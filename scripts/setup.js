#!/usr/bin/env node
/**
 * Phase 0 — v4 Installer setup.
 *
 *   1. Validate config shape + API key.
 *   2. Verify required OAuth toolkits are connected on the Composio project.
 *   3. Call composio.mcp.create() with the enabled toolkit allowlist.
 *   4. Call composio.mcp.generate() to materialise the per-user URL.
 *   5. Write the URL to config.composio.mcpServerUrl.
 *   6. Verify the URL by listing tools as an MCP client.
 *
 * No SDK tool calls. Tool execution is exclusively over MCP.
 *
 * Usage: node setup.js --config /data/social-marketing/config.json
 */

const fs = require('fs');
const path = require('path');
const { Composio } = require('@composio/core');
const { listTools, resetForTests } = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const configPath = getArg('config');
if (!configPath) { console.error('Usage: node setup.js --config <config.json>'); process.exit(1); }

const checks = [];
const record = (label, ok, fix) => {
  checks.push({ label, ok, fix });
  console.log(`${ok ? '✅' : '❌'} ${label}${!ok && fix ? `\n   → ${fix}` : ''}`);
};
const skip = (label) => console.log(`⏭  ${label}`);

function loadConfig() {
  const p = path.resolve(configPath);
  if (!fs.existsSync(p)) { console.error(`Config not found: ${p}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function saveConfig(config) {
  fs.writeFileSync(path.resolve(configPath), JSON.stringify(config, null, 2) + '\n');
}

const TOOLKIT_FOR_PLATFORM = {
  instagram: 'instagram',
  facebook:  'facebook',
  tiktok:    'tiktok'
};

function enabledToolkits(config) {
  const list = [];
  for (const [name, p] of Object.entries(config.platforms || {})) {
    if (p?.enabled && TOOLKIT_FOR_PLATFORM[name]) list.push(TOOLKIT_FOR_PLATFORM[name]);
  }
  if (config.googleDrive?.enabled) list.push('googledrive');
  // OpenAI image generation is always allowed; the project credential gates it.
  list.push('openai');
  return list;
}

async function fetchAuthConfigs(composio, toolkits) {
  // Composio's TS SDK exposes auth config listing under composio.authConfigs.
  // We need exactly one auth config per toolkit. If zero, prompt operator;
  // if multiple, take the first and warn.
  const out = {};
  for (const tk of toolkits) {
    const list = await composio.authConfigs.list({ toolkit: tk });
    const items = list.items || list.data || list || [];
    if (!items.length) {
      record(`auth config exists for "${tk}"`, false,
        `Open https://app.composio.dev → your project → Auth Configs and create one for "${tk}". For OAuth toolkits (instagram/facebook/tiktok/googledrive) finish the connect flow afterwards.`);
      continue;
    }
    if (items.length > 1) {
      console.log(`   ℹ multiple auth configs for "${tk}" — using first (${items[0].id})`);
    }
    out[tk] = items[0].id;
    record(`auth config for "${tk}" → ${items[0].id}`, true);
  }
  return out;
}

(async () => {
  console.log(`\n=== v4 Setup — config: ${configPath} ===\n`);
  const config = loadConfig();

  // 1. shape + key
  const apiKey = config.composio?.apiKey;
  const userId = config.composio?.userId;
  if (!apiKey)  { record('composio.apiKey set', false, 'Set composio.apiKey from your Composio project'); process.exit(1); }
  if (!userId)  { record('composio.userId set', false, 'Set composio.userId — per-agent identifier'); process.exit(1); }
  record('composio.apiKey set', true);
  record(`composio.userId "${userId}" set`, true);

  // 2. composio client
  let composio;
  try { composio = new Composio({ apiKey }); record('Composio API key valid (client constructed)', true); }
  catch (e) { record('Composio API key valid', false, e.message); process.exit(1); }

  // 3. enabled toolkits → auth configs
  const toolkits = enabledToolkits(config);
  if (!toolkits.length) { record('At least one platform enabled', false, 'Enable instagram/facebook/tiktok/googleDrive in config.platforms'); process.exit(1); }
  record(`Enabled toolkits: ${toolkits.join(', ')}`, true);

  const authMap = await fetchAuthConfigs(composio, toolkits);
  const missing = toolkits.filter((tk) => !authMap[tk]);
  if (missing.length) { console.log(`\n❌ Missing auth configs for: ${missing.join(', ')}\n`); process.exit(1); }

  // 4. mcp.create
  const serverName = `restaurant-marketing-${userId}`;
  let server;
  try {
    server = await composio.mcp.create(serverName, {
      toolkits: toolkits.map((tk) => ({ toolkit: tk, authConfigId: authMap[tk] })),
      // No allowedTools allowlist: we want every tool the toolkit advertises.
      // If Composio requires the field, pass an empty array — they document
      // omitting it as "all tools". If runtime rejects it, the test plan
      // says to set the explicit list per toolkit.
    });
    record(`MCP server created: ${server.id}`, true);
  } catch (e) {
    record('MCP server create', false, `composio.mcp.create failed: ${e.message}`);
    process.exit(1);
  }

  // 5. mcp.generate (per-user URL)
  let instance;
  try {
    instance = await composio.mcp.generate(userId, server.id);
    record(`MCP server URL → ${instance.url.slice(0, 60)}…`, true);
  } catch (e) {
    record('MCP server URL generated', false, e.message);
    process.exit(1);
  }

  // 6. persist
  config.composio.mcpServerUrl = instance.url;
  config.composio.mcpServerId = server.id;
  saveConfig(config);
  record('config.composio.mcpServerUrl written', true);

  // 7. verify by listing tools as an MCP client
  resetForTests();
  try {
    const tools = await listTools(config);
    if (!tools.length) throw new Error('Server returned 0 tools');
    record(`MCP client lists ${tools.length} tools`, true);
  } catch (e) {
    record('MCP client lists tools', false, `Listing tools from ${instance.url} failed: ${e.message}`);
    process.exit(1);
  }

  // 8. Telegram
  const tg = config.telegram || {};
  if (!tg.botToken) { record('Telegram bot token', false, 'Set telegram.botToken'); }
  else {
    try {
      const r = await fetch(`https://api.telegram.org/bot${tg.botToken}/getMe`);
      const j = await r.json();
      if (!j.ok) record('Telegram bot reachable', false, j.description || 'rejected');
      else record(`Telegram bot @${j.result.username}`, true);
    } catch (e) { record('Telegram bot reachable', false, e.message); }
  }
  if (!tg.chatId) record('Telegram chat_id', false, 'Send a message to the bot then GET /getUpdates');
  else record(`Telegram chat_id ${tg.chatId}`, true);

  console.log('\n' + '─'.repeat(60));
  const failed = checks.filter((c) => !c.ok);
  if (!failed.length) { console.log(`✅ All ${checks.length} checks passed.`); process.exit(0); }
  console.log(`❌ ${failed.length}/${checks.length} failed.`);
  process.exit(1);
})();

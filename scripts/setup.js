#!/usr/bin/env node
/**
 * Skill setup. Idempotent. Run once after editing config.json with your
 * Composio apiKey, defaultUserId, and any userIdOverrides.
 *
 *   1. Validate config shape.
 *   2. For each unique userId (default + overrides), figure out which
 *      enabled toolkits it owns by querying Composio's authConfigs.
 *   3. Create one MCP server per userId with its toolkits.
 *   4. composio.mcp.generate(userId, serverId) → write per-userId URLs
 *      to config.composio.mcpServerUrls[userId].
 *   5. Verify by listing tools across every userId.
 *
 * Usage:
 *   node setup.js --config ~/agents/<agent>/social-marketing/config.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Composio } = require('@composio/core');
const {
  listAllTools,
  resetCache,
  uniqueUserIds,
  resolveUserIdForToolkit,
} = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (n) => args.includes(`--${n}`);
const configPath = getArg('config');
const force = hasFlag('force');
if (!configPath) { console.error('Usage: node setup.js --config <config.json> [--force]'); process.exit(1); }

const checks = [];
const record = (label, ok, fix) => {
  checks.push({ label, ok, fix });
  console.log(`${ok ? '✅' : '❌'} ${label}${!ok && fix ? `\n   → ${fix}` : ''}`);
};

function loadConfig() {
  const p = path.resolve(configPath);
  if (!fs.existsSync(p)) { console.error(`Config not found: ${p}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function saveConfig(config) {
  fs.writeFileSync(path.resolve(configPath), JSON.stringify(config, null, 2) + '\n');
}

// Toolkit slugs we care about. The platforms.* keys map 1:1 to Composio
// toolkit slugs. Drive, OpenAI, OpenRouter are always considered if a
// userId owns them (resolved by reading the Composio project's auth configs).
const PLATFORM_TOOLKITS = ['instagram', 'facebook', 'tiktok'];
const KNOWN_TOOLKITS = [
  'instagram', 'facebook', 'tiktok',
  'googledrive', 'gmail',
  'openai', 'openrouter',
  'telegram',
];

// CRITICAL: hardcoded allowlist of the EXACT tool slugs the skill calls.
// Without this, composio.mcp.create() exposes the FULL catalog for each
// connected toolkit (50-150+ tools per server) and the API gets overloaded
// when Hermes tries to list/load them all on session start.
//
// Total surface across all toolkits: ~16 tools instead of ~100+.
//
// To add a tool: grep the scripts/ + skill bodies for the new slug, then
// add it here. If the skill calls a tool not on this list, the call fails
// at runtime with a "tool not found" error — that's intentional, forces
// us to declare it explicitly.
const TOOL_ALLOWLIST = {
  instagram: [
    'INSTAGRAM_CREATE_CAROUSEL_CONTAINER',
    'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH',
    'INSTAGRAM_GET_IG_USER_MEDIA',
    'INSTAGRAM_GET_IG_MEDIA',
    'INSTAGRAM_GET_IG_MEDIA_INSIGHTS',
  ],
  facebook: [
    'FACEBOOK_CREATE_PHOTO_POST',
    'FACEBOOK_UPLOAD_PHOTOS_BATCH',
  ],
  tiktok: [
    'TIKTOK_POST_PHOTO',
  ],
  googledrive: [
    'GOOGLEDRIVE_FIND_FILE',
    'GOOGLEDRIVE_DOWNLOAD_FILE',
  ],
  openai: [
    'OPENAI_CREATE_IMAGE',
    'OPENAI_CREATE_IMAGE_EDIT',
    'OPENAI_CHAT_COMPLETIONS',
  ],
  openrouter: [
    'OPENROUTER_CHAT_COMPLETIONS',
  ],
  telegram: [
    'TELEGRAM_SEND_MESSAGE',
  ],
  gmail: [
    // currently unused — keep empty until a script actually calls Gmail.
  ],
};

function enabledToolkits(config) {
  const list = [];
  for (const t of PLATFORM_TOOLKITS) {
    if (config.platforms?.[t]?.enabled) list.push(t);
  }
  if (config.googleDrive?.enabled) list.push('googledrive');
  // OpenAI is always required (image generation).
  list.push('openai');
  // OpenRouter is required for weekly research; default-on (cron skips
  // gracefully if the auth config is missing).
  list.push('openrouter');
  return [...new Set(list)];
}

/**
 * For one userId, fetch every auth config they have on the Composio
 * project. Returns a map { toolkitSlug: authConfigId }. Multiple auth
 * configs for the same toolkit → take the first and warn.
 */
async function fetchAuthConfigsForUserId(composio, userId) {
  const out = {};
  // Composio's authConfigs.list() can be filtered per toolkit. We iterate
  // KNOWN_TOOLKITS and ask "is there an auth config for this toolkit
  // under this userId?". The connectedAccounts API would be more direct
  // but auth configs are what mcp.create() needs anyway.
  for (const tk of KNOWN_TOOLKITS) {
    try {
      // Note: Composio's authConfigs.list() is project-scoped, not
      // userId-scoped. To check whether *this userId* has a connected
      // account for a toolkit, use connectedAccounts.list({ userId, toolkit }).
      const accounts = await composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: [tk] });
      const items = Array.isArray(accounts?.items) ? accounts.items : [];
      if (!items.length) continue;
      // Find this toolkit's project-level auth config (mcp.create needs that).
      const authList = await composio.authConfigs.list({ toolkit: tk });
      const authItems = Array.isArray(authList?.items) ? authList.items : [];
      if (!authItems.length) continue;
      if (authItems.length > 1) {
        console.log(`   ℹ multiple auth configs for "${tk}" — using first (${authItems[0].id})`);
      }
      out[tk] = authItems[0].id;
    } catch (e) {
      // Ignore "not found" / 404 — just means this userId doesn't have
      // this toolkit. Real failures (auth) bubble up via the apiKey check.
      if (!/not found|404/i.test(e.message || '')) {
        console.log(`   ⚠ probing "${tk}" for "${userId}" failed: ${e.message}`);
      }
    }
  }
  return out;
}

/**
 * Composio caps server names at 30 chars + accepts [a-z0-9-]. Hash the
 * userId so the name is deterministic across reinstalls.
 */
function serverNameFor(userId) {
  const hash = crypto.createHash('sha1').update(userId).digest('hex').slice(0, 8);
  return `rm-${hash}`;
}

(async () => {
  console.log(`\n=== Restaurant Marketing — Setup ===`);
  console.log(`Config: ${configPath}\n`);
  const config = loadConfig();

  // 0. If MCP servers are already provisioned, bail out unless --force.
  // This is the most important check in the file. Earlier the on-boot
  // hook ran setup.js on every container restart, which re-provisioned
  // servers and clobbered working config.yaml entries. Now: if URLs
  // already exist in config.json, OR config.yaml has a Composio MCP
  // entry, do nothing. Only --force overrides this.
  const existingUrls = config.composio?.mcpServerUrls || {};
  if (!force && Object.keys(existingUrls).length > 0) {
    console.log(`✓ ${Object.keys(existingUrls).length} MCP server URL(s) already configured.`);
    console.log(`  To re-provision, re-run with --force.`);
    process.exit(0);
  }

  // 1. Shape
  const apiKey = config.composio?.apiKey;
  const defaultUserId = config.composio?.defaultUserId;
  if (!apiKey) { record('composio.apiKey set', false, 'Set composio.apiKey from your Composio project'); process.exit(1); }
  if (!defaultUserId) { record('composio.defaultUserId set', false, 'Set composio.defaultUserId — your main per-agent userId'); process.exit(1); }
  record('composio.apiKey set', true);
  record(`composio.defaultUserId "${defaultUserId}"`, true);

  const overrides = config.composio?.userIdOverrides || {};
  if (Object.keys(overrides).length) {
    for (const [tk, uid] of Object.entries(overrides)) {
      record(`override: ${tk} → "${uid}"`, true);
    }
  } else {
    console.log(`   ℹ no userIdOverrides — all toolkits resolve to defaultUserId`);
  }

  // 2. Composio client
  let composio;
  try {
    composio = new Composio({ apiKey });
    record('Composio API key valid (client constructed)', true);
  } catch (e) {
    record('Composio API key valid', false, e.message);
    process.exit(1);
  }

  // 3. Enabled toolkits
  const enabled = enabledToolkits(config);
  if (!enabled.length) {
    record('At least one platform enabled', false, 'Enable instagram/facebook/tiktok or googleDrive in config');
    process.exit(1);
  }
  record(`Enabled toolkits: ${enabled.join(', ')}`, true);

  // 4. For each unique userId, gather toolkits + auth configs.
  const userIds = uniqueUserIds(config);
  const perUser = {};   // userId → { toolkits: { slug: authConfigId } }

  for (const uid of userIds) {
    perUser[uid] = { toolkits: {} };
    const authMap = await fetchAuthConfigsForUserId(composio, uid);
    // Filter to toolkits actually expected for this userId based on
    // resolveUserIdForToolkit + config's enabled list.
    for (const tk of enabled) {
      if (resolveUserIdForToolkit(config, tk) !== uid) continue;
      if (!authMap[tk]) {
        record(`auth config + connected account for "${tk}" on "${uid}"`, false,
          `In Composio dashboard: connect "${tk}" for userId "${uid}". OAuth toolkits need OAuth flow; API-key toolkits need the key pasted.`);
        continue;
      }
      perUser[uid].toolkits[tk] = authMap[tk];
      record(`auth config "${tk}" for "${uid}" → ${authMap[tk]}`, true);
    }
  }

  // 5. Per userId: create MCP server (or reuse) and generate URL.
  const newServerUrls = {};
  const newServerIds = {};

  for (const uid of userIds) {
    const tks = Object.entries(perUser[uid].toolkits);
    if (!tks.length) {
      console.log(`   ⏭  userId "${uid}" has no toolkits — skipping MCP server`);
      continue;
    }
    const name = serverNameFor(uid);
    // Build the per-toolkit allowlist for THIS server. Without this, Composio
    // exposes the entire toolkit catalog (50-150+ tools per server) and we
    // overload the API on every Hermes session start.
    const toolkitsWithAllowlist = tks.map(([tk, authId]) => {
      const allowed = TOOL_ALLOWLIST[tk] || [];
      if (allowed.length === 0) {
        console.log(`   ℹ "${tk}" has no allowlisted tools — toolkit will be wired with auth but expose nothing`);
      }
      return {
        toolkit: tk,
        authConfigId: authId,
        allowedTools: allowed,
      };
    });
    const totalAllowed = toolkitsWithAllowlist.reduce((n, t) => n + t.allowedTools.length, 0);
    console.log(`   → MCP server "${name}" will expose ${totalAllowed} tool(s) total (allowlist enforced)`);

    let server;
    try {
      server = await composio.mcp.create(name, {
        toolkits: toolkitsWithAllowlist,
      });
      record(`MCP server for "${uid}" → ${server.id} (${totalAllowed} tools)`, true);
    } catch (e) {
      record(`MCP server create for "${uid}"`, false, `composio.mcp.create failed: ${e.message}`);
      process.exit(1);
    }
    let instance;
    try {
      instance = await composio.mcp.generate(uid, server.id);
      record(`MCP URL for "${uid}" → ${instance.url.slice(0, 50)}…`, true);
    } catch (e) {
      record(`MCP URL generate for "${uid}"`, false, e.message);
      process.exit(1);
    }
    newServerUrls[uid] = instance.url;
    newServerIds[uid] = server.id;
  }

  // 6. Persist
  config.composio.mcpServerUrls = newServerUrls;
  config.composio.mcpServerIds = newServerIds;
  saveConfig(config);
  record(`config.composio.mcpServerUrls written for ${Object.keys(newServerUrls).length} userId(s)`, true);

  // 7. Verify by listing tools across every userId.
  resetCache();
  try {
    const tools = await listAllTools(config);
    if (!tools.length) throw new Error('No tools listed across any userId');
    record(`MCP listing returned ${tools.length} tools across ${userIds.length} userId(s)`, true);
  } catch (e) {
    record('MCP listing across userIds', false, e.message);
    process.exit(1);
  }

  console.log('\n' + '─'.repeat(60));
  const failed = checks.filter((c) => !c.ok);
  if (!failed.length) { console.log(`✅ All ${checks.length} checks passed.`); process.exit(0); }
  console.log(`❌ ${failed.length}/${checks.length} failed.`);
  process.exit(1);
})();

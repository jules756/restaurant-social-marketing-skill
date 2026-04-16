#!/usr/bin/env node
/**
 * Phase 0 — Installer setup validator.
 *
 * Runs before handing the Telegram bot to the restaurant owner. Validates that
 * every piece of technical plumbing is in place so the owner never has to
 * answer a technical question.
 *
 * Usage: node setup.js --config social-marketing/config.json
 *
 * Checks (each line reports ✅ or ❌ with a fix instruction):
 *   1. Two-actor boundary — config.json has no restaurant-content keys.
 *   2. node v18+
 *   3. @composio/core SDK reachable from Node (global install).
 *   4. Telegram bot token + chat id work.
 *   5. Composio project API key authenticates against /api/v3/toolkits.
 *   6. Composio user_id scoping works (list connected accounts).
 *   7. Composio-routed OpenRouter reaches the configured image model.
 *   8. Composio MCP server URL accepts JSON-RPC initialize with ck_ key.
 *   9. Per-platform `enabled` booleans — MCP resolves connections at call time.
 *  10. Google Drive enabled + folderName set.
 *
 * Exit code: 0 if every enabled check passes, 1 otherwise.
 */

const { executeTool, executeProxy, loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config');
if (!configPath) {
  console.error('Usage: node setup.js --config <config.json>');
  process.exit(1);
}

const checks = [];
const record = (label, ok, fix) => {
  checks.push({ label, ok, fix });
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${label}${!ok && fix ? `\n   → ${fix}` : ''}`);
};

function checkTwoActorBoundary(config) {
  // Installer-scope only. Any of these in config.json = someone crossed the
  // owner-scope boundary. Restaurant content belongs in
  // restaurant-profile.json, written by the orchestrator via Telegram.
  const forbidden = ['restaurant', 'menu', 'chef', 'history', 'recipes', 'vibe', 'signatureDishes'];
  const present = forbidden.filter((k) => k in config);
  if (present.length > 0) {
    record(
      'config.json is Installer-scope only',
      false,
      `Remove these keys — they are owner-scope and belong in social-marketing/restaurant-profile.json: ${present.join(', ')}`
    );
    return false;
  }
  record('config.json is Installer-scope only', true);
  return true;
}

async function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  record(
    `node ${process.version}`,
    major >= 18,
    'Install Node.js v18+ (https://nodejs.org or nvm install 18)'
  );
}

async function checkComposioSdk() {
  // The SDK is not used by this script, but its global presence is a product
  // prerequisite for provisioning tooling and future script migration.
  try {
    require.resolve('@composio/core');
    record('@composio/core SDK reachable', true);
  } catch {
    record(
      '@composio/core SDK reachable',
      false,
      'Run: npm install -g @composio/core'
    );
  }
}

async function checkTelegram(config) {
  const tg = config.telegram;
  if (!tg?.botToken) {
    record('Telegram bot token set', false, 'Set telegram.botToken in config.json (from @BotFather)');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${tg.botToken}/getMe`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      record('Telegram bot reachable', false, `Telegram rejected token: ${data.description || res.status}`);
      return;
    }
    record(`Telegram bot @${data.result.username}`, true);
    if (!tg.chatId) {
      record('Telegram chat_id set', false, 'Set telegram.chatId (send a message to the bot, then check https://api.telegram.org/bot<token>/getUpdates)');
    } else {
      record(`Telegram chat_id ${tg.chatId}`, true);
    }
  } catch (e) {
    record('Telegram bot reachable', false, `Network error: ${e.message}`);
  }
}

async function checkComposioRestAuth(config) {
  const key = config.composio?.projectApiKey;
  if (!key) {
    record('composio.projectApiKey set', false, 'Set composio.projectApiKey (ak_... project-scoped REST key from https://app.composio.dev)');
    return false;
  }
  try {
    const res = await fetch('https://backend.composio.dev/api/v3/toolkits', {
      headers: { 'x-api-key': key }
    });
    if (res.ok) {
      record('Composio project API key valid', true);
      return true;
    }
    record('Composio project API key valid', false, `Composio rejected key (${res.status}). Verify project API key at https://app.composio.dev → your project → API Keys`);
    return false;
  } catch (e) {
    record('Composio project API key valid', false, `Network error: ${e.message}`);
    return false;
  }
}

async function checkComposioUserId(config, restOk) {
  if (!restOk) {
    record('composio.userId scoping works', false, 'REST key not working — cannot verify user_id');
    return;
  }
  if (!config.composio?.userId) {
    record('composio.userId set', false, 'Set composio.userId (per-restaurant entity identifier from provisioning)');
    return;
  }
  try {
    await executeTool(config, 'COMPOSIO_LIST_CONNECTED_ACCOUNTS', {});
    record(`composio.userId "${config.composio.userId}" resolves`, true);
  } catch (e) {
    record(
      `composio.userId "${config.composio.userId}" resolves`,
      false,
      `Composio returned error: ${e.message}. Verify the user_id matches the entity under which OAuth connections were created.`
    );
  }
}

async function checkComposioImageModel(config, restOk) {
  if (!restOk) {
    record('Image model reachable via Composio', false, 'REST key not working — cannot verify');
    return;
  }
  const model = config.imageGen?.model;
  if (!model) {
    record('config.imageGen.model set', false, 'Set config.imageGen.model (e.g. google/gemini-2.5-flash-image-preview)');
    return;
  }
  try {
    const result = await executeProxy(
      config,
      'https://openrouter.ai/api/v1/models',
      'GET'
    );
    const body = result.data || result.body || result;
    const models = (body.data || body.models || []).map((m) => m.id || m.name).filter(Boolean);
    const found = models.includes(model);
    record(
      `Image model "${model}" reachable via Composio`,
      found,
      found ? null : `Model not in OpenRouter catalog via your Composio Project. Either add OpenRouter credential to the Project, or update config.imageGen.model to a model that's listed at https://openrouter.ai/models.`
    );
  } catch (e) {
    record(
      `Image model "${model}" reachable via Composio`,
      false,
      `Composio proxy to OpenRouter failed: ${e.message}. Verify the OpenRouter credential is attached to this Composio Project.`
    );
  }
}

async function checkComposioMcp(config) {
  const mcp = config.composio?.mcp;
  if (!mcp?.url) {
    record(
      'composio.mcp.url set',
      false,
      'Set composio.mcp.url (expect https://backend.composio.dev/v3/mcp/<server_id>/mcp?user_id=<entity>)'
    );
    return;
  }
  if (!mcp.serverKey) {
    record(
      'composio.mcp.serverKey set',
      false,
      'Set composio.mcp.serverKey (ck_... server key from https://app.composio.dev → MCP Servers)'
    );
    return;
  }
  try {
    const res = await fetch(mcp.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mcp.serverKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'setup-js', version: '1.0' }
        }
      })
    });
    record(
      `Composio MCP reachable`,
      res.ok,
      res.ok ? null : `MCP server returned ${res.status}. Verify URL format is https://backend.composio.dev/v3/mcp/<server_id>/mcp?user_id=<entity> and ck_ key matches.`
    );
  } catch (e) {
    record('Composio MCP reachable', false, `Network error: ${e.message}`);
  }
}

function checkPlatformEnabled(name, platformConfig) {
  if (!platformConfig?.enabled) {
    console.log(`⏭  ${name} disabled in config.platforms`);
    return;
  }
  record(`${name} enabled — will post via Composio MCP`, true);
}

function checkGoogleDriveEnabled(config) {
  const drive = config.googleDrive;
  if (!drive?.enabled) {
    console.log('⏭  Google Drive disabled in config.googleDrive');
    return;
  }
  if (!drive.folderName) {
    record('googleDrive.folderName set', false, 'Set googleDrive.folderName in config.json (default: "akira-agent_src")');
    return;
  }
  record(`Google Drive enabled — folder "${drive.folderName}" will be found/created at first use`, true);
}

(async () => {
  console.log(`\n=== Restaurant Social Marketing — Phase 0 Setup Check ===\nConfig: ${configPath}\n`);
  const config = loadConfig(configPath);

  checkTwoActorBoundary(config);
  await checkNode();
  await checkComposioSdk();
  await checkTelegram(config);
  const restOk = await checkComposioRestAuth(config);
  await checkComposioUserId(config, restOk);
  await checkComposioImageModel(config, restOk);
  await checkComposioMcp(config);

  for (const name of ['tiktok', 'instagram', 'facebook']) {
    checkPlatformEnabled(name, config.platforms?.[name]);
  }
  checkGoogleDriveEnabled(config);

  const failed = checks.filter((c) => !c.ok);
  console.log('\n' + '─'.repeat(60));
  if (failed.length === 0) {
    console.log(`✅ All ${checks.length} checks passed. Bot is ready for the restaurant owner.`);
    process.exit(0);
  } else {
    console.log(`❌ ${failed.length}/${checks.length} checks failed. Fix these before handing the bot to the owner:`);
    failed.forEach((c) => console.log(`   • ${c.label}${c.fix ? ` — ${c.fix}` : ''}`));
    process.exit(1);
  }
})();

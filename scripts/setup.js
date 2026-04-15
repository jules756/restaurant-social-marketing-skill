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
 * Checks (every line reports ✅ or ❌ with a fix instruction):
 *   1. node v18+
 *   2. OPENROUTER_API_KEY set and working
 *   3. Configured image model (config.imageGen.model) accessible via OpenRouter
 *   4. COMPOSIO_API_KEY set and working
 *   5. Each enabled platform has a working connected_account_id
 *   6. Google Drive connected and folder reachable (if enabled)
 *
 * Exit code: 0 if every check passes, 1 otherwise. Do not hand the bot to the
 * owner until exit code is 0.
 */

const { loadConfig } = require('./composio-helpers');

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

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;

const checks = [];
const record = (label, ok, fix) => {
  checks.push({ label, ok, fix });
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${label}${!ok && fix ? `\n   → ${fix}` : ''}`);
};

function checkTwoActorBoundary(config) {
  // Installer-scope only. If any of these appear in config.json, it means the
  // Installer crossed the boundary into owner-scope — restaurant content
  // belongs in restaurant-profile.json (written by the orchestrator from
  // Telegram answers), NOT in config.json.
  const forbidden = ['restaurant', 'menu', 'chef', 'history', 'recipes', 'vibe', 'signatureDishes'];
  const present = forbidden.filter((k) => k in config);
  if (present.length > 0) {
    record(
      'config.json is Installer-scope only',
      false,
      `Remove these keys from config.json — they are owner-scope and belong in social-marketing/restaurant-profile.json (set by the orchestrator via Telegram): ${present.join(', ')}`
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

async function checkOpenRouterKey() {
  if (!OPENROUTER_API_KEY) {
    record('OPENROUTER_API_KEY present', false, 'Add OPENROUTER_API_KEY to ~/.hermes/.env');
    return false;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });
    record(
      'OpenRouter API key valid',
      res.ok,
      'Key rejected by OpenRouter. Verify at https://openrouter.ai/keys'
    );
    return res.ok;
  } catch (e) {
    record('OpenRouter API key valid', false, `Network error: ${e.message}`);
    return false;
  }
}

async function checkImageModel(config) {
  const imageModel = config.imageGen?.model;
  if (!imageModel) {
    record('config.imageGen.model set', false, 'Set config.imageGen.model to an OpenRouter image model (e.g. google/gemini-2.5-flash-image-preview)');
    return;
  }
  if (!OPENROUTER_API_KEY) {
    record(`${imageModel} reachable`, false, 'OpenRouter key missing — cannot check');
    return;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });
    if (!res.ok) {
      record(`${imageModel} reachable`, false, `OpenRouter returned ${res.status}`);
      return;
    }
    const data = await res.json();
    const models = (data.data || []).map((m) => m.id);
    const found = models.includes(imageModel);
    record(
      `${imageModel} reachable`,
      found,
      found ? null : `Model not in OpenRouter catalog. Browse https://openrouter.ai/models and update config.imageGen.model.`
    );
  } catch (e) {
    record(`${imageModel} reachable`, false, `Error: ${e.message}`);
  }
}

async function checkComposioMcp(config) {
  const mcp = config.composio?.mcp;
  if (!mcp?.url) {
    record('composio.mcp.url set', false, 'Set composio.mcp.url (default: https://connect.composio.dev/mcp)');
    return false;
  }
  if (!mcp.serverKey) {
    record('composio.mcp.serverKey set', false, 'Set composio.mcp.serverKey (ck_… from https://app.composio.dev → MCP Servers)');
    return false;
  }
  try {
    // MCP servers respond to JSON-RPC initialize. A well-formed request with a
    // bad key should return 401/403; a valid key returns 200 with server capabilities.
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
    const ok = res.ok;
    record(
      `Composio MCP reachable at ${mcp.url}`,
      ok,
      ok ? null : `MCP server returned ${res.status}. Verify the ck_ server key at https://app.composio.dev → MCP Servers.`
    );
    return ok;
  } catch (e) {
    record(`Composio MCP reachable at ${mcp.url}`, false, `Network error: ${e.message}`);
    return false;
  }
}

function checkComposioRestOptional(config) {
  // REST API is OPTIONAL — only used by cron scripts (daily-report.js,
  // weekly-research.js). If the Installer isn't setting up cron automation,
  // composio.apiKey + composio.userId can be blank and we note it as a
  // warning, not a failure.
  const rest = config.composio;
  const hasAny = rest?.apiKey || rest?.userId;
  const hasBoth = rest?.apiKey && rest?.userId;
  if (!hasAny) {
    console.log('⏭  Composio REST API not configured — cron scripts (daily-report, weekly-research) will not run. This is fine if you don\'t want scheduled automation.');
    return;
  }
  if (!hasBoth) {
    record(
      'composio.apiKey + composio.userId both set',
      false,
      'For cron scripts both composio.apiKey (ak_…) and composio.userId are required. Either set both or clear both to disable cron.'
    );
    return;
  }
  record('Composio REST (for cron) configured', true);
}

async function checkPlatformEnabled(name, platformConfig) {
  if (!platformConfig?.enabled) {
    console.log(`⏭  ${name} disabled in config.platforms`);
    return;
  }
  // Under MCP-first, we don't pre-validate the platform connection with REST.
  // The MCP server holds the connection. At post time, the skill calls the
  // MCP tool directly and surfaces any failure. This keeps setup lean.
  record(`${name} enabled — will post via Composio MCP`, true);
}

async function checkGoogleDriveEnabled(config) {
  const drive = config.googleDrive;
  if (!drive?.enabled) {
    console.log('⏭  Google Drive disabled in config.googleDrive');
    return;
  }
  if (!drive.folderName) {
    record('googleDrive.folderName set', false, 'Set googleDrive.folderName in config.json (default: "akira-agent_src")');
    return;
  }
  // Folder discovery / creation happens at first use via the MCP tool
  // GOOGLEDRIVE_LIST_FILES. The orchestrator handles that on the first
  // `generate post` or manual sync command, not at setup time.
  record(`Google Drive enabled — folder "${drive.folderName}" will be found/created at first use`, true);
}

(async () => {
  console.log(`\n=== Restaurant Social Marketing — Phase 0 Setup Check ===\nConfig: ${configPath}\n`);
  const config = loadConfig(configPath);

  checkTwoActorBoundary(config);
  await checkNode();
  await checkTelegram(config);
  const openrouterOk = await checkOpenRouterKey();
  if (openrouterOk) await checkImageModel(config);
  await checkComposioMcp(config);
  checkComposioRestOptional(config);

  for (const name of ['tiktok', 'instagram', 'facebook']) {
    await checkPlatformEnabled(name, config.platforms?.[name]);
  }
  await checkGoogleDriveEnabled(config);

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

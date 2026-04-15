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

const { executeTool, executeProxy, loadConfig, PLATFORMS } = require('./composio-helpers');

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

async function checkComposioKey() {
  if (!COMPOSIO_API_KEY) {
    record('COMPOSIO_API_KEY present', false, 'Add COMPOSIO_API_KEY to ~/.hermes/.env');
    return false;
  }
  try {
    const res = await fetch('https://backend.composio.dev/api/v3/toolkits', {
      headers: { 'x-api-key': COMPOSIO_API_KEY }
    });
    record(
      'Composio API key valid',
      res.ok,
      res.ok ? null : `Composio rejected key (${res.status}). Verify at https://app.composio.dev`
    );
    return res.ok;
  } catch (e) {
    record('Composio API key valid', false, `Network error: ${e.message}`);
    return false;
  }
}

async function checkPlatform(name, platformConfig, composioOk) {
  if (!platformConfig?.enabled) {
    console.log(`⏭  ${name} disabled — skipping`);
    return;
  }
  if (!composioOk) {
    record(`${name} connected`, false, 'Composio key not working — cannot verify platform');
    return;
  }
  const accountId = platformConfig.composioAccountId;
  if (!accountId || accountId.startsWith('ca_xxx')) {
    record(
      `${name} connected`,
      false,
      `Set platforms.${name}.composioAccountId in config.json. Connect the account at https://app.composio.dev → Toolkits → ${name} → Connect.`
    );
    return;
  }
  const userId = `setup_check_${Date.now()}`;
  const testTool = {
    tiktok: PLATFORMS.tiktok.userStatsTool,
    instagram: PLATFORMS.instagram.userInsightsTool,
    facebook: PLATFORMS.facebook.pageInsightsTool
  }[name];
  try {
    await executeTool(COMPOSIO_API_KEY, accountId, userId, testTool, {});
    record(`${name} connected (${accountId})`, true);
  } catch (e) {
    record(
      `${name} connected (${accountId})`,
      false,
      `Test call failed: ${e.message}. Reconnect at https://app.composio.dev → Toolkits → ${name}`
    );
  }
}

async function checkGoogleDrive(config, composioOk) {
  const drive = config.googleDrive;
  if (!drive?.enabled) {
    console.log('⏭  Google Drive disabled — skipping');
    return;
  }
  if (!composioOk) {
    record('Google Drive connected', false, 'Composio key not working — cannot verify Drive');
    return;
  }
  if (!drive.composioAccountId || drive.composioAccountId.startsWith('ca_gdrive_xxx')) {
    record('Google Drive connected', false, 'Set googleDrive.composioAccountId in config.json');
    return;
  }
  if (!drive.folderId) {
    record('Google Drive folder set', false, 'Set googleDrive.folderId in config.json');
    return;
  }
  try {
    await executeTool(
      COMPOSIO_API_KEY,
      drive.composioAccountId,
      `setup_check_${Date.now()}`,
      PLATFORMS.googledrive.listFilesTool,
      { folder_id: drive.folderId, page_size: 1 }
    );
    record(`Google Drive folder ${drive.folderId} reachable`, true);
  } catch (e) {
    record(
      'Google Drive folder reachable',
      false,
      `List call failed: ${e.message}. Verify folder sharing with the connected Drive account.`
    );
  }
}

(async () => {
  console.log(`\n=== Restaurant Social Marketing — Phase 0 Setup Check ===\nConfig: ${configPath}\n`);
  const config = loadConfig(configPath);

  checkTwoActorBoundary(config);
  await checkNode();
  await checkTelegram(config);
  const openrouterOk = await checkOpenRouterKey();
  if (openrouterOk) await checkImageModel(config);
  const composioOk = await checkComposioKey();

  for (const name of ['tiktok', 'instagram', 'facebook']) {
    await checkPlatform(name, config.platforms?.[name], composioOk);
  }
  await checkGoogleDrive(config, composioOk);

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

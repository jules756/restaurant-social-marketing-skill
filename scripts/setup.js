#!/usr/bin/env node
/**
 * Phase 0 — Installer setup validator.
 *
 * End-to-end readiness check. Each enabled platform is probed via a real
 * Composio tool call; Google Drive has its folder resolved or created and
 * the id written back to config; image generation is verified with a
 * minimal live call.
 *
 * Usage: node setup.js --config social-marketing/config.json
 */

const fs = require('fs');
const path = require('path');
const {
  executeTool,
  loadConfig,
  getClient,
  findOrCreateDriveFolder,
  PLATFORMS
} = require('./composio-helpers');

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
  console.log(`${ok ? '✅' : '❌'} ${label}${!ok && fix ? `\n   → ${fix}` : ''}`);
};

function saveConfig(config) {
  fs.writeFileSync(path.resolve(configPath), JSON.stringify(config, null, 2) + '\n');
}

function checkTwoActorBoundary(config) {
  const forbidden = ['restaurant', 'menu', 'chef', 'history', 'recipes', 'vibe', 'signatureDishes'];
  const present = forbidden.filter((k) => k in config);
  if (present.length > 0) {
    record('config.json is Installer-scope only', false,
      `Remove these keys — they belong in restaurant-profile.json: ${present.join(', ')}`);
    return;
  }
  record('config.json is Installer-scope only', true);
}

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  record(`node ${process.version}`, major >= 18, 'Install Node.js v18+');
}

function checkComposioSdk() {
  try {
    require.resolve('@composio/core');
    record('@composio/core SDK reachable', true);
  } catch {
    record('@composio/core SDK reachable', false,
      'Run: cd ~/restaurant-social-marketing-skill && npm install');
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
      record('Telegram bot reachable', false, `Token rejected: ${data.description || res.status}`);
      return;
    }
    record(`Telegram bot @${data.result.username}`, true);
    if (!tg.chatId) {
      record('Telegram chat_id set', false,
        'Send a message to the bot, then curl https://api.telegram.org/bot<TOKEN>/getUpdates to read the chat_id');
    } else {
      record(`Telegram chat_id ${tg.chatId}`, true);
    }
  } catch (e) {
    record('Telegram bot reachable', false, `Network error: ${e.message}`);
  }
}

async function checkComposioAuth(config) {
  if (!config.composio?.apiKey) {
    record('composio.apiKey set', false,
      'Set composio.apiKey — org-scoped API key from https://app.composio.dev');
    return false;
  }
  try {
    getClient(config);
    record('Composio API key valid', true);
    return true;
  } catch (e) {
    record('Composio API key valid', false, `Key rejected: ${e.message}`);
    return false;
  }
}

function checkUserId(config) {
  if (!config.composio?.userId) {
    record('composio.userId set', false,
      'Set composio.userId — per-restaurant entity identifier');
    return false;
  }
  record(`composio.userId "${config.composio.userId}" set`, true);
  return true;
}

async function checkImageModel(config, authOk) {
  if (!authOk) { record('Image model reachable', false, 'API key not valid'); return; }
  const model = config.imageGen?.model;
  if (!model) {
    record('config.imageGen.model set', false,
      'Set imageGen.model (e.g. google/gemini-2.5-flash-image-preview)');
    return;
  }
  // Minimal live probe. A 1-token chat completion confirms the OpenRouter
  // credential is wired up in the Composio org AND the model is available.
  try {
    const result = await executeTool(config, 'OPENROUTER_CHAT_COMPLETIONS', {
      model,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 1
    });
    const body = result.data || result.body || result;
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    record(`Image model "${model}" live`, true);
  } catch (e) {
    record(`Image model "${model}" live`, false,
      `Test call failed: ${e.message}. Verify the OpenRouter credential is attached to this Composio org and the model is listed at https://openrouter.ai/models.`);
  }
}

async function checkPlatform(name, platformConfig, config, userOk) {
  if (!platformConfig?.enabled) {
    console.log(`⏭  ${name} disabled`);
    return;
  }
  if (!userOk) {
    record(`${name} connected`, false, 'userId not set — cannot verify');
    return;
  }
  const platform = PLATFORMS[name];
  const probeTool = {
    tiktok:    platform.userStatsTool,
    instagram: platform.userInsightsTool,
    facebook:  platform.pageInsightsTool
  }[name];
  if (!probeTool) {
    record(`${name} connected`, false, `No probe tool known for ${name}`);
    return;
  }
  try {
    await executeTool(config, probeTool, {});
    record(`${name} connected (live)`, true);
  } catch (e) {
    const msg = e.message || '';
    record(`${name} connected (live)`, false,
      `Probe ${probeTool} failed: ${msg.slice(0, 200)}. Verify the ${name} account is connected under userId "${config.composio.userId}" in the Composio dashboard.`);
  }
}

async function checkGoogleDrive(config, userOk) {
  const drive = config.googleDrive;
  if (!drive?.enabled) {
    console.log('⏭  Google Drive disabled');
    return;
  }
  if (!userOk) {
    record('Google Drive ready', false, 'userId not set — cannot verify');
    return;
  }
  const folderName = drive.folderName;
  if (!folderName) {
    record('googleDrive.folderName set', false,
      'Set googleDrive.folderName (default: "akira-agent_src")');
    return;
  }
  try {
    const { id, created } = await findOrCreateDriveFolder(config, folderName);
    drive.folderId = id;
    saveConfig(config);
    if (created) {
      console.log(`   ✨ Created new Drive folder "${folderName}" (${id})`);
    }
    record(`Google Drive folder "${folderName}" → ${id}`, true);
  } catch (e) {
    record(`Google Drive folder "${folderName}" ready`, false,
      `Failed to find/create folder: ${e.message.slice(0, 200)}. Verify the Drive connection is attached to userId "${config.composio.userId}" in Composio and has write access.`);
  }
}

(async () => {
  console.log(`\n=== Restaurant Social Marketing — Phase 0 Setup Check ===\nConfig: ${configPath}\n`);
  const config = loadConfig(configPath);

  checkTwoActorBoundary(config);
  checkNode();
  checkComposioSdk();
  await checkTelegram(config);
  const authOk = await checkComposioAuth(config);
  const userOk = checkUserId(config);
  await checkImageModel(config, authOk);
  for (const name of ['tiktok', 'instagram', 'facebook']) {
    await checkPlatform(name, config.platforms?.[name], config, authOk && userOk);
  }
  await checkGoogleDrive(config, authOk && userOk);

  const failed = checks.filter((c) => !c.ok);
  console.log('\n' + '─'.repeat(60));
  if (failed.length === 0) {
    console.log(`✅ All ${checks.length} checks passed. Bot is ready for the restaurant owner.`);
    process.exit(0);
  } else {
    console.log(`❌ ${failed.length}/${checks.length} failed:`);
    failed.forEach((c) => console.log(`   • ${c.label}${c.fix ? ` — ${c.fix}` : ''}`));
    process.exit(1);
  }
})();

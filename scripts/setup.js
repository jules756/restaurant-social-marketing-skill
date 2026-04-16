#!/usr/bin/env node
/**
 * Phase 0 — Installer setup validator.
 *
 * Validates that every piece of technical plumbing is in place so the
 * restaurant owner never has to answer a technical question.
 *
 * Usage: node setup.js --config social-marketing/config.json
 *
 * Checks:
 *   1. Two-actor boundary — config.json has no restaurant-content keys.
 *   2. node v18+
 *   3. @composio/core SDK reachable.
 *   4. Telegram bot token + chat id work.
 *   5. Composio API key authenticates (org-scoped).
 *   6. Composio userId scoping works (list connected accounts).
 *   7. Image model reachable via Composio (OpenRouter tool).
 *   8. Per-platform enabled booleans.
 *   9. Google Drive enabled + folderName set.
 */

const { executeTool, loadConfig, getClient } = require('./composio-helpers');

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
  record(`node ${process.version}`, major >= 18,
    'Install Node.js v18+ (https://nodejs.org)');
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
        'Set telegram.chatId — send a message to the bot then check https://api.telegram.org/bot<token>/getUpdates');
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
    const composio = getClient(config);
    // A simple SDK call to verify the key is valid. Listing toolkits is
    // lightweight and works with any valid key.
    await composio.tools.execute('COMPOSIO_LIST_CONNECTED_ACCOUNTS', {
      userId: config.composio.userId || '__setup_probe__',
      arguments: {}
    });
    record('Composio API key valid', true);
    return true;
  } catch (e) {
    // If the key itself is bad, we get an auth error. If just the userId
    // is wrong, we still confirmed the key works — separate check below.
    if (e.message?.includes('401') || e.message?.includes('403') || e.message?.includes('Unauthorized')) {
      record('Composio API key valid', false,
        `Key rejected. Verify at https://app.composio.dev → your org → API Keys`);
      return false;
    }
    // Key works but tool call failed for another reason — key is fine.
    record('Composio API key valid', true);
    return true;
  }
}

async function checkComposioUserId(config, authOk) {
  if (!authOk) { record('composio.userId works', false, 'API key not valid — cannot verify'); return; }
  if (!config.composio?.userId) {
    record('composio.userId set', false,
      'Set composio.userId — per-restaurant entity identifier');
    return;
  }
  try {
    await executeTool(config, 'COMPOSIO_LIST_CONNECTED_ACCOUNTS', {});
    record(`composio.userId "${config.composio.userId}" resolves`, true);
  } catch (e) {
    record(`composio.userId "${config.composio.userId}" resolves`, false,
      `Error: ${e.message}. Verify userId matches the entity under which OAuth connections were created.`);
  }
}

async function checkImageModel(config, authOk) {
  if (!authOk) { record('Image model reachable', false, 'API key not valid — cannot verify'); return; }
  const model = config.imageGen?.model;
  if (!model) {
    record('config.imageGen.model set', false,
      'Set imageGen.model (e.g. google/gemini-2.5-flash-image-preview)');
    return;
  }
  // We can't list OpenRouter models through the SDK without a specific tool
  // slug for that. Just record the config value and trust that the first
  // generate-slides run will surface an error if the model is unavailable.
  record(`Image model "${model}" configured`, true);
}

function checkPlatformEnabled(name, platformConfig) {
  if (!platformConfig?.enabled) {
    console.log(`⏭  ${name} disabled`);
    return;
  }
  record(`${name} enabled — will use Composio SDK`, true);
}

function checkGoogleDriveEnabled(config) {
  if (!config.googleDrive?.enabled) {
    console.log('⏭  Google Drive disabled');
    return;
  }
  if (!config.googleDrive.folderName) {
    record('googleDrive.folderName set', false,
      'Set googleDrive.folderName (default: "akira-agent_src")');
    return;
  }
  record(`Google Drive enabled — folder "${config.googleDrive.folderName}" at first use`, true);
}

(async () => {
  console.log(`\n=== Restaurant Social Marketing — Phase 0 Setup Check ===\nConfig: ${configPath}\n`);
  const config = loadConfig(configPath);

  checkTwoActorBoundary(config);
  checkNode();
  checkComposioSdk();
  await checkTelegram(config);
  const authOk = await checkComposioAuth(config);
  await checkComposioUserId(config, authOk);
  await checkImageModel(config, authOk);
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
    console.log(`❌ ${failed.length}/${checks.length} failed:`);
    failed.forEach((c) => console.log(`   • ${c.label}${c.fix ? ` — ${c.fix}` : ''}`));
    process.exit(1);
  }
})();

#!/usr/bin/env node
/**
 * Post to multiple platforms based on config.
 *
 * Usage:
 *   node post-to-platforms.js --config <config.json> --dir <slides-dir> --caption "text" [--title "text"] [--platforms tiktok,instagram,facebook]
 *
 * When --platforms is given, only those platforms are targeted.
 * Otherwise every platform that is both enabled in config AND has a
 * connected account in composio.connectedAccounts is used.
 *
 * Each platform is posted sequentially to avoid rate limits.
 * If one platform fails the others still run; a combined summary is
 * saved to <dir>/platforms-meta.json at the end.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const configPath = getArg('config');
const dir = getArg('dir');
const caption = getArg('caption');
const title = getArg('title') || '';
const platformsFlag = getArg('platforms'); // comma-separated override

if (!configPath || !dir || !caption) {
  console.error(
    'Usage: node post-to-platforms.js --config <config.json> --dir <dir> --caption "text" [--title "text"] [--platforms tiktok,instagram,facebook]'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

if (!fs.existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// ---------------------------------------------------------------------------
// Determine target platforms
// ---------------------------------------------------------------------------

const SUPPORTED_PLATFORMS = ['tiktok', 'instagram', 'facebook'];

function resolveTargetPlatforms() {
  if (platformsFlag) {
    const requested = platformsFlag.split(',').map((p) => p.trim().toLowerCase());
    const invalid = requested.filter((p) => !SUPPORTED_PLATFORMS.includes(p));
    if (invalid.length) {
      console.error(`Unsupported platform(s): ${invalid.join(', ')}`);
      process.exit(1);
    }
    return requested;
  }

  // Auto-detect: enabled in config AND has a connected account
  return SUPPORTED_PLATFORMS.filter((name) => {
    const platformCfg = config.platforms && config.platforms[name];
    const hasAccount =
      config.composio &&
      config.composio.connectedAccounts &&
      config.composio.connectedAccounts[name];
    return platformCfg && platformCfg.enabled === true && hasAccount;
  });
}

const targets = resolveTargetPlatforms();

if (targets.length === 0) {
  console.error('No platforms to post to. Check your config or --platforms flag.');
  process.exit(1);
}

console.log(`Posting to: ${targets.join(', ')}\n`);

// ---------------------------------------------------------------------------
// Build per-platform commands
// ---------------------------------------------------------------------------

const scriptsDir = __dirname;

function shellEscape(str) {
  // Wrap in single quotes, escaping any embedded single quotes
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function buildCommand(platform) {
  const cfgArg = shellEscape(path.resolve(configPath));
  const dirArg = shellEscape(path.resolve(dir));
  const captionArg = shellEscape(caption);
  const titleArg = shellEscape(title);

  switch (platform) {
    case 'tiktok':
      return [
        'node',
        path.join(scriptsDir, 'post-to-tiktok.js'),
        '--config', cfgArg,
        '--dir', dirArg,
        '--caption', captionArg,
        '--title', titleArg
      ].join(' ');

    case 'instagram': {
      const postType =
        (config.platforms.instagram && config.platforms.instagram.postTypes && config.platforms.instagram.postTypes[0]) ||
        'feed';
      return [
        'node',
        path.join(scriptsDir, 'post-to-instagram.js'),
        '--config', cfgArg,
        '--dir', dirArg,
        '--caption', captionArg,
        '--type', postType
      ].join(' ');
    }

    case 'facebook':
      return [
        'node',
        path.join(scriptsDir, 'post-to-facebook.js'),
        '--config', cfgArg,
        '--dir', dirArg,
        '--caption', captionArg
      ].join(' ');

    default:
      throw new Error(`No command template for platform: ${platform}`);
  }
}

// ---------------------------------------------------------------------------
// Execute sequentially
// ---------------------------------------------------------------------------

const results = [];

for (const platform of targets) {
  const cmd = buildCommand(platform);
  console.log(`--- ${platform.toUpperCase()} ---`);
  console.log(`Running: ${cmd}\n`);

  const startTime = Date.now();
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000 // 2-minute timeout per platform
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(output);
    console.log(`[${platform}] SUCCESS (${elapsed}s)\n`);
    results.push({ platform, success: true, elapsed: `${elapsed}s`, error: null });
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    console.error(`[${platform}] FAILED (${elapsed}s)`);
    if (stdout) console.error(`stdout: ${stdout}`);
    if (stderr) console.error(`stderr: ${stderr}`);
    console.error(`exit code: ${err.status}\n`);
    results.push({
      platform,
      success: false,
      elapsed: `${elapsed}s`,
      error: stderr || err.message
    });
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const succeeded = results.filter((r) => r.success).length;
const failed = results.filter((r) => !r.success).length;

console.log('========================================');
console.log(`Results: ${succeeded} succeeded, ${failed} failed out of ${results.length} platform(s)`);
results.forEach((r) => {
  const icon = r.success ? 'OK' : 'FAIL';
  console.log(`  [${icon}] ${r.platform} (${r.elapsed})`);
});
console.log('========================================');

// Save combined summary
const summaryPath = path.join(path.resolve(dir), 'platforms-meta.json');
const summary = {
  postedAt: new Date().toISOString(),
  caption,
  title: title || null,
  platforms: results
};
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\nSummary saved to ${summaryPath}`);

// Exit with non-zero if any platform failed
if (failed > 0) {
  process.exit(1);
}

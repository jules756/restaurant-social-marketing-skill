#!/usr/bin/env node
/**
 * Offline tests for the three platform posting scripts.
 * Uses --dry-run on each script — no real Composio calls.
 *
 * Run: node tests/test-posting.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'tests/fixtures/posts/test-post');
const CONFIG_PATH = path.join(ROOT, 'tests/fixtures/config.test.json');

let passed = 0;
let failed = 0;
const failures = [];

const section = (n) => console.log(`\n── ${n} ──`);
const ok = (m) => { console.log(`  ✅ ${m}`); passed++; };
const notOk = (m, d) => { console.log(`  ❌ ${m}`); if (d) console.log(`     ${d}`); failed++; failures.push(m); };

function setupFixture() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const pngOnePx = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
    'base64'
  );
  for (let i = 1; i <= 6; i++) {
    fs.writeFileSync(path.join(FIXTURE_DIR, `slide-${i}.png`), pngOnePx);
  }
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'caption.txt'),
    'Fresh handmade Bolognese at Rodolfino — Stockholm. Book now → https://rodolfino.se?utm_source=instagram&utm_medium=social'
  );
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({
      telegram: { botToken: 'test', chatId: 'test' },
      composio: { apiKey: 'ak_test', userId: 'test-user' },
      platforms: {
        instagram: { enabled: true },
        tiktok: { enabled: true },
        facebook: { enabled: true }
      },
      googleDrive: { enabled: false, folderName: 'akira-agent_src' },
      imageGen: { model: 'google/gemini-3.1-flash-image-preview' },
      timezone: 'Europe/Stockholm',
      country: 'SE'
    }, null, 2)
  );
}

function runScript(script, args) {
  const res = spawnSync('node', [path.join(ROOT, 'scripts', script), ...args], {
    encoding: 'utf-8',
    env: { ...process.env, COMPOSIO_API_KEY: 'ak_test' }
  });
  const lines = (res.stdout || '').trim().split('\n');
  const lastJson = lines.reverse().find((l) => {
    try { JSON.parse(l); return true; } catch { return false; }
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, parsed: lastJson ? JSON.parse(lastJson) : null };
}

function assertOk(result, name) {
  if (result.code !== 0) { notOk(`${name} exit=0`, `exit=${result.code} stderr=${(result.stderr || '').slice(0, 200)}`); return false; }
  ok(`${name} exit=0`);
  if (!result.parsed) { notOk(`${name} parseable JSON`, result.stdout?.slice(0, 200)); return false; }
  ok(`${name} parseable JSON`);
  if (result.parsed.ok !== true) { notOk(`${name} ok=true`, JSON.stringify(result.parsed)); return false; }
  ok(`${name} ok=true`);
  return true;
}

function assertField(parsed, field, expected, name) {
  if (parsed[field] === expected) ok(`${name}.${field} === ${JSON.stringify(expected)}`);
  else notOk(`${name}.${field} === ${JSON.stringify(expected)}`, `got ${JSON.stringify(parsed[field])}`);
}

section('Setup');
setupFixture();
ok(`fixture: ${FIXTURE_DIR}`);
ok(`config:  ${CONFIG_PATH}`);

section('post-to-instagram.js --dry-run');
{
  const r = runScript('post-to-instagram.js', ['--config', CONFIG_PATH, '--dir', FIXTURE_DIR, '--dry-run']);
  if (assertOk(r, 'ig-live')) {
    assertField(r.parsed, 'platform', 'instagram', 'ig-live');
    assertField(r.parsed, 'mode', 'live', 'ig-live');
    assertField(r.parsed, 'slidesPosted', 6, 'ig-live');
    assertField(r.parsed, 'dryRun', true, 'ig-live');
  }
}

section('post-to-instagram.js --dry-run --draft');
{
  const r = runScript('post-to-instagram.js', ['--config', CONFIG_PATH, '--dir', FIXTURE_DIR, '--dry-run', '--draft']);
  if (assertOk(r, 'ig-draft')) {
    assertField(r.parsed, 'mode', 'draft', 'ig-draft');
  }
}

section('post-to-tiktok.js --dry-run');
{
  const r = runScript('post-to-tiktok.js', ['--config', CONFIG_PATH, '--dir', FIXTURE_DIR, '--dry-run']);
  if (assertOk(r, 'tiktok')) {
    assertField(r.parsed, 'platform', 'tiktok', 'tiktok');
    assertField(r.parsed, 'mode', 'draft', 'tiktok');
    assertField(r.parsed, 'slidesPosted', 6, 'tiktok');
  }
}

section('post-to-facebook.js --dry-run (carousel)');
{
  const r = runScript('post-to-facebook.js', ['--config', CONFIG_PATH, '--dir', FIXTURE_DIR, '--dry-run']);
  if (assertOk(r, 'fb-carousel')) {
    assertField(r.parsed, 'mode', 'carousel', 'fb-carousel');
    assertField(r.parsed, 'slidesPosted', 6, 'fb-carousel');
  }
}

section('post-to-facebook.js --dry-run --single');
{
  const r = runScript('post-to-facebook.js', ['--config', CONFIG_PATH, '--dir', FIXTURE_DIR, '--dry-run', '--single']);
  if (assertOk(r, 'fb-single')) {
    assertField(r.parsed, 'mode', 'single', 'fb-single');
    assertField(r.parsed, 'slidesPosted', 1, 'fb-single');
  }
}

section('Errors: missing --dir');
{
  const r = runScript('post-to-instagram.js', ['--config', CONFIG_PATH, '--dry-run']);
  if (r.code !== 0 && r.parsed?.ok === false) ok('ig missing --dir → non-zero + {ok:false}');
  else notOk('ig missing --dir', JSON.stringify(r.parsed));
}

section('Errors: platform disabled');
{
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  cfg.platforms.instagram.enabled = false;
  const p = path.join(ROOT, 'tests/fixtures/config.disabled.json');
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  const r = runScript('post-to-instagram.js', ['--config', p, '--dir', FIXTURE_DIR, '--dry-run']);
  if (r.code !== 0 && r.parsed?.ok === false && /Instagram is not enabled/.test(r.parsed.error || '')) {
    ok('ig disabled → clear error');
  } else notOk('ig disabled', JSON.stringify(r.parsed));
  fs.unlinkSync(p);
}

section('Errors: empty dir');
{
  const empty = path.join(ROOT, 'tests/fixtures/posts/empty');
  fs.mkdirSync(empty, { recursive: true });
  const r = runScript('post-to-instagram.js', ['--config', CONFIG_PATH, '--dir', empty, '--dry-run']);
  if (r.code !== 0 && r.parsed?.ok === false && /No slide/.test(r.parsed.error || '')) {
    ok('empty dir → clear error');
  } else notOk('empty dir', JSON.stringify(r.parsed));
  fs.rmSync(empty, { recursive: true, force: true });
}

console.log(`\n${'─'.repeat(40)}\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
process.exit(0);

#!/usr/bin/env node
/**
 * Stage 3 (TikTok variant): post a generated slide set to TikTok as a
 * photo carousel.
 *
 * Per the Composio TikTok toolkit, TIKTOK_POST_PHOTO requires HTTPS URLs
 * from a TikTok-verified domain. Local file paths are not accepted —
 * unverified URLs return 403.
 *
 * Until verified-domain hosting is wired up, this script:
 *   - With config.platforms.tiktok.verifiedDomain set: maps slide files
 *     to URLs by joining the domain + a public path the user has set up
 *     (config.platforms.tiktok.publicPath, default "/posts/").
 *     Caller is responsible for uploading the slides to that path before
 *     running this script.
 *   - Without verifiedDomain: warns and exits 0 with a "skipped" status.
 *     The post still completes for Instagram/Facebook.
 *
 * Reads state.json. Writes state.tiktok.{publishId, status, postedAt}.
 *
 * Usage:
 *   node post-to-tiktok.js --config <config.json> --dir <post-dir> [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { callTool, loadConfig } = require('./mcp-client');
const { readState, writeState } = require('./state-helpers');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const dir = getArg('dir');
const dryRun = hasFlag('dry-run');

function emit(payload) { console.log(JSON.stringify(payload)); }
function fail(msg) { emit({ ok: false, platform: 'tiktok', error: msg }); process.exit(1); }
if (!dir) fail('--dir is required');

(async () => {
  try {
    const config = loadConfig(configPath);
    if (!config.platforms?.tiktok?.enabled) fail('TikTok is not enabled in config.platforms.tiktok');

    const verifiedDomain = config.platforms?.tiktok?.verifiedDomain;
    if (!verifiedDomain) {
      // Warn and skip — let the rest of the pipeline succeed for IG/FB.
      const note = 'TikTok photo carousels require a TikTok-verified domain. ' +
                   'Set config.platforms.tiktok.verifiedDomain (e.g. "https://media.your-restaurant.com") ' +
                   'and upload slides to it before posting. Skipping for now.';
      console.error(`⚠ ${note}`);
      emit({ ok: true, platform: 'tiktok', skipped: true, reason: 'no verified domain' });
      return;
    }

    const postDir = path.resolve(dir);
    const state = readState(postDir);
    if (!state) fail(`No state.json in ${postDir}`);

    const slides = (state.slides || [])
      .filter((s) => s.overlaid && s.final)
      .map((s) => s.final);
    if (slides.length === 0) fail(`No overlaid slides ready in ${postDir}`);
    if (slides.length > 35) {
      console.error(`  ℹ trimming to 35 slides (TikTok max)`);
      slides.length = 35;
    }

    const publicPath = config.platforms?.tiktok?.publicPath || '/posts/';
    const postSegment = path.basename(postDir);
    const photoUrls = slides.map((file) =>
      `${verifiedDomain.replace(/\/$/, '')}${publicPath}${postSegment}/${file}`
    );

    const captionPath = path.join(postDir, 'caption.txt');
    const caption = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf-8').trim() : '';

    if (dryRun) {
      console.log(`[DRY-RUN] verified domain: ${verifiedDomain}`);
      photoUrls.forEach((u) => console.log(`  - ${u}`));
      console.log(`[DRY-RUN] caption: ${caption.slice(0, 80)}…`);
      emit({ ok: true, platform: 'tiktok', dryRun: true, slidesPosted: slides.length });
      return;
    }

    // TIKTOK_POST_PHOTO with the verified-domain URLs.
    const result = await callTool(config, 'TIKTOK_POST_PHOTO', {
      photo_images: photoUrls,
      photo_cover_index: 0,
      title: caption.slice(0, 90),
      description: caption,
      privacy_level: 'SELF_ONLY',          // post lands as draft; owner adds music + publishes
      post_mode: 'DIRECT_POST',
      auto_add_music: false,
    });
    const publishId = result?.data?.publish_id || result?.publish_id || result?.data?.id;
    if (!publishId) throw new Error(`TIKTOK_POST_PHOTO returned no publish_id: ${JSON.stringify(result).slice(0, 400)}`);

    state.tiktok = state.tiktok || {};
    state.tiktok.publishId = publishId;
    state.tiktok.status = 'submitted';
    state.tiktok.postedAt = new Date().toISOString();
    writeState(postDir, state);

    emit({
      ok: true, platform: 'tiktok', mode: 'draft',
      publishId, slidesPosted: slides.length,
      note: 'Owner must add trending sound and publish from TikTok inbox.',
    });
  } catch (e) {
    fail(e.message);
  }
})();

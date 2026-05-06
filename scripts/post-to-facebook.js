#!/usr/bin/env node
/**
 * Stage 3 (FB variant): post a generated slide set to a Facebook Page.
 *
 * Per the Composio Facebook toolkit:
 *   - FACEBOOK_CREATE_PHOTO_POST: single image. Accepts `photo` (local file)
 *     or `url` (publicly accessible HTTPS, no redirects). Requires page_id.
 *   - FACEBOOK_UPLOAD_PHOTOS_BATCH: up to 50 photos in one batch. Accepts
 *     `photos` (local files) or `photo_urls`. Optional `album_id`.
 *
 * Multiple slides → batch upload. Single slide → photo post.
 *
 * page_id resolution:
 *   1. config.platforms.facebook.pageId (preferred — set once at install)
 *   2. else: error out with instructions (we do NOT silently scan accounts)
 *
 * Reads state.json. Writes state.facebook.{postId, postedAt}.
 *
 * Usage:
 *   node post-to-facebook.js --config <config.json> --dir <post-dir> [--single] [--dry-run]
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
const single = hasFlag('single');
const dryRun = hasFlag('dry-run');

function emit(payload) { console.log(JSON.stringify(payload)); }
function fail(msg) { emit({ ok: false, platform: 'facebook', error: msg }); process.exit(1); }
if (!dir) fail('--dir is required');

(async () => {
  try {
    const config = loadConfig(configPath);
    if (!config.platforms?.facebook?.enabled) fail('Facebook is not enabled in config.platforms.facebook');

    const pageId = config.platforms?.facebook?.pageId;
    if (!pageId && !dryRun) fail('config.platforms.facebook.pageId is not set. Find your numeric Page ID at https://www.facebook.com/<your-page>/about and set it in config.json.');

    const postDir = path.resolve(dir);
    const state = readState(postDir);
    if (!state) fail(`No state.json in ${postDir}`);

    const slides = (state.slides || [])
      .filter((s) => s.overlaid && s.final)
      .map((s) => path.join(postDir, s.final))
      .filter((p) => fs.existsSync(p));
    if (slides.length === 0) fail(`No overlaid slides ready to post in ${postDir}`);

    const captionPath = path.join(postDir, 'caption.txt');
    const caption = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf-8').trim() : '';

    const useBatch = slides.length > 1 && !single;

    if (dryRun) {
      console.log(`[DRY-RUN] page_id: ${pageId || '(unset)'}`);
      console.log(`[DRY-RUN] slides: ${slides.length}, mode: ${useBatch ? 'batch' : 'single'}`);
      slides.forEach((s) => console.log(`  - ${path.basename(s)}`));
      console.log(`[DRY-RUN] caption preview: ${caption.slice(0, 80)}…`);
      emit({ ok: true, platform: 'facebook', dryRun: true, slidesPosted: useBatch ? slides.length : 1 });
      return;
    }

    state.facebook = state.facebook || {};

    if (!useBatch) {
      // Single image post
      const result = await callTool(config, 'FACEBOOK_CREATE_PHOTO_POST', {
        page_id: pageId,
        photo: path.resolve(slides[0]),
        message: caption,
      });
      const postId = result?.data?.id || result?.id || result?.data?.post_id;
      if (!postId) throw new Error(`Photo post returned no id: ${JSON.stringify(result).slice(0, 400)}`);
      state.facebook.postId = postId;
      state.facebook.postedAt = new Date().toISOString();
      writeState(postDir, state);
      emit({ ok: true, platform: 'facebook', mode: 'single', postId, slidesPosted: 1 });
      return;
    }

    // Multi-photo: batch upload + a single feed post would be the FB-correct
    // pattern for showing a multi-photo card, but Composio's
    // FACEBOOK_UPLOAD_PHOTOS_BATCH is a one-shot upload with optional album_id.
    // For a single visible carousel-style post, the simplest reliable path
    // is: batch-upload to an album (creates per-photo posts in feed), and
    // surface the album as the canonical link.
    const result = await callTool(config, 'FACEBOOK_UPLOAD_PHOTOS_BATCH', {
      page_id: pageId,
      photos: slides.map((s) => path.resolve(s)),
      published: true,
    });
    const ids = (result?.data?.ids || result?.ids || []);
    if (!ids.length) throw new Error(`Batch upload returned no ids: ${JSON.stringify(result).slice(0, 400)}`);

    state.facebook.batchIds = ids;
    state.facebook.postedAt = new Date().toISOString();
    state.status = 'posted';
    writeState(postDir, state);

    emit({
      ok: true, platform: 'facebook', mode: 'batch',
      photoIds: ids, slidesPosted: ids.length,
    });
  } catch (e) {
    fail(e.message);
  }
})();

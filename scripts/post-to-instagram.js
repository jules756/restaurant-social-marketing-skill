#!/usr/bin/env node
/**
 * Stage 3: post a generated slide set to Instagram as a carousel.
 *
 * Reads state.json from the post directory, only proceeds if status is
 * "overlaid" (or "overlaid-partial" with at least 2 slides done).
 *
 * Approach (per Composio Instagram toolkit docs):
 *   - INSTAGRAM_CREATE_CAROUSEL_CONTAINER: pass child_image_files (local
 *     absolute paths) directly. Composio hosts the files server-side.
 *     Returns a creation_id once all children reach FINISHED status
 *     (the action handles polling internally up to max_wait_seconds).
 *   - INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH: publish the creation_id.
 *
 * No more S3 dance, no more re-generating images, no more inline overlay.
 *
 * Usage:
 *   node post-to-instagram.js --config <config.json> --dir <post-dir> [--draft] [--dry-run]
 *
 * Output (last line is JSON):
 *   {"ok": true, "mediaId": "...", "permalink": "...", "platform": "instagram"}
 *   {"ok": false, "platform": "instagram", "error": "..."}
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
const draft = hasFlag('draft');
const dryRun = hasFlag('dry-run');
const scheduleMinutes = (() => { const v = getArg('schedule'); return v ? parseInt(v, 10) : null; })();

function emit(payload) { console.log(JSON.stringify(payload)); }
function fail(msg) { emit({ ok: false, platform: 'instagram', error: msg }); process.exit(1); }
if (!dir) fail('--dir is required');

(async () => {
  try {
    const config = loadConfig(configPath);
    if (!config.platforms?.instagram?.enabled) fail('Instagram is not enabled in config.platforms.instagram');

    const postDir = path.resolve(dir);
    const state = readState(postDir);
    if (!state) fail(`No state.json in ${postDir}. Run generate-slides + add-text-overlay first.`);

    // Collect overlaid slides in order, expecting absolute paths.
    const slides = [];
    for (const slot of state.slides || []) {
      if (!slot.overlaid || !slot.final) continue;
      const abs = path.join(postDir, slot.final);
      if (!fs.existsSync(abs)) {
        console.error(`  ⚠ slot ${slot.index}: overlaid=true but file missing at ${abs}`);
        continue;
      }
      slides.push(abs);
    }
    if (slides.length < 2) fail(`Need at least 2 overlaid slides for a carousel; have ${slides.length}.`);
    if (slides.length > 10) {
      console.error(`  ℹ trimming to 10 slides (Instagram carousel max)`);
      slides.length = 10;
    }

    const captionPath = path.join(postDir, 'caption.txt');
    const caption = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf-8').trim() : '';
    if (caption.length > 2200) {
      console.error(`  ⚠ caption is ${caption.length} chars; Instagram cap is 2200.`);
    }

    if (dryRun) {
      console.log(`[DRY-RUN] would create carousel with ${slides.length} slides`);
      slides.forEach((s) => console.log(`  - ${path.basename(s)}`));
      console.log(`[DRY-RUN] caption preview: ${caption.slice(0, 80)}…`);
      console.log(`[DRY-RUN] mode: ${draft ? 'draft (no publish)' : (scheduleMinutes ? `scheduled +${scheduleMinutes}min` : 'live')}`);
      emit({ ok: true, platform: 'instagram', dryRun: true, slidesPosted: slides.length });
      return;
    }

    state.instagram = state.instagram || {};

    // 1. Create the carousel container with all children at once. Per
    //    Composio docs, child_image_files takes an array of local files.
    //    The action waits for all child containers to reach FINISHED
    //    status before returning (configurable via max_wait_seconds).
    const containerArgs = {
      child_image_files: slides,    // array of absolute paths
      caption,
    };
    if (scheduleMinutes && scheduleMinutes >= 10) {
      containerArgs.scheduled_publish_time = Math.floor(Date.now() / 1000) + scheduleMinutes * 60;
    }
    console.log(`Creating carousel container with ${slides.length} slides…`);
    const carouselResult = await callTool(config, 'INSTAGRAM_CREATE_CAROUSEL_CONTAINER', containerArgs);
    const creationId = carouselResult?.data?.id || carouselResult?.id || carouselResult?.data?.creation_id;
    if (!creationId) {
      throw new Error(`Carousel container returned no id: ${JSON.stringify(carouselResult).slice(0, 400)}`);
    }
    console.log(`  ✅ container ${creationId}`);
    state.instagram.carouselId = creationId;
    writeState(postDir, state);

    // 2. Branch on mode.
    if (scheduleMinutes && scheduleMinutes >= 10) {
      const publishAt = new Date(Date.now() + scheduleMinutes * 60 * 1000).toISOString();
      state.instagram.scheduledPublishAt = publishAt;
      state.status = 'scheduled';
      writeState(postDir, state);
      emit({
        ok: true, platform: 'instagram', mode: 'scheduled',
        creationId, scheduledPublishAt: publishAt, slidesPosted: slides.length,
      });
      return;
    }

    if (draft) {
      state.status = 'draft';
      writeState(postDir, state);
      emit({
        ok: true, platform: 'instagram', mode: 'draft',
        creationId, slidesPosted: slides.length,
        note: 'Container expires in 24h unless published.',
      });
      return;
    }

    // 3. Publish.
    console.log('Publishing carousel…');
    const publishResult = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH', {
      creation_id: creationId,
    });
    const mediaId = publishResult?.data?.id || publishResult?.id;
    if (!mediaId) throw new Error(`Publish returned no media id: ${JSON.stringify(publishResult).slice(0, 400)}`);

    // 4. Fetch permalink (publish usually returns just the id).
    let permalink = publishResult?.data?.permalink || publishResult?.permalink || null;
    if (!permalink) {
      try {
        const meta = await callTool(config, 'INSTAGRAM_GET_IG_MEDIA', {
          ig_media_id: mediaId, fields: 'permalink',
        });
        permalink = meta?.data?.permalink || null;
      } catch { /* not all toolkit versions expose this */ }
    }

    state.instagram.mediaId = mediaId;
    state.instagram.permalink = permalink;
    state.instagram.postedAt = new Date().toISOString();
    state.status = 'posted';
    writeState(postDir, state);

    emit({
      ok: true, platform: 'instagram', mode: 'live',
      mediaId, permalink, slidesPosted: slides.length, creationId,
    });
  } catch (e) {
    fail(e.message);
  }
})();

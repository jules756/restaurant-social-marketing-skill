#!/usr/bin/env node
/**
 * Post a generated slide set to Facebook, via Composio.
 *
 * Multi-photo carousel when multiple slides are present. Falls back to a
 * single-image post when only one slide exists.
 *
 * Usage:
 *   node post-to-facebook.js --config <config.json> --dir <post-dir> [--single] [--dry-run]
 *
 * Expects in --dir:
 *   slide-1.png … slide-N.png    (up to 10 for carousel)
 *   caption.txt
 *
 * Flags:
 *   --single   Force single-image mode (posts slide-1 only).
 *   --dry-run  Don't call Composio. Log the steps that would run.
 *
 * Facebook multi-photo flow:
 *   1. For each slide, upload the image + create an unpublished photo
 *      post (published=false). Collect each returned photo_id.
 *   2. Create a parent post with message=caption and attached_media
 *      referencing the child photo_ids.
 *   3. The parent post publishes the carousel.
 *
 * Output (stdout, last line is machine-readable JSON):
 *   {"ok": true, "postId": "...", "permalink": "...", "platform": "facebook", "mode": "carousel"}
 */

const fs = require('fs');
const path = require('path');
const { callTool, loadConfig, findToolByPattern } = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const dir = getArg('dir');
const single = hasFlag('single');
const dryRun = hasFlag('dry-run');

function fail(msg) {
  console.log(JSON.stringify({ ok: false, platform: 'facebook', error: msg }));
  process.exit(1);
}
function dryLog(label, obj) {
  console.log(`[DRY-RUN] ${label}: ${JSON.stringify(obj)}`);
}

if (!dir) fail('--dir is required');

(async () => {
  try {
    const config = loadConfig(configPath);
    if (!config.platforms?.facebook?.enabled) fail('Facebook is not enabled in config.platforms.facebook');

    const postDir = path.resolve(dir);
    const slides = [];
    for (let i = 1; i <= 10; i++) {
      const finalP = path.join(postDir, `slide-${i}.png`);
      const rawP = path.join(postDir, `slide-${i}-raw.png`);
      if (fs.existsSync(finalP)) slides.push(finalP);
      else if (fs.existsSync(rawP)) slides.push(rawP);
    }
    if (slides.length === 0) fail(`No slide-*.png found in ${postDir}`);

    const captionPath = path.join(postDir, 'caption.txt');
    const caption = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf-8').trim() : '';

    const useCarousel = slides.length > 1 && !single;

    if (dryRun) {
      if (useCarousel) {
        slides.forEach((_, i) =>
          dryLog(`upload_photo_${i + 1}_unpublished`, { tool: 'FACEBOOK_CREATE_PHOTO_POST', published: false })
        );
        dryLog('create_parent_post', { message_preview: caption.slice(0, 80), attached_media_count: slides.length });
      } else {
        dryLog('upload_single_photo', { tool: 'FACEBOOK_CREATE_PHOTO_POST', published: true });
      }
      console.log(JSON.stringify({
        ok: true,
        platform: 'facebook',
        mode: useCarousel ? 'carousel' : 'single',
        dryRun: true,
        slidesPosted: useCarousel ? slides.length : 1
      }));
      return;
    }

    // Composio MCP resolves the FB Page from the OAuth connection — no
    // pageId lookup, no direct Graph API hit. The image_file path pattern
    // (proven on Instagram) lets Composio host the bytes server-side.
    if (!useCarousel) {
      // Single-image mode
      const hero = path.resolve(slides[0]);
      const payloads = [
        { image_file: hero, message: caption },
        { photo_url: hero, caption },
        { url: hero, caption }
      ];
      let result, lastError;
      for (const payload of payloads) {
        try {
          result = await callTool(config, 'FACEBOOK_CREATE_PHOTO_POST', payload);
          if (result && !result.error) break;
        } catch (e) { lastError = e; }
      }
      if (!result || result.error) {
        throw new Error(`Facebook single-photo failed. Last: ${lastError?.message || result?.error || 'unknown'}`);
      }

      const postId = result.data?.id || result.id || result.data?.post_id;
      const permalink = result.data?.permalink_url || result.permalink_url || null;

      console.log(JSON.stringify({
        ok: true,
        platform: 'facebook',
        mode: 'single',
        postId: postId || null,
        permalink,
        slidesPosted: 1
      }));
      return;
    }

    // Multi-photo carousel
    // Step 1: Upload each image as an unpublished photo.
    const photoIds = [];
    for (const slide of slides) {
      const absPath = path.resolve(slide);
      const payloads = [
        { image_file: absPath, published: false },
        { photo_url: absPath, published: false },
        { url: absPath, published: false }
      ];
      let result, lastError;
      for (const payload of payloads) {
        try {
          result = await callTool(config, 'FACEBOOK_CREATE_PHOTO_POST', payload);
          if (result && !result.error) break;
        } catch (e) { lastError = e; }
      }
      if (!result || result.error) {
        throw new Error(`Facebook photo upload failed for ${path.basename(slide)}: ${lastError?.message || result?.error || 'unknown'}`);
      }
      const photoId = result.data?.id || result.id || result.data?.photo_id;
      if (!photoId) throw new Error(`Photo create returned no id for ${path.basename(slide)}`);
      photoIds.push(photoId);
    }

    // Step 2: Create parent post with attached_media referencing the unpublished photos.
    // Composio MCP advertises a feed-post tool that accepts the media_fbid
    // array directly; it resolves the FB Page from the OAuth connection.
    // The multi-shape retry mirrors the v3 fallback behavior.
    const attachedMedia = photoIds.map((id) => ({ media_fbid: id }));
    const feedPayloads = [
      { message: caption, attached_media: attachedMedia },
      { caption, attached_media: attachedMedia }
    ];
    let feedResult, feedLastError;
    for (const payload of feedPayloads) {
      try {
        feedResult = await callTool(config, 'FACEBOOK_CREATE_FEED_POST', payload);
        if (feedResult && !feedResult.error) break;
      } catch (e) { feedLastError = e; }
    }
    if (!feedResult || feedResult.error) {
      throw new Error(`Facebook parent feed post failed: ${feedLastError?.message || feedResult?.error || 'unknown'}`);
    }
    const body = feedResult.data || feedResult;
    const postId = body.id || body.post_id;

    console.log(JSON.stringify({
      ok: true,
      platform: 'facebook',
      mode: 'carousel',
      postId: postId || null,
      slidesPosted: photoIds.length,
      attachedPhotoIds: photoIds
    }));
  } catch (e) {
    fail(e.message);
  }
})();

#!/usr/bin/env node
/**
 * Post a generated slide set to TikTok as a photo slideshow DRAFT (via Composio).
 *
 * Usage:
 *   node post-to-tiktok.js --config ~/social-marketing/config.json --dir ~/social-marketing/posts/<YYYY-MM-DD-HHmm>
 *
 * Expects in --dir:
 *   slide-1.png … slide-N.png   (up to 35 slides — TikTok's hard limit)
 *   caption.txt
 *
 * Output (stdout, last line is machine-readable JSON):
 *   {"ok": true, "draftId": "...", "platform": "tiktok", "mode": "draft"}
 *
 * The post lands in the owner's TikTok inbox as a DRAFT — they must add a
 * trending sound and publish manually. This is intentional: music is the
 * single biggest algorithm factor on TikTok.
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
const dryRun = hasFlag('dry-run');

function fail(msg) {
  console.log(JSON.stringify({ ok: false, platform: 'tiktok', error: msg }));
  process.exit(1);
}
function dryLog(label, obj) {
  console.log(`[DRY-RUN] ${label}: ${JSON.stringify(obj)}`);
}

if (!dir) fail('--dir is required');

(async () => {
  try {
    const config = loadConfig(configPath);
    if (!config.platforms?.tiktok?.enabled) fail('TikTok is not enabled in config.platforms.tiktok');

    const postDir = path.resolve(dir);
    const slides = [];
    for (let i = 1; i <= 35; i++) {
      const finalP = path.join(postDir, `slide-${i}.png`);
      const rawP = path.join(postDir, `slide-${i}-raw.png`);
      if (fs.existsSync(finalP)) slides.push(finalP);
      else if (fs.existsSync(rawP)) slides.push(rawP);
    }
    if (slides.length === 0) fail(`No slide-*.png found in ${postDir}`);

    const captionPath = path.join(postDir, 'caption.txt');
    const caption = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf-8').trim() : '';

    if (dryRun) {
      slides.forEach((s) => dryLog('upload_slide', path.basename(s)));
      dryLog('post_as_draft', { tool: 'TIKTOK_POST_PHOTO', privacy: 'SELF_ONLY', slide_count: slides.length, caption_preview: caption.slice(0, 80) });
      console.log(JSON.stringify({
        ok: true,
        platform: 'tiktok',
        mode: 'draft',
        dryRun: true,
        slidesPosted: slides.length
      }));
      return;
    }

    // Pass each slide as an absolute file path. Composio MCP hosts the
    // file server-side and gives TikTok a URL it trusts (same pattern
    // as Instagram's image_file). No client-side upload step.
    const slidePaths = slides.map((s) => path.resolve(s));

    // TIKTOK_POST_PHOTO accepts the file paths + caption + draft privacy.
    // Different tool versions have used slightly different field names; the
    // multi-shape retry mirrors the v3 behavior. With MCP discovery in
    // place, future cleanup can pick a single shape from the tool schema.
    const payloads = [
      { photo_images: slidePaths, post_info: { title: caption, privacy_level: 'SELF_ONLY' } },
      { images: slidePaths, caption, privacy: 'SELF_ONLY', is_draft: true },
      { image_urls: slidePaths, title: caption, privacy_level: 'SELF_ONLY' }
    ];

    let lastError, result;
    for (const payload of payloads) {
      try {
        result = await callTool(config, 'TIKTOK_POST_PHOTO', payload);
        if (result && !result.error) break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!result || result.error) {
      throw new Error(`All TikTok post payload shapes failed. Last: ${lastError?.message || result?.error || 'unknown'}`);
    }

    const draftId = result.data?.publish_id || result.data?.draft_id || result.data?.id || result.id;

    console.log(JSON.stringify({
      ok: true,
      platform: 'tiktok',
      mode: 'draft',
      draftId: draftId || null,
      slidesPosted: slides.length,
      note: 'Owner must add trending sound in TikTok inbox and publish manually.'
    }));
  } catch (e) {
    fail(e.message);
  }
})();

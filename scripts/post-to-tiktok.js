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
const { executeTool, uploadFile, loadConfig, PLATFORMS } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const dir = getArg('dir');

function fail(msg) {
  console.log(JSON.stringify({ ok: false, platform: 'tiktok', error: msg }));
  process.exit(1);
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

    const tt = PLATFORMS.tiktok;

    // Upload each slide
    const fileKeys = [];
    for (const slide of slides) {
      const key = await uploadFile(config, tt.toolkit, tt.postPhotoTool, slide, 'image/png');
      fileKeys.push(key);
    }

    // Post as draft — TIKTOK_POST_PHOTO typically accepts an array of image
    // URLs/keys + caption + a privacy/draft flag. Different Composio tool
    // versions expose this under different keys, so try a few shapes.
    const payloads = [
      { photo_images: fileKeys, post_info: { title: caption, privacy_level: 'SELF_ONLY' } },
      { images: fileKeys, caption, privacy: 'SELF_ONLY', is_draft: true },
      { image_urls: fileKeys, title: caption, privacy_level: 'SELF_ONLY' }
    ];

    let lastError, result;
    for (const payload of payloads) {
      try {
        result = await executeTool(config, tt.postPhotoTool, payload);
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

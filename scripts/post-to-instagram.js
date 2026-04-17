#!/usr/bin/env node
/**
 * Post a generated slide set to Instagram as a carousel, via Composio.
 *
 * Usage:
 *   node post-to-instagram.js --config ~/social-marketing/config.json --dir ~/social-marketing/posts/<YYYY-MM-DD-HHmm>
 *
 * Expects in --dir:
 *   slide-1.png … slide-N.png    (final images with overlays)
 *   caption.txt                   (post caption including UTM-tagged booking URL)
 *
 * Output (stdout, last line is machine-readable JSON):
 *   {"ok": true, "mediaId": "...", "permalink": "https://...", "platform": "instagram"}
 *
 * Non-zero exit on failure with: {"ok": false, "error": "..."}
 *
 * Instagram carousel flow:
 *   1. Upload each image via Composio file upload (gets a composio file key).
 *   2. Create a CAROUSEL_ITEM media container per image.
 *   3. Create a CAROUSEL media container referencing the children.
 *   4. Publish the CAROUSEL container.
 *   5. Return the media ID + permalink.
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
  console.log(JSON.stringify({ ok: false, platform: 'instagram', error: msg }));
  process.exit(1);
}

if (!dir) fail('--dir is required (path to the post directory containing slide-*.png and caption.txt)');

(async () => {
  try {
    const config = loadConfig(configPath);
    if (!config.platforms?.instagram?.enabled) fail('Instagram is not enabled in config.platforms.instagram');

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

    const ig = PLATFORMS.instagram;

    // 1. Upload each slide, collect composio file keys
    const fileKeys = [];
    for (const slide of slides) {
      const key = await uploadFile(config, ig.toolkit, ig.createMediaTool, slide, 'image/png');
      fileKeys.push(key);
    }

    // 2. Create one CAROUSEL_ITEM container per slide
    const childIds = [];
    for (const key of fileKeys) {
      const result = await executeTool(config, ig.createMediaTool, {
        media_type: 'IMAGE',
        is_carousel_item: true,
        image_url: key
      });
      const id = result.data?.id || result.id || result.data?.container_id;
      if (!id) throw new Error(`CAROUSEL_ITEM create returned no id: ${JSON.stringify(result).slice(0, 200)}`);
      childIds.push(id);
    }

    // 3. Create the CAROUSEL container with children
    const carouselResult = await executeTool(config, ig.createMediaTool, {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption
    });
    const carouselId = carouselResult.data?.id || carouselResult.id || carouselResult.data?.container_id;
    if (!carouselId) throw new Error(`CAROUSEL create returned no id: ${JSON.stringify(carouselResult).slice(0, 200)}`);

    // 4. Publish
    const publishResult = await executeTool(config, ig.publishMediaTool, {
      creation_id: carouselId
    });
    const mediaId = publishResult.data?.id || publishResult.id;
    if (!mediaId) throw new Error(`Publish returned no media id: ${JSON.stringify(publishResult).slice(0, 200)}`);

    const permalink = publishResult.data?.permalink || publishResult.permalink || null;

    console.log(JSON.stringify({
      ok: true,
      platform: 'instagram',
      mediaId,
      permalink,
      slidesPosted: slides.length,
      carouselContainerId: carouselId
    }));
  } catch (e) {
    fail(e.message);
  }
})();

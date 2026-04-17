#!/usr/bin/env node
/**
 * Post a generated slide to Facebook as a single photo post, via Composio.
 *
 * Usage:
 *   node post-to-facebook.js --config ~/social-marketing/config.json --dir ~/social-marketing/posts/<YYYY-MM-DD-HHmm>
 *
 * Expects in --dir:
 *   slide-1.png    (the hero — Facebook posts are single-image)
 *   caption.txt
 *
 * Output (stdout, last line is machine-readable JSON):
 *   {"ok": true, "postId": "...", "permalink": "...", "platform": "facebook"}
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
  console.log(JSON.stringify({ ok: false, platform: 'facebook', error: msg }));
  process.exit(1);
}

if (!dir) fail('--dir is required');

(async () => {
  try {
    const config = loadConfig(configPath);
    if (!config.platforms?.facebook?.enabled) fail('Facebook is not enabled in config.platforms.facebook');

    const postDir = path.resolve(dir);
    const hero = [
      path.join(postDir, 'slide-1.png'),
      path.join(postDir, 'slide-1-raw.png')
    ].find(fs.existsSync);
    if (!hero) fail(`No slide-1.png or slide-1-raw.png found in ${postDir}`);

    const captionPath = path.join(postDir, 'caption.txt');
    const caption = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf-8').trim() : '';

    const fb = PLATFORMS.facebook;

    // Upload the image
    const key = await uploadFile(config, fb.toolkit, fb.createPhotoTool, hero, 'image/png');

    // Create the post. Try a couple payload shapes for tool-version variance.
    const payloads = [
      { image_url: key, message: caption },
      { photo_url: key, caption },
      { url: key, caption }
    ];

    let result, lastError;
    for (const payload of payloads) {
      try {
        result = await executeTool(config, fb.createPhotoTool, payload);
        if (result && !result.error) break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!result || result.error) {
      throw new Error(`All Facebook post payload shapes failed. Last: ${lastError?.message || result?.error || 'unknown'}`);
    }

    const postId = result.data?.id || result.id || result.data?.post_id;
    const permalink = result.data?.permalink_url || result.permalink_url || null;

    console.log(JSON.stringify({
      ok: true,
      platform: 'facebook',
      postId: postId || null,
      permalink,
      slidesPosted: 1
    }));
  } catch (e) {
    fail(e.message);
  }
})();

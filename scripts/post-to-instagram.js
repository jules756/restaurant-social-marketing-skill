#!/usr/bin/env node
/**
 * Post a generated slide set to Instagram as a carousel, via Composio.
 *
 * Usage:
 *   node post-to-instagram.js --config <config.json> --dir <post-dir> [--draft] [--dry-run]
 *
 * Expects in --dir:
 *   slide-1.png … slide-N.png    (final images with overlays; up to 10)
 *   caption.txt                   (UTM-tagged caption)
 *
 * Flags:
 *   --draft     Create the carousel container but skip the publish step.
 *               Owner publishes later via Meta Business Suite. Returns
 *               creation_id so the caller can publish on demand.
 *   --dry-run   Do not call Composio. Print the exact steps that would
 *               run, including payload shapes and upload targets. Useful
 *               for local testing without real credentials.
 *
 * Output (stdout, last line is machine-readable JSON):
 *   Live:  {"ok": true, "mediaId": "...", "permalink": "...", "platform": "instagram"}
 *   Draft: {"ok": true, "creationId": "...", "platform": "instagram", "mode": "draft"}
 *   Fail:  {"ok": false, "platform": "instagram", "error": "..."}
 *
 * Instagram carousel flow:
 *   1. Upload each image → Composio file key.
 *   2. Create one CAROUSEL_ITEM container per image.
 *   3. Create a CAROUSEL container referencing the children + caption.
 *   4. If not --draft: publish the CAROUSEL container.
 */

const fs = require('fs');
const path = require('path');
const { executeTool, uploadFile, loadConfig, PLATFORMS } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const dir = getArg('dir');
const draft = hasFlag('draft');
const dryRun = hasFlag('dry-run');

function fail(msg) {
  console.log(JSON.stringify({ ok: false, platform: 'instagram', error: msg }));
  process.exit(1);
}
function dryLog(label, obj) {
  console.log(`[DRY-RUN] ${label}: ${JSON.stringify(obj)}`);
}

if (!dir) fail('--dir is required (path to the post directory)');

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

    if (dryRun) {
      dryLog('upload_files', slides.map((s) => path.basename(s)));
      slides.forEach((_, i) =>
        dryLog(`create_media_container_${i + 1}`, { tool: ig.createMediaTool, media_type: 'IMAGE', is_carousel_item: true })
      );
      dryLog('create_carousel', { tool: ig.createMediaTool, media_type: 'CAROUSEL', children_count: slides.length, caption_preview: caption.slice(0, 80) });
      if (!draft) {
        dryLog('publish_carousel', { tool: ig.publishMediaTool });
      } else {
        dryLog('draft_mode', { skip_publish: true });
      }
      console.log(JSON.stringify({
        ok: true,
        platform: 'instagram',
        mode: draft ? 'draft' : 'live',
        dryRun: true,
        slidesPosted: slides.length
      }));
      return;
    }

    // 1. Upload each slide. uploadFile returns { key, url, raw }; Instagram
    //    needs an HTTPS url in image_url.
    const uploaded = [];
    for (const slide of slides) {
      const upload = await uploadFile(config, ig.toolkit, ig.createMediaTool, slide, 'image/png');
      if (typeof upload === 'string') {
        // Back-compat if the helper still returns a bare key
        uploaded.push({ key: upload, url: upload });
      } else {
        uploaded.push(upload);
      }
    }

    // Get the ig_user_id — required by Instagram Graph API. Try in order:
    // 1. config.platforms.instagram.igUserId (Installer pre-sets it)
    // 2. Several Composio tool names that might return the authed IG user
    // 3. Throw a clear error if still missing so the Installer fixes it.
    let igUserId = config.platforms?.instagram?.igUserId;
    if (!igUserId) {
      const meAttempts = [
        'INSTAGRAM_GET_USER_ME',
        'INSTAGRAM_GET_ME',
        'INSTAGRAM_GET_USER',
        'INSTAGRAM_GET_INSTAGRAM_BUSINESS_ACCOUNT'
      ];
      for (const tool of meAttempts) {
        try {
          const r = await executeTool(config, tool, {});
          igUserId = r?.data?.id || r?.id || r?.data?.ig_user_id;
          if (igUserId) break;
        } catch {}
      }
    }
    if (!igUserId) {
      fail('Could not resolve ig_user_id. Set config.platforms.instagram.igUserId to your Instagram Business Account ID (find it in Meta Business Suite → Settings → Instagram accounts, or call the IG Graph API /me/accounts).');
    }

    // 2. Create one CAROUSEL_ITEM container per slide.
    //    NOTE: media_type is only valid on the parent CAROUSEL container.
    //    Child items use is_carousel_item: true + image_url only.
    const childIds = [];
    for (const u of uploaded) {
      const args = {
        ig_user_id: igUserId,
        is_carousel_item: true,
        image_url: u.url || u.key
      };
      const result = await executeTool(config, ig.createMediaTool, args);
      const id = result.data?.id || result.id || result.data?.container_id;
      if (!id) throw new Error(`CAROUSEL_ITEM create returned no id. args=${JSON.stringify(args).slice(0, 200)} response=${JSON.stringify(result).slice(0, 400)}`);
      childIds.push(id);
    }

    // 3. Create the CAROUSEL parent container
    const carouselArgs = {
      ig_user_id: igUserId,
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption
    };
    const carouselResult = await executeTool(config, ig.createMediaTool, carouselArgs);
    const carouselId = carouselResult.data?.id || carouselResult.id || carouselResult.data?.container_id;
    if (!carouselId) throw new Error(`CAROUSEL create returned no id: ${JSON.stringify(carouselResult).slice(0, 200)}`);

    if (draft) {
      console.log(JSON.stringify({
        ok: true,
        platform: 'instagram',
        mode: 'draft',
        creationId: carouselId,
        slidesPosted: slides.length,
        note: 'Carousel container created. Publish via Meta Business Suite or call INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH with creation_id=' + carouselId
      }));
      return;
    }

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
      mode: 'live',
      mediaId,
      permalink,
      slidesPosted: slides.length,
      carouselContainerId: carouselId
    }));
  } catch (e) {
    fail(e.message);
  }
})();

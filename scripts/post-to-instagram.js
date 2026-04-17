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
 *   --draft            Create the carousel container but skip the publish
 *                      step. Container is invisible in Meta Business Suite
 *                      UI (expires in 24h). Prefer --schedule instead.
 *   --schedule <min>   Schedule the post for <min> minutes from now.
 *                      Appears in Meta Business Suite as "Scheduled",
 *                      reviewable + cancelable from the UI. Must be
 *                      ≥10 minutes (Instagram's minimum).
 *   --music <name>     Best-effort add audio to the carousel via the
 *                      Graph API's audio_name parameter. Instagram's
 *                      carousel music support is inconsistent; if this
 *                      fails the post still goes out without music.
 *   --dry-run          Do not call Composio. Print the steps that would
 *                      run.
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
const { executeTool, loadConfig, PLATFORMS } = require('./composio-helpers');

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
const scheduleMinutesArg = getArg('schedule');
const scheduleMinutes = scheduleMinutesArg ? parseInt(scheduleMinutesArg, 10) : null;
const musicName = getArg('music');

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

    // Resolve ig_user_id
    let igUserId = config.platforms?.instagram?.igUserId;
    if (!igUserId) {
      const meAttempts = ['INSTAGRAM_GET_USER_INFO', 'INSTAGRAM_GET_USER_ME', 'INSTAGRAM_GET_ME'];
      for (const tool of meAttempts) {
        try {
          const r = await executeTool(config, tool, {});
          igUserId = r?.data?.id || r?.id || r?.data?.ig_user_id;
          if (igUserId) break;
        } catch {}
      }
    }
    if (!igUserId) {
      fail('Could not resolve ig_user_id. Set config.platforms.instagram.igUserId (Meta Business Suite → Settings → Instagram accounts).');
    }

    // Approach: use Composio's image_file parameter (per docs, Composio
    // hosts the file and gives IG a URL IG trusts). Avoid imgbb/signed-URL
    // rejection entirely.
    //
    // 1. Create one CAROUSEL_ITEM container per slide, passing image_file
    //    as the absolute path. Composio handles hosting server-side.
    const childIds = [];
    for (const slide of slides) {
      const absPath = path.resolve(slide);
      const args = {
        ig_user_id: igUserId,
        is_carousel_item: true,
        image_file: absPath
      };
      const result = await executeTool(config, ig.createMediaTool, args);
      const id = result.data?.id || result.id || result.data?.container_id;
      if (!id) {
        const msg = typeof result?.data?.message === 'string' ? result.data.message : JSON.stringify(result).slice(0, 400);
        throw new Error(`CAROUSEL_ITEM create returned no id. args=${JSON.stringify(args).slice(0, 200)} response=${msg}`);
      }
      childIds.push(id);
    }

    // 2. Create the CAROUSEL parent container.
    const carouselArgs = {
      ig_user_id: igUserId,
      media_type: 'CAROUSEL',
      children: childIds,
      caption
    };
    if (scheduleMinutes && scheduleMinutes >= 10) {
      // Instagram requires ≥10 min in the future. Convert to Unix seconds.
      carouselArgs.scheduled_publish_time = Math.floor(Date.now() / 1000) + scheduleMinutes * 60;
    }
    if (musicName) {
      // Best-effort — Instagram's carousel audio support is limited.
      carouselArgs.audio_name = musicName;
    }
    const carouselResult = await executeTool(config, ig.createMediaTool, carouselArgs);
    const carouselId = carouselResult.data?.id || carouselResult.id || carouselResult.data?.container_id;
    if (!carouselId) throw new Error(`CAROUSEL create returned no id: ${JSON.stringify(carouselResult).slice(0, 200)}`);

    if (scheduleMinutes && scheduleMinutes >= 10) {
      const publishAt = new Date(Date.now() + scheduleMinutes * 60 * 1000).toISOString();
      console.log(JSON.stringify({
        ok: true,
        platform: 'instagram',
        mode: 'scheduled',
        creationId: carouselId,
        scheduledPublishAt: publishAt,
        scheduledInMinutes: scheduleMinutes,
        slidesPosted: slides.length,
        note: `Scheduled for ${publishAt}. Visible in Meta Business Suite → Planner/Scheduled. Cancel from UI before publish time if needed.`
      }));
      return;
    }

    if (draft) {
      console.log(JSON.stringify({
        ok: true,
        platform: 'instagram',
        mode: 'draft',
        creationId: carouselId,
        slidesPosted: slides.length,
        note: 'Container created but NOT visible in Meta Business Suite UI. Expires in 24h unless published. Use --schedule <min> for a real visible draft.'
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

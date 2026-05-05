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
 * Default behavior (no flags): publishes the carousel live and notifies
 * the restaurant owner on Telegram with the permalink + a suggestion to
 * convert to a Reel (via IG app's "Share as Reel") if they want music.
 *
 * Flags:
 *   --draft            Create the carousel container but skip publish.
 *                      Container is invisible in Meta Business Suite UI
 *                      and expires in 24h.
 *   --schedule <min>   Schedule for <min> minutes from now (≥10 min).
 *                      Appears in Meta Business Suite → Planner.
 *   --music <name>     Best-effort carousel audio via audio_name param.
 *                      Instagram's Graph API support is inconsistent for
 *                      carousels; silently ignored if it fails.
 *   --no-notify        Skip the Telegram notification after publish.
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
const { callTool, loadConfig, findToolByPattern } = require('./mcp-client');

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
const notifyTelegram = !hasFlag('no-notify');  // Default ON; --no-notify to skip.

function fail(msg) {
  console.log(JSON.stringify({ ok: false, platform: 'instagram', error: msg }));
  process.exit(1);
}
function dryLog(label, obj) {
  console.log(`[DRY-RUN] ${label}: ${JSON.stringify(obj)}`);
}

async function sendTelegramNotification(config, text) {
  const token = config.telegram?.botToken;
  const chatId = config.telegram?.chatId;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
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

    if (dryRun) {
      dryLog('upload_files', slides.map((s) => path.basename(s)));
      slides.forEach((_, i) =>
        dryLog(`create_media_container_${i + 1}`, { tool: 'INSTAGRAM_POST_IG_USER_MEDIA', media_type: 'IMAGE', is_carousel_item: true })
      );
      dryLog('create_carousel', { tool: 'INSTAGRAM_POST_IG_USER_MEDIA', media_type: 'CAROUSEL', children_count: slides.length, caption_preview: caption.slice(0, 80) });
      if (!draft) {
        dryLog('publish_carousel', { tool: 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH' });
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

    // Approach: use Composio's image_file parameter (per docs, Composio
    // hosts the file and gives IG a URL IG trusts). Avoid imgbb/signed-URL
    // rejection entirely.
    //
    // 1. Create one CAROUSEL_ITEM container per slide, passing image_file
    //    as the absolute path. Composio handles hosting server-side.
    //
    // ig_user_id is intentionally omitted — Composio MCP resolves it from
    // the OAuth connection. If IG ever rejects with "ig_user_id required",
    // look it up via findToolByPattern(/INSTAGRAM.*USER.*ME|USER_INFO/) and
    // cache the id on config.platforms.instagram.igUserId.
    const childIds = [];
    for (const slide of slides) {
      const absPath = path.resolve(slide);
      const args = {
        is_carousel_item: true,
        image_file: absPath
      };
      const result = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA', args);
      const id = result.data?.id || result.id || result.data?.container_id;
      if (!id) {
        const msg = typeof result?.data?.message === 'string' ? result.data.message : JSON.stringify(result).slice(0, 400);
        throw new Error(`CAROUSEL_ITEM create returned no id. args=${JSON.stringify(args).slice(0, 200)} response=${msg}`);
      }
      childIds.push(id);
    }

    // 2. Create the CAROUSEL parent container.
    const carouselArgs = {
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
    const carouselResult = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA', carouselArgs);
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
    const publishResult = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH', {
      creation_id: carouselId
    });
    const mediaId = publishResult.data?.id || publishResult.id;
    if (!mediaId) throw new Error(`Publish returned no media id: ${JSON.stringify(publishResult).slice(0, 200)}`);

    // Fetch the permalink — publish usually returns just the id; resolve url.
    let permalink = publishResult.data?.permalink || publishResult.permalink || null;
    if (!permalink) {
      try {
        const meta = await callTool(config, 'INSTAGRAM_GET_IG_MEDIA', {
          ig_media_id: mediaId,
          fields: 'permalink'
        });
        permalink = meta?.data?.permalink || null;
      } catch {}
    }

    // 5. Notify the restaurant owner on Telegram.
    let notified = false;
    if (notifyTelegram) {
      const profilePath = path.join(path.dirname(path.resolve(configPath)), 'restaurant-profile.json');
      const restaurantName = fs.existsSync(profilePath)
        ? (JSON.parse(fs.readFileSync(profilePath, 'utf-8')).name || 'your restaurant')
        : 'your restaurant';
      const message =
        `✅ New Instagram post live for *${restaurantName}*\n\n` +
        (permalink ? `${permalink}\n\n` : `Media id: \`${mediaId}\`\n\n`) +
        `Want music on it? Open the post in Instagram → tap ⋯ → *Share as Reel*. Instagram will let you pick a trending sound and convert it to a Reel for better reach.`;
      notified = await sendTelegramNotification(config, message);
    }

    console.log(JSON.stringify({
      ok: true,
      platform: 'instagram',
      mode: 'live',
      mediaId,
      permalink,
      slidesPosted: slides.length,
      carouselContainerId: carouselId,
      telegramNotified: notified
    }));
  } catch (e) {
    fail(e.message);
  }
})();

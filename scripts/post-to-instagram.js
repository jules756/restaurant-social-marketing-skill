#!/usr/bin/env node
/**
 * Post a generated slide set to Instagram, via Composio MCP.
 *
 * Flow per slide:
 *   1. Apply text overlay (node-canvas) onto slide-N-raw.png → slide-N.png
 *   2. Re-generate via OpenAI to get a fresh s3key (or reuse from metadata.s3keys)
 *   3. INSTAGRAM_POST_IG_USER_MEDIA (carousel item) using s3key
 *   4. INSTAGRAM_POST_IG_USER_MEDIA (carousel container) with caption
 *   5. INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH
 *
 * Usage:
 *   node post-to-instagram.js --config <config.json> --dir <post-dir> [--dry-run] [--no-notify]
 *
 * Output (last line is machine-readable JSON):
 *   {\"ok\": true, \"mediaId\": \"...\", \"permalink\": \"...\", \"platform\": \"instagram\"}
 *   {\"ok\": false, \"platform\": \"instagram\", \"error\": \"...\"}
 */

const fs   = require('fs');
const path = require('path');
const { callTool, loadConfig } = require('./mcp-client');

const args    = process.argv.slice(2);
const getArg  = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (n) => args.includes(`--${n}`);

const configPath     = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const dir            = getArg('dir');
const dryRun         = hasFlag('dry-run');
const notifyTelegram = !hasFlag('no-notify');

if (!dir) { console.error('Usage: node post-to-instagram.js --config <cfg> --dir <post-dir>'); process.exit(1); }

const config    = loadConfig(configPath);
const igUserId  = config.platforms?.instagram?.igUserId || '34824861763795379';

// OpenAI uses a different entity — swap URL for image gen calls
const imageConfig = config.composio?.imageGenMcpUrl
  ? { ...config, composio: { ...config.composio, mcpServerUrl: config.composio.imageGenMcpUrl } }
  : config;

// ─── helpers ────────────────────────────────────────────────────────────────

function applyOverlay(rawPath, outPath, text) {
  let createCanvas, loadImage;
  try { ({ createCanvas, loadImage } = require('canvas')); }
  catch(e) { fs.copyFileSync(rawPath, outPath); return; } // canvas not available, use raw

  const buf = fs.readFileSync(rawPath);
  const img = new (require('canvas').Image)();
  img.src = buf;
  const w = img.width || 1024;
  const h = img.height || 1280;

  const canvas = createCanvas(w, h);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  if (text) {
    const lines    = text.split('\n').filter(Boolean);
    const fontSize = Math.round(w * 0.055);
    ctx.font       = `bold ${fontSize}px sans-serif`;
    ctx.textAlign  = 'center';

    // dark semi-transparent pill behind text
    const lineH  = fontSize * 1.4;
    const padX   = 40;
    const padY   = 20;
    const boxW   = w * 0.88;
    const boxH   = lines.length * lineH + padY * 2;
    const boxX   = (w - boxW) / 2;
    const boxY   = h * 0.08;

    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 18);
    ctx.fill();

    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 8;
    lines.forEach((line, i) => {
      ctx.fillText(line, w / 2, boxY + padY + fontSize + i * lineH);
    });
  }

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

async function getS3KeyForSlide(slideNum, metadata) {
  // Reuse cached s3key from generation if available (< 55 min old — Composio S3 TTL is ~1h)
  const cached = metadata?.s3keys?.[`slide-${slideNum}`];
  if (cached) {
    const age = Date.now() - new Date(metadata.generatedAt).getTime();
    if (age < 55 * 60 * 1000) return cached;
  }
  // Otherwise re-generate just for the s3key (fast, single image)
  const prompt = `Instagram food photography slide ${slideNum}: ${metadata?.dish || 'signature dish'}, restaurant quality, candlelit bistro`;
  const res = await callTool(imageConfig, 'OPENAI_CREATE_IMAGE', {
    prompt,
    model: 'gpt-image-2',
    n: 1,
    size: '1024x1024'
  });
  const assetUrl = res?.data?.images?.[0]?.asset_url;
  if (!assetUrl) throw new Error('No asset_url refreshing s3key');
  return new URL(assetUrl).pathname.substring(1);
}

// ─── main ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    // Load slides + caption
    const rawSlides = fs.readdirSync(dir)
      .filter(f => /^slide-\d+-raw\.png$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
      .map(f => path.join(dir, f));

    if (!rawSlides.length) throw new Error(`No slide-N-raw.png files found in ${dir}`);

    const captionPath = path.join(dir, 'caption.txt');
    const caption     = fs.existsSync(captionPath) ? fs.readFileSync(captionPath, 'utf-8').trim() : '';

    const metaPath = path.join(dir, 'metadata.json');
    const metadata = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};

    // Load texts for overlay
    const textsPath = path.join(dir, 'texts.json');
    const texts     = fs.existsSync(textsPath) ? JSON.parse(fs.readFileSync(textsPath, 'utf-8')) : [];

    if (dryRun) {
      console.log('[DRY-RUN] slides:', rawSlides.length);
      console.log('[DRY-RUN] caption preview:', caption.substring(0, 80));
      console.log('[DRY-RUN] overlay texts:', texts.length ? 'yes' : 'none');
      console.log(JSON.stringify({ ok: true, platform: 'instagram', mode: 'live', dryRun: true, slidesPosted: rawSlides.length }));
      return;
    }

    // Step 1: apply overlays → slide-N.png
    console.log(`Applying overlays to ${rawSlides.length} slide(s)...`);
    const finalSlides = [];
    for (let i = 0; i < rawSlides.length; i++) {
      const outPath = path.join(dir, `slide-${i + 1}.png`);
      const text    = texts[i] || null;
      applyOverlay(rawSlides[i], outPath, text);
      finalSlides.push({ num: i + 1, path: outPath });
      console.log(`  ✅ slide-${i + 1}.png`);
    }

    // Step 2+3: get s3key and create carousel item containers
    console.log('\nCreating Instagram media containers...');
    const childIds = [];
    for (const slide of finalSlides) {
      const s3key = await getS3KeyForSlide(slide.num, metadata);
      console.log(`  slide-${slide.num} s3key: ${s3key.substring(0, 50)}...`);

      const res = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA', {
        ig_user_id: igUserId,
        is_carousel_item: true,
        image_file: { name: `slide-${slide.num}.png`, s3key, mimetype: 'image/png' }
      });
      const id = res?.data?.id || res?.id;
      if (!id) throw new Error(`Carousel item ${slide.num} returned no id: ${JSON.stringify(res).slice(0, 200)}`);
      childIds.push(id);
      console.log(`  ✅ container id: ${id}`);
    }

    // Step 4: create carousel container
    console.log('\nCreating carousel container...');
    const carouselRes = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA', {
      ig_user_id: igUserId,
      media_type: 'CAROUSEL',
      children: childIds,
      caption
    });
    const carouselId = carouselRes?.data?.id || carouselRes?.id;
    if (!carouselId) throw new Error(`Carousel container returned no id: ${JSON.stringify(carouselRes).slice(0, 200)}`);
    console.log('Carousel container id:', carouselId);

    // Step 5: publish
    console.log('\nPublishing...');
    const pubRes = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH', {
      ig_user_id: igUserId,
      creation_id: carouselId
    });
    const mediaId = pubRes?.data?.id || pubRes?.id;
    if (!mediaId) throw new Error(`Publish returned no media id: ${JSON.stringify(pubRes).slice(0, 200)}`);

    // Fetch permalink
    let permalink = null;
    try {
      const mediaRes = await callTool(config, 'INSTAGRAM_GET_IG_MEDIA', {
        ig_media_id: mediaId,
        fields: 'permalink'
      });
      permalink = mediaRes?.data?.permalink || null;
    } catch(e) { /* non-fatal */ }

    const result = { ok: true, platform: 'instagram', mediaId, permalink };
    if (permalink) console.log('Permalink:', permalink);
    console.log(JSON.stringify(result));

  } catch(e) {
    console.error(JSON.stringify({ ok: false, platform: 'instagram', error: e.message }));
    process.exit(1);
  }
})();

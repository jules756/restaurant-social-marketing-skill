#!/usr/bin/env node
/**
 * Stage 2: render text overlays onto slide-N-raw.png → slide-N.png.
 *
 * Mandatory: node-canvas must be installed. We do NOT silently fall back
 * to copying the raw file (caused the inconsistent overlay bug in v3).
 *
 * Reads state.json from the post directory, only operates on slides
 * that have generated=true. Marks them overlaid=true on success.
 *
 * Usage:
 *   node add-text-overlay.js \
 *     --input <posts/timestamp/> \
 *     --texts <texts.json>          # array of strings, one per slide
 */

let createCanvas, loadImage;
try { ({ createCanvas, loadImage } = require('canvas')); }
catch (e) {
  console.error('✗ node-canvas not installed. This is required — refusing to silently skip overlays.');
  console.error('  Install: npm install canvas');
  console.error('  Linux deps: apt-get install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { readState, writeState } = require('./state-helpers');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : null; };
const inputDir = getArg('input');
const textsPath = getArg('texts');
if (!inputDir || !textsPath) {
  console.error('Usage: node add-text-overlay.js --input <dir> --texts <texts.json>');
  process.exit(1);
}

const texts = JSON.parse(fs.readFileSync(textsPath, 'utf-8'));
if (!Array.isArray(texts) || texts.length === 0) {
  console.error('texts.json must be a non-empty JSON array of strings.');
  process.exit(1);
}

function wrapText(ctx, text, maxWidth) {
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  const manual = clean.split('\n');
  const out = [];
  for (const line of manual) {
    if (ctx.measureText(line.trim()).width <= maxWidth) { out.push(line.trim()); continue; }
    const words = line.trim().split(/\s+/);
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width <= maxWidth) cur = test;
      else { if (cur) out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

async function overlay(imgPath, text, outPath) {
  const img = await loadImage(imgPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const fontSize = Math.round(img.width * 0.065);
  const outlineWidth = Math.round(fontSize * 0.15);
  const maxWidth = img.width * 0.75;
  const lineHeight = fontSize * 1.25;

  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, text, maxWidth);
  const totalH = lines.length * lineHeight;
  const startY = img.height * 0.30 - totalH / 2 + lineHeight / 2;
  const minY = img.height * 0.10;
  const maxY = img.height * 0.80 - totalH;
  const safeY = Math.max(minY, Math.min(startY, maxY));
  const x = img.width / 2;

  for (let i = 0; i < lines.length; i++) {
    const y = safeY + i * lineHeight;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(lines[i], x, y);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(lines[i], x, y);
  }
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
}

(async () => {
  const state = readState(inputDir);
  if (!state) {
    console.error(`✗ No state.json in ${inputDir}. Run generate-slides.js first.`);
    process.exit(1);
  }

  console.log(`Adding overlays for ${texts.length} slide(s) in ${inputDir}\n`);
  let ok = 0, fail = 0;
  for (let i = 0; i < texts.length; i++) {
    const num = i + 1;
    const slot = state.slides[i];
    if (!slot || !slot.generated) {
      console.error(`  ❌ slide ${num}: not generated yet (state.json)`);
      fail++; continue;
    }
    const raw = path.join(inputDir, slot.raw || `slide-${num}-raw.png`);
    if (!fs.existsSync(raw)) {
      console.error(`  ❌ slide ${num}: raw file missing at ${raw}`);
      fail++; continue;
    }
    const out = path.join(inputDir, `slide-${num}.png`);
    try {
      await overlay(raw, texts[i], out);
      slot.final = `slide-${num}.png`;
      slot.overlaid = true;
      delete slot.lastError;
      console.log(`  ✅ slide-${num}.png`);
      ok++;
    } catch (e) {
      console.error(`  ❌ slide ${num}: ${e.message}`);
      slot.overlaid = false;
      slot.lastError = e.message;
      fail++;
    }
  }

  state.status = fail === 0 ? 'overlaid' : 'overlaid-partial';
  state.overlaidAt = new Date().toISOString();
  writeState(inputDir, state);

  console.log(`\n${ok}/${texts.length} overlays complete.`);
  if (fail > 0) process.exit(1);
})();

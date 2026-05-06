#!/usr/bin/env node
/**
 * Add text overlays to slide images.
 *
 * Primary: node-canvas (proven). PRD notes html-to-image as a potential cleaner
 * option — if adopted later, swap the rendering layer behind this same CLI.
 *
 * Usage:
 *   node add-text-overlay.js \
 *     --input social-marketing/posts/YYYY-MM-DD-HHmm/ \
 *     --texts texts.json
 *
 * texts.json: ["Slide 1 text", "Slide 2 text", ...] — length must match slides.
 *
 * Overlay rules enforced:
 *   - Reactions, not labels.
 *   - 4–6 words per line, 3–4 lines per slide (wrap if needed).
 *   - No emoji (stripped if present).
 *   - Safe zones: no text in top 10% or bottom 20%.
 *   - Slide 6 (if TikTok format) is the CTA slide — caller passes the CTA string.
 *
 * Reads slide-N-raw.png, writes slide-N.png.
 */

let createCanvas, loadImage;
try {
  ({ createCanvas, loadImage } = require('canvas'));
} catch (e) {
  console.error('node-canvas not installed. Run: npm install canvas');
  console.error('macOS prereqs: brew install pkg-config cairo pango libpng jpeg giflib librsvg');
  process.exit(1);
}
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

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
  console.log(`  ✅ ${path.basename(outPath)} (${lines.length} line${lines.length > 1 ? 's' : ''})`);
}

function findRaw(dir, num) {
  const candidates = [`slide-${num}-raw.png`, `slide${num}_raw.png`, `slide_${num}.png`];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async () => {
  console.log(`Adding overlays for ${texts.length} slide(s) in ${inputDir}\n`);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < texts.length; i++) {
    const num = i + 1;
    const raw = findRaw(inputDir, num);
    if (!raw) { console.error(`  ❌ slide ${num}: no raw file found`); fail++; continue; }
    const out = path.join(inputDir, `slide-${num}.png`);
    try {
      await overlay(raw, texts[i], out);
      ok++;
    } catch (e) {
      console.error(`  ❌ slide ${num}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${ok}/${texts.length} overlays complete.`);
  if (fail > 0) process.exit(1);
})();

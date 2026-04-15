#!/usr/bin/env node
/**
 * Generate slideshow images via OpenRouter (openai/gpt-image-1.5).
 *
 * Selects approach per slide based on photo-inventory.json:
 *   - If a matching Drive photo exists → img2img (OpenRouter images/edits).
 *   - Otherwise → txt2img (OpenRouter images/generations).
 *
 * Usage:
 *   node generate-slides.js \
 *     --config social-marketing/config.json \
 *     --output social-marketing/posts/YYYY-MM-DD-HHmm/ \
 *     --prompts prompts.json \
 *     [--platform tiktok|instagram|facebook] \
 *     [--urgency fast|quality] \
 *     [--dish "Pasta Carbonara"]
 *
 * prompts.json format:
 * {
 *   "base": "Shared base description anchoring ALL slides (same table, same plates, same lighting)",
 *   "slides": ["Slide 1 additions", "Slide 2 additions", ...]
 * }
 *
 * Resume: slide files that already exist (>10KB) are skipped. Re-run on failure.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config');
const outputDir = getArg('output');
const promptsPath = getArg('prompts');
const platform = getArg('platform') || 'tiktok';
const urgency = getArg('urgency') || 'quality';
const dish = getArg('dish');

if (!configPath || !outputDir || !promptsPath) {
  console.error('Usage: node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json> [--platform tiktok] [--urgency fast|quality] [--dish "Name"]');
  process.exit(1);
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is not set. Run from an environment with ~/.hermes/.env loaded.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
const model = config.imageGen?.model || 'openai/gpt-image-1.5';

if (!model.includes('1.5')) {
  console.error(`Refusing to run with model "${model}". Use openai/gpt-image-1.5 — gpt-image-1 produces visibly AI food.`);
  process.exit(1);
}

const PLATFORM_DIMS = {
  tiktok: { size: '1024x1536', slides: 6 },
  instagram: { size: '1080x1350', slides: 6 },
  facebook: { size: '1200x630', slides: 1 }
};
const dims = PLATFORM_DIMS[platform];
if (!dims) {
  console.error(`Unknown platform: ${platform}`);
  process.exit(1);
}

if (!config.platforms?.[platform]?.enabled) {
  console.error(`Platform ${platform} is not enabled in config.platforms. Refusing to generate.`);
  process.exit(1);
}

if (!Array.isArray(prompts.slides) || prompts.slides.length === 0) {
  console.error('prompts.json must have a non-empty slides array.');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const quality = urgency === 'fast' ? 'standard' : 'high';

function loadInventory() {
  const invPath = config.googleDrive?.inventoryPath;
  if (!invPath || !fs.existsSync(invPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(invPath, 'utf-8'));
  } catch (e) {
    console.warn(`Inventory unreadable (${e.message}) — falling back to txt2img for all slides.`);
    return null;
  }
}

function findReferencePhoto(inventory, dishName) {
  if (!inventory || !dishName) return null;
  const entry = inventory.byDish?.[dishName];
  if (!entry?.bestFile) return null;
  const cacheDir = config.googleDrive?.localCachePath || 'social-marketing/photos/';
  const abs = path.resolve(cacheDir, 'dishes', entry.bestFile);
  return fs.existsSync(abs) ? abs : null;
}

async function txt2img(prompt, outPath) {
  const res = await fetch('https://openrouter.ai/api/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://akira-agent.com',
      'X-Title': 'restaurant-social-marketing'
    },
    body: JSON.stringify({ model, prompt, n: 1, size: dims.size, quality })
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || `txt2img ${res.status}`);
  fs.writeFileSync(outPath, Buffer.from(data.data[0].b64_json, 'base64'));
}

async function img2img(prompt, referenceImagePath, outPath) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', dims.size);
  form.append('quality', quality);
  const buf = fs.readFileSync(referenceImagePath);
  form.append('image', new Blob([buf], { type: 'image/jpeg' }), path.basename(referenceImagePath));
  const res = await fetch('https://openrouter.ai/api/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://akira-agent.com',
      'X-Title': 'restaurant-social-marketing'
    },
    body: form
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    // Fallback: if OpenRouter does not support images/edits for this model,
    // fall back to txt2img so we never block the post.
    console.warn(`img2img unavailable (${data.error?.message || res.status}) — falling back to txt2img.`);
    return txt2img(prompt, outPath);
  }
  fs.writeFileSync(outPath, Buffer.from(data.data[0].b64_json, 'base64'));
}

async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      console.log(`  retry ${i + 1}/${retries}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

(async () => {
  const inventory = loadInventory();
  const refPhoto = findReferencePhoto(inventory, dish);
  const approach = refPhoto ? 'img2img' : 'txt2img';
  console.log(`\nGenerating ${prompts.slides.length} slides for ${config.restaurant?.name || 'restaurant'}`);
  console.log(`  platform: ${platform}  urgency: ${urgency}  approach: ${approach}  model: ${model}`);
  if (refPhoto) console.log(`  reference: ${refPhoto}\n`);

  let success = 0;
  let failed = 0;
  for (let i = 0; i < prompts.slides.length; i++) {
    const outRaw = path.join(outputDir, `slide-${i + 1}-raw.png`);
    if (fs.existsSync(outRaw) && fs.statSync(outRaw).size > 10000) {
      console.log(`  ⏭  slide-${i + 1}-raw.png already exists, skipping`);
      success++; continue;
    }
    const fullPrompt = `${prompts.base}\n\n${prompts.slides[i]}`;
    try {
      await withRetry(() =>
        refPhoto ? img2img(fullPrompt, refPhoto, outRaw) : txt2img(fullPrompt, outRaw)
      );
      console.log(`  ✅ slide-${i + 1}-raw.png`);
      success++;
    } catch (e) {
      console.error(`  ❌ slide-${i + 1}: ${e.message}`);
      failed++;
    }
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    platform,
    urgency,
    approach,
    model,
    dish: dish || null,
    referencePhoto: refPhoto || null,
    slidesGenerated: success,
    slidesFailed: failed
  };
  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  console.log(`\nGenerated ${success}/${prompts.slides.length} slides → ${outputDir}`);
  if (failed > 0) {
    console.error(`${failed} failed. Re-run to retry — completed slides are preserved.`);
    process.exit(1);
  }
})();

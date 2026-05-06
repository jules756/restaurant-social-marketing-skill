#!/usr/bin/env node
/**
 * Stage 1: generate slideshow images via gpt-image-2 over Composio MCP.
 *
 * Two paths:
 *   txt2img: OPENAI_CREATE_IMAGE — text-only prompt.
 *   img2img: OPENAI_CREATE_IMAGE_EDIT — text prompt + 1-16 reference images
 *            (food and/or ambiance photos so plating + venue match reality).
 *
 * Reference photos come from --references (comma-separated absolute paths)
 * or from the photo inventory at config.googleDrive.inventoryPath. We pass
 * up to MAX_REFS images to OPENAI_CREATE_IMAGE_EDIT.
 *
 * Output: posts/<timestamp>/slide-N-raw.png + state.json + metadata.json.
 * Generation runs in parallel with a concurrency cap (default 3).
 *
 * Resume: if state.json shows a slide already generated and the file is
 * non-empty, it's skipped.
 *
 * Usage:
 *   node generate-slides.js \
 *     --config <config.json> \
 *     --output <posts/timestamp/> \
 *     --prompts <prompts.json> \
 *     [--platform tiktok|instagram|facebook] \
 *     [--urgency fast|quality] \
 *     [--dish "Pasta Carbonara"] \
 *     [--references "/abs/dish.jpg,/abs/venue.jpg"] \
 *     [--concurrency 3]
 */

const fs = require('fs');
const path = require('path');
const { callTool, loadConfig, findToolByPattern, listAllTools } = require('./mcp-client');
const { readState, writeState } = require('./state-helpers');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : null; };

const configPath = getArg('config');
const outputDir = getArg('output');
const promptsPath = getArg('prompts');
const platform = getArg('platform') || 'tiktok';
const urgency = getArg('urgency') || 'quality';
const dish = getArg('dish');
const explicitRefs = getArg('references');   // comma-separated absolute paths
const concurrency = parseInt(getArg('concurrency') || '3', 10);

if (!configPath || !outputDir || !promptsPath) {
  console.error(
    'Usage: node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json> ' +
    '[--platform tiktok|instagram|facebook] [--urgency fast|quality] [--dish "Name"] ' +
    '[--references "/abs/a.jpg,/abs/b.jpg"] [--concurrency 3]'
  );
  process.exit(1);
}

const config = loadConfig(configPath);
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
const model = 'gpt-image-2';
const MAX_REFS = 4;     // gpt-image-2 supports up to 16; cap at 4 for prompt clarity + cost.

const PLATFORM_SIZE = {
  tiktok:    '1024x1536',
  instagram: '1024x1280',
  facebook:  '1536x1024',
};
const PLATFORM_HINTS = {
  tiktok:    { aspect: '9:16 portrait',  slides: 6 },
  instagram: { aspect: '4:5 portrait',   slides: 6 },
  facebook:  { aspect: '16:9 landscape', slides: 1 },
};
const hints = PLATFORM_HINTS[platform];
if (!hints) { console.error(`Unknown platform: ${platform}`); process.exit(1); }
if (!config.platforms?.[platform]?.enabled) {
  console.error(`Platform ${platform} is not enabled in config.platforms. Refusing to generate.`);
  process.exit(1);
}
if (!Array.isArray(prompts.slides) || prompts.slides.length === 0) {
  console.error('prompts.json must have a non-empty slides array.');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

// ─── Reference resolution ───────────────────────────────────────────────
// Priority:
//   1. --references "/abs/a.jpg,/abs/b.jpg" (most explicit)
//   2. inventory: byDish[dish] (food) + ambiance/exterior pool
//   3. none → txt2img
function loadInventory() {
  const invPath = config.googleDrive?.inventoryPath;
  if (!invPath || !fs.existsSync(invPath)) return null;
  try { return JSON.parse(fs.readFileSync(invPath, 'utf-8')); }
  catch (e) { console.warn(`Inventory unreadable (${e.message}) — txt2img fallback.`); return null; }
}

function pickReferencesFromInventory(inventory, dishName) {
  if (!inventory) return [];
  const refs = [];
  const cacheDir = path.dirname(path.resolve(config.googleDrive?.inventoryPath || ''));
  const photosDir = path.resolve(cacheDir, 'photos');
  // Food: best-of-dish if known, else any first.
  const dishEntry = dishName ? inventory.byDish?.[dishName] : null;
  if (dishEntry?.bestFile) {
    const abs = path.resolve(photosDir, 'dishes', dishEntry.bestFile);
    if (fs.existsSync(abs)) refs.push(abs);
  }
  // Ambiance / venue context: pick one from each available bucket.
  for (const bucket of ['ambiance', 'exterior', 'kitchen']) {
    const list = inventory.byCategory?.[bucket];
    if (Array.isArray(list) && list.length > 0) {
      const abs = path.resolve(photosDir, bucket, list[0]);
      if (fs.existsSync(abs)) refs.push(abs);
      if (refs.length >= MAX_REFS) break;
    }
  }
  return refs.slice(0, MAX_REFS);
}

function resolveReferences() {
  if (explicitRefs) {
    const list = explicitRefs.split(',').map((s) => s.trim()).filter(Boolean);
    return list.filter((p) => {
      if (!path.isAbsolute(p)) { console.warn(`Skipping non-absolute reference: ${p}`); return false; }
      if (!fs.existsSync(p)) { console.warn(`Reference not found: ${p}`); return false; }
      return true;
    }).slice(0, MAX_REFS);
  }
  const inventory = loadInventory();
  return pickReferencesFromInventory(inventory, dish);
}

// ─── Prompt + tool resolution ───────────────────────────────────────────
function buildPrompt(basePrompt, slidePrompt, hasRefs) {
  const qualityLine = urgency === 'fast'
    ? 'Quality: good, fast turnaround.'
    : 'Quality: high, photorealistic, iPhone-like authenticity.';
  const refLine = hasRefs
    ? 'Use the supplied reference photos as anchors for plating, dishware, table, and ambiance — match their look and feel exactly.'
    : '';
  return [
    `Aspect ratio: ${hints.aspect}. Output must be a single image in that exact ratio.`,
    qualityLine,
    refLine,
    'No text, no watermarks, no logos in the image.',
    '',
    basePrompt,
    '',
    slidePrompt,
  ].filter(Boolean).join('\n');
}

let _txt2imgSlug = null;
let _img2imgSlug = null;

async function resolveImageTools() {
  if (_txt2imgSlug && _img2imgSlug) return;
  // Pin via config.imageGen.toolSlug for txt2img if user wants to override.
  if (config.imageGen?.toolSlug) _txt2imgSlug = config.imageGen.toolSlug;
  if (config.imageGen?.editToolSlug) _img2imgSlug = config.imageGen.editToolSlug;

  if (!_txt2imgSlug) {
    const found = await findToolByPattern(config, /^OPENAI_CREATE_IMAGE$/i);
    if (!found) {
      // Last-resort fuzzy match.
      const fuzzy = await findToolByPattern(config, /^OPENAI_.*IMAGE.*GENERAT/i);
      if (!fuzzy) {
        const all = await listAllTools(config);
        const names = all.map((t) => t.name).slice(0, 30).join(', ');
        throw new Error(
          `No OpenAI text-to-image tool advertised. Confirm OpenAI is connected on the right userId. ` +
          `First tools: ${names}`
        );
      }
      _txt2imgSlug = fuzzy.tool.name;
    } else {
      _txt2imgSlug = found.tool.name;
    }
  }
  if (!_img2imgSlug) {
    const found = await findToolByPattern(config, /^OPENAI_CREATE_IMAGE_EDIT$/i);
    if (found) _img2imgSlug = found.tool.name;
    // If not found, img2img is unavailable — txt2img still works.
  }
}

function extractImageB64(result) {
  const candidates = [
    result?.data?.[0]?.b64_json,
    result?.data?.b64_json,
    result?.images?.[0]?.b64_json,
    result?.images?.[0]?.b64,
    result?.b64_json,
    result?.image_b64,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}

async function generateImage(promptText, referencePaths, outPath) {
  await resolveImageTools();
  const useEdit = referencePaths.length > 0 && _img2imgSlug;
  const slug = useEdit ? _img2imgSlug : _txt2imgSlug;

  const baseArgs = {
    prompt: promptText,
    model,
    n: 1,
    size: PLATFORM_SIZE[platform],
  };
  let toolArgs;
  if (useEdit) {
    // OPENAI_CREATE_IMAGE_EDIT shape: images: [{ image_url } | { file_id }].
    // Composio MCP wraps local file paths as file_id transparently when
    // we pass image_url with absolute paths; if the toolkit version
    // requires a stricter shape, the call surfaces the error from MCP.
    toolArgs = {
      ...baseArgs,
      images: referencePaths.map((p) => ({ image_url: path.resolve(p) })),
    };
  } else {
    toolArgs = { ...baseArgs, response_format: 'b64_json' };
  }

  const result = await callTool(config, slug, toolArgs);
  if (result?.error) {
    throw new Error(result.error?.message || JSON.stringify(result.error).slice(0, 300));
  }
  const b64 = extractImageB64(result);
  if (!b64) {
    throw new Error(`No image in response from ${slug}. First 300 chars: ${JSON.stringify(result).slice(0, 300)}`);
  }
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return slug;
}

async function withRetry(fn, label, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      console.log(`  retry ${i + 1}/${retries} ${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

// Tiny p-limit replacement (no external dep).
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then((v) => { active--; resolve(v); next(); })
        .catch((e) => { active--; reject(e); next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

(async () => {
  const refPhotos = resolveReferences();
  const approach = refPhotos.length > 0 ? `img2img(${refPhotos.length} refs)` : 'txt2img';

  const profilePath = config.paths?.restaurantProfile;
  const restaurantName = (profilePath && fs.existsSync(profilePath))
    ? (JSON.parse(fs.readFileSync(profilePath, 'utf-8')).name || 'restaurant')
    : 'restaurant';

  console.log(`\nGenerating ${prompts.slides.length} slides for ${restaurantName}`);
  console.log(`  platform: ${platform}  aspect: ${hints.aspect}  size: ${PLATFORM_SIZE[platform]}`);
  console.log(`  urgency: ${urgency}  approach: ${approach}  model: ${model}  concurrency: ${concurrency}`);
  if (refPhotos.length) refPhotos.forEach((p) => console.log(`  ref: ${p}`));
  console.log();

  // State init / merge
  const state = readState(outputDir) || { status: 'pending', slides: [], platform, createdAt: new Date().toISOString() };
  state.platform = platform;
  state.slides = state.slides || [];

  const limit = limiter(Math.max(1, concurrency));
  const tasks = prompts.slides.map((slidePrompt, i) => limit(async () => {
    const idx = i + 1;
    const outRaw = path.join(outputDir, `slide-${idx}-raw.png`);
    const slot = state.slides[i] || { index: idx };
    if (fs.existsSync(outRaw) && fs.statSync(outRaw).size > 10000 && slot.generated) {
      console.log(`  ⏭  slide-${idx}-raw.png exists, skipping`);
      return { idx, ok: true, skipped: true };
    }
    const fullPrompt = buildPrompt(prompts.base, slidePrompt, refPhotos.length > 0);
    try {
      const slug = await withRetry(() => generateImage(fullPrompt, refPhotos, outRaw), `slide-${idx}`);
      console.log(`  ✅ slide-${idx}-raw.png (via ${slug})`);
      slot.generated = true;
      slot.raw = `slide-${idx}-raw.png`;
      slot.toolUsed = slug;
      state.slides[i] = slot;
      return { idx, ok: true };
    } catch (e) {
      console.error(`  ❌ slide-${idx}: ${e.message}`);
      slot.generated = false;
      slot.lastError = e.message;
      state.slides[i] = slot;
      return { idx, ok: false };
    }
  }));

  const results = await Promise.all(tasks);
  const success = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  state.status = failed === 0 ? 'generated' : 'generated-partial';
  state.generatedAt = new Date().toISOString();
  state.refPhotos = refPhotos;
  state.approach = approach;
  writeState(outputDir, state);

  // metadata.json kept for human + downstream-consumer convenience.
  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify({
    generatedAt: state.generatedAt,
    platform, aspect: hints.aspect, urgency, approach, model,
    dish: dish || null, refPhotos,
    slidesGenerated: success, slidesFailed: failed,
  }, null, 2));

  console.log(`\nGenerated ${success}/${prompts.slides.length} → ${outputDir}`);
  if (failed > 0) {
    console.error(`${failed} failed. Re-run to retry — completed slides are preserved via state.json.`);
    process.exit(1);
  }
})();

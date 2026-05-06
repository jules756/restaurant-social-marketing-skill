#!/usr/bin/env node
/**
 * Generate slideshow images via gpt-image-2 routed through Composio MCP.
 *
 * v4: the OpenAI API key lives in the Composio project, not the VM. The
 * MCP server advertises an OpenAI image-generation tool; we discover its
 * slug at runtime (config.imageGen.toolSlug overrides discovery if set).
 *
 * txt2img: send a text-only prompt.
 * img2img: pass the reference photo's absolute path; Composio MCP handles
 *          server-side hosting and feeds OpenAI an edit/variation call.
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
 *   "base": "Shared base description anchoring ALL slides (same table, plates, lighting)",
 *   "slides": ["Slide 1 additions", "Slide 2 additions", ...]
 * }
 *
 * Resume: slide files that already exist (>10KB) are skipped. Re-run on failure.
 */

const fs = require('fs');
const path = require('path');
const { callTool, loadConfig, findToolByPattern, listTools } = require('./mcp-client');

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
const explicitReference = getArg('reference'); // direct path override (from drive-get.js)

if (!configPath || !outputDir || !promptsPath) {
  console.error('Usage: node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json> [--platform tiktok] [--urgency fast|quality] [--dish "Name"]');
  process.exit(1);
}

const config = loadConfig(configPath);
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
const model = 'gpt-image-2';

// gpt-image-2 supported sizes (per OpenAI API). The tool's input schema
// may further constrain; we intersect at runtime via listTools.
const PLATFORM_SIZE = {
  tiktok:    '1024x1536',  // 2:3 portrait — closest to TikTok 9:16; overlay handles final crop
  instagram: '1024x1280',  // ~4:5 portrait — IG carousel native
  facebook:  '1536x1024'   // 3:2 landscape — closest to FB 16:9
};
const PLATFORM_HINTS = {
  tiktok:    { aspect: '9:16 portrait',  slides: 6 },
  instagram: { aspect: '4:5 portrait',   slides: 6 },
  facebook:  { aspect: '16:9 landscape', slides: 1 }
};
const hints = PLATFORM_HINTS[platform];
if (!hints) {
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

// Direct --reference flag is the primary img2img path. Pass an absolute
// file path (often from drive-get.js). Inventory-based lookup remains as
// a legacy fallback for pipelines that pre-cache to disk.
function loadInventory() {
  const invPath = config.googleDrive?.inventoryPath;
  if (!invPath || !fs.existsSync(invPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(invPath, 'utf-8'));
  } catch (e) {
    console.warn(`Inventory unreadable (${e.message}) — falling back to txt2img.`);
    return null;
  }
}

function findReferencePhoto(inventory, dishName) {
  if (!inventory || !dishName) return null;
  const entry = inventory.byDish?.[dishName];
  if (!entry?.bestFile) return null;
  const configDir = path.dirname(path.resolve(configPath));
  const rawCachePath = config.googleDrive?.localCachePath || 'photos/';
  const cacheDir = path.isAbsolute(rawCachePath)
    ? rawCachePath
    : path.resolve(configDir, rawCachePath.replace(/^social-marketing\//, ''));
  const abs = path.resolve(cacheDir, 'dishes', entry.bestFile);
  return fs.existsSync(abs) ? abs : null;
}

function buildPrompt(basePrompt, slidePrompt) {
  const qualityLine = urgency === 'fast'
    ? 'Quality: good, fast turnaround.'
    : 'Quality: high, photorealistic, iPhone-like authenticity.';
  return [
    `Aspect ratio: ${hints.aspect}. Output must be a single image in that exact ratio.`,
    qualityLine,
    'No text, no watermarks, no logos in the image.',
    '',
    basePrompt,
    '',
    slidePrompt
  ].join('\n');
}

// Resolve the OpenAI image-generation tool slug from the MCP server.
// Config can pin one explicitly via config.imageGen.toolSlug; otherwise
// we discover it by name pattern. Cache the resolution across calls.
let _resolvedToolSlug = null;
async function resolveImageTool() {
  if (_resolvedToolSlug) return _resolvedToolSlug;
  if (config.imageGen?.toolSlug) {
    _resolvedToolSlug = config.imageGen.toolSlug;
    return _resolvedToolSlug;
  }
  const tool = await findToolByPattern(config, /^OPENAI_.*IMAGE.*GENERAT/i);
  if (!tool) {
    const tools = await listTools(config);
    const names = tools.map((t) => t.name).slice(0, 20).join(', ');
    throw new Error(
      `No OpenAI image-generation tool advertised by the MCP server. ` +
      `Confirm the OpenAI credential is attached to your Composio project, ` +
      `or pin the slug in config.imageGen.toolSlug. ` +
      `First tools advertised: ${names}`
    );
  }
  _resolvedToolSlug = tool.name;
  return _resolvedToolSlug;
}

// gpt-image-2 returns base64 JSON via Composio's standard image-generation
// tool. Response shape varies slightly between toolkit versions — probe a
// few common paths.
function extractImageB64(result) {
  const candidates = [
    result?.data?.[0]?.b64_json,
    result?.data?.b64_json,
    result?.images?.[0]?.b64_json,
    result?.images?.[0]?.b64,
    result?.b64_json,
    result?.image_b64
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

async function generateImage(promptText, referenceImagePath, outPath) {
  const toolSlug = await resolveImageTool();
  const args = {
    prompt: promptText,
    model,
    n: 1,
    size: PLATFORM_SIZE[platform],
    response_format: 'b64_json'
  };
  if (referenceImagePath) {
    // Pass the absolute path; Composio MCP hosts the file server-side and
    // routes to OpenAI's image-edit endpoint. Field name matches the
    // pattern used by other Composio image tools (Instagram, Facebook).
    args.image_file = path.resolve(referenceImagePath);
  }

  const result = await callTool(config, toolSlug, args);
  if (result?.error) {
    throw new Error(result.error?.message || JSON.stringify(result.error).slice(0, 300));
  }

  const b64 = extractImageB64(result);
  if (!b64) {
    throw new Error(
      `No image in response. Tool ${toolSlug} returned an unexpected shape. ` +
      `First 400 chars: ${JSON.stringify(result).slice(0, 400)}`
    );
  }

  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
}

async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      console.log(`  retry ${i + 1}/${retries}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

(async () => {
  // Priority: explicit --reference > inventory lookup > txt2img
  let refPhoto = null;
  if (explicitReference && fs.existsSync(explicitReference)) {
    refPhoto = path.resolve(explicitReference);
  } else {
    const inventory = loadInventory();
    refPhoto = findReferencePhoto(inventory, dish);
  }
  const approach = refPhoto ? 'img2img' : 'txt2img';

  const profilePath = config.paths?.restaurantProfile || 'social-marketing/restaurant-profile.json';
  const restaurantName = fs.existsSync(profilePath)
    ? (JSON.parse(fs.readFileSync(profilePath, 'utf-8')).name || 'restaurant')
    : 'restaurant';

  console.log(`\nGenerating ${prompts.slides.length} slides for ${restaurantName}`);
  console.log(`  platform: ${platform}  aspect: ${hints.aspect}  size: ${PLATFORM_SIZE[platform]}  urgency: ${urgency}  approach: ${approach}  model: ${model}`);
  if (refPhoto) console.log(`  reference: ${refPhoto}\n`);

  let success = 0;
  let failed = 0;
  for (let i = 0; i < prompts.slides.length; i++) {
    const outRaw = path.join(outputDir, `slide-${i + 1}-raw.png`);
    if (fs.existsSync(outRaw) && fs.statSync(outRaw).size > 10000) {
      console.log(`  ⏭  slide-${i + 1}-raw.png already exists, skipping`);
      success++;
      continue;
    }
    const fullPrompt = buildPrompt(prompts.base, prompts.slides[i]);
    try {
      await withRetry(() => generateImage(fullPrompt, refPhoto, outRaw));
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
    aspect: hints.aspect,
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

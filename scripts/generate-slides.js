#!/usr/bin/env node
/**
 * Generate slideshow images via OpenRouter chat completions with image modality.
 *
 * Works with Gemini image models (e.g. google/gemini-2.5-flash-image-preview) and
 * any other OpenRouter image model that supports the chat-completions-with-image
 * output modality. For txt2img, send a text-only user message. For img2img, attach
 * the reference photo as an image_url part in the same user message.
 *
 * Model is set in config.imageGen.model.
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
const { executeTool, loadConfig } = require('./composio-helpers');

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

const config = loadConfig(configPath);
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
const model = config.imageGen?.model;

if (!model) {
  console.error('No image model configured. Set config.imageGen.model in config.json.');
  process.exit(1);
}

// Chat-completions image models don't accept size/quality as parameters the way
// OpenAI's images/generations endpoint does. We hint at aspect ratio + quality
// inside the prompt text instead.
const PLATFORM_HINTS = {
  tiktok:    { aspect: '9:16 portrait', slides: 6 },
  instagram: { aspect: '4:5 portrait',  slides: 6 },
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

// Extract the first base64-encoded image from a chat-completions response.
// OpenRouter's image-modality response format varies by provider, so we probe
// every shape we've seen and return the first match.
function extractImageB64(data) {
  const message = data.choices?.[0]?.message;
  if (!message) return null;

  // Shape A: message.images is an array of { type, image_url: { url: "data:image/...;base64,..." } }
  if (Array.isArray(message.images)) {
    for (const img of message.images) {
      const url = img?.image_url?.url || img?.url;
      if (typeof url === 'string' && url.startsWith('data:image/')) {
        return url.split(',')[1];
      }
    }
  }

  // Shape B: message.content is an array containing an image part
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url || part?.image_url || part?.image;
      if (typeof url === 'string' && url.startsWith('data:image/')) {
        return url.split(',')[1];
      }
    }
  }

  // Shape C: message.content is a string containing a data URL
  if (typeof message.content === 'string') {
    const match = message.content.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/);
    if (match) return match[1];
  }

  return null;
}

async function generateImage(promptText, referenceImagePath, outPath) {
  const userContent = [{ type: 'text', text: promptText }];

  if (referenceImagePath) {
    const buf = fs.readFileSync(referenceImagePath);
    const mime = /\.png$/i.test(referenceImagePath) ? 'image/png' : 'image/jpeg';
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${buf.toString('base64')}` }
    });
  }

  // Prefer direct OpenRouter if OPENROUTER_API_KEY is set on the VM (demo
  // path — fastest, and works until the Composio org has an OpenRouter
  // toolkit attached). Fall back to Composio proxy otherwise.
  const directKey = process.env.OPENROUTER_API_KEY;
  let data;
  if (directKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${directKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://akira-agent.com',
        'X-Title': 'restaurant-social-marketing'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userContent }],
        modalities: ['image', 'text']
      })
    });
    data = await res.json();
    if (!res.ok && !data.error) data.error = { message: `HTTP ${res.status}` };
  } else {
    const result = await executeTool(config, 'OPENROUTER_CHAT_COMPLETIONS', {
      model,
      messages: [{ role: 'user', content: userContent }],
      modalities: ['image', 'text']
    });
    data = result.data || result.body || result;
  }
  if (data.error) {
    throw new Error(data.error?.message || `chat.completions: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const b64 = extractImageB64(data);
  if (!b64) {
    throw new Error(
      `No image in response. Model may not support image output modality. Response shape: ${JSON.stringify(data.choices?.[0]?.message || data).slice(0, 400)}`
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
  const inventory = loadInventory();
  const refPhoto = findReferencePhoto(inventory, dish);
  const approach = refPhoto ? 'img2img' : 'txt2img';

  const profilePath = config.paths?.restaurantProfile || 'social-marketing/restaurant-profile.json';
  const restaurantName = fs.existsSync(profilePath)
    ? (JSON.parse(fs.readFileSync(profilePath, 'utf-8')).name || 'restaurant')
    : 'restaurant';

  console.log(`\nGenerating ${prompts.slides.length} slides for ${restaurantName}`);
  console.log(`  platform: ${platform}  aspect: ${hints.aspect}  urgency: ${urgency}  approach: ${approach}  model: ${model}`);
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

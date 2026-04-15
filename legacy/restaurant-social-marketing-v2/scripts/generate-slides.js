#!/usr/bin/env node
/**
 * Generate slideshow images for a restaurant using image generation.
 *
 * Supported providers:
 *   - openai (gpt-image-1.5 STRONGLY RECOMMENDED — never use gpt-image-1)
 *   - local (user provides pre-made images, skips generation)
 *   - googledrive (use cached photos from synced Drive folder)
 *   - mixed (real photos where available, AI-generated for the rest)
 *
 * Supported platforms:
 *   - tiktok (1024x1536, exactly 6 slides)
 *   - instagram (1080x1350, 1-10 slides)
 *   - instagram-reels (1080x1920, 1-10 slides)
 *   - facebook (1200x630, exactly 1 slide)
 *
 * Usage: node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json> [--platform tiktok] [--promotion <id>]
 *
 * prompts.json format:
 * {
 *   "base": "Shared base prompt for all slides",
 *   "slides": ["Slide 1 additions", "Slide 2 additions", ...]
 * }
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const configPath = getArg('config');
const outputDir = getArg('output');
const promptsPath = getArg('prompts');

if (!configPath || !outputDir || !promptsPath) {
  console.error('Usage: node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json> [--platform tiktok] [--promotion <id>]');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));

// ─── Platform-aware dimensions ─────────────────────────────────────
const platform = getArg('platform') || 'tiktok';
const PLATFORM_DIMS = {
  tiktok: { width: 1024, height: 1536, size: '1024x1536' },
  instagram: { width: 1080, height: 1350, size: '1080x1350' },
  'instagram-reels': { width: 1080, height: 1920, size: '1080x1920' },
  facebook: { width: 1200, height: 630, size: '1200x630' }
};
const dims = PLATFORM_DIMS[platform] || PLATFORM_DIMS.tiktok;

// ─── Flexible slide count per platform ─────────────────────────────
const PLATFORM_SLIDES = { tiktok: { min: 6, max: 6 }, instagram: { min: 1, max: 10 }, facebook: { min: 1, max: 1 } };
const slideReq = PLATFORM_SLIDES[platform] || PLATFORM_SLIDES.tiktok;

if (!prompts.slides || prompts.slides.length < slideReq.min || prompts.slides.length > slideReq.max) {
  console.error(`ERROR: prompts.json must have between ${slideReq.min} and ${slideReq.max} slides for platform "${platform}" (got ${prompts.slides?.length || 0})`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const provider = config.imageGen?.provider || 'openai';
const model = config.imageGen?.model || 'gpt-image-1.5';
const apiKey = config.imageGen?.apiKey;

if (!apiKey && provider !== 'local' && provider !== 'googledrive' && provider !== 'mixed') {
  console.error(`ERROR: No API key found in config.imageGen.apiKey for provider "${provider}"`);
  process.exit(1);
}

// Warn if using gpt-image-1 instead of 1.5
if (provider === 'openai' && model && !model.includes('1.5')) {
  console.warn(`\n⚠️  WARNING: You're using "${model}" — this produces noticeably AI-looking images.`);
  console.warn(`   STRONGLY RECOMMENDED: Switch to "gpt-image-1.5" in your config for photorealistic results.`);
  console.warn(`   The quality difference is massive and directly impacts views.\n`);
}

// ─── Load knowledge base if available ──────────────────────────────
let knowledgeBase = null;
if (config.knowledgeBase?.menu) {
  const menuPath = config.knowledgeBase.menu;
  if (fs.existsSync(menuPath)) {
    knowledgeBase = { menu: JSON.parse(fs.readFileSync(menuPath, 'utf-8')) };
  }
}

// ─── Load active promotions if specified ───────────────────────────
const promotionId = getArg('promotion');
let activePromotion = null;
if (promotionId) {
  const promoPath = path.join(path.dirname(configPath), 'promotions.json');
  if (fs.existsSync(promoPath)) {
    const promoData = JSON.parse(fs.readFileSync(promoPath, 'utf-8'));
    activePromotion = promoData.promotions.find(p => p.id === promotionId);
    if (activePromotion) {
      console.log(`  Promotion: ${activePromotion.name} (${activePromotion.discount || activePromotion.type})`);
    }
  }
}

// ─── Provider: OpenAI/OpenRouter ───────────────────────────────────────────────
async function generateOpenAI(prompt, outPath) {
  // Detect if we're using OpenRouter (apiKey starts with sk-or- or contains openrouter)
  const isOpenRouter = apiKey?.startsWith('sk-or-') || 
                       (typeof apiKey === 'string' && apiKey.toLowerCase().includes('openrouter'));
  
  const res = await fetch(isOpenRouter 
    ? 'https://openrouter.ai/api/v1/images/generations' 
    : 'https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: dims.size,
      quality: 'high'
    }),
    signal: global.__abortSignal
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  fs.writeFileSync(outPath, Buffer.from(data.data[0].b64_json, 'base64'));
}

// ─── Provider: Local (skip generation) ──────────────────────────────
async function generateLocal(prompt, outPath) {
  const slideNum = path.basename(outPath).match(/\d+/)?.[0];
  const localPath = path.join(outputDir, `local_slide${slideNum}.png`);
  if (fs.existsSync(localPath)) {
    fs.copyFileSync(localPath, outPath);
  } else {
    throw new Error(`Place your image at ${localPath} — local provider skips generation`);
  }
}

// ─── Provider: Google Drive (use cached photos from synced Drive folder) ─
async function generateGoogleDrive(prompt, outPath) {
  // Load photo index from the configured cache path
  const cachePath = config.googleDrive?.localCachePath || 'tiktok-marketing/photos';
  const indexPath = path.join(cachePath, 'photo-index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error('No photo index found. Run google-drive-sync.js --sync first');
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const slideNum = parseInt(path.basename(outPath).match(/\d+/)?.[0] || '1');

  // Try to find a photo matching tags from the prompt
  const promptWords = prompt.toLowerCase().split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;
  for (const photo of index.photos) {
    const score = photo.tags.filter(t => promptWords.includes(t.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; bestMatch = photo; }
  }

  if (bestMatch && fs.existsSync(bestMatch.localPath)) {
    fs.copyFileSync(bestMatch.localPath, outPath);
  } else {
    // Fall back to any unused photo
    const unused = index.photos.filter(p => p.usedInPosts.length === 0 && fs.existsSync(p.localPath));
    if (unused.length > 0) {
      fs.copyFileSync(unused[slideNum % unused.length].localPath, outPath);
    } else {
      throw new Error('No matching photos found in Google Drive cache. Sync more photos or use openai provider.');
    }
  }
}

// ─── Provider: Mixed (real photos where available, AI-generated for the rest) ─
async function generateMixed(prompt, outPath) {
  try {
    await generateGoogleDrive(prompt, outPath);
  } catch (e) {
    // Fall back to OpenAI if no matching Drive photo
    console.log(`  No Drive photo match, using AI: ${e.message}`);
    await generateOpenAI(prompt, outPath);
  }
}

// ─── Retry with timeout ─────────────────────────────────────────────
async function withRetry(fn, retries = 2, timeoutMs = 120000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // Pass abort signal via global (providers use fetch which supports it)
      global.__abortSignal = controller.signal;
      const result = await fn();
      clearTimeout(timer);
      return result;
    } catch (e) {
      if (attempt < retries) {
        const isTimeout = e.name === 'AbortError' || e.message?.includes('timeout') || e.message?.includes('abort');
        console.log(`  ⚠️ ${isTimeout ? 'Timeout' : 'Error'}: ${e.message}. Retrying (${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      } else {
        throw e;
      }
    }
  }
}

// ─── Provider dispatch ──────────────────────────────────────────────
const providers = {
  openai: generateOpenAI,
  local: generateLocal,
  googledrive: generateGoogleDrive,
  mixed: generateMixed
};

async function generate(prompt, outPath) {
  const fn = providers[provider];
  if (!fn) {
    console.error(`Unknown provider: "${provider}". Supported: ${Object.keys(providers).join(', ')}`);
    process.exit(1);
  }
  console.log(`  Generating ${path.basename(outPath)} [${provider}/${model}]...`);
  await withRetry(() => fn(prompt, outPath));
  console.log(`  ✅ ${path.basename(outPath)}`);
}

(async () => {
  const slideCount = prompts.slides.length;
  console.log(`Generating ${slideCount} slides for ${config.restaurant?.name || 'restaurant'} [${platform}/${provider}/${model}]${activePromotion ? ` (PROMO: ${activePromotion.name})` : ''}\n`);
  let success = 0;
  let skipped = 0;
  for (let i = 0; i < prompts.slides.length; i++) {
    const outPath = path.join(outputDir, `slide${i + 1}_raw.png`);
    // Skip if already exists (resume from partial run)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      console.log(`  ⏭ slide${i + 1}_raw.png already exists, skipping`);
      success++;
      skipped++;
      continue;
    }
    const fullPrompt = `${prompts.base}\n\n${prompts.slides[i]}`;
    try {
      await generate(fullPrompt, outPath);
      success++;
    } catch (e) {
      console.error(`  ❌ Slide ${i + 1} failed after retries: ${e.message}`);
      console.error(`     Re-run this script to retry — completed slides will be skipped.`);
    }
  }
  console.log(`\n✨ Generated ${success}/${slideCount} slides for ${config.restaurant?.name || 'restaurant'} in ${outputDir}${skipped > 0 ? ` (${skipped} skipped — already existed)` : ''}`);
  if (success < slideCount) {
    console.error(`\n⚠️  ${slideCount - success} slides failed. Re-run to retry — completed slides are preserved.`);
    process.exit(1);
  }
})();

#!/usr/bin/env node
/**
 * Build social-marketing/photo-inventory.json by categorizing every synced
 * Drive photo using OpenRouter vision.
 *
 * For each photo: detect dish name, category (dish/ambiance/kitchen/exterior),
 * quality signal (sharp/blurry/dark). Move from unsorted/ into the matching
 * subdirectory. Track lastUsed and usage count across posts.
 *
 * Usage:
 *   node drive-inventory.js --config social-marketing/config.json [--full]
 *
 * --full re-categorizes every photo, not just new ones.
 *
 * Output:
 *   <photo-inventory.json>
 *   {
 *     "lastUpdated": "2026-04-15",
 *     "totalPhotos": 47,
 *     "byDish": { "Pasta Carbonara": { files, bestFile, quality, lastUsed, usedInPosts } },
 *     "byCategory": { "dishes": 31, "ambiance": 8, "kitchen": 5, "exterior": 3 },
 *     "missing": ["desserts", "bar area"],
 *     "note": "..."
 *   }
 */

const fs = require('fs');
const path = require('path');
const { executeTool, loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config');
if (!configPath) {
  console.error('Usage: node drive-inventory.js --config <config.json> [--full]');
  process.exit(1);
}

const config = loadConfig(configPath);

// Resolve paths relative to the config file's directory, not cwd.
const configDir = path.dirname(path.resolve(configPath));
const rawCachePath = config.googleDrive?.localCachePath || 'photos/';
const cacheDir = path.isAbsolute(rawCachePath)
  ? rawCachePath
  : path.resolve(configDir, rawCachePath.replace(/^social-marketing\//, ''));
const driveIndexPath = path.join(cacheDir, 'drive-index.json');
const rawInventoryPath = config.googleDrive?.inventoryPath || 'photo-inventory.json';
const inventoryPath = path.isAbsolute(rawInventoryPath)
  ? rawInventoryPath
  : path.resolve(configDir, rawInventoryPath.replace(/^social-marketing\//, ''));

if (!fs.existsSync(driveIndexPath)) {
  console.error(`No drive-index.json at ${driveIndexPath}. Run drive-sync.js first.`);
  process.exit(1);
}

const driveIndex = JSON.parse(fs.readFileSync(driveIndexPath, 'utf-8'));
const full = hasFlag('full');

// Load menu for known dish matching.
const menuPath = config.knowledgeBase?.menu;
const knownDishes = [];
if (menuPath && fs.existsSync(menuPath)) {
  try {
    const menu = JSON.parse(fs.readFileSync(menuPath, 'utf-8'));
    (menu.sections || []).forEach((section) => {
      (section.items || []).forEach((item) => {
        if (item.name) knownDishes.push(item.name);
      });
    });
  } catch (e) {
    console.warn(`Could not parse menu.json: ${e.message}`);
  }
}

// Vision classification is part of the image pipeline and runs through the
// Composio Project's OpenRouter credential — no direct OpenRouter key on the
// VM. The vision model is an internal detail (not user-configurable).
// Override via VISION_MODEL env var if absolutely necessary.
const VISION_MODEL = process.env.VISION_MODEL || 'openai/gpt-4o-mini';

async function classifyPhoto(filePath, sourceFolder) {
  const buf = fs.readFileSync(filePath);
  const mime = filePath.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
  const b64 = buf.toString('base64');
  const folderHint = sourceFolder
    ? `\nHINT: This image came from a Drive folder named "${sourceFolder}" — use this as a non-authoritative clue. Classify based on the actual image content, not the folder name.`
    : '';
  const prompt = `You are cataloging a restaurant's photo library. Look at this photo and return ONLY a JSON object with this exact shape (no markdown, no prose):

{
  "category": "dish" | "ambiance" | "kitchen" | "exterior" | "menu" | "other",
  "dishName": "<best-guess dish name if category is dish, else null>",
  "quality": "high" | "medium" | "low",
  "notes": "<one-sentence description>"
}

Category guidelines:
- "dish": plated food ready to eat, close-up or styled shot
- "ambiance": dining room, tables, bar, decor, guests enjoying the space
- "kitchen": chefs working, cooking in progress, prep area, equipment
- "exterior": building facade, street view, entrance, outdoor seating
- "menu": menu card/board/printed list
- "other": people, events, logos, anything not fitting above

Known dishes from this restaurant's menu (prefer these when category is dish):
${knownDishes.length ? knownDishes.map((d) => `  - ${d}`).join('\n') : '  (none provided)'}

Quality: "high" = sharp, well-lit, good composition. "medium" = usable. "low" = blurry/dark/poor angle.${folderHint}`;

  // Prefer direct OpenRouter via config.imageGen.openrouterApiKey or env.
  // Fall back to Composio if not set.
  const directKey = config.imageGen?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  let data;
  if (directKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${directKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://akira-agent.com',
        'X-Title': 'drive-inventory'
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
          ]
        }],
        response_format: { type: 'json_object' }
      })
    });
    data = await res.json();
  } else {
    const result = await executeTool(config, 'OPENROUTER_CHAT_COMPLETIONS', {
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
        ]
      }],
      response_format: { type: 'json_object' }
    });
    data = result.data || result.body || result;
  }
  if (data.error) throw new Error(data.error?.message || 'vision error');
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('vision: empty response');
  return JSON.parse(content);
}

function moveToCategory(file, category) {
  const subdir = {
    dish: 'dishes',
    ambiance: 'ambiance',
    kitchen: 'kitchen',
    exterior: 'exterior',
    menu: 'menu',
    other: 'other'
  }[category] || 'unsorted';
  const target = path.join(cacheDir, subdir, path.basename(file.localPath));
  if (file.localPath !== target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(file.localPath, target);
    file.localPath = target;
  }
  return target;
}

function loadInventory() {
  if (!fs.existsSync(inventoryPath)) {
    return { lastUpdated: null, totalPhotos: 0, byDish: {}, byCategory: {}, missing: [], note: '' };
  }
  return JSON.parse(fs.readFileSync(inventoryPath, 'utf-8'));
}

function updateInventory(inv, file, classification) {
  const { category, dishName, quality } = classification;
  inv.byCategory[category] = (inv.byCategory[category] || 0) + 1;
  if (category === 'dish' && dishName) {
    const entry = inv.byDish[dishName] || {
      files: [],
      bestFile: null,
      quality: 'low',
      lastUsed: null,
      usedInPosts: 0
    };
    const filename = path.basename(file.localPath);
    if (!entry.files.includes(filename)) entry.files.push(filename);
    const qualityRank = { high: 3, medium: 2, low: 1 };
    if (qualityRank[quality] > qualityRank[entry.quality] || !entry.bestFile) {
      entry.bestFile = filename;
      entry.quality = quality;
    }
    inv.byDish[dishName] = entry;
  }
}

(async () => {
  const inv = loadInventory();
  // Reset counters — we recompute from driveIndex each run.
  inv.byCategory = {};
  inv.totalPhotos = 0;

  const files = Object.values(driveIndex.files);
  console.log(`Classifying ${files.length} photos (full=${full})`);

  let classified = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    if (!fs.existsSync(file.localPath)) {
      failed++;
      console.warn(`  ⚠️  missing file: ${file.localPath}`);
      continue;
    }
    if (!full && file.category) {
      // Re-apply known classification to the aggregate totals.
      inv.byCategory[file.category] = (inv.byCategory[file.category] || 0) + 1;
      inv.totalPhotos++;
      skipped++;
      continue;
    }
    try {
      const c = await classifyPhoto(file.localPath, file.sourceFolder);
      file.category = c.category;
      file.dishName = c.dishName || null;
      file.quality = c.quality;
      file.notes = c.notes;
      moveToCategory(file, c.category);
      updateInventory(inv, file, c);
      inv.totalPhotos++;
      classified++;
      console.log(`  ✅ ${path.basename(file.localPath)} → ${c.category}${c.dishName ? ` (${c.dishName})` : ''} [${c.quality}]`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${path.basename(file.localPath)}: ${e.message}`);
    }
  }

  // Detect missing categories.
  const expected = ['dish', 'ambiance', 'kitchen', 'exterior'];
  inv.missing = expected.filter((c) => !inv.byCategory[c]);

  // Flag missing dish coverage.
  const menuDishes = knownDishes;
  const missingDishes = menuDishes.filter((d) => !inv.byDish[d]);
  if (missingDishes.length) {
    inv.note = `Missing photos for: ${missingDishes.join(', ')}. Trigger knowledge-gap probe.`;
  } else {
    inv.note = '';
  }

  inv.lastUpdated = new Date().toISOString().split('T')[0];
  fs.writeFileSync(inventoryPath, JSON.stringify(inv, null, 2));
  fs.writeFileSync(driveIndexPath, JSON.stringify(driveIndex, null, 2));

  console.log(`\nInventory updated → ${inventoryPath}`);
  console.log(`  classified: ${classified}, cached: ${skipped}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();

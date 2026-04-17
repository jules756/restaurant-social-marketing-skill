#!/usr/bin/env node
/**
 * One-shot post generator — reads restaurant-profile.json, generates 6
 * slides via OpenRouter (through Composio SDK or direct OpenRouter key),
 * adds text overlays, and prints JSON with the final slide paths + caption.
 *
 * Designed to be invoked by Hermes via its `terminal` tool when the owner
 * types "generate post" in Telegram. Output is machine-readable so Hermes
 * can attach each slide via its send-photo tool.
 *
 * Usage:
 *   node demo-post.js --config ~/social-marketing/config.json
 *
 * Output (stdout, last line):
 *   {"ok": true, "slides": ["/path/1.png", ...], "caption": "..."}
 *
 * On failure, exits non-zero with { "ok": false, "error": "..." }
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const platform = getArg('platform') || 'instagram';

function fail(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

try {
  const config = loadConfig(configPath);
  const profilePath = config.paths?.restaurantProfile ||
    path.join(path.dirname(path.resolve(configPath)), 'restaurant-profile.json');
  if (!fs.existsSync(profilePath)) fail(`Restaurant profile not found: ${profilePath}. Owner has not completed onboarding.`);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

  const dish = profile.signatureDishes?.[0]?.name || profile.signatureDishes?.[0] || 'signature dish';
  const visual = profile.signatureDishes?.[0]?.visualDescription || profile.signatureDishes?.[0]?.visual || `${dish} plated beautifully`;
  const vibe = profile.vibe || 'cozy and inviting';
  const restaurantName = profile.name || 'the restaurant';
  const location = profile.location || '';
  const cuisine = profile.cuisine || 'restaurant';

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16).replace('T', '-');
  const outputDir = path.resolve(config.paths?.posts || 'social-marketing/posts/', timestamp);
  fs.mkdirSync(outputDir, { recursive: true });

  const basePrompt = `iPhone photo of ${visual}, ${vibe} atmosphere, ${cuisine} restaurant, warm ambient lighting, authentic and appetizing, shot on iPhone, natural depth of field, no text no watermarks no logos`;
  const prompts = {
    base: basePrompt,
    slides: [
      `Close-up top-down of ${dish}, steam rising, intimate detail`,
      `Side angle of ${dish} with ambient restaurant background, soft bokeh`,
      `Chef's or server's hand finishing the plate — sprinkle, drizzle, or garnish`,
      `Kitchen scene, chef working, ${dish} ingredients visible`,
      `Wide shot of the dining room — ${vibe} atmosphere, guests visible but not foregrounded`,
      `Final slide: ${dish} hero shot with upper-third clear for overlay text — for the booking CTA`
    ]
  };
  const promptsPath = path.join(outputDir, 'prompts.json');
  fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));

  const texts = [
    `Wait… is this\nreally homemade??`,
    `The care that\ngoes into every\nplate`,
    `This is ${cuisine}\nthe way it's meant\nto be`,
    `${restaurantName}${location ? ` — ${location}` : ''}`,
    `Our regulars know\nwhy they keep\ncoming back`,
    `Book at ${restaurantName}\n— link in bio`
  ];
  const textsPath = path.join(outputDir, 'texts.json');
  fs.writeFileSync(textsPath, JSON.stringify(texts, null, 2));

  const repoDir = path.resolve(__dirname, '..');

  // 1. Generate raw slides
  execSync(
    `node "${repoDir}/scripts/generate-slides.js" --config "${configPath}" --output "${outputDir}" --prompts "${promptsPath}" --platform ${platform} --dish "${dish}"`,
    { stdio: 'inherit', env: process.env }
  );

  // 2. Add text overlays (best-effort — if node-canvas missing, skip)
  try {
    execSync(
      `node "${repoDir}/scripts/add-text-overlay.js" --input "${outputDir}" --texts "${textsPath}"`,
      { stdio: 'inherit', env: process.env }
    );
  } catch (e) {
    console.error('[warn] overlay step failed, returning raw slides without text');
  }

  // 3. Collect final slide paths (prefer overlaid, fall back to raw)
  const slides = [];
  for (let i = 1; i <= 6; i++) {
    const finalPath = path.join(outputDir, `slide-${i}.png`);
    const rawPath = path.join(outputDir, `slide-${i}-raw.png`);
    if (fs.existsSync(finalPath)) slides.push(finalPath);
    else if (fs.existsSync(rawPath)) slides.push(rawPath);
  }

  // 4. Build caption
  const caption = `Fresh ${dish} at ${restaurantName}${location ? ' — ' + location : ''}. ${profile.typicalGuest ? profile.typicalGuest + ' welcome.' : ''} Book now${profile.bookingUrl ? ' → ' + profile.bookingUrl : ' — link in bio'}`;
  fs.writeFileSync(path.join(outputDir, 'caption.txt'), caption);

  console.log('');
  console.log(JSON.stringify({
    ok: true,
    outputDir,
    slides,
    caption,
    dish,
    restaurantName
  }));
} catch (e) {
  fail(e.message);
}

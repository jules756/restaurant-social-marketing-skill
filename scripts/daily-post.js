#!/usr/bin/env node
/**
 * Daily autonomous post generator and publisher.
 * Runs via cron. Reads owner prefs + learned strategy, generates 6-slide carousel,
 * posts to enabled platforms via Composio, sends Telegram notification.
 * 
 * Usage: node daily-post.js --config ~/social-marketing/config.json [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const dryRun = hasFlag('dry-run');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const config = loadConfig(configPath);
const clientDir = path.dirname(path.resolve(configPath));
let profilePath = path.join(clientDir, 'restaurant-profile.json');
if (!fs.existsSync(profilePath)) {
  profilePath = path.join(process.env.HOME || '/Users/jules', 'social-marketing', 'restaurant-profile.json');
}
const strategyPath = path.join(clientDir, 'strategy.json');

if (!fs.existsSync(profilePath)) {
  fail('No restaurant-profile.json found. Run onboarding first.');
}

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
const prefs = profile.postingPrefs || { frequency: 1, preferredTimes: ['11:00'] };
const strategy = fs.existsSync(strategyPath) ? JSON.parse(fs.readFileSync(strategyPath, 'utf-8')) : { postingTimes: [] };

const postTime = strategy.postingTimes?.[0]?.time || prefs.preferredTimes[0] || '11:00';
const timestamp = new Date().toISOString().slice(0,16).replace(/:/g,'');
const postDir = path.join(clientDir, 'posts', timestamp);

console.log(`[Daily Post] Starting for ${profile.name || 'restaurant'} at ~${postTime} (${prefs.frequency} post/day)`);
if (dryRun) console.log('[DRY-RUN] Would create', postDir);

if (!dryRun) {
  fs.mkdirSync(postDir, { recursive: true });
}

// Run full pipeline
console.log(`[Daily Post] Generating content in ${postDir}...`);

const execSync = require('child_process').execSync;

console.log(`[Daily Post] Running pipeline in ${postDir}...`);

try {
    if (!dryRun) {
      console.log("→ Generating slides...");
      const promptsPath = path.join(postDir, 'prompts.json');
      const prompts = {
        base: "Professional restaurant food photography, appetizing, high quality, realistic food photo",
        slides: [
          "Hook slide with strong opening line",
          "Show the dish details",
          "Restaurant atmosphere",
          "Customer reaction",
          "Chef preparing",
          "Strong booking call to action"
        ]
      };
      fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));
      
      execSync(`node generate-slides.js --config "${configPath}" --output "${postDir}" --prompts "${promptsPath}" --platform instagram --dish "Signature Dish"`, { stdio: 'inherit', cwd: __dirname });

      console.log("→ Adding text overlays...");
      execSync(`node add-text-overlay.js --dir "${postDir}"`, { stdio: 'inherit', cwd: __dirname });
      
      if (config.platforms?.instagram?.enabled !== false) {
        console.log("→ Posting to Instagram...");
        execSync(`node post-to-instagram.js --config "${configPath}" --dir "${postDir}"`, { stdio: 'inherit', cwd: __dirname });
      }

      console.log("→ Running self-improvement...");
      execSync(`node self-improve.js "${configPath}"`, { stdio: 'inherit', cwd: __dirname });
    } else {
    console.log('[DRY-RUN] Would run: generate-slides.js → add-text-overlay.js → post-to-instagram.js → self-improve.js');
  }
} catch (e) {
  console.error('Pipeline error:', e.message);
  if (!dryRun) process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: dryRun ? 'dry-run' : 'live',
  postDir,
  frequency: prefs.frequency,
  time: postTime,
  restaurant: profile.name
}));

console.log('✅ Daily post cycle completed.');

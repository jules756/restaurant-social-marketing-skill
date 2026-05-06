#!/usr/bin/env node
/**
 * Module D — On-demand competitor research.
 *
 * Triggered by `research competitors` Telegram command (orchestrator confirms
 * first — takes 15–30 min). Produces a research plan + synthesis template; the
 * actual browsing / search work is handled by Hermes's browser and web-search
 * tools at runtime. This script organizes the scope and output.
 *
 * Usage:
 *   node competitor-research.js --config social-marketing/config.json
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config');
if (!configPath) {
  console.error('Usage: node competitor-research.js --config <config.json>');
  process.exit(1);
}

const config = loadConfig(configPath);
const today = new Date().toISOString().split('T')[0];

// Restaurant info lives in restaurant-profile.json (owner-provided via Telegram),
// NOT in config.json. config.json is Installer-scope only.
function loadProfile() {
  const fs = require('fs');
  const profilePath = config.paths?.restaurantProfile || 'social-marketing/restaurant-profile.json';
  if (!fs.existsSync(profilePath)) {
    console.error(`No restaurant profile at ${profilePath}. Owner must complete Telegram onboarding first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
}
const profile = loadProfile();
const cuisine = profile.cuisine || 'restaurant';
const city = profile.location || '';
const year = new Date().getFullYear();

const plan = {
  createdAt: today,
  cuisine,
  city,
  scope: [
    { source: 'TikTok', action: `Search "${cuisine} TikTok ${city}"; identify 3–5 competitor accounts` },
    { source: 'Instagram', action: `Search "${cuisine} Instagram ${city}"; same competitor list; top posts` },
    { source: 'Google Maps', action: `Pull recent reviews of top 3 competitors — extract customer language` },
    { source: 'TripAdvisor', action: `Same — recent reviews of top 3 competitors` },
    { source: 'Local press', action: `Search "best ${cuisine} ${city} ${year}"` }
  ],
  perCompetitorCapture: [
    'handle',
    'followers',
    'topHookFormats',
    'avgVsBestViews',
    'postingFrequency',
    'ctaStyle',
    'whatTheyAreNotDoing'
  ],
  gapAnalysis: 'Identify formats / angles NOT being used in this market — that is our opportunity.'
};

const outPath = path.resolve(config.paths?.competitorResearch || 'social-marketing/competitor-research.json');
const mdPath = path.resolve(
  config.paths?.competitorReports || 'social-marketing/reports/competitor/',
  `${today}.md`
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(path.dirname(mdPath), { recursive: true });

const structured = {
  researchDate: today,
  status: 'PENDING_BROWSER_RUN',
  plan,
  competitors: [],
  gapOpportunities: []
};
fs.writeFileSync(outPath, JSON.stringify(structured, null, 2));

const md = `# Competitor Research — ${today}

**Status:** Pending browser run. This file stages the research plan; orchestrator executes the scope using Hermes browser / web-search tools, then updates the structured JSON at \`${outPath}\`.

## Scope
${plan.scope.map((s) => `- **${s.source}** — ${s.action}`).join('\n')}

## Per Competitor Capture
${plan.perCompetitorCapture.map((k) => `- \`${k}\``).join('\n')}

## Gap Analysis (most valuable output)
${plan.gapAnalysis}

## Competitors
_Populated by the browser run._

## Gap Opportunities
_Populated by the browser run._
`;
fs.writeFileSync(mdPath, md);

console.log(`Competitor research plan staged.`);
console.log(`  structured: ${outPath}`);
console.log(`  narrative:  ${mdPath}`);
console.log('\n---TELEGRAM-SUMMARY---');
console.log(`Starting competitor research on ${cuisine} restaurants in ${city || 'your area'} — I'll have a gap-analysis report in 15–30 minutes.`);
console.log('---END---');

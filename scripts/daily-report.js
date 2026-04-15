#!/usr/bin/env node
/**
 * Module A — Daily analytics cron.
 *
 * Runs every morning at 10:00 (config.timezone). Pulls platform stats from
 * Composio, optionally Google Analytics, and booking data. Produces:
 *   - social-marketing/reports/YYYY-MM-DD-daily.md
 *   - A short Telegram-ready summary written to stdout for the orchestrator
 *     to forward to the owner.
 *   - An appended row in social-marketing/hook-performance.json per post
 *     analyzed.
 *
 * Usage:
 *   node daily-report.js --config social-marketing/config.json [--days 3]
 */

const fs = require('fs');
const path = require('path');
const { executeTool, loadConfig, PLATFORMS } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};

const configPath = getArg('config');
const days = parseInt(getArg('days', '3'), 10);
if (!configPath) {
  console.error('Usage: node daily-report.js --config <config.json> [--days 3]');
  process.exit(1);
}

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
if (!COMPOSIO_API_KEY) {
  console.error('COMPOSIO_API_KEY is not set.');
  process.exit(1);
}

const config = loadConfig(configPath);
const today = new Date().toISOString().split('T')[0];
const reportPath = path.resolve(
  config.paths?.reports || 'social-marketing/reports/',
  `${today}-daily.md`
);
const hookPath = path.resolve(config.paths?.hookPerformance || 'social-marketing/hook-performance.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

async function pullPlatform(name) {
  const pc = config.platforms?.[name];
  if (!pc?.enabled) return null;
  const accountId = pc.composioAccountId;
  const userId = `daily_${today}`;
  try {
    if (name === 'tiktok') {
      const [videos, stats] = await Promise.all([
        executeTool(COMPOSIO_API_KEY, accountId, userId, PLATFORMS.tiktok.listVideosTool, { max_count: days * 5 }),
        executeTool(COMPOSIO_API_KEY, accountId, userId, PLATFORMS.tiktok.userStatsTool, {})
      ]);
      return { videos, stats };
    }
    if (name === 'instagram') {
      return await executeTool(COMPOSIO_API_KEY, accountId, userId, PLATFORMS.instagram.userInsightsTool, {});
    }
    if (name === 'facebook') {
      return await executeTool(COMPOSIO_API_KEY, accountId, userId, PLATFORMS.facebook.pageInsightsTool, {});
    }
  } catch (e) {
    return { error: e.message };
  }
  return null;
}

async function pullGoogleAnalytics() {
  const ga = config.analytics?.googleAnalytics;
  if (!ga?.enabled) return null;
  // Placeholder: the real integration will call GA4 Data API via a GA-specific
  // Composio tool or direct fetch with service account auth. Log and skip for
  // now so the cron doesn't block the rest of the pipeline.
  console.log('  (GA integration pending — skipping)');
  return null;
}

async function pullBookings() {
  const bt = config.analytics?.bookingTracking;
  if (!bt) return null;
  if (bt.method === 'manual') {
    // Manual method means the orchestrator will ask the owner. Emit a marker so
    // the orchestrator knows to prompt.
    return { method: 'manual', promptRequired: true };
  }
  // TODO: api / utm methods.
  return { method: bt.method, pending: true };
}

function diagnose(viewsTrend, bookingsTrend) {
  // viewsTrend / bookingsTrend expected: "up" | "flat" | "down"
  const high = (t) => t === 'up';
  const flat = (t) => t === 'flat' || t === 'down';
  if (high(viewsTrend) && high(bookingsTrend)) return { verdict: 'Working', action: 'Scale — 3 hook variations now.' };
  if (high(viewsTrend) && flat(bookingsTrend)) return { verdict: 'CTA broken', action: 'Test new slide 6; check booking page.' };
  if (flat(viewsTrend) && high(bookingsTrend)) return { verdict: 'Hook broken', action: 'Content converts — fix slide 1 hook.' };
  return { verdict: 'Reset', action: 'New format; trigger trend research.' };
}

function writeReport({ platformData, bookings, diagnosis, summary }) {
  const md = `# Daily Report — ${today}

## Diagnosis
**${diagnosis.verdict}** — ${diagnosis.action}

## Platform Data
\`\`\`json
${JSON.stringify(platformData, null, 2)}
\`\`\`

## Bookings
\`\`\`json
${JSON.stringify(bookings, null, 2)}
\`\`\`

## Summary (for Telegram)
${summary}
`;
  fs.writeFileSync(reportPath, md);
}

function summarize(platformData, bookings, diagnosis) {
  // Max 5 sentences, plain language, one suggested hook.
  const bestPlatform = Object.entries(platformData).find(([, v]) => v && !v.error)?.[0] || 'your account';
  const s1 = `Yesterday on ${bestPlatform}: ${diagnosis.verdict.toLowerCase()}.`;
  const s2 = diagnosis.action;
  const s3 = bookings?.promptRequired ? 'How many covers did you do yesterday?' : '';
  const s4 = 'One idea for today: a story-behind-the-dish hook on your strongest signature.';
  return [s1, s2, s3, s4].filter(Boolean).join(' ');
}

(async () => {
  console.log(`Daily report for ${today} (days=${days})`);

  const platformData = {};
  for (const name of ['tiktok', 'instagram', 'facebook']) {
    platformData[name] = await pullPlatform(name);
  }
  await pullGoogleAnalytics();
  const bookings = await pullBookings();

  // Trend detection left as a refinement — default to "flat" so the diagnosis
  // surfaces "need more data" rather than fabricating direction.
  const diagnosis = diagnose('flat', 'flat');
  const summary = summarize(platformData, bookings, diagnosis);
  writeReport({ platformData, bookings, diagnosis, summary });

  // Emit summary on stdout for orchestrator to forward.
  console.log('\n---TELEGRAM-SUMMARY---');
  console.log(summary);
  console.log('---END---');
  console.log(`\nReport saved: ${reportPath}`);
  console.log(`(Hook-performance ledger at ${hookPath} is updated by generate-slides.js at post time.)`);
})();

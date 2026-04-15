#!/usr/bin/env node
/**
 * Module B — Weekly trend research cron.
 *
 * Runs every Monday at 09:00 (config.timezone). Uses the OpenRouter chat model
 * with web search capability (or delegates to Hermes's web search tool — see
 * note below) to execute the query buckets defined in social-trend-monitor-hermes.
 *
 * Output:
 *   - social-marketing/trend-report.json (structured)
 *   - social-marketing/reports/trend-reports/YYYY-MM-DD-weekly.md (narrative)
 *   - Telegram summary on stdout
 *
 * Usage:
 *   node weekly-research.js --config social-marketing/config.json
 *
 * Implementation note: Hermes agents have web search natively. When this
 * script runs under Hermes, prefer delegating each query to the agent's
 * search tool via the orchestrator rather than calling a search API here.
 * This file writes the query plan and synthesizes results once supplied.
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config');
if (!configPath) {
  console.error('Usage: node weekly-research.js --config <config.json>');
  process.exit(1);
}

const config = loadConfig(configPath);
const today = new Date();
const weekOf = today.toISOString().split('T')[0];
const monthYear = today.toLocaleString('en-US', { month: 'long', year: 'numeric' });
const month = today.toLocaleString('en-US', { month: 'long' });
const year = String(today.getFullYear());
const country = (config.country || 'SE').toUpperCase();

function buildQueries() {
  const queries = {
    platformUpdates: [
      `TikTok slideshow algorithm ${monthYear}`,
      `Instagram carousel reach algorithm ${monthYear}`,
      `Instagram keyword SEO captions ${year}`
    ],
    viralFormats: [
      `restaurant TikTok viral ${monthYear}`,
      `food Instagram carousel performing ${month}`,
      `restaurant social media trend ${monthYear}`
    ],
    industry: [
      `restaurant marketing social media ${monthYear}`,
      `hospitality content strategy ${year}`
    ]
  };
  if (['SE', 'NO'].includes(country)) {
    queries.localMarket = [
      `restaurang TikTok trend ${month}`,
      `mat Instagram Sverige trend ${month}`
    ];
  }
  return queries;
}

function writeQueryPlan(queries) {
  const planPath = path.resolve(
    config.paths?.trendReports || 'social-marketing/reports/trend-reports/',
    `${weekOf}-query-plan.json`
  );
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify({ weekOf, queries }, null, 2));
  return planPath;
}

function writeEmptyReport(queries) {
  const trendReport = {
    weekOf,
    platformUpdates: [],
    trendingFormats: [],
    hookTrends: [],
    swedishMarket: [],
    upcomingDates: [],
    recommendedActions: [],
    status: 'PENDING_WEB_SEARCH',
    queryPlanPath: writeQueryPlan(queries)
  };
  const trendReportPath = path.resolve('social-marketing/trend-report.json');
  fs.writeFileSync(trendReportPath, JSON.stringify(trendReport, null, 2));

  const narrative = `# Weekly Trend Report — Week of ${weekOf}

Status: **pending web search**. Orchestrator, run the queries listed at
\`${trendReport.queryPlanPath}\` and call back with results so this script can
synthesize the final trend-report.json.

## Query plan

${Object.entries(queries)
  .map(([bucket, qs]) => `### ${bucket}\n${qs.map((q) => `- \`${q}\``).join('\n')}`)
  .join('\n\n')}

## Recommended Actions for This Week
- (pending synthesis)
`;
  const narrPath = path.resolve(
    config.paths?.trendReports || 'social-marketing/reports/trend-reports/',
    `${weekOf}-weekly.md`
  );
  fs.writeFileSync(narrPath, narrative);
  return { trendReportPath, narrPath };
}

(() => {
  const queries = buildQueries();
  const { trendReportPath, narrPath } = writeEmptyReport(queries);
  console.log(`Query plan written for week of ${weekOf}.`);
  console.log(`  trend-report.json: ${trendReportPath}`);
  console.log(`  narrative:         ${narrPath}`);
  console.log('\n---TELEGRAM-SUMMARY---');
  console.log(`Running weekly research — I'll have a full report shortly. ${Object.values(queries).flat().length} queries queued.`);
  console.log('---END---');
})();

#!/usr/bin/env node
/**
 * Cross-client intelligence aggregator.
 *
 * Runs weekly at the network level (NOT per-client). Pulls hook-performance.json
 * from every active client branch, strips restaurant-specific content, and
 * surfaces structural patterns that appear across 3+ clients. Opens a GitHub
 * PR to `main` with a proposed skill update.
 *
 * What transfers: structural learnings (format wins, timing wins, img2img vs
 * txt2img lift). What does NOT transfer: dish names, restaurant names, captions.
 *
 * Usage:
 *   node aggregator.js --repo /path/to/restaurant-marketing-skills [--dry-run]
 *
 * Expected branches: client/<slug> each holding social-marketing/hook-performance.json
 *
 * This script is a skeleton — the Installer wires up the git orchestration and
 * the GitHub PR creation. The core aggregation logic is complete.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const repo = getArg('repo');
const dryRun = hasFlag('dry-run');
if (!repo) {
  console.error('Usage: node aggregator.js --repo <path-to-skills-repo> [--dry-run]');
  process.exit(1);
}

const MIN_CLIENTS_FOR_PATTERN = 3;

function listClientBranches() {
  const out = execSync('git branch -r', { cwd: repo }).toString();
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('origin/client/'))
    .map((l) => l.replace('origin/', ''));
}

function readHookPerf(branch) {
  try {
    const raw = execSync(`git show ${branch}:social-marketing/hook-performance.json`, {
      cwd: repo
    }).toString();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.entries || [];
  } catch {
    return [];
  }
}

function stripContent(entry) {
  // Keep only structural fields. Drop everything that names the restaurant,
  // dish, or caption text.
  return {
    date: entry.date,
    category: entry.category,
    approach: entry.approach,
    platform: entry.platform,
    viewsDelta: entry.viewsDelta,
    bookingsDelta: entry.bookingsDelta,
    hour: entry.date ? new Date(entry.date).getUTCHours() : null
  };
}

function patternsByDimension(records, dimension) {
  // Group by a structural dimension, compute avg views/bookings.
  const groups = {};
  for (const r of records) {
    const key = r[dimension];
    if (!key) continue;
    groups[key] = groups[key] || { count: 0, viewsSum: 0, bookingsSum: 0, clients: new Set() };
    groups[key].count++;
    groups[key].viewsSum += r.viewsDelta || 0;
    groups[key].bookingsSum += r.bookingsDelta || 0;
    groups[key].clients.add(r.__client);
  }
  return Object.entries(groups)
    .map(([key, g]) => ({
      dimension,
      key,
      postCount: g.count,
      clientCount: g.clients.size,
      avgViews: g.viewsSum / g.count,
      avgBookings: g.bookingsSum / g.count
    }))
    .filter((p) => p.clientCount >= MIN_CLIENTS_FOR_PATTERN);
}

(async () => {
  const branches = listClientBranches();
  console.log(`Found ${branches.length} client branch(es).`);

  const all = [];
  for (const b of branches) {
    const records = readHookPerf(b).map((e) => ({ ...stripContent(e), __client: b }));
    console.log(`  ${b}: ${records.length} records`);
    all.push(...records);
  }

  const byCategory = patternsByDimension(all, 'category');
  const byApproach = patternsByDimension(all, 'approach');
  const byPlatform = patternsByDimension(all, 'platform');

  const findings = {
    generatedAt: new Date().toISOString(),
    minClientsPerPattern: MIN_CLIENTS_FOR_PATTERN,
    totalRecordsAnalyzed: all.length,
    patterns: { byCategory, byApproach, byPlatform }
  };

  const outPath = path.join(repo, `aggregator-findings-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outPath, JSON.stringify(findings, null, 2));
  console.log(`\nFindings written to ${outPath}`);

  if (dryRun) {
    console.log('Dry run — no PR will be opened.');
    return;
  }

  // TODO: open GitHub PR via gh CLI with findings summary.
  console.log('\nPR creation not wired up yet — Installer opens the PR manually until then.');
})();

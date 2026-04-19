#!/usr/bin/env node
/**
 * Daily analytics — runs every morning, pulls platform stats via Composio,
 * compares yesterday vs the 7-day rolling average, formats a 5-sentence
 * summary, sends to Telegram, and appends per-post records to
 * hook-performance.json.
 *
 * Usage:
 *   node daily-report.js --config <config.json> [--days 7] [--no-notify] [--dry-run]
 *
 * --days       Lookback window for the rolling average (default 7).
 * --no-notify  Skip the Telegram notification.
 * --dry-run    Pull data + format summary, but don't send Telegram or
 *              write hook-performance.json (still writes the report).
 *
 * Output (stdout, last line is JSON):
 *   {"ok": true, "yesterdayPosts": N, "yesterdayReach": M, "trend": "up|flat|down",
 *    "telegramNotified": true, "reportPath": "..."}
 */

const fs = require('fs');
const path = require('path');
const { executeTool, loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config');
const days = parseInt(getArg('days', '7'), 10);
const dryRun = hasFlag('dry-run');
const notifyTelegram = !hasFlag('no-notify');
if (!configPath) {
  console.error('Usage: node daily-report.js --config <config.json> [--days 7] [--no-notify] [--dry-run]');
  process.exit(1);
}

const config = loadConfig(configPath);
const configDir = path.dirname(path.resolve(configPath));
const today = new Date();
const todayStr = today.toISOString().split('T')[0];
const yesterdayStr = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const reportsRoot = config.paths?.reports || 'reports/';
const reportsAbs = path.isAbsolute(reportsRoot)
  ? reportsRoot
  : path.resolve(configDir, reportsRoot.replace(/^social-marketing\//, ''));
fs.mkdirSync(reportsAbs, { recursive: true });
const reportPath = path.join(reportsAbs, `${todayStr}-daily.md`);

const hookRoot = config.paths?.hookPerformance || 'hook-performance.json';
const hookPath = path.isAbsolute(hookRoot)
  ? hookRoot
  : path.resolve(configDir, hookRoot.replace(/^social-marketing\//, ''));

function fail(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

async function sendTelegram(text) {
  const token = config.telegram?.botToken;
  const chatId = config.telegram?.chatId;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    return (await res.json()).ok === true;
  } catch {
    return false;
  }
}

/**
 * Pull recent Instagram posts + per-post insights via Composio.
 * Returns posts within the last `days` days, each with metrics flattened.
 */
async function pullInstagram() {
  const igConfig = config.platforms?.instagram;
  if (!igConfig?.enabled) return { enabled: false };
  const igUserId = igConfig.igUserId;
  if (!igUserId) return { enabled: true, error: 'igUserId missing' };

  // 1. List recent media
  let media;
  try {
    media = await executeTool(config, 'INSTAGRAM_GET_IG_USER_MEDIA', {
      ig_user_id: igUserId,
      fields: 'id,caption,timestamp,media_type,permalink',
      limit: Math.max(days * 2, 14)
    });
  } catch (e) {
    return { enabled: true, error: `list media: ${e.message}` };
  }
  const list = media.data?.data || media.data || [];
  if (!Array.isArray(list)) return { enabled: true, error: 'unexpected list shape', raw: media };

  const cutoffMs = today.getTime() - days * 24 * 60 * 60 * 1000;
  const recent = list.filter((p) => {
    const ts = new Date(p.timestamp).getTime();
    return !Number.isNaN(ts) && ts >= cutoffMs;
  });

  // 2. For each, pull insights. Tolerate per-post failures.
  const enriched = [];
  for (const post of recent) {
    let insights = {};
    try {
      const r = await executeTool(config, 'INSTAGRAM_GET_IG_MEDIA_INSIGHTS', {
        ig_media_id: post.id,
        metric: 'impressions,reach,likes,comments,saved,shares'
      });
      // Insights come back as an array of { name, values: [{value}] }
      const values = r.data?.data || r.data || [];
      if (Array.isArray(values)) {
        for (const v of values) {
          insights[v.name] = v.values?.[0]?.value ?? 0;
        }
      }
    } catch (e) {
      insights._error = e.message;
    }
    enriched.push({
      id: post.id,
      caption: post.caption || '',
      timestamp: post.timestamp,
      mediaType: post.media_type,
      permalink: post.permalink,
      ...insights
    });
  }
  return { enabled: true, posts: enriched };
}

function aggregateDay(posts, dateStr) {
  const dayPosts = posts.filter((p) => (p.timestamp || '').startsWith(dateStr));
  return {
    count: dayPosts.length,
    impressions: dayPosts.reduce((s, p) => s + (p.impressions || 0), 0),
    reach: dayPosts.reduce((s, p) => s + (p.reach || 0), 0),
    likes: dayPosts.reduce((s, p) => s + (p.likes || 0), 0),
    saves: dayPosts.reduce((s, p) => s + (p.saved || 0), 0),
    comments: dayPosts.reduce((s, p) => s + (p.comments || 0), 0)
  };
}

function trendDirection(value, baseline) {
  if (!baseline || baseline === 0) return value > 0 ? 'up' : 'flat';
  const delta = (value - baseline) / baseline;
  if (delta > 0.15) return 'up';
  if (delta < -0.15) return 'down';
  return 'flat';
}

function bestPost(posts) {
  if (!posts || posts.length === 0) return null;
  return posts.reduce((best, p) => {
    const score = (p.reach || 0) + 2 * (p.saves || 0) + (p.shares || 0);
    return !best || score > best.score ? { ...p, score } : best;
  }, null);
}

function captionFirstLine(caption) {
  if (!caption) return '(no caption)';
  return caption.split('\n')[0].slice(0, 80);
}

function diagnose(yesterdayReach, baselineReach, bookingsKnown) {
  const reachTrend = trendDirection(yesterdayReach, baselineReach);
  if (reachTrend === 'up' && bookingsKnown === 'up') return { verdict: 'Working', action: 'Scale — try 2-3 variations of yesterday\'s top hook.' };
  if (reachTrend === 'up' && bookingsKnown === 'flat') return { verdict: 'CTA broken', action: 'Hook gets eyeballs but CTA doesn\'t convert. Test a sharper slide-6 booking line.' };
  if (reachTrend !== 'up' && bookingsKnown === 'up') return { verdict: 'Hook broken', action: 'Content converts, but reach is low. Test a stronger slide-1 hook.' };
  if (reachTrend === 'up') return { verdict: 'Reach up', action: 'Reach is climbing — keep pushing similar content this week.' };
  if (reachTrend === 'down') return { verdict: 'Reach down', action: 'Test a different format today — story-behind-dish or reaction hook.' };
  return { verdict: 'Steady', action: 'Try a new hook category to see what moves the needle.' };
}

function formatSummary({ ig, yesterday, baseline, top, diagnosis, bookingsPrompt }) {
  if (!ig.enabled) return 'Instagram disabled in config — no analytics today.';
  if (ig.error) return `Couldn't pull Instagram analytics today: ${ig.error}.`;
  const reachLine = `Yesterday: ${yesterday.count} post${yesterday.count === 1 ? '' : 's'}, ${yesterday.reach} reach (${diagnosis.verdict.toLowerCase()} vs ${days}d avg of ${Math.round(baseline.reach)}).`;
  const topLine = top
    ? `Top recent post: *${captionFirstLine(top.caption)}* — ${top.reach || 0} reach, ${top.saves || 0} saves.`
    : 'No posts in the lookback window.';
  const actionLine = `Today: ${diagnosis.action}`;
  const askLine = bookingsPrompt ? 'Quick one — how many covers did you do yesterday?' : '';
  return [reachLine, topLine, actionLine, askLine].filter(Boolean).join('\n\n');
}

function writeReport({ ig, yesterday, baseline, top, diagnosis, summary }) {
  const md = `# Daily Report — ${todayStr}

**Diagnosis:** ${diagnosis.verdict} — ${diagnosis.action}

## Yesterday (${yesterdayStr})
- Posts: ${yesterday.count}
- Impressions: ${yesterday.impressions}
- Reach: ${yesterday.reach}
- Likes: ${yesterday.likes}
- Saves: ${yesterday.saves}
- Comments: ${yesterday.comments}

## Rolling ${days}-day average
- Impressions/day: ${Math.round(baseline.impressions)}
- Reach/day: ${Math.round(baseline.reach)}

## Top post in window
${top ? `- Caption: ${captionFirstLine(top.caption)}\n- Reach: ${top.reach || 0}\n- Saves: ${top.saves || 0}\n- Permalink: ${top.permalink || 'n/a'}` : 'No posts.'}

## Telegram summary
${summary}

---
_Raw posts in window:_ ${ig.posts?.length || 0}
`;
  fs.writeFileSync(reportPath, md);
}

function appendHookPerformance(posts) {
  if (!posts || posts.length === 0) return;
  let existing = [];
  if (fs.existsSync(hookPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
      if (!Array.isArray(existing)) existing = [];
    } catch { existing = []; }
  }
  const seenIds = new Set(existing.map((e) => e.postId));
  for (const p of posts) {
    if (seenIds.has(p.id)) continue;
    existing.push({
      date: (p.timestamp || '').split('T')[0],
      postId: p.id,
      hook: captionFirstLine(p.caption),
      platform: 'instagram',
      mediaType: p.mediaType,
      impressions: p.impressions || 0,
      reach: p.reach || 0,
      likes: p.likes || 0,
      saves: p.saved || 0,
      comments: p.comments || 0,
      shares: p.shares || 0,
      permalink: p.permalink,
      capturedAt: new Date().toISOString()
    });
  }
  fs.writeFileSync(hookPath, JSON.stringify(existing, null, 2) + '\n');
}

(async () => {
  const ig = await pullInstagram();

  const allPosts = ig.posts || [];
  const yesterday = aggregateDay(allPosts, yesterdayStr);

  // 7-day rolling avg, excluding today
  const windowStart = new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const windowPosts = allPosts.filter((p) => {
    const d = (p.timestamp || '').slice(0, 10);
    return d >= windowStart && d < todayStr;
  });
  const baseline = {
    impressions: windowPosts.reduce((s, p) => s + (p.impressions || 0), 0) / Math.max(days, 1),
    reach: windowPosts.reduce((s, p) => s + (p.reach || 0), 0) / Math.max(days, 1)
  };

  const top = bestPost(windowPosts.length ? windowPosts : allPosts);

  // Booking signal — manual = ask, otherwise unknown for now.
  const bookingsMethod = config.analytics?.bookingTracking?.method || 'manual';
  const bookingsPrompt = bookingsMethod === 'manual';
  // Without booking data yet, treat as 'unknown' so diagnose doesn't fabricate.
  const diagnosis = diagnose(yesterday.reach, baseline.reach, 'unknown');

  const summary = formatSummary({ ig, yesterday, baseline, top, diagnosis, bookingsPrompt });
  writeReport({ ig, yesterday, baseline, top, diagnosis, summary });

  if (!dryRun) appendHookPerformance(allPosts);

  let notified = false;
  if (!dryRun && notifyTelegram) {
    notified = await sendTelegram(`📊 *Daily report — ${todayStr}*\n\n${summary}`);
  }

  // Run self-improvement after analysis
  if (!dryRun) {
    console.log("→ Running self-improvement...");
    try {
      require('child_process').execSync(`node "${__dirname}/self-improve.js" "${configPath}"`, { stdio: 'inherit' });
    } catch (e) {
      console.error('Self-improvement failed:', e.message);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    yesterdayPosts: yesterday.count,
    yesterdayReach: yesterday.reach,
    baselineReach: Math.round(baseline.reach),
    trend: trendDirection(yesterday.reach, baseline.reach),
    topPostReach: top?.reach || 0,
    telegramNotified: notified,
    reportPath
  }));
})();

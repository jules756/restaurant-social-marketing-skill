#!/usr/bin/env node
/**
 * Module B — Weekly trend research cron.
 *
 * Runs every Monday at 09:00 (config.timezone). Uses a web-search-enabled
 * model via OpenRouter (perplexity/sonar by default) to research trending
 * formats, platform updates, and local market signals for the restaurant's
 * cuisine + city. Synthesises findings into a structured trend report +
 * narrative Markdown, then sends a Telegram summary with the 3 actions for
 * the week.
 *
 * Usage:
 *   node weekly-research.js --config <config.json>
 *     [--dry-run] [--no-notify] [--model <openrouter-model>]
 *
 * --dry-run   Research + write files, skip Telegram + don't overwrite the
 *             canonical trend-report.json (keeps old one).
 * --no-notify Skip Telegram.
 * --model     Override research model. Default: perplexity/sonar (cheap,
 *             web search built in). Alternatives: perplexity/sonar-pro,
 *             google/gemini-2.5-flash:online, openai/gpt-4o-mini:online.
 *
 * Output (stdout, last line is JSON):
 *   {"ok": true, "weekOf": "YYYY-MM-DD", "actions": 3,
 *    "reportPath": "...", "telegramNotified": true}
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config');
const dryRun = hasFlag('dry-run');
const notifyTelegram = !hasFlag('no-notify');
const modelOverride = getArg('model');

if (!configPath) {
  console.error('Usage: node weekly-research.js --config <config.json> [--dry-run] [--no-notify] [--model <slug>]');
  process.exit(1);
}

const config = loadConfig(configPath);
const configDir = path.dirname(path.resolve(configPath));

const today = new Date();
const weekOf = today.toISOString().split('T')[0];
const month = today.toLocaleString('en-US', { month: 'long' });
const monthYear = `${month} ${today.getFullYear()}`;
const year = String(today.getFullYear());
const country = (config.country || 'SE').toUpperCase();
const timezone = config.timezone || 'Europe/Stockholm';

const RESEARCH_MODEL = modelOverride || config.research?.model || 'perplexity/sonar';

const trendReportsRoot = config.paths?.trendReports || 'social-marketing/reports/trend-reports/';
const trendReportsAbs = path.isAbsolute(trendReportsRoot)
  ? trendReportsRoot
  : path.resolve(configDir, trendReportsRoot.replace(/^social-marketing\//, ''));
fs.mkdirSync(trendReportsAbs, { recursive: true });

const narrativePath = path.join(trendReportsAbs, `${weekOf}-weekly.md`);
const canonicalJsonPath = path.resolve(configDir, 'trend-report.json');

function fail(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

function readRestaurantProfile() {
  const profilePath = config.paths?.restaurantProfile || 'social-marketing/restaurant-profile.json';
  const abs = path.isAbsolute(profilePath)
    ? profilePath
    : path.resolve(configDir, profilePath.replace(/^social-marketing\//, ''));
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch {
    return null;
  }
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

function buildResearchBrief(profile) {
  const cuisine = profile?.cuisine || 'restaurant';
  const city = profile?.location?.city || profile?.city || 'Stockholm';
  const name = profile?.name || 'the restaurant';
  const signature = profile?.signatureDishes || profile?.dishes || [];
  const signatureLine = Array.isArray(signature) && signature.length
    ? `Signature dishes: ${signature.slice(0, 3).map((d) => typeof d === 'string' ? d : d.name).filter(Boolean).join(', ')}.`
    : '';

  const localBuckets = ['SE', 'NO'].includes(country)
    ? '\n- **Local market (Sweden/Norway)**: Swedish-language food trends on TikTok/Instagram, regional signals for Stockholm/Oslo dining.'
    : '';

  return `You are a social media trend researcher for restaurants. Research the current week's trends for a ${cuisine} restaurant in ${city}. Use web search — do not rely only on training data.

Context:
- Restaurant: ${name} (${cuisine}, ${city}, country=${country}).
- ${signatureLine}
- Week of: ${weekOf} (${monthYear}).
- Primary platforms we post to: Instagram (carousels + reels), TikTok (later).

Research these buckets and return a JSON object with the exact schema below. For each bucket, prioritise results from the last 30 days. Exclude crypto, fashion, fitness, and general-lifestyle influencer content — restaurant / food / hospitality only.

Buckets:
- **Platform updates**: Algorithm changes, reach shifts, new features on Instagram/TikTok that affect food accounts in ${monthYear}.
- **Viral formats**: Specific post formats (carousel types, hook styles, transitions) that are performing for restaurant accounts right now.
- **Hook trends**: Opening-line / slide-1 patterns that are driving saves + shares for food content.${localBuckets}
- **Upcoming dates**: Holidays, seasonal moments, or cultural events in the next 2–4 weeks that a ${cuisine} restaurant in ${city} should plan content around.
- **Recommended actions**: The 3 most impactful things THIS restaurant should do this week, derived from the above. Be specific — not "post more reels" but "film a 15-sec behind-the-pass clip of the Bolognese plating on Wednesday for the Thursday lunch push".

Schema (return ONLY valid JSON, no preamble):
{
  "platformUpdates": [{"platform": "instagram|tiktok", "update": "...", "impact": "...", "action": "..."}],
  "viralFormats":   [{"format": "...", "why": "...", "application": "..."}],
  "hookTrends":     [{"pattern": "...", "example": "...", "whyItWorks": "..."}],
  "localMarket":    [{"signal": "...", "relevance": "..."}],
  "upcomingDates":  [{"date": "YYYY-MM-DD", "event": "...", "weeksOut": N, "action": "..."}],
  "recommendedActions": [{"priority": 1, "action": "...", "why": "...", "when": "..."}]
}

Keep each array to 3–5 items max. If a bucket genuinely has no relevant signal this week, return an empty array — don't pad with filler.`;
}

function extractJson(text) {
  if (!text) return null;
  // Strip markdown code fences if present
  let stripped = text.trim();
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to locate the first { ... } block
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

async function callOpenRouter(prompt) {
  const key = config.imageGen?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('No OpenRouter key. Set config.imageGen.openrouterApiKey or OPENROUTER_API_KEY env.');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://akira-agent.com',
      'X-Title': 'restaurant-social-marketing'
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      messages: [
        { role: 'system', content: 'You are a concise restaurant social media trend researcher. Return only valid JSON matching the schema given. Use web search. No preamble, no trailing prose.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`);

  const content = data.choices?.[0]?.message?.content;
  const parsed = extractJson(content);
  if (!parsed) throw new Error(`Could not parse JSON from model. Raw: ${String(content).slice(0, 400)}`);

  return {
    report: parsed,
    citations: data.citations || data.choices?.[0]?.message?.citations || [],
    model: data.model || RESEARCH_MODEL
  };
}

function bulletize(items, formatter) {
  if (!Array.isArray(items) || items.length === 0) return '_(nothing notable this week)_';
  return items.map(formatter).filter(Boolean).join('\n');
}

function writeNarrative({ report, citations, model, profile }) {
  const name = profile?.name || 'your restaurant';
  const md = `# Weekly Trend Report — Week of ${weekOf}

_Researched for **${name}** (${profile?.cuisine || 'restaurant'}, ${profile?.location?.city || profile?.city || country}) via ${model}._

## Recommended Actions for This Week
${bulletize(report.recommendedActions, (a) => `${a.priority || '•'}. **${a.action}**${a.when ? ` — _${a.when}_` : ''}\n   ${a.why || ''}`)}

## Platform Updates
${bulletize(report.platformUpdates, (p) => `- **${p.platform}**: ${p.update} → _${p.impact}_${p.action ? ` → **${p.action}**` : ''}`)}

## Trending Formats
${bulletize(report.viralFormats, (v) => `- **${v.format}**: ${v.why}${v.application ? ` → ${v.application}` : ''}`)}

## Hook Trends
${bulletize(report.hookTrends, (h) => `- _"${h.pattern}"_ — ${h.whyItWorks}${h.example ? `\n  Example: ${h.example}` : ''}`)}

${report.localMarket?.length ? `## Local Market\n${bulletize(report.localMarket, (l) => `- ${l.signal} — ${l.relevance}`)}\n` : ''}
## Upcoming Dates (next 2–4 weeks)
${bulletize(report.upcomingDates, (d) => `- **${d.date}** — ${d.event} (${d.weeksOut}w out) → ${d.action}`)}

${citations.length ? `---\n## Sources\n${citations.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n` : ''}`;
  fs.writeFileSync(narrativePath, md);
}

function writeCanonicalJson({ report, citations, model }) {
  const canonical = {
    weekOf,
    generatedAt: new Date().toISOString(),
    model,
    citations,
    ...report
  };
  fs.writeFileSync(canonicalJsonPath, JSON.stringify(canonical, null, 2) + '\n');
}

function formatTelegramSummary(report, profile) {
  const name = profile?.name ? `for *${profile.name}*` : '';
  const actions = report.recommendedActions || [];
  const lines = [`🗓 *Weekly trend report — ${weekOf}* ${name}`];
  if (actions.length === 0) {
    lines.push('\nNo standout actions this week — keep the current rhythm going.');
  } else {
    lines.push('\n*Top actions this week:*');
    actions.slice(0, 3).forEach((a, i) => {
      lines.push(`${i + 1}. ${a.action}${a.when ? ` _(${a.when})_` : ''}`);
    });
  }
  const dates = (report.upcomingDates || []).slice(0, 2);
  if (dates.length) {
    lines.push('\n*Upcoming:* ' + dates.map((d) => `${d.event} (${d.weeksOut}w)`).join(' • '));
  }
  lines.push(`\nFull report: \`${narrativePath.replace(process.env.HOME || '', '~')}\``);
  return lines.join('\n');
}

(async () => {
  const profile = readRestaurantProfile();
  if (!profile) {
    console.error('Warning: no restaurant-profile.json found — running with generic context.');
  }

  const prompt = buildResearchBrief(profile);

  let result;
  try {
    result = await callOpenRouter(prompt);
  } catch (e) {
    fail(`Research call failed: ${e.message}`);
    return;
  }

  const { report, citations, model } = result;
  writeNarrative({ report, citations, model, profile });
  if (!dryRun) writeCanonicalJson({ report, citations, model });

  const summary = formatTelegramSummary(report, profile);

  let notified = false;
  if (!dryRun && notifyTelegram) {
    notified = await sendTelegram(summary);
  }

  console.log(JSON.stringify({
    ok: true,
    weekOf,
    model,
    actions: (report.recommendedActions || []).length,
    upcomingDates: (report.upcomingDates || []).length,
    citations: citations.length,
    telegramNotified: notified,
    reportPath: narrativePath,
    canonicalJsonPath: dryRun ? null : canonicalJsonPath
  }));
})();

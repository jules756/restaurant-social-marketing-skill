#!/usr/bin/env node
/**
 * Cron-triggered auto-post.
 *
 * Runs daily at config.posting.schedule[0]. End-to-end, planned around
 * postType (NOT dish — the dish is one beat in many possible posts):
 *
 *   1. Pre-flight (enabled, not paused, rate cap, no recent failures)
 *   2. Gather context (profile, knowledge base, last 14 days of post history,
 *      active promos/events, trend report)
 *   3. LLM planning step: pick postType, scenario, dish (if any), build
 *      the 6-beat sceneArc, write hook + overlay texts + caption
 *   4. drive-sync.js (with --dish if applicable, else --no-dish)
 *   5. generate-slides.js
 *   6. add-text-overlay.js
 *   7. post-to-{platform}.js for each enabled platform
 *   8. Notify owner on Telegram (post-and-tell)
 *   9. Update config.posting.autoPost.{lastPostedAt, consecutiveFailures}
 *
 * On 2 consecutive failures: auto-pauses for 24h, alerts owner.
 *
 * Usage:
 *   node auto-post.js --config <config.json>
 *   node auto-post.js --config <config.json> --dry-run
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { callTool, loadConfig, findToolByPattern } = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (n) => args.includes(`--${n}`);

const configPath = getArg('config');
const dryRun = hasFlag('dry-run');
if (!configPath) { console.error('Usage: node auto-post.js --config <config.json> [--dry-run]'); process.exit(1); }

const SKILL_DIR = path.resolve(__dirname, '..');
const FAILURE_PAUSE_HOURS = 24;
const MAX_CONSECUTIVE_FAILURES = 2;
const POST_TYPE_HISTORY_DAYS = 14;
const REPETITION_WINDOW_DAYS = 7;

function log(msg) { console.log(`[auto-post ${new Date().toISOString()}] ${msg}`); }
function fail(msg, exitCode = 1) { log(`✗ ${msg}`); process.exit(exitCode); }

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function saveJson(p, data) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

const config = loadConfig(configPath);
const baseDir = config.paths?.baseDir || path.dirname(path.resolve(configPath));
const profilePath = config.paths?.restaurantProfile;
const postsDir = config.paths?.posts || path.join(baseDir, 'posts');
const knowledgeBaseDir = config.paths?.knowledgeBaseDir || path.join(baseDir, 'knowledge-base');
const trendReportPath = path.join(baseDir, 'trend-report.json');
const promotionsDir = path.join(baseDir, 'promotions');
const logsDir = path.join(baseDir, 'logs');
fs.mkdirSync(logsDir, { recursive: true });

// ─── 1. Pre-flight ──────────────────────────────────────────────────────
const ap = config.posting?.autoPost || {};
if (!ap.enabled) fail('config.posting.autoPost.enabled is false. Skipping.', 0);
if (ap.paused) {
  if (ap.pausedUntil && new Date(ap.pausedUntil) > new Date()) {
    fail(`Auto-post paused until ${ap.pausedUntil}. Skipping.`, 0);
  }
  if (!ap.pausedUntil) fail('Auto-post manually paused (/pause). Skipping.', 0);
  ap.paused = false;
  ap.pausedUntil = null;
}
if (ap.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
  fail(`Auto-paused: ${ap.consecutiveFailures} consecutive failures. Owner must /resume.`, 0);
}
if (ap.lastPostedAt) {
  const since = (Date.now() - new Date(ap.lastPostedAt).getTime()) / (1000 * 60 * 60);
  if (since < 23) fail(`Already auto-posted ${since.toFixed(1)}h ago. 1 post/day cap.`, 0);
}
if (!profilePath || !fs.existsSync(profilePath)) {
  fail(`No restaurant profile at ${profilePath}. Owner must complete /start onboarding first.`, 0);
}
const profile = loadJson(profilePath);

// ─── 2. Gather context ─────────────────────────────────────────────────
function recentPosts(days) {
  if (!fs.existsSync(postsDir)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return fs.readdirSync(postsDir)
    .filter((d) => {
      const p = path.join(postsDir, d);
      if (!fs.statSync(p).isDirectory()) return false;
      const sp = path.join(p, 'state.json');
      if (!fs.existsSync(sp)) return false;
      try {
        const st = loadJson(sp);
        const ts = st.createdAt ? new Date(st.createdAt).getTime() : 0;
        return ts > cutoff;
      } catch { return false; }
    })
    .map((d) => {
      try { return loadJson(path.join(postsDir, d, 'state.json')); }
      catch { return null; }
    })
    .filter(Boolean);
}

const recent14 = recentPosts(POST_TYPE_HISTORY_DAYS);
const recent7 = recent14.filter((s) => {
  const ts = s.createdAt ? new Date(s.createdAt).getTime() : 0;
  return ts > Date.now() - REPETITION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
});
const recentDishes = new Set(recent7.map((s) => s.dish).filter(Boolean));
const recentScenarios = new Set(recent7.map((s) => s.scenario).filter(Boolean));
const recentPostTypes = recent14.map((s) => s.postType).filter(Boolean);

log(`Recent posts: ${recent14.length} (last ${POST_TYPE_HISTORY_DAYS}d), ${recent7.length} (last ${REPETITION_WINDOW_DAYS}d)`);
log(`  postTypes (14d): [${recentPostTypes.join(', ') || '(none)'}]`);
log(`  scenarios (7d):  [${[...recentScenarios].join(', ') || '(none)'}]`);
log(`  dishes (7d):     [${[...recentDishes].join(', ') || '(none)'}]`);

// Active promo (any non-expired entry under promotions/)
function activePromos() {
  if (!fs.existsSync(promotionsDir)) return [];
  return fs.readdirSync(promotionsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return loadJson(path.join(promotionsDir, f)); } catch { return null; }
    })
    .filter((p) => p && (!p.endDate || new Date(p.endDate) > new Date()));
}
const promos = activePromos();
log(`Active promos: ${promos.length > 0 ? promos.map((p) => p.name).join(', ') : '(none)'}`);

// Knowledge-base entries (chef story, recipes, sourcing, history)
function loadKnowledgeBase() {
  if (!fs.existsSync(knowledgeBaseDir)) return {};
  const out = {};
  for (const f of fs.readdirSync(knowledgeBaseDir).filter((x) => x.endsWith('.json'))) {
    try { out[path.basename(f, '.json')] = loadJson(path.join(knowledgeBaseDir, f)); }
    catch { /* skip */ }
  }
  return out;
}
const knowledge = loadKnowledgeBase();
log(`Knowledge base entries: [${Object.keys(knowledge).join(', ') || '(none)'}]`);

// Trend report
const trendReport = fs.existsSync(trendReportPath) ? loadJson(trendReportPath) : null;
log(`Trend report: ${trendReport ? `present (week of ${trendReport.weekOf || '?'})` : 'absent'}`);

// ─── 3. LLM planning step ──────────────────────────────────────────────
function readSkillFile(...parts) {
  return fs.readFileSync(path.join(SKILL_DIR, ...parts), 'utf-8');
}
const knowledgeFiles = {
  postTypes: readSkillFile('social-media-seo-hermes', 'references', 'post-types.md'),
  scenarios: readSkillFile('social-media-seo-hermes', 'references', 'scenarios.md'),
  hooks: readSkillFile('social-media-seo-hermes', 'references', 'hooks.md'),
  hookArchetypes: readSkillFile('social-media-seo-hermes', 'references', 'hook-archetypes.md'),
  ctas: readSkillFile('social-media-seo-hermes', 'references', 'ctas.md'),
  keywords: readSkillFile('social-media-seo-hermes', 'references', 'keywords.md'),
  photography: readSkillFile('food-photography-hermes', 'SKILL.md'),
};

const today = new Date();
const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: config.timezone || 'UTC' });
const monthDay = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: config.timezone || 'UTC' });
const timeOfDay = (() => {
  const h = parseInt(today.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: config.timezone || 'UTC' }));
  if (h < 11) return 'morning';
  if (h < 15) return 'lunch';
  if (h < 18) return 'afternoon';
  return 'dinner';
})();

const planningPrompt = `You are planning a single Instagram carousel post for "${profile.name || 'a restaurant'}", a ${profile.cuisine || ''} restaurant in ${profile.location?.city || profile.city || ''}.

Today is ${dayOfWeek}, ${monthDay}, ${timeOfDay}. Restaurant vibe: ${profile.vibe || 'unspecified'}. Typical guest: ${profile.typicalGuest || 'unspecified'}.

Signature dishes: ${(profile.signatureDishes || []).map((d) => typeof d === 'string' ? d : d.name).join(', ') || '(none defined)'}.

== Recent post history (use to AVOID repetition) ==
- Post types in the last 14 days: [${recentPostTypes.join(', ') || 'none'}]  (avoid 3 of the same in 5 posts; prefer types underrepresented)
- Scenarios in the last 7 days (DO NOT repeat): [${[...recentScenarios].join(', ') || 'none'}]
- Dishes in the last 7 days (DO NOT repeat): [${[...recentDishes].join(', ') || 'none'}]

== Active context ==
- Active promotions: ${promos.length ? JSON.stringify(promos.map((p) => ({ name: p.name, dish: p.dish, endDate: p.endDate }))) : 'none'}
- Trend report: ${trendReport ? JSON.stringify({ weekOf: trendReport.weekOf, recommendedActions: trendReport.recommendedActions || [] }).slice(0, 1000) : 'none'}
- Knowledge base entries available: ${JSON.stringify(Object.keys(knowledge))}
${Object.keys(knowledge).length > 0 ? `- Knowledge content (use for 'story' postType): ${JSON.stringify(knowledge).slice(0, 2000)}` : ''}

== Your job ==
Plan today's post. Pick a postType FIRST (not a dish). Then decide everything else around it. The healthy mix is ~30-40% dish-feature, the rest spread across vibe-moment, behind-the-scenes, story, neighborhood, seasonal, regular, promo, trend-driven, event.

Use these knowledge files (do NOT echo them back; use them to make decisions):

=== post-types.md ===
${knowledgeFiles.postTypes}

=== scenarios.md ===
${knowledgeFiles.scenarios}

=== hooks.md ===
${knowledgeFiles.hooks}

=== hook-archetypes.md ===
${knowledgeFiles.hookArchetypes}

=== ctas.md ===
${knowledgeFiles.ctas}

=== keywords.md ===
${knowledgeFiles.keywords}

=== food-photography-hermes (style anchors) ===
${knowledgeFiles.photography}

== OUTPUT ==
A single JSON object, nothing else. Schema:

{
  "postType": "<one of: dish-feature, vibe-moment, behind-the-scenes, story, seasonal, regular, neighborhood, promo, trend-driven, event>",
  "postIdea": "<one sentence: what this post is actually about>",
  "scenario": "<scenario archetype slug from scenarios.md, fit to postType>",
  "characters": "<one sentence describing the people>",
  "mood": "<one sentence>",
  "dish": "<dish name | null>",
  "hookCategory": "<from hooks.md, e.g. 'Story-Behind-the-Dish' or 'Reaction / Disbelief'>",
  "hookText": "<slide-1 overlay text, max 10 words, in restaurant's voice>",
  "hookArchetype": "<one of: object, character-pre-context, place, detail, text-led>",
  "base": "<base prompt: documentary food photography anchors + lighting preset for this restaurant + scenario mood>",
  "sceneArc": [
    { "beat": "hook", "archetype": "<same as hookArchetype>", "moment": "<one sentence>", "useDishRef": false, "useVenueRef": false, "useCharacterRef": false },
    { "beat": "scene-set", "moment": "<one sentence>", "useDishRef": false, "useVenueRef": true, "useCharacterRef": false, "isCharacterSeed": true },
    { "beat": "<varies by postType — see post-types.md beats-3-4 table>", "moment": "<one sentence>", "useDishRef": <true|false>, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "<varies by postType>", "moment": "<one sentence>", "useDishRef": <true|false>, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "connection", "moment": "<one sentence: non-food experience moment>", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "outro", "moment": "<one sentence>", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true }
  ],
  "overlayTexts": [
    "<slide 1: hookText>",
    "<slide 2: short narrative beat, max 10 words>",
    "<slide 3: short narrative beat>",
    "<slide 4: short narrative beat>",
    "<slide 5: short narrative beat>",
    "<slide 6: CTA from ctas.md>"
  ],
  "caption": "<keyword-first Instagram caption: first 125 chars lead with what the post is about + restaurant + city; hashtags from keywords.md mid-tail; final line is CTA with UTM placeholder __UTM__>"
}

CRITICAL RULES:
- For postType=dish-feature: dish must be a real signature dish, slides 3+4 useDishRef=true.
- For postType=vibe-moment, behind-the-scenes (when no specific dish anchor), neighborhood, regular, trend-driven: dish=null, ALL slides useDishRef=false.
- For other types: dish optional; max 1 slide with useDishRef=true unless it's a 'promo' for a specific dish.
- Maximum 2 slides total with useDishRef=true. ALWAYS.
- Slides 2-6 MUST have useVenueRef=true. Always.
- Slide 2 MUST have isCharacterSeed=true.
- Slides 3-6 MUST have useCharacterRef=true (slide 2 is the seed).`;

async function planPost() {
  const tool = await findToolByPattern(config, /^OPENROUTER_CHAT_COMPLETIONS$/i)
    || await findToolByPattern(config, /^OPENAI_CHAT_COMPLETIONS$/i)
    || await findToolByPattern(config, /CHAT.*COMPLETIONS/i);
  if (!tool) throw new Error('No chat-completions tool advertised by Composio MCP. Connect OpenRouter or OpenAI on the right userId.');

  const useOpenRouter = /OPENROUTER/.test(tool.tool.name);
  const args = {
    model: config.posting?.autoPost?.planningModel || (useOpenRouter ? 'anthropic/claude-sonnet-4' : 'gpt-4o'),
    messages: [{ role: 'user', content: planningPrompt }],
    response_format: { type: 'json_object' },
  };

  const result = await callTool(config, tool.tool.name, args);
  const content = result?.choices?.[0]?.message?.content
    || result?.data?.choices?.[0]?.message?.content
    || result?.message?.content;
  if (!content) throw new Error(`Chat completion returned no content: ${JSON.stringify(result).slice(0, 300)}`);
  let plan;
  try { plan = JSON.parse(content); }
  catch { throw new Error(`LLM returned non-JSON plan: ${content.slice(0, 300)}`); }

  // Sanity-check plan structure.
  if (!plan.postType) throw new Error('Plan missing postType');
  if (!Array.isArray(plan.sceneArc) || plan.sceneArc.length !== 6) throw new Error(`Plan sceneArc has ${plan.sceneArc?.length || 0} beats, expected 6`);
  if (!plan.sceneArc.some((b) => b.isCharacterSeed)) throw new Error('Plan sceneArc has no isCharacterSeed beat');
  const dishSlides = plan.sceneArc.filter((b) => b.useDishRef).length;
  if (dishSlides > 2) {
    log(`  ⚠ plan has ${dishSlides} dish slides — capping to 2 by clearing useDishRef on extras`);
    let kept = 0;
    for (const b of plan.sceneArc) {
      if (b.useDishRef) { kept++; if (kept > 2) b.useDishRef = false; }
    }
  }
  return plan;
}

// ─── Pipeline runners ──────────────────────────────────────────────────
function runScript(name, scriptArgs) {
  const script = path.join(SKILL_DIR, 'scripts', name);
  log(`  → ${name} ${scriptArgs.join(' ')}`);
  const r = spawnSync('node', [script, ...scriptArgs], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: SKILL_DIR,
  });
  const stdout = r.stdout.toString().trim();
  const stderr = r.stderr.toString().trim();
  if (stdout) console.log(stdout);
  if (r.status !== 0) {
    if (stderr) console.error(stderr);
    throw new Error(`${name} exited ${r.status}: ${stderr.split('\n').pop() || stdout.split('\n').pop()}`);
  }
  return { stdout, stderr };
}

// ─── Telegram notify ───────────────────────────────────────────────────
async function notifyOwner(text) {
  try {
    const tool = await findToolByPattern(config, /TELEGRAM.*SEND.*MESSAGE/i);
    if (!tool) { log('  ⚠ no Telegram tool — skipping notify'); return false; }
    const args = profile.telegramChatId ? { chat_id: profile.telegramChatId, text } : { text };
    await callTool(config, tool.tool.name, args);
    return true;
  } catch (e) {
    log(`  ⚠ notify failed: ${e.message}`);
    return false;
  }
}

// ─── Failure handler ───────────────────────────────────────────────────
async function recordFailure(reason) {
  config.posting = config.posting || {};
  config.posting.autoPost = config.posting.autoPost || {};
  config.posting.autoPost.consecutiveFailures = (config.posting.autoPost.consecutiveFailures || 0) + 1;
  if (config.posting.autoPost.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    config.posting.autoPost.paused = true;
    config.posting.autoPost.pausedUntil = new Date(Date.now() + FAILURE_PAUSE_HOURS * 60 * 60 * 1000).toISOString();
    saveJson(configPath, config);
    await notifyOwner(`⚠️ Auto-posting paused after ${MAX_CONSECUTIVE_FAILURES} failures. Last error: ${reason}\n\nUse /resume to re-enable.`);
  } else {
    saveJson(configPath, config);
  }
}

async function recordSuccess() {
  config.posting = config.posting || {};
  config.posting.autoPost = config.posting.autoPost || {};
  config.posting.autoPost.consecutiveFailures = 0;
  config.posting.autoPost.lastPostedAt = new Date().toISOString();
  saveJson(configPath, config);
}

// ─── Main ──────────────────────────────────────────────────────────────
(async () => {
  try {
    log(`=== auto-post for ${profile.name || '(unnamed)'} ===`);
    log(`Day: ${dayOfWeek} ${timeOfDay}`);

    log('Planning post via LLM…');
    const plan = await planPost();
    log(`  postType: ${plan.postType} | scenario: ${plan.scenario} | dish: ${plan.dish || '(none)'}`);
    log(`  hook: "${plan.hookText}" (${plan.hookCategory}/${plan.hookArchetype})`);
    log(`  idea: ${plan.postIdea}`);

    if (dryRun) {
      console.log(JSON.stringify(plan, null, 2));
      log('[DRY-RUN] would write prompts.json + texts.json, then run drive-sync, generate-slides, overlay, post-to-*.');
      return;
    }

    // Build post directory
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
    const postDir = path.join(postsDir, ts);
    fs.mkdirSync(postDir, { recursive: true });

    // Write prompts.json + texts.json
    const promptsObj = {
      postType: plan.postType,
      postIdea: plan.postIdea,
      scenario: plan.scenario,
      characters: plan.characters,
      mood: plan.mood,
      venue: { name: profile.name, vibe: profile.vibe || '' },
      dish: plan.dish || null,
      base: plan.base,
      sceneArc: plan.sceneArc,
    };
    saveJson(path.join(postDir, 'prompts.json'), promptsObj);
    saveJson(path.join(postDir, 'texts.json'), plan.overlayTexts);

    // Resolve UTM in caption
    const platforms = Object.entries(config.platforms || {})
      .filter(([_, v]) => v?.enabled).map(([k]) => k);
    if (!platforms.length) throw new Error('No platforms enabled');
    const primaryPlatform = platforms[0];
    const utm = `?utm_source=${primaryPlatform}&utm_medium=social&utm_campaign=auto&utm_content=${ts}`;
    const caption = (plan.caption || '').replace('__UTM__', utm);
    fs.writeFileSync(path.join(postDir, 'caption.txt'), caption + '\n');

    // Mark this post as autoPost in state.json + record postType for repetition guard
    saveJson(path.join(postDir, 'state.json'), {
      status: 'planned',
      autoPost: true,
      postType: plan.postType,
      postIdea: plan.postIdea,
      scenario: plan.scenario,
      dish: plan.dish || null,
      characters: plan.characters,
      createdAt: new Date().toISOString(),
      slides: [],
    });

    // Drive sync — pass --dish only if the plan uses dish refs
    log('Drive sync (per-post)…');
    const usesDish = plan.sceneArc.some((b) => b.useDishRef);
    const driveArgs = ['--config', configPath];
    if (usesDish && plan.dish) driveArgs.push('--dish', plan.dish);
    if (!usesDish) driveArgs.push('--no-dish');
    runScript('drive-sync.js', driveArgs);

    log('Generating slides…');
    runScript('generate-slides.js', [
      '--config', configPath,
      '--output', postDir,
      '--prompts', path.join(postDir, 'prompts.json'),
      '--platform', primaryPlatform,
    ]);

    log('Adding overlays…');
    runScript('add-text-overlay.js', [
      '--input', postDir,
      '--texts', path.join(postDir, 'texts.json'),
    ]);

    // Post to each enabled platform
    const results = {};
    for (const platform of platforms) {
      log(`Posting to ${platform}…`);
      try {
        const { stdout } = runScript(`post-to-${platform}.js`, ['--config', configPath, '--dir', postDir]);
        const last = stdout.split('\n').filter(Boolean).pop();
        results[platform] = JSON.parse(last);
      } catch (e) {
        results[platform] = { ok: false, error: e.message };
      }
    }

    const succeeded = Object.entries(results).filter(([_, r]) => r.ok);
    const failed = Object.entries(results).filter(([_, r]) => !r.ok);
    const summary = succeeded.map(([p, r]) => `${p}: ${r.permalink || r.mediaId || 'posted'}`).join('\n');
    const failSummary = failed.map(([p, r]) => `${p}: ${r.error || 'failed'}`).join('\n');

    if (succeeded.length === 0) {
      await recordFailure(`All platforms failed: ${failSummary}`);
      throw new Error(`All platforms failed.\n${failSummary}`);
    }

    await recordSuccess();

    // Notify owner
    const captionFirstLine = caption.split('\n')[0].slice(0, 120);
    const dishNote = plan.dish ? `, ${plan.dish}` : '';
    const note = `📸 Auto-posted (${plan.postType}: ${plan.scenario}${dishNote})\n\n${summary}${failSummary ? `\n\nFailed:\n${failSummary}` : ''}\n\n${captionFirstLine}…`;
    await notifyOwner(note);

    log(`✅ Done. Succeeded: ${succeeded.map(([p]) => p).join(', ')}${failed.length ? `. Failed: ${failed.map(([p]) => p).join(', ')}` : ''}`);
  } catch (e) {
    log(`✗ ${e.message}`);
    await recordFailure(e.message);
    process.exit(1);
  }
})();

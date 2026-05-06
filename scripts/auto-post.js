#!/usr/bin/env node
/**
 * Cron-triggered auto-post.
 *
 * Runs daily at config.posting.schedule[0]. End-to-end:
 *   1. Pre-flight: enabled, not paused, no rate-cap hit, not too-many-failures
 *   2. Pick a dish (rotate through restaurant-profile.signatureDishes; never
 *      same dish twice within 7 days based on memory of past auto-posts)
 *   3. Pick a scenario (load scenarios.md; never repeat within 7 days)
 *   4. Pick a hook (load hooks.md; pick category, write 2-3 variants, pick
 *      the strongest) — done via OPENROUTER_CHAT_COMPLETIONS over MCP
 *   5. Build the 6-beat sceneArc → prompts.json + texts.json
 *   6. drive-sync.js --dish "<name>" → photos/last-sync.json
 *   7. generate-slides.js → 6 raw PNGs
 *   8. add-text-overlay.js → 6 final PNGs
 *   9. For each enabled platform: post-to-{platform}.js
 *  10. Notify owner on Telegram (post-and-tell): permalink + caption first line
 *  11. Update config.posting.autoPost.{lastPostedAt, consecutiveFailures}
 *
 * On 2 consecutive failures: auto-pauses for 24h, alerts owner.
 *
 * No Hermes session needed — this is a self-contained background job.
 * Manual /post still goes through Hermes (content-preparation skill).
 *
 * Usage:
 *   node auto-post.js --config <config.json>
 *   node auto-post.js --config <config.json> --dry-run    # plan + log, no gen/post
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
  // pausedUntil expired — clear and continue.
  ap.paused = false;
  ap.pausedUntil = null;
}

if (ap.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
  fail(`Auto-paused: ${ap.consecutiveFailures} consecutive failures. Owner must /resume.`, 0);
}

// Rate cap: 1 post/day max.
if (ap.lastPostedAt) {
  const since = (Date.now() - new Date(ap.lastPostedAt).getTime()) / (1000 * 60 * 60);
  if (since < 23) fail(`Already auto-posted ${since.toFixed(1)}h ago. 1 post/day cap.`, 0);
}

if (!profilePath || !fs.existsSync(profilePath)) {
  fail(`No restaurant profile at ${profilePath}. Owner must complete /start onboarding first.`, 0);
}
const profile = loadJson(profilePath);
const dishes = (profile.signatureDishes || []).map((d) => typeof d === 'string' ? { name: d } : d);
if (!dishes.length) fail('No signature dishes in restaurant-profile.json. Owner must complete onboarding.', 0);

// ─── 2 + 3. Pick dish + scenario (avoid 7-day repetition) ───────────────
function recentAutoPosts() {
  // Look for state.json in the last 7 days of post directories that have an
  // autoPost: true marker (set below when generating).
  if (!fs.existsSync(postsDir)) return [];
  const cutoff = Date.now() - REPETITION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const entries = fs.readdirSync(postsDir).filter((d) => {
    const p = path.join(postsDir, d);
    if (!fs.statSync(p).isDirectory()) return false;
    const statePath = path.join(p, 'state.json');
    if (!fs.existsSync(statePath)) return false;
    try {
      const st = loadJson(statePath);
      const ts = st.createdAt ? new Date(st.createdAt).getTime() : 0;
      return ts > cutoff && st.autoPost === true;
    } catch { return false; }
  });
  return entries.map((d) => {
    try { return loadJson(path.join(postsDir, d, 'state.json')); } catch { return null; }
  }).filter(Boolean);
}

const recent = recentAutoPosts();
const recentDishes = new Set(recent.map((s) => s.dish).filter(Boolean));
const recentScenarios = new Set(recent.map((s) => s.scenario).filter(Boolean));
log(`Recent auto-posts (last ${REPETITION_WINDOW_DAYS}d): ${recent.length} posts, dishes=[${[...recentDishes].join(', ')}], scenarios=[${[...recentScenarios].join(', ')}]`);

// Pick a dish: round-robin through signatureDishes, skip recent.
const availableDishes = dishes.filter((d) => !recentDishes.has(d.name));
const dish = availableDishes.length > 0
  ? availableDishes[0]                        // simple round-robin: oldest unused
  : dishes[Math.floor(Math.random() * dishes.length)];   // all used recently → just pick any
log(`Selected dish: ${dish.name}`);

// ─── 4. LLM-driven scenario + hook + sceneArc + caption ─────────────────
// Load knowledge files. They live alongside the skill repo.
const scenariosMd = fs.readFileSync(path.join(SKILL_DIR, 'social-media-seo-hermes', 'references', 'scenarios.md'), 'utf-8');
const hooksMd = fs.readFileSync(path.join(SKILL_DIR, 'social-media-seo-hermes', 'references', 'hooks.md'), 'utf-8');
const hookArchetypesMd = fs.readFileSync(path.join(SKILL_DIR, 'social-media-seo-hermes', 'references', 'hook-archetypes.md'), 'utf-8');
const photographyMd = fs.readFileSync(path.join(SKILL_DIR, 'food-photography-hermes', 'SKILL.md'), 'utf-8');
const ctasMd = fs.readFileSync(path.join(SKILL_DIR, 'social-media-seo-hermes', 'references', 'ctas.md'), 'utf-8');

const today = new Date();
const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: config.timezone || 'UTC' });
const timeOfDay = (() => {
  const h = parseInt(today.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: config.timezone || 'UTC' }));
  if (h < 11) return 'morning';
  if (h < 15) return 'lunch';
  if (h < 18) return 'afternoon';
  return 'dinner';
})();

const planningPrompt = `You are planning a single Instagram carousel post for "${profile.name || 'a restaurant'}", a ${profile.cuisine || ''} restaurant in ${profile.location?.city || profile.city || ''}. The dish is: ${dish.name}${dish.visualDescription ? ` (${dish.visualDescription})` : ''}.

Today is ${dayOfWeek}, ${timeOfDay}. Restaurant vibe: ${profile.vibe || 'unspecified'}. Typical guest: ${profile.typicalGuest || 'unspecified'}.

Recent auto-post history (last 7 days, AVOID repeating): scenarios=[${[...recentScenarios].join(', ') || 'none'}], dishes=[${[...recentDishes].join(', ') || 'none'}].

Your job: produce a JSON plan for the post. The plan must follow the 6-beat blueprint where ONLY slides 3 and 4 are dish-focused; the rest tell the experience.

Use these knowledge files (DO NOT echo them back; use them to make decisions):

=== scenarios.md (pick one scenario archetype) ===
${scenariosMd}

=== hooks.md (pick a hook category, write the line) ===
${hooksMd}

=== hook-archetypes.md (pick a slide-1 visual archetype) ===
${hookArchetypesMd}

=== ctas.md (pick a CTA for slide 6 + caption end) ===
${ctasMd}

=== food-photography-hermes (style anchors, what to put in prompts) ===
${photographyMd}

OUTPUT: a single JSON object, nothing else. Schema:

{
  "scenario": "<scenario archetype slug from scenarios.md>",
  "characters": "<one sentence describing the people>",
  "mood": "<one sentence>",
  "hookCategory": "<from hooks.md, e.g. 'Story-Behind-the-Dish'>",
  "hookText": "<the slide-1 overlay text, max 10 words, in restaurant's voice>",
  "hookArchetype": "<one of: object, character-pre-context, place, detail, text-led>",
  "base": "<base prompt: documentary food photography anchors, lighting preset for this restaurant's vibe, scenario mood>",
  "sceneArc": [
    { "beat": "hook", "archetype": "<same as hookArchetype>", "moment": "<one sentence>", "useDishRef": false, "useVenueRef": false, "useCharacterRef": false },
    { "beat": "scene-set", "moment": "<one sentence: characters seated at the table, dining room behind>", "useDishRef": false, "useVenueRef": true, "useCharacterRef": false, "isCharacterSeed": true },
    { "beat": "dish-arrives", "moment": "<one sentence: ${dish.name} landing on the table, characters reacting>", "useDishRef": true, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "the-bite", "moment": "<one sentence: first-bite moment, motion, hands>", "useDishRef": true, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "connection", "moment": "<one sentence: non-food experience, conversation, candlelight, dish off-frame>", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "outro", "moment": "<one sentence: exterior or aftermath>", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true }
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
}`;

async function planPost() {
  const tool = await findToolByPattern(config, /^OPENROUTER_CHAT_COMPLETIONS$/i)
    || await findToolByPattern(config, /^OPENAI_CHAT_COMPLETIONS$/i)
    || await findToolByPattern(config, /CHAT.*COMPLETIONS/i);
  if (!tool) throw new Error('No chat-completions tool advertised by Composio MCP. Connect OpenRouter or OpenAI on the right userId.');

  const useOpenRouter = /OPENROUTER/.test(tool.tool.name);
  const args = useOpenRouter
    ? {
        model: config.posting?.autoPost?.planningModel || 'anthropic/claude-sonnet-4',
        messages: [{ role: 'user', content: planningPrompt }],
        response_format: { type: 'json_object' },
      }
    : {
        model: config.posting?.autoPost?.planningModel || 'gpt-4o',
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
  return plan;
}

// ─── Pipeline runners (shell out to existing scripts) ────────────────────
function runScript(name, scriptArgs) {
  const script = path.join(SKILL_DIR, 'scripts', name);
  log(`  → ${name} ${scriptArgs.join(' ')}`);
  const r = spawnSync('node', [script, ...scriptArgs], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: SKILL_DIR,
  });
  const stdout = r.stdout.toString().trim();
  const stderr = r.stderr.toString().trim();
  if (r.status !== 0) {
    if (stderr) console.error(stderr);
    throw new Error(`${name} exited ${r.status}: ${stderr.split('\n').pop() || stdout.split('\n').pop()}`);
  }
  return { stdout, stderr };
}

// ─── Telegram notify (via Composio TELEGRAM_SEND_MESSAGE) ───────────────
async function notifyOwner(text) {
  try {
    const tool = await findToolByPattern(config, /TELEGRAM.*SEND.*MESSAGE/i);
    if (!tool) { log('  ⚠ no Telegram tool — skipping notify'); return false; }
    // chat_id resolution: Hermes owns the bot connection, so the Composio
    // Telegram tool already has the connected chat. We pass the owner's
    // chat id only if the user has wired it in profile (best-effort).
    const args = profile.telegramChatId ? { chat_id: profile.telegramChatId, text } : { text };
    await callTool(config, tool.tool.name, args);
    return true;
  } catch (e) {
    log(`  ⚠ notify failed: ${e.message}`);
    return false;
  }
}

// ─── Failure handler ────────────────────────────────────────────────────
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

// ─── Main ───────────────────────────────────────────────────────────────
(async () => {
  try {
    log(`=== auto-post for ${profile.name || '(unnamed)'} ===`);
    log(`Day: ${dayOfWeek} ${timeOfDay} | Dish: ${dish.name}`);

    log('Planning post via LLM…');
    const plan = await planPost();
    log(`  scenario: ${plan.scenario}, hook: "${plan.hookText}" (${plan.hookCategory}/${plan.hookArchetype})`);

    if (dryRun) {
      console.log(JSON.stringify(plan, null, 2));
      log('[DRY-RUN] would write prompts.json + texts.json, then run drive-sync, generate-slides, overlay, post-to-*.');
      return;
    }

    // Build post directory
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);  // YYYYMMDDTHHMM
    const postDir = path.join(postsDir, ts);
    fs.mkdirSync(postDir, { recursive: true });

    // Write prompts.json + texts.json (consumed by generate-slides + overlay)
    const promptsObj = {
      scenario: plan.scenario,
      characters: plan.characters,
      mood: plan.mood,
      venue: { name: profile.name, vibe: profile.vibe || '' },
      dish: dish.name,
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

    // Mark this post as autoPost in state.json so future runs detect it for repetition guard
    saveJson(path.join(postDir, 'state.json'), {
      status: 'planned', autoPost: true, scenario: plan.scenario, dish: dish.name,
      createdAt: new Date().toISOString(), slides: [],
    });

    // Drive sync
    log('Drive sync (per-post)…');
    runScript('drive-sync.js', ['--config', configPath, '--dish', dish.name]);

    // Generate slides
    log('Generating slides…');
    runScript('generate-slides.js', [
      '--config', configPath,
      '--output', postDir,
      '--prompts', path.join(postDir, 'prompts.json'),
      '--platform', primaryPlatform,
    ]);

    // Overlay
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

    // Summarize
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
    const note = `📸 Auto-posted (${plan.scenario}, ${dish.name})\n\n${summary}${failSummary ? `\n\nFailed:\n${failSummary}` : ''}\n\n${captionFirstLine}…`;
    await notifyOwner(note);

    log(`✅ Done. Succeeded: ${succeeded.map(([p]) => p).join(', ')}${failed.length ? `. Failed: ${failed.map(([p]) => p).join(', ')}` : ''}`);
  } catch (e) {
    log(`✗ ${e.message}`);
    await recordFailure(e.message);
    process.exit(1);
  }
})();

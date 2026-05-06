#!/usr/bin/env node
/**
 * Stage 1: generate slideshow images via gpt-image-2 over Composio MCP.
 *
 * The 6-beat blueprint (see content-preparation/SKILL.md):
 *   1. Hook         — earns the swipe; standalone, no continuity required
 *   2. Scene-set    — character seed; dining room with characters
 *   3. Dish-arrives — dish lands on the table, characters reacting
 *   4. The-bite     — first-bite moment, motion, partial faces
 *   5. Connection   — non-food experience, conversation, candlelight
 *   6. Outro / CTA  — exterior or aftermath
 *
 * Generation order:
 *   - Slide 2 (or whichever is `isCharacterSeed: true`) generates first.
 *   - Slides 1, 3, 4, 5, 6 generate in parallel (concurrency capped) using
 *     slide 2 as the character reference where the beat sets useCharacterRef.
 *
 * Reference photos:
 *   - Venue photos come from photos/last-sync.json (written by drive-sync).
 *   - Dish photo comes from photos/last-sync.json under .dishPhotos[].
 *   - Character ref is the freshly generated character-seed slide.
 *
 * State.json tracks completed slides for resumability.
 *
 * Usage:
 *   node generate-slides.js \
 *     --config <config.json> \
 *     --output <posts/timestamp/> \
 *     --prompts <prompts.json>      # new sceneArc-based schema
 *     [--platform tiktok|instagram|facebook]
 *     [--urgency fast|quality]
 *     [--concurrency 3]
 */

const fs = require('fs');
const path = require('path');
const { callTool, loadConfig, findToolByPattern, listAllTools } = require('./mcp-client');
const { readState, writeState } = require('./state-helpers');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : null; };

const configPath = getArg('config');
const outputDir = getArg('output');
const promptsPath = getArg('prompts');
const platform = getArg('platform') || 'instagram';
const urgency = getArg('urgency') || 'quality';
const concurrency = parseInt(getArg('concurrency') || '3', 10);

if (!configPath || !outputDir || !promptsPath) {
  console.error(
    'Usage: node generate-slides.js --config <config.json> --output <dir> --prompts <prompts.json> ' +
    '[--platform tiktok|instagram|facebook] [--urgency fast|quality] [--concurrency 3]'
  );
  process.exit(1);
}

const config = loadConfig(configPath);
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
const model = 'gpt-image-2';
const MAX_REFS = 4;   // OPENAI_CREATE_IMAGE_EDIT supports up to 16; cap at 4 for clarity + cost.

const PLATFORM_SIZE = {
  tiktok:    '1024x1536',
  instagram: '1024x1280',
  facebook:  '1536x1024',
};
const PLATFORM_HINTS = {
  tiktok:    { aspect: '9:16 portrait',  slides: 6 },
  instagram: { aspect: '4:5 portrait',   slides: 6 },
  facebook:  { aspect: '16:9 landscape', slides: 1 },
};
const hints = PLATFORM_HINTS[platform];
if (!hints) { console.error(`Unknown platform: ${platform}`); process.exit(1); }
if (!config.platforms?.[platform]?.enabled) {
  console.error(`Platform ${platform} is not enabled in config.platforms. Refusing to generate.`);
  process.exit(1);
}

// ─── sceneArc validation ────────────────────────────────────────────────
if (!Array.isArray(prompts.sceneArc) || prompts.sceneArc.length === 0) {
  console.error('prompts.json must have a non-empty sceneArc array.');
  process.exit(1);
}
const seedIdx = prompts.sceneArc.findIndex((b) => b.isCharacterSeed);
if (seedIdx === -1) {
  console.error('prompts.json sceneArc must mark exactly one beat as isCharacterSeed (typically slide 2 / scene-set).');
  process.exit(1);
}
// Soft-validate the dish-only-on-2-slides rule.
const dishSlides = prompts.sceneArc.filter((b) => b.useDishRef).length;
if (dishSlides > 3) {
  console.warn(`⚠ sceneArc has ${dishSlides} dish-focused beats. Blueprint allows max 2 (slides 3 + 4). Generating anyway, but consider revising.`);
}

fs.mkdirSync(outputDir, { recursive: true });

// ─── Reference resolution ───────────────────────────────────────────────
function loadLastSync() {
  const lastSyncPath = path.join(
    path.dirname(path.dirname(path.resolve(outputDir))),  // posts/<ts>/.. → social-marketing/
    'photos', 'last-sync.json'
  );
  if (!fs.existsSync(lastSyncPath)) return { venuePhotos: [], dishPhotos: [] };
  try { return JSON.parse(fs.readFileSync(lastSyncPath, 'utf-8')); }
  catch (e) { console.warn(`last-sync.json unreadable: ${e.message}`); return { venuePhotos: [], dishPhotos: [] }; }
}

function pickVenueRef(syncData) {
  const list = syncData.venuePhotos || [];
  // Pick one venue photo at random for variety across posts.
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function pickDishRef(syncData) {
  const list = syncData.dishPhotos || [];
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// Block generation if no venue refs — venue is required by the blueprint.
const sync = loadLastSync();
if ((sync.venuePhotos || []).length === 0) {
  console.error('✗ No venue photos in photos/last-sync.json.');
  console.error('  Run drive-sync.js first (it should be called by content-preparation Phase 3).');
  console.error('  If venue folder is empty in Drive, the orchestrator must ask the owner to add photos.');
  process.exit(2);   // distinct exit code so orchestrator can detect "missing-venue-refs"
}

const venueRef = pickVenueRef(sync);
const dishRef = pickDishRef(sync);

// ─── Tool resolution (txt2img + img2img) ────────────────────────────────
let _txt2imgSlug = null;
let _img2imgSlug = null;

async function resolveImageTools() {
  if (_txt2imgSlug && _img2imgSlug) return;
  if (config.imageGen?.toolSlug) _txt2imgSlug = config.imageGen.toolSlug;
  if (config.imageGen?.editToolSlug) _img2imgSlug = config.imageGen.editToolSlug;

  if (!_txt2imgSlug) {
    const found = await findToolByPattern(config, /^OPENAI_CREATE_IMAGE$/i);
    if (found) _txt2imgSlug = found.tool.name;
    else {
      const fuzzy = await findToolByPattern(config, /^OPENAI_.*IMAGE.*GENERAT/i);
      if (!fuzzy) {
        const all = await listAllTools(config);
        const names = all.map((t) => t.name).slice(0, 30).join(', ');
        throw new Error(`No OpenAI text-to-image tool. First tools: ${names}`);
      }
      _txt2imgSlug = fuzzy.tool.name;
    }
  }
  if (!_img2imgSlug) {
    const found = await findToolByPattern(config, /^OPENAI_CREATE_IMAGE_EDIT$/i);
    if (found) _img2imgSlug = found.tool.name;
  }
  if (!_img2imgSlug) {
    throw new Error(
      'OPENAI_CREATE_IMAGE_EDIT not advertised by the MCP server. ' +
      'img2img with reference photos is mandatory for this skill (slides 2–6 need character + venue continuity). ' +
      'Confirm OpenAI is connected on the right userId in Composio.'
    );
  }
}

function extractImageB64(result) {
  const candidates = [
    result?.data?.[0]?.b64_json, result?.data?.b64_json,
    result?.images?.[0]?.b64_json, result?.images?.[0]?.b64,
    result?.b64_json, result?.image_b64,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}

// ─── Prompt construction ────────────────────────────────────────────────
const DOCUMENTARY_ANCHORS = [
  'documentary food photography, candid moment',
  'phone snapshot from a real dinner, not staged',
  'subjects in motion, slight motion blur',
  'humans in the frame — hands, body language, faces partial OK',
  'iPhone-candid composition, warm ambient lighting',
];

const ANTI_PRODUCT_ANCHORS = [
  'NOT product photography',
  'NOT studio lighting',
  'no white background',
  'no top-down flat lay',
];

function buildBasePromptLines() {
  return [
    `Aspect ratio: ${hints.aspect}. Output must be a single image in that exact ratio.`,
    urgency === 'fast' ? 'Quality: good, fast turnaround.' : 'Quality: high, photorealistic, smartphone-candid feel.',
    `Scenario: ${prompts.scenario || 'social dinner moment'}.`,
    `Mood: ${prompts.mood || 'warm, candid'}.`,
    `Characters: ${prompts.characters || '2-3 people, casual-stylish'}.`,
    `Venue: ${prompts.venue?.name ? `${prompts.venue.name} — ${prompts.venue.vibe || ''}` : 'restaurant interior'}.`,
    '',
    DOCUMENTARY_ANCHORS.map((s) => `- ${s}`).join('\n'),
    ANTI_PRODUCT_ANCHORS.map((s) => `- ${s}`).join('\n'),
    'Faces can be partial, blurred, three-quarter, over-shoulder, or out-of-frame. Hands and motion carry the emotion.',
    'No text, no watermarks, no logos in the image.',
    '',
    prompts.base || '',
  ].filter(Boolean).join('\n');
}

function buildSlidePrompt(beat) {
  const refLine = (beat.useVenueRef || beat.useCharacterRef || beat.useDishRef)
    ? 'Use the supplied reference photos as anchors. The venue reference shows the actual restaurant — match the lighting, decor, and ambiance exactly. The character reference (when present) shows the same people who appear across slides 2-6 — match their general appearance, age, outfits, and energy. The dish reference (when present) shows the actual dish — match plating and color.'
    : 'No reference photos for this slide. Generate from text only — this is the hook slide, free composition.';

  const archetypeNote = beat.archetype
    ? `\nSlide 1 archetype: ${beat.archetype}. ${ARCHETYPE_GUIDANCE[beat.archetype] || ''}`
    : '';

  return [
    buildBasePromptLines(),
    '',
    `Beat: ${beat.beat}.`,
    `Moment: ${beat.moment}.`,
    archetypeNote,
    '',
    refLine,
  ].filter(Boolean).join('\n');
}

const ARCHETYPE_GUIDANCE = {
  'object': 'Tight crop on a single non-food object that implies the night (keys + lipstick, phone with reservation, rain on window). Soft warm light.',
  'character-pre-context': 'The same archetype of people we see in slides 2-6, but earlier (getting ready, walking up to the restaurant). Faces partial.',
  'place': 'Restaurant exterior or facade, dramatically composed (sign at dusk, view through window from street).',
  'detail': 'Extreme close-up. Tight composition. Hint at the dish without showing the full plate. Motion or steam preferred. Cinematic, low-key.',
  'text-led': 'Moody backdrop image. Single texture or surface. Low contrast. Leaves the top two-thirds open for overlay text.',
};

// ─── Image generation ───────────────────────────────────────────────────
async function generateImage(promptText, references, outPath) {
  await resolveImageTools();
  const useEdit = references.length > 0;
  const slug = useEdit ? _img2imgSlug : _txt2imgSlug;

  const baseArgs = {
    prompt: promptText,
    model,
    n: 1,
    size: PLATFORM_SIZE[platform],
  };
  let toolArgs;
  if (useEdit) {
    toolArgs = {
      ...baseArgs,
      images: references.map((p) => ({ image_url: path.resolve(p) })),
    };
  } else {
    toolArgs = { ...baseArgs, response_format: 'b64_json' };
  }

  const result = await callTool(config, slug, toolArgs);
  if (result?.error) throw new Error(result.error?.message || JSON.stringify(result.error).slice(0, 300));
  const b64 = extractImageB64(result);
  if (!b64) throw new Error(`No image in ${slug} response. First 300 chars: ${JSON.stringify(result).slice(0, 300)}`);
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return slug;
}

async function withRetry(fn, label, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      console.log(`  retry ${i + 1}/${retries} ${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then((v) => { active--; resolve(v); next(); })
        .catch((e) => { active--; reject(e); next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

// ─── Per-beat ref resolution ────────────────────────────────────────────
function refsForBeat(beat, characterSeedPath) {
  const refs = [];
  if (beat.useCharacterRef && characterSeedPath) refs.push(characterSeedPath);
  if (beat.useVenueRef && venueRef) refs.push(venueRef);
  if (beat.useDishRef && dishRef) refs.push(dishRef);
  return refs.slice(0, MAX_REFS);
}

// ─── Main ───────────────────────────────────────────────────────────────
(async () => {
  const profilePath = config.paths?.restaurantProfile;
  const restaurantName = (profilePath && fs.existsSync(profilePath))
    ? (JSON.parse(fs.readFileSync(profilePath, 'utf-8')).name || 'restaurant')
    : 'restaurant';

  console.log(`\nGenerating ${prompts.sceneArc.length}-slide carousel for ${restaurantName}`);
  console.log(`  scenario: ${prompts.scenario || '(unspecified)'}  platform: ${platform}  size: ${PLATFORM_SIZE[platform]}`);
  console.log(`  venue ref: ${venueRef}`);
  console.log(`  dish ref:  ${dishRef || '(none — using txt for dish content)'}`);
  console.log(`  concurrency: ${concurrency}\n`);

  const state = readState(outputDir) || {
    status: 'pending', slides: [], scenario: prompts.scenario,
    characters: prompts.characters, mood: prompts.mood,
    platform, createdAt: new Date().toISOString(),
  };
  state.slides = state.slides || [];
  state.venueRef = venueRef;
  state.dishRef = dishRef;

  // ─── Phase A: generate the character-seed slide first (sequential) ───
  const seedBeat = prompts.sceneArc[seedIdx];
  const seedNum = seedIdx + 1;
  const seedPath = path.join(outputDir, `slide-${seedNum}-raw.png`);
  const seedSlot = state.slides[seedIdx] || { index: seedNum, beat: seedBeat.beat };

  if (fs.existsSync(seedPath) && fs.statSync(seedPath).size > 10000 && seedSlot.generated) {
    console.log(`  ⏭  slide-${seedNum} (seed) already generated, reusing`);
  } else {
    console.log(`→ Generating character-seed slide ${seedNum} (${seedBeat.beat})…`);
    const refs = refsForBeat(seedBeat, null);   // seed has no character ref yet
    const promptText = buildSlidePrompt(seedBeat);
    const slug = await withRetry(() => generateImage(promptText, refs, seedPath), `seed slide ${seedNum}`);
    seedSlot.generated = true;
    seedSlot.raw = `slide-${seedNum}-raw.png`;
    seedSlot.toolUsed = slug;
    state.slides[seedIdx] = seedSlot;
    writeState(outputDir, state);
    console.log(`  ✅ slide-${seedNum}-raw.png (${slug})\n`);
  }

  // ─── Phase B: generate remaining slides in parallel ──────────────────
  console.log(`→ Generating remaining ${prompts.sceneArc.length - 1} slides in parallel (concurrency ${concurrency})…`);
  const limit = limiter(Math.max(1, concurrency));
  const tasks = prompts.sceneArc.map((beat, i) => {
    if (i === seedIdx) return Promise.resolve({ idx: i + 1, ok: true, skipped: true });
    return limit(async () => {
      const num = i + 1;
      const out = path.join(outputDir, `slide-${num}-raw.png`);
      const slot = state.slides[i] || { index: num, beat: beat.beat };
      if (fs.existsSync(out) && fs.statSync(out).size > 10000 && slot.generated) {
        console.log(`  ⏭  slide-${num} (${beat.beat}) already generated, skipping`);
        return { idx: num, ok: true, skipped: true };
      }
      try {
        const refs = refsForBeat(beat, seedPath);
        const promptText = buildSlidePrompt(beat);
        const slug = await withRetry(() => generateImage(promptText, refs, out), `slide ${num}`);
        slot.generated = true;
        slot.raw = `slide-${num}-raw.png`;
        slot.toolUsed = slug;
        state.slides[i] = slot;
        console.log(`  ✅ slide-${num}-raw.png (${beat.beat}, ${slug})`);
        return { idx: num, ok: true };
      } catch (e) {
        slot.generated = false;
        slot.lastError = e.message;
        state.slides[i] = slot;
        console.error(`  ❌ slide-${num} (${beat.beat}): ${e.message}`);
        return { idx: num, ok: false };
      }
    });
  });

  const results = await Promise.all(tasks);
  const success = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  state.status = failed === 0 ? 'generated' : 'generated-partial';
  state.generatedAt = new Date().toISOString();
  writeState(outputDir, state);

  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify({
    generatedAt: state.generatedAt,
    scenario: prompts.scenario,
    characters: prompts.characters,
    mood: prompts.mood,
    platform, aspect: hints.aspect, urgency, model,
    venueRef, dishRef,
    slidesGenerated: success, slidesFailed: failed,
  }, null, 2));

  console.log(`\nGenerated ${success}/${prompts.sceneArc.length} → ${outputDir}`);
  if (failed > 0) {
    console.error(`${failed} failed. Re-run to retry — completed slides preserved via state.json.`);
    process.exit(1);
  }
})();

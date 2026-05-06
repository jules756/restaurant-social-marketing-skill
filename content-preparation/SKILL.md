---
name: content-preparation
description: Asset pipeline for restaurant social content. Given a dish + context, produces 6 finished slides with overlays and a caption ready to post. Load this when the restaurant-marketing orchestrator calls for a post (generate post, generate pool), a promotion, or spontaneous content. Never talks to the owner directly.
---

# Content Preparation

You produce posts. The [restaurant-marketing orchestrator](../restaurant-marketing/SKILL.md) decides when; you decide what and how. You never message the owner; errors go back through the orchestrator.

Your output is always the same shape, saved under `$HOST_AGENT_HOME/social-marketing/posts/<YYYY-MM-DD-HHmm>/`:

```
slide-1.png … slide-6.png        — final images with text overlays
slide-N-raw.png                  — pre-overlay (kept for debugging)
caption.txt                      — keyword-first caption with UTM
state.json                       — pipeline state (generated → overlaid → posted)
metadata.json                    — { scenario, contentType, dish, hookCategory, hookText, archetype, ... }
```

`metadata.json` is the record `memory` uses later to correlate hooks → engagement. Never skip writing it.

---

## The 6-Beat Blueprint (Hard Contract)

Every carousel follows the same 6-beat structure. **Only slides 3 and 4 are dish-focused.** The rest tell the experience. This is what real restaurant Instagram does — the dish is a beat in the story, not the subject of it.

| # | Beat | Job | Dish ref? | Venue ref? | Character ref? |
|---|---|---|---|---|---|
| 1 | **Hook** | Earn the swipe. Anything pattern-interrupting. | ❌ optional | ❌ optional | ❌ no |
| 2 | **Scene-set** *(character seed)* | Establish: this restaurant, these people, this night. Wide shot of the dining room with characters seated. | ❌ | ✅ required | ❌ (this slide *creates* the character ref) |
| 3 | **Dish-arrives** | The dish lands on the table. Server's hand, characters' faces lighting up. | ✅ required | ✅ | ✅ (slide 2) |
| 4 | **The-bite** | First-bite moment. Hands, fork, motion, mid-laugh. | ✅ required (mid-eating, partial) | ✅ | ✅ (slide 2) |
| 5 | **Connection** | Mid-conversation, leaning in, candlelight. **Dish off-frame.** | ❌ | ✅ | ✅ (slide 2) |
| 6 | **Outro / CTA** | Exterior at the right time of day, OR aftermath (empty plate, candle burning, paid bill). | ❌ optional (empty plate OK) | ✅ | ✅ optional |

**This contract is non-negotiable.** Dish on 2 of 6 slides, venue on 5 of 6, character continuity across 5 of 6. If you write a sceneArc with the dish on more than 2 slides, you're producing the dead "dish-dish-dish-dish" carousels we explicitly don't want.

---

## Generation Order

1. **Slide 2 generates first** — it's the character seed. The image becomes the reference for slides 3–6.
2. **Slides 1, 3, 4, 5, 6 generate in parallel** (concurrency cap 3) using slide 2 as the character ref where applicable.

`generate-slides.js` enforces this order automatically when you mark slide 2 as `isCharacterSeed: true` in the sceneArc.

---

## Pass-by-Pass Execution

### Phase 0: Pick the scenario

Load [social-media-seo-hermes/references/scenarios.md](../social-media-seo-hermes/references/scenarios.md) via `skill_view('social-media-seo-hermes', 'references/scenarios.md')`.

Pick **one scenario** based on:
- Day of week + time (Friday 8pm → `friend-night-dinner` or `date-night`; Sunday 1pm → `family-sunday`; Wednesday 1pm → `solo-lunch-pause`)
- Dish character (rich pasta → social/comfort; light salad → solo/lunch; shared plates → group)
- `memory` of the last 7 scenarios used for this restaurant — **never repeat a scenario within 7 days**
- `trend-report.json` if a scenario type is hot
- Owner cues from the orchestrator's brief (*"post about tonight's special"* → infer dinner)

Output: `{ scenario: "friend-night-dinner", characters: "Two women, late 20s, casual-stylish — one in colorful top, one in earth tones", mood: "Warm laughter, candid, leaning in", time: "Dinner, 8pm" }`.

### Phase 1: Build the 6-beat sceneArc

For the chosen scenario, write 6 beats following the blueprint above. Each beat is one specific moment within the scenario.

Example (friend-night-dinner + carbonara):

```json
{
  "sceneArc": [
    { "beat": "hook",         "archetype": "detail",  "moment": "Hand twirling pasta on a fork in low candlelight, motion blur, abstract close-up", "useDishRef": false, "useVenueRef": false, "useCharacterRef": false },
    { "beat": "scene-set",    "moment": "Two women just sat down at a candlelit table, dining room behind them with other guests soft-focused, one pouring wine for the other", "useDishRef": false, "useVenueRef": true,  "useCharacterRef": false, "isCharacterSeed": true },
    { "beat": "dish-arrives", "moment": "Server's hand placing the carbonara on the table, both women leaning in, faces lighting up, candlelight on the plate", "useDishRef": true,  "useVenueRef": true, "useCharacterRef": true },
    { "beat": "the-bite",     "moment": "One twirls pasta on her fork, mid-laugh, the other watching with a fork in hand, fork in motion blur", "useDishRef": true,  "useVenueRef": true, "useCharacterRef": true },
    { "beat": "connection",   "moment": "Both leaning over the table mid-conversation, wine glasses, hands gesturing, dish off-frame, candlelight on faces", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "outro",        "moment": "Outside the restaurant after, golden hour fading, both women hugging goodbye, warm restaurant windows behind them", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true }
  ]
}
```

Slide 1 archetype options (pick based on the hook line you'll write in Phase 2): see [social-media-seo-hermes/references/hook-archetypes.md](../social-media-seo-hermes/references/hook-archetypes.md). Five archetypes: object, character-pre-context, place, detail, text-led.

### Phase 2: Write the hook line + overlays

Load [social-media-seo-hermes/references/hooks.md](../social-media-seo-hermes/references/hooks.md). Pick a hook category based on content type, restaurant fit, memory, trends. Write 2–3 hook variants in the restaurant's voice. Pick the strongest.

Write 6 overlay texts (4–6 words, max 10 words):
- Slide 1: the hook line itself
- Slides 2–5: short narrative beats supporting the moment (*"Friday nights are for this"*, *"The first twirl"*, *"The kind of laugh that takes over the table"*)
- Slide 6: CTA from [social-media-seo-hermes/references/ctas.md](../social-media-seo-hermes/references/ctas.md)

### Phase 3: Run drive-sync (on-demand, per post)

Drive sync now runs *per post*, not on a schedule. Pull the dish photo and venue photos for this post:

```bash
node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/drive-sync.js \
  --config $HOST_AGENT_HOME/social-marketing/config.json \
  --dish "<dish name>"
```

Output: list of dish photo paths + venue photo paths cached locally. The script writes these into `$HOST_AGENT_HOME/social-marketing/photos/last-sync.json`.

**If the venue photos folder is empty, fail loud and return to the orchestrator.** The orchestrator should tell the owner: *"I need a few photos of your space first — add them to the venue folder in your Drive."* Do not proceed to image generation without venue refs.

Dish photos are best-effort: if no dish photo matches the requested dish name (filename match, fuzzy), the orchestrator gets a soft warning and we proceed using a generic dish prompt.

### Phase 4: Build prompts.json

Write the new schema to `/tmp/prompts-<ts>.json`:

```json
{
  "scenario": "friend-night-dinner",
  "characters": "Two women, late 20s, casual-stylish",
  "mood": "Warm laughter, candid, motion-rich",
  "venue": { "name": "Rodolfino", "vibe": "intimate trattoria, candlelight, exposed brick" },
  "dish": "Carbonara",
  "base": "<shared base description: documentary food photography, candid moment, smartphone-candid feel, [lighting preset from food-photography-hermes], [scenario mood], real human moments — see food-photography-hermes/SKILL.md for the documentary anchors>",
  "sceneArc": [
    { "beat": "hook", "archetype": "detail", "moment": "...", "useDishRef": false, "useVenueRef": false, "useCharacterRef": false },
    { "beat": "scene-set", "moment": "...", "useDishRef": false, "useVenueRef": true, "useCharacterRef": false, "isCharacterSeed": true },
    { "beat": "dish-arrives", "moment": "...", "useDishRef": true, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "the-bite", "moment": "...", "useDishRef": true, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "connection", "moment": "...", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "outro", "moment": "...", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true }
  ]
}
```

Texts file:

```json
["<slide 1 hook>", "<slide 2 narrative>", "<slide 3 narrative>", "<slide 4 narrative>", "<slide 5 narrative>", "<slide 6 CTA>"]
```

### Phase 5: Generate slides

```bash
node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/generate-slides.js \
  --config $HOST_AGENT_HOME/social-marketing/config.json \
  --output $HOST_AGENT_HOME/social-marketing/posts/<timestamp> \
  --prompts /tmp/prompts-<ts>.json \
  --platform <tiktok|instagram|facebook> \
  --urgency <fast|quality>
```

The script generates the `isCharacterSeed: true` slide first (slide 2), then slides 1, 3, 4, 5, 6 in parallel using slide 2 as the character reference where the beat sets `useCharacterRef: true`. Per-beat ref selection is automatic from the sceneArc.

Exit 0 + 6 raw PNGs = success. Re-runnable; state.json tracks completed slides.

### Phase 6: Add text overlays

```bash
node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/add-text-overlay.js \
  --input $HOST_AGENT_HOME/social-marketing/posts/<timestamp> \
  --texts /tmp/texts-<ts>.json
```

Produces final `slide-1.png` … `slide-6.png`. Mandatory — fails loud if `canvas` isn't installed.

### Phase 7: Write caption

Compose the caption yourself (LLM reasoning) using the keyword-first rules from [social-media-seo-hermes/SKILL.md](../social-media-seo-hermes/SKILL.md). First 125 chars lead with what the post is about + restaurant name + city. Hashtags from [social-media-seo-hermes/references/keywords.md](../social-media-seo-hermes/references/keywords.md). CTA from [ctas.md](../social-media-seo-hermes/references/ctas.md) with UTM:

```
?utm_source=<platform>&utm_medium=social&utm_campaign=<contentType>&utm_content=<YYYY-MM-DD>
```

Write to `$HOST_AGENT_HOME/social-marketing/posts/<timestamp>/caption.txt`.

### Phase 8: Write metadata.json

```json
{
  "generatedAt": "<ISO>",
  "scenario": "friend-night-dinner",
  "characters": "Two women, late 20s, casual-stylish",
  "contentType": "<regular|promo|knowledge-story|trend|spontaneous>",
  "platform": "<tiktok|instagram|facebook>",
  "dish": "<dish name>",
  "hookCategory": "<from hooks.md>",
  "hookText": "<exact slide 1 text>",
  "hookArchetype": "<from hook-archetypes.md>",
  "venuePhotos": ["<path1>", "<path2>"],
  "dishPhoto": "<path or null>"
}
```

`memory` indexes this for performance correlation.

### Phase 9: Return to orchestrator

Return the directory path + one-line summary. Orchestrator handles Telegram delivery and posting.

---

## Platform Rules

Always check `config.platforms.<name>.enabled` before generating.

| Platform  | Aspect        | Slides    | Posting mode |
|-----------|---------------|-----------|--------------|
| TikTok    | 9:16 portrait | 6         | Draft — owner adds trending sound |
| Instagram | 4:5 portrait  | 6 (up to 10) | Direct publish |
| Facebook  | 16:9 landscape | Single hero (slide 4) | Single photo |

Paths always `$HOST_AGENT_HOME/social-marketing/…`.

---

## Drive Workflow (on-demand, not cron)

Drive sync runs *as part of post generation*, not as a background job. The owner organizes their Drive into two folders (one for dishes, one for the venue/place). Folder names can vary — `drive-sync.js` auto-detects them by name pattern.

Full details: [references/drive-workflow.md](references/drive-workflow.md).

**Critical:** Drive photos are REFERENCES for image generation — they are NOT the images posted to social. Never mention them as the post content. Always *"I'll use them as references to generate posts that look like your space and your food"*.

---

## What You Do NOT Do

- Decide when to post (orchestrator).
- Talk to the owner (orchestrator).
- Write hook patterns from scratch (use social-media-seo-hermes).
- Invent scenarios from scratch (use scenarios.md).
- Run analytics or research (marketing-intelligence).
- Post to social platforms directly. Platform posting scripts live in `scripts/post-to-*.js` and are invoked by the orchestrator's post step.

---

## Error Handling

- **No venue photos in Drive** → fail to orchestrator with `"missing-venue-refs"`. Orchestrator tells the owner. Do not proceed to generation.
- **No dish photo matches the dish name** → soft warning, proceed without dish ref (txt2img-ish for the dish content). Orchestrator can mention it casually (*"Add a [dish] photo to your Drive — quality jumps when I have a real reference"*).
- **`generate-slides.js` non-zero** → re-run once (state.json preserves completed slides), then surface to orchestrator.
- **`add-text-overlay.js` non-zero** → fail loud. The script requires `canvas`; missing canvas is an install bug, not a runtime fallback.
- **Trend report missing** → evergreen hook categories only (story-behind-dish, reaction, sourcing).
- **Scenario history empty (cold start)** → use cold-start defaults from scenarios.md (`friend-night-dinner` for dinner, `solo-lunch-pause` for lunch).

---

## Anti-Patterns

These are the failures we explicitly designed against. If you find yourself producing any of these, stop:

- **Six dish-focused slides.** The carousel must be ~2 dish slides + ~4 experience slides.
- **No people in the carousel.** Slides 2, 3, 4, 5 must include human presence (hands, faces partial, motion). Slide 6 can be peopled or aftermath.
- **Different characters across slides.** Slides 2–6 must feature the same archetype of people (vibe-match, not face-replica).
- **Generic stock-photo restaurant.** Every slide must feel like *this* restaurant — venue refs are mandatory on 5 of 6 slides.
- **Catalog/product photography style.** No `professional food photography`, no `studio lighting`, no white backgrounds. Use the documentary anchors in [food-photography-hermes/SKILL.md](../food-photography-hermes/SKILL.md).

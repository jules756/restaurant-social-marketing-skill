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

Every carousel follows the same 6-beat structure. **Slides 1, 2, 5, 6 are structurally fixed.** **Slides 3 and 4 shift based on the `postType` of this post** — see "Beats 3-4 by post type" below.

| # | Beat | Job | Dish ref? | Venue ref? | Character ref? |
|---|---|---|---|---|---|
| 1 | **Hook** | Earn the swipe. Anything pattern-interrupting. | ❌ optional | ❌ optional | ❌ no |
| 2 | **Scene-set** *(character seed)* | Establish: this restaurant, these people, this night. Wide shot with characters seated or arriving. | ❌ | ✅ required | ❌ (this slide *creates* the character ref) |
| 3 | **(Varies by postType — see table below)** | The first thrust of the post idea. | varies | ✅ | ✅ (slide 2) |
| 4 | **(Varies by postType — see table below)** | The payoff or follow-through. | varies | ✅ | ✅ (slide 2) |
| 5 | **Connection** | Mid-conversation, leaning in, candlelight. **Dish off-frame** unless the postType makes it weird. | ❌ usually | ✅ | ✅ (slide 2) |
| 6 | **Outro / CTA** | Exterior at the right time of day, OR aftermath (empty plate, candle burning, paid bill). | ❌ optional | ✅ | ✅ optional |

**Venue refs are required on slides 2-6 (5 of 6). Character continuity required across slides 2-6.** If venue refs are missing entirely, fail to the orchestrator — the skill never proceeds without venue references.

## Beats 3-4 by Post Type

Slides 3-4 are where the post's `postType` actually shapes the content. Pick from this table — the LLM (in `auto-post.js`) or the orchestrator (in manual `/post`) picks the postType first, then the corresponding beat-3-4 pair.

| postType | Slide 3 | Slide 4 | useDishRef? |
|---|---|---|---|
| `dish-feature` | Dish lands on table, server's hand, characters reacting | First-bite moment, fork twirl, motion, partial faces | ✅ both slides |
| `vibe-moment` | A specific moment in the night (toast, glance across the table, candlelight on faces) | A connection moment (laugh, lean-in, hands meeting) | ❌ neither |
| `behind-the-scenes` | The craft moment: chef's hands working (plating, finishing, dusting), kitchen action, motion | The payoff: finished plate appearing OR service starting OR the team a moment before opening | ✅ slide 4 only (optional) |
| `story` | Story illustration #1 — the source (old recipe handwritten, the place the recipe came from, the chef's grandmother's photo if available, archival texture) | Story illustration #2 — the present-day execution (the dish today, the chef now, the same dish made the same way) | ✅ slide 4 only (optional) |
| `seasonal` | The seasonal trigger: ingredient peak (first asparagus, first mushrooms), weather (rain on the window, snow outside), calendar moment (candles for a holiday) | The dish or service moment that responds to the season | ✅ slide 4 (optional) |
| `regular` | The regular arriving / their order being prepared / their usual table being set | Them mid-meal, in their usual spot, candid | ✅ slide 4 (optional, if their order is the visual anchor) |
| `neighborhood` | Local landmark, street scene, view from the door — the *area* | The restaurant within that context (window-lit at dusk, awning, exterior at the right time of day) | ❌ neither |
| `promo` | The promo dish or element (or the calendar/urgency visual for last-chance posts) | People enjoying the promo OR the value-reveal moment | ✅ both (when applicable) |
| `trend-driven` | Trend execution shot #1 (depends on the trend — could be a transition, a meme format, a specific composition) | Trend execution shot #2 | varies |
| `event` | Event setup, arrival, the menu / collab artifact | Event in full swing — people enjoying, room full, energy at peak | ✅ slide 4 (optional) |

**Anti-pattern**: If you find yourself writing all 6 beats around the dish (3+ slides with `useDishRef: true`), the postType is wrong. Pick a different postType or move dish content to slides 3-4 only.

Full taxonomy with selection logic + healthy mix: [social-media-seo-hermes/references/post-types.md](../social-media-seo-hermes/references/post-types.md).

---

## Generation Order

1. **Slide 2 generates first** — it's the character seed. The image becomes the reference for slides 3–6.
2. **Slides 1, 3, 4, 5, 6 generate in parallel** (concurrency cap 3) using slide 2 as the character ref where applicable.

`generate-slides.js` enforces this order automatically when you mark slide 2 as `isCharacterSeed: true` in the sceneArc.

---

## Pass-by-Pass Execution

### Phase 0: Pick the post type, then the scenario, then (if relevant) the dish

A daily restaurant feed is not a dish catalog. Real restaurants post about *moments*, *people*, *story*, *neighborhood*, *seasonality*, *behind-the-scenes* — the dish is one beat in many possible posts, not the subject of every post.

**Step 1 — Pick `postType`** from [social-media-seo-hermes/references/post-types.md](../social-media-seo-hermes/references/post-types.md). 10 types: `dish-feature`, `vibe-moment`, `behind-the-scenes`, `story`, `seasonal`, `regular`, `neighborhood`, `promo`, `trend-driven`, `event`. Healthy mix: ~30-40% dish-feature, ~20-30% vibe-moment, rest spread across the others.

Selection priority:
1. Active promo in window (check `promotions/*.json`) → `promo`
2. Event in next 7 days → `event` for at least one of the lead-up posts
3. Cold start (zero or near-zero post history) → fixed sequence: `vibe-moment` → `dish-feature` → `behind-the-scenes` → `story` → `vibe-moment`
4. Otherwise — pick weighted by recent post-type history (avoid back-to-back same type; never 3 of the same type in 5 posts), day/time, season/weather, what's underserved

**Step 2 — Pick `scenario`** from [scenarios.md](../social-media-seo-hermes/references/scenarios.md) based on day-of-week + time + the postType.
- Never repeat a scenario within 7 days (`memory` lookup).
- `dish-feature` + Friday dinner = `friend-night-dinner` or `date-night`
- `behind-the-scenes` + weekday morning = the chef-prep scenarios
- `vibe-moment` + Tuesday lunch = `solo-lunch-pause`

**Step 3 — Pick `dish` (or null)**:
- For `postType: dish-feature` → pick a signature dish from `restaurant-profile.signatureDishes` (rotate, never repeat within 7 days)
- For `postType: promo / event / seasonal / story` → pick if there's an obvious dish anchor; null otherwise
- For `postType: vibe-moment / behind-the-scenes / regular / neighborhood / trend-driven` → null is fine; the post is about something else

Output: `{ postType, scenario, characters, mood, time, dish: <name | null> }`.

### Phase 1: Build the 6-beat sceneArc

For the chosen `postType` + `scenario`, write 6 beats. Slides 1, 2, 5, 6 are structurally fixed across all post types. Slides 3, 4 come from the postType→beats-3-4 table above.

Example A — `dish-feature` + `friend-night-dinner` + Carbonara:

```json
{
  "sceneArc": [
    { "beat": "hook",         "archetype": "detail",  "moment": "Hand twirling pasta on a fork in low candlelight, motion blur, abstract close-up", "useDishRef": false, "useVenueRef": false, "useCharacterRef": false },
    { "beat": "scene-set",    "moment": "Two women just sat down at a candlelit table, dining room behind, one pouring wine for the other", "useDishRef": false, "useVenueRef": true,  "useCharacterRef": false, "isCharacterSeed": true },
    { "beat": "dish-arrives", "moment": "Server's hand placing the carbonara on the table, both women leaning in, faces lighting up, candlelight on the plate", "useDishRef": true,  "useVenueRef": true, "useCharacterRef": true },
    { "beat": "the-bite",     "moment": "One twirls pasta on her fork, mid-laugh, the other watching, fork in motion blur", "useDishRef": true,  "useVenueRef": true, "useCharacterRef": true },
    { "beat": "connection",   "moment": "Both leaning over the table mid-conversation, wine glasses, hands gesturing, dish off-frame", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "outro",        "moment": "Outside the restaurant after, golden hour, both hugging goodbye, warm windows behind", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true }
  ]
}
```

Example B — `behind-the-scenes` + the chef's morning, no specific dish:

```json
{
  "sceneArc": [
    { "beat": "hook",         "archetype": "object", "moment": "An empty kitchen pass at 6am, single lamp on, copper pans hanging — implies what's coming", "useDishRef": false, "useVenueRef": false, "useCharacterRef": false },
    { "beat": "scene-set",    "moment": "The chef tying her apron at the kitchen counter, soft morning light from a side window, prep station behind her", "useDishRef": false, "useVenueRef": true,  "useCharacterRef": false, "isCharacterSeed": true },
    { "beat": "craft-1",      "moment": "Hands kneading dough on a wooden surface, flour on forearms, motion blur — pure craft", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "craft-2",      "moment": "The same chef at the pass, plating something with tweezers, focused, kitchen warmth", "useDishRef": true, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "connection",   "moment": "First guest of the day being greeted at the door — the work just paid off", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "outro",        "moment": "Restaurant exterior at golden hour, warm light through the windows", "useDishRef": false, "useVenueRef": true, "useCharacterRef": false }
  ]
}
```

Example C — `neighborhood` + Sunday afternoon, no characters tied to dish:

```json
{
  "sceneArc": [
    { "beat": "hook",         "archetype": "place",  "moment": "The restaurant's neighborhood street at golden hour, light from windows, a couple walking by", "useDishRef": false, "useVenueRef": true, "useCharacterRef": false },
    { "beat": "scene-set",    "moment": "View from inside the front window looking out — same street, blurred figures outside, our wood tables foreground", "useDishRef": false, "useVenueRef": true,  "useCharacterRef": false, "isCharacterSeed": true },
    { "beat": "neighborhood-1", "moment": "Detail of a local landmark a block away — the church spire, the cobblestones, the iconic block", "useDishRef": false, "useVenueRef": false, "useCharacterRef": false },
    { "beat": "neighborhood-2", "moment": "Restaurant exterior with awning, golden hour, our character archetype walking up to the door", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "connection",   "moment": "Inside, the couple now seated, candlelight, the street view through the window behind them", "useDishRef": false, "useVenueRef": true, "useCharacterRef": true },
    { "beat": "outro",        "moment": "Exterior again, dusk now, warm windows lit, full of people — a place worth coming to", "useDishRef": false, "useVenueRef": true, "useCharacterRef": false }
  ]
}
```

Slide 1 archetype options: see [social-media-seo-hermes/references/hook-archetypes.md](../social-media-seo-hermes/references/hook-archetypes.md).

### Phase 2: Write the hook line + overlays

Load [social-media-seo-hermes/references/hooks.md](../social-media-seo-hermes/references/hooks.md). Pick a hook category based on content type, restaurant fit, memory, trends. Write 2–3 hook variants in the restaurant's voice. Pick the strongest.

Write 6 overlay texts (4–6 words, max 10 words):
- Slide 1: the hook line itself
- Slides 2–5: short narrative beats supporting the moment (*"Friday nights are for this"*, *"The first twirl"*, *"The kind of laugh that takes over the table"*)
- Slide 6: CTA from [social-media-seo-hermes/references/ctas.md](../social-media-seo-hermes/references/ctas.md)

### Phase 3: Run drive-sync (on-demand, per post)

Drive sync runs *per post*, not on a schedule. Pull venue photos always; dish photos only when the post needs them.

```bash
# When postType uses dish refs (dish-feature, promo, sometimes story/seasonal/event):
node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/drive-sync.js \
  --config $HOST_AGENT_HOME/social-marketing/config.json \
  --dish "<dish name>"

# When postType doesn't need dish refs (vibe-moment, behind-the-scenes, regular, neighborhood, trend-driven):
node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/drive-sync.js \
  --config $HOST_AGENT_HOME/social-marketing/config.json
```

Output: `$HOST_AGENT_HOME/social-marketing/photos/last-sync.json` with `venuePhotos[]` + (optionally) `dishPhotos[]`.

**If the venue folder is empty, fail loud and return to the orchestrator** (exit code 2). The orchestrator should tell the owner: *"I need a few photos of your space first — add them to the venue folder in your Drive."*

When `--dish` is omitted, no dish-photo filtering happens; if the sceneArc has any `useDishRef: true` beats anyway, those slides will txt-only-generate the dish content (degraded but not a hard fail).

### Phase 4: Build prompts.json

Write to `/tmp/prompts-<ts>.json`. The `dish` field is `null` when there's no specific dish for this post.

```json
{
  "postType": "dish-feature",
  "postIdea": "Friday-night carbonara with two friends — the cozy trattoria moment",
  "scenario": "friend-night-dinner",
  "characters": "Two women, late 20s, casual-stylish",
  "mood": "Warm laughter, candid, motion-rich",
  "venue": { "name": "Rodolfino", "vibe": "intimate trattoria, candlelight, exposed brick" },
  "dish": "Carbonara",
  "base": "<base description: documentary food photography anchors + scenario mood + lighting preset from food-photography-hermes>",
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

For non-dish post types (`vibe-moment`, `behind-the-scenes`, etc.), `dish: null` and the sceneArc has zero or one `useDishRef: true` beat (or none). See the postType→beats-3-4 table above for which slides use the dish ref.

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
  "postType": "<from post-types.md>",
  "postIdea": "<one-sentence what this post is about>",
  "scenario": "<scenario archetype>",
  "characters": "<one sentence>",
  "platform": "<tiktok|instagram|facebook>",
  "dish": "<dish name or null>",
  "hookCategory": "<from hooks.md>",
  "hookText": "<exact slide 1 text>",
  "hookArchetype": "<from hook-archetypes.md>",
  "venuePhotos": ["<path1>", "<path2>"],
  "dishPhoto": "<path or null>"
}
```

`memory` indexes this for performance correlation. The `postType` field is critical — it's what the next post's planner uses to avoid back-to-back same-type posts.

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

- **Every post is a dish-feature.** The feed must mix post types. Roughly 30-40% dish-feature, the rest spread across vibe-moment, behind-the-scenes, story, neighborhood, etc. — see [post-types.md](../social-media-seo-hermes/references/post-types.md). Dish-rotating is dish-catalog content, not restaurant content.
- **Three or more dish-focused slides in one post.** The blueprint is dish on 2 of 6 slides max — and only when `postType` is `dish-feature` (or one of the few others where dish refs apply). For non-dish post types, 0-1 dish slides.
- **No people in the carousel.** Slides 2, 3, 4, 5 must include human presence (hands, faces partial, motion). Slide 6 can be peopled or aftermath.
- **Different characters across slides.** Slides 2–6 must feature the same archetype of people (vibe-match, not face-replica).
- **Generic stock-photo restaurant.** Every slide must feel like *this* restaurant — venue refs are mandatory on slides 2-6.
- **Catalog/product photography style.** No `professional food photography`, no `studio lighting`, no white backgrounds. Use the documentary anchors in [food-photography-hermes/SKILL.md](../food-photography-hermes/SKILL.md).

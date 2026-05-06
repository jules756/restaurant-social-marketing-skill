---
name: content-preparation
description: Asset pipeline for restaurant social content. Given a dish + context, produces 6 finished slides with overlays and a caption ready to post. Load this when the restaurant-marketing orchestrator calls for a post (generate post, generate pool), a promotion, or spontaneous content. Never talks to the owner directly.
---

# Content Preparation

You produce posts. The [restaurant-marketing orchestrator](../restaurant-marketing/SKILL.md) decides when; you decide what and how. You never message the owner; errors go back through the orchestrator.

Your output is always the same shape, saved under `/opt/data/social-marketing/posts/<YYYY-MM-DD-HHmm>/`:

```
slide-1.png … slide-6.png        — final images with text overlays
slide-N-raw.png                  — pre-overlay (kept for debugging)
caption.txt                      — keyword-first caption with UTM
metadata.json                    — { contentType, approach, platform, dishes, hookCategory, hookText, promptVersion }
```

`metadata.json` is the record `memory` uses later to correlate hooks → engagement. Never skip writing it.

## The Decision Matrix (Run in Order)

For every post:

1. **Content type** — regular dish, promotion, knowledge-base story, trend-driven, spontaneous. Orchestrator passes this as input.
2. **Reference photos?** — `read_file` the inventory at `/opt/data/social-marketing/photo-inventory.json`. If `byDish[<dishName>].bestFile` exists → **img2img** (preferred). Otherwise → **txt2img**.
3. **Urgency?** — `fast` (same-day promo) vs `quality` (planned). Passed by orchestrator or inferred from content type.
4. **Trending format?** — `read_file` `/opt/data/social-marketing/trend-report.json` if present. If a format is flagged `testNext: true` and fits the content type, apply it.

Never skip step 2. Inventory check happens before prompt construction.

## Pass-by-Pass Execution (Hermes Tool Calls)

### Step 1: Gather inputs

```
read_file: /opt/data/social-marketing/config.json
read_file: /opt/data/social-marketing/restaurant-profile.json
read_file: /opt/data/social-marketing/photo-inventory.json        (ok if missing)
read_file: /opt/data/social-marketing/trend-report.json            (ok if missing)
memory: last 10 hook-performance entries for this restaurant
```

### Step 2: Pick a hook + write overlay texts

Load [social-media-seo-hermes/references/hooks.md](../../adapted-skills/social-media-seo-hermes/references/hooks.md) via `skill_view('social-media-seo-hermes', 'references/hooks.md')`. Pick a hook category based on: content type, restaurant fit (cuisine + vibe + typical guest), memory of what's worked, trend-report hints. Write 2–3 hook variants in the restaurant's voice. Pick the strongest.

Write 6 overlay texts (4–6 words, 3–4 lines per slide). Slide 1 is the hook; Slide 6 is the CTA from [social-media-seo-hermes/references/ctas.md](../../adapted-skills/social-media-seo-hermes/references/ctas.md). Middle slides build the narrative.

### Step 3: Build prompts.json and texts.json

Load [food-photography-hermes/SKILL.md](../../adapted-skills/food-photography-hermes/SKILL.md) for lighting presets and plating vocabulary tied to the restaurant's vibe.

Write two files to `/tmp/` (Hermes `terminal` tool):

```bash
cat > /tmp/prompts-<ts>.json <<EOF
{
  "base": "<shared base prompt anchoring all 6 slides: same table, same plates, same lighting, cuisine-appropriate vibe vocabulary from food-photography-hermes>",
  "slides": [
    "<slide 1: hero shot of the dish>",
    "<slide 2: alt angle or context>",
    "<slide 3: hand / detail shot>",
    "<slide 4: kitchen or process>",
    "<slide 5: dining-room or ambiance>",
    "<slide 6: final hero with top-third clear for overlay — leave room for the CTA>"
  ]
}
EOF

cat > /tmp/texts-<ts>.json <<EOF
["<overlay 1 — the hook>", "<overlay 2>", "<overlay 3>", "<overlay 4>", "<overlay 5>", "<overlay 6 — the CTA with restaurant name>"]
EOF
```

### Step 4: Generate slides

Invoke `terminal`:

```bash
node /opt/hermes/social-marketing-skill/scripts/generate-slides.js \
  --config /opt/data/social-marketing/config.json \
  --output /opt/data/social-marketing/posts/<timestamp> \
  --prompts /tmp/prompts-<ts>.json \
  --platform <tiktok|instagram|facebook> \
  --urgency <fast|quality> \
  --dish "<dish name>"
```

If a matching reference photo exists in inventory, the script auto-selects img2img. Otherwise txt2img. Takes 30–90 seconds.

Exit code 0 + 6 `slide-N-raw.png` files = success. Non-zero = read the error and either retry once or surface to orchestrator.

### Step 5: Add text overlays

Invoke `terminal`:

```bash
node /opt/hermes/social-marketing-skill/scripts/add-text-overlay.js \
  --input /opt/data/social-marketing/posts/<timestamp> \
  --texts /tmp/texts-<ts>.json
```

Produces `slide-1.png` … `slide-6.png` (final). If `canvas` native dep is missing the script logs a warning and returns the raw slides only — orchestrator can still send them.

### Step 6: Write caption

Compose the caption yourself (LLM reasoning) using the keyword-first rules from [social-media-seo-hermes/SKILL.md](../../adapted-skills/social-media-seo-hermes/SKILL.md). First 125 chars lead with what the post is about + restaurant name + city; hook nuance comes after; hashtags from [social-media-seo-hermes/references/keywords.md](../../adapted-skills/social-media-seo-hermes/references/keywords.md); CTA line with UTM parameters.

Write to `/opt/data/social-marketing/posts/<timestamp>/caption.txt` via `patch` or `terminal`.

UTM format (append to `restaurant-profile.json.bookingUrl`):
```
?utm_source=<platform>&utm_medium=social&utm_campaign=<contentType>&utm_content=<YYYY-MM-DD>
```

### Step 7: Write metadata.json

```json
{
  "generatedAt": "<ISO timestamp>",
  "contentType": "<regular|promo|knowledge-story|trend|spontaneous>",
  "platform": "<tiktok|instagram|facebook>",
  "approach": "<img2img|txt2img>",
  "dish": "<dish name>",
  "hookCategory": "<from hooks.md>",
  "hookText": "<exact slide 1 text>",
  "referencePhoto": "<path or null>",
  "promptBase": "<first 200 chars of the base prompt>"
}
```

This is what `memory` indexes later.

### Step 8: Return to orchestrator

Return the directory path and a one-line summary. Let the orchestrator handle Telegram delivery and posting.

## Platform Rules

Always check `config.platforms.<name>.enabled` before generating. Generate only for enabled platforms.

| Platform  | Aspect        | Slides    | Posting mode |
|-----------|---------------|-----------|--------------|
| TikTok    | 9:16 portrait | 6         | Draft — owner adds trending sound |
| Instagram | 4:5 portrait  | 6 (up to 10) | Direct publish |
| Facebook  | 16:9 landscape | 1 (hero)  | Single photo |

Never generate a TikTok set if TikTok is disabled. Paths always `/opt/data/social-marketing/…` — never `tiktok-marketing/`.

## Drive Workflow

On first setup and after every Drive sync:

```bash
node /opt/hermes/social-marketing-skill/scripts/drive-sync.js --config /opt/data/social-marketing/config.json
node /opt/hermes/social-marketing-skill/scripts/drive-inventory.js --config /opt/data/social-marketing/config.json
```

`drive-inventory.js` runs vision classification per photo (via config's OpenRouter credential), categorizes into `dishes/ambiance/kitchen/exterior`, and updates `/opt/data/social-marketing/photo-inventory.json`. If a category is empty, it notes the gap in `inventory.missing` for the orchestrator to probe naturally.

**Critical:** Drive photos are REFERENCES for image generation — they are NOT the images posted to social. Never mention them as the post content. Full details: [references/drive-workflow.md](references/drive-workflow.md).

## What You Do NOT Do

- Decide when to post (orchestrator).
- Talk to the owner (orchestrator).
- Write prompt patterns from scratch (use food-photography-hermes).
- Invent hook formulas (use social-media-seo-hermes).
- Run analytics or research (marketing-intelligence).
- Post to social platforms directly. Platform posting scripts live next to `generate-slides.js` and are invoked by the orchestrator's post step, not here. If you find yourself calling `post-to-*.js`, stop — you're out of scope.

## Error Handling

- `generate-slides.js` non-zero → retry once → surface to orchestrator with the stderr text.
- `add-text-overlay.js` non-zero (canvas missing) → return raw slides, flag the overlay miss to orchestrator.
- Inventory file missing or corrupt → fall back to txt2img with profile context only.
- Trend report missing → evergreen hook categories only (story-behind-dish, reaction, sourcing).

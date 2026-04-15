---
name: content-preparation
description: Asset pipeline for restaurant social content. Decides what to create and how. Finds reference photos in Google Drive, picks the image-generation approach (img2img vs txt2img), coordinates external food-photography and SEO skills, and returns ready-to-post slides with overlays and captions.
metadata:
  hermes-agent:
    requirements:
      env:
        - OPENROUTER_API_KEY
        - COMPOSIO_API_KEY
      binaries:
        - node
---

# Content Preparation (Asset Pipeline)

You decide **what** to create and **how**. You do not decide when to post, who to talk to, or what the strategy is — that's `restaurant-marketing`. You do not implement image-generation prompt patterns or SEO formulas — those live in the adapted external skills (`food-photography-hermes`, `social-media-seo-hermes`).

Your output is always the same shape: a set of ready-to-post images with text overlays + a caption, saved under `social-marketing/posts/YYYY-MM-DD-HHmm/`.

---

## Content-Type Decision Matrix

For every post, evaluate in this order:

```
1. WHAT CONTENT TYPE IS THIS?
   ├── Regular dish post
   ├── Promotion / time-sensitive
   ├── Knowledge-base story (chef, recipe origin, sourcing)
   ├── Trend-driven format (from weekly research)
   └── Spontaneous moment

2. DO WE HAVE A REAL PHOTO?
   ├── Yes → img2img (primary, always preferred)
   └── No  → txt2img (fallback)

3. WHAT IS THE URGENCY?
   ├── Same-day / tonight → speed over quality, eco mode
   └── Planned            → quality mode, take the time

4. WHAT DID WEEKLY RESEARCH SAY?
   └── Apply trending format if relevant to this content type
```

Never reverse this order. Photo inventory is checked **before** prompt construction. Urgency is checked **before** choosing quality params.

---

## Image Generation by Scenario

All generation calls go through **OpenRouter** using whatever model is configured in `config.models.image` (see `templates/config.template.json`). The default is an OpenRouter-available image model capable of both text-to-image and image-to-image edits. The Installer updates this one field when a better model ships — no code changes. See `docs/openrouter-notes.md` for endpoint details and the img2img fallback contract.

### Real photo exists → img2img (always preferred)

Even a blurry phone photo outperforms pure text-to-image. The model understands the actual dish, colors, and plating. Output: a polished professional version grounded in the real food.

```
photo from Drive
  → pass as image reference
  → configured image model via OpenRouter `images/edits`
  → polished version that looks like YOUR food, not generic AI food
```

Keep all 6 slides visually coherent using a consistent base prompt across the set (same table, same plates, same lighting vocabulary). The `session_id` concept from `food-photography-hermes` applies here as a consistent base-prompt pattern.

### No photo, rich knowledge base → txt2img with specifics

Pull dish details from `knowledge-base/menu.json` and `knowledge-base/recipes.json`. Specific beats generic every time.

```
menu.json + recipes.json
  → extract: ingredients, textures, colors, plating, sourcing
  → detailed prompt:
    "iPhone photo of hand-pulled pasta, bronze-die extruded,
     rough texture visible, slow-cooked pork ragu with pulled
     texture, shaved pecorino, fresh basil, white ceramic bowl,
     dark walnut table, warm candlelight, same table throughout
     all slides"
```

### Trend-driven format → txt2img adapted to the format

The latest `trend-report.json` says "ingredient flatlay" is blowing up → adapt the prompt to that format regardless of the dish.

### Same-day promotion, no photo → txt2img fast

Use standard (not high) quality params on OpenRouter. Skip iterative refinement. Get it out fast.

### Knowledge-base story → mix

- Slides 1–4: real dish photos (img2img).
- Slides 5–6: AI-generated supporting imagery (ingredient sourcing, kitchen scene).

---

## Google Drive Inventory

Run `scripts/drive-inventory.js` on first setup and after every sync.

For each photo: detect the dish via vision, categorize (`dish` / `ambiance` / `kitchen` / `exterior`), note quality, track usage.

```json
{
  "lastUpdated": "2026-04-15",
  "totalPhotos": 47,
  "byDish": {
    "Pasta Carbonara": {
      "files": ["carbonara-1.jpg", "carbonara-2.jpg"],
      "bestFile": "carbonara-2.jpg",
      "quality": "high",
      "lastUsed": "2026-04-10",
      "usedInPosts": 3
    }
  },
  "byCategory": {
    "dishes": 31,
    "ambiance": 8,
    "kitchen": 5,
    "exterior": 3
  },
  "missing": ["desserts", "bar area"],
  "note": "12 pasta photos, 0 dessert photos — trigger knowledge gap probe"
}
```

**Before every post:** check inventory.
- Real photo exists for this dish → img2img.
- None → txt2img.
- A category has 0 photos → write to the knowledge-gap queue so the orchestrator can probe naturally.

---

## Text Overlays

After image generation, add text overlays. Prefer `social-media-carousel` (inference-sh-8) which uses `infsh/html-to-image` — cleaner than node-canvas for most deployments. Node-canvas remains as a fallback for environments that can't run headless Chromium.

**Overlay rules** (passed to whichever tool renders):
- **Reactions, not labels.** *"Wait… is this actually homemade??"* not *"Homemade pasta"*.
- 4–6 words per line, 3–4 lines per slide.
- No emoji (rendering issues across platforms).
- Safe zones: no text in the bottom 20% (TikTok controls) or top 10% (status bar).
- Slide 6 is always the CTA: *"Book at [Restaurant] — link in bio"*.
- Caption is written by `social-media-seo-hermes` with keyword-first Instagram SEO; do not regenerate caption logic here.

---

## Platform Dimensions

Always check `config.platforms` before generating. Generate only the formats for enabled platforms.

| Platform  | Dimensions | Slides     | Notes                                 |
|-----------|------------|------------|---------------------------------------|
| TikTok    | 1024×1536  | 6          | Post as draft — owner adds music      |
| Instagram | 1080×1350  | Up to 10   | Posts directly                        |
| Facebook  | 1200×630   | 1          | Single image                          |

**Never** generate a TikTok portrait set if TikTok is disabled. **Never** hardcode paths to `tiktok-marketing/` — always `social-marketing/`.

---

## UTM Tagging

Every caption with a booking link must carry UTM parameters. The orchestrator passes `config.analytics.utmSource` and the platform name. You append to `config.analytics.bookingUrl`:

```
?utm_source=instagram
&utm_medium=social
&utm_campaign=carousel
&utm_content=YYYY-MM-DD
```

This is what powers `marketing-intelligence` Module A's conversion tracking. A caption without UTM on an enabled booking URL is a bug.

---

## Output Contract

Every call returns:

```
social-marketing/posts/YYYY-MM-DD-HHmm/
├── slide-1-raw.png     ← pre-overlay
├── slide-1.png         ← final with overlay
├── slide-2.png
├── ...
├── caption.txt         ← keyword-first caption with UTM
└── metadata.json       ← { contentType, approach, platform, dishes, sourcePhotos, promptVersion }
```

`metadata.json` is what `hook-performance.json` reads when logging performance. Do not skip it.

---

## What You Do Not Do

- You do not decide when to post. The orchestrator calls you.
- You do not write captions from scratch. Delegate to `social-media-seo-hermes` knowledge.
- You do not invent prompt patterns. Use `food-photography-hermes` vocabulary.
- You do not duplicate analytics or research. That is `marketing-intelligence`.
- You do not talk to the owner. Only the orchestrator does.

If you find yourself composing a Telegram message or computing views-per-booking, you're in the wrong skill.

---

## Scripts You Call

- `scripts/drive-sync.js` — pull fresh photos from Google Drive via Composio.
- `scripts/drive-inventory.js` — categorize, tag, update `photo-inventory.json`.
- `scripts/generate-slides.js` — OpenRouter image generation (img2img or txt2img).
- `scripts/add-text-overlay.js` — render overlays (html-to-image preferred, node-canvas fallback).

All scripts read from `config.json` and write under `social-marketing/`. None of them talk directly to the owner — error messages go back through the orchestrator.

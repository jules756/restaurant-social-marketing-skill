# Post-Type Taxonomy

A daily restaurant feed is not a dish catalog. Real restaurants post about *moments*, *people*, *story*, *neighborhood*, *seasonality*, *behind-the-scenes*, *trends* — the dish is one beat in many possible posts, not the subject of every post.

This file is the taxonomy Hermes (and `auto-post.js`) uses when picking what a post is *about*. The `postType` field flows into the 6-beat blueprint and shifts what slides 3 and 4 contain — slides 1, 2, 5, 6 stay structurally the same.

A healthy feed mixes these types. **Dish-feature posts should be ~30-40% of posts, not 100%.**

---

## The 10 Post Types

### 1. `dish-feature`

A specific dish is the subject. Used when the dish has a story, a season, a moment.

- **When to use**: signature dish you want to amplify, new menu item, dish that performed well historically, a dish with a story (chef's grandmother's recipe, sourced from a specific farm)
- **Slides 3-4**: dish-arrives → the-bite (existing pattern)
- **Refs needed**: dish + venue + character
- **Frequency cap**: max 2 per week

### 2. `vibe-moment`

A specific evening, atmosphere, mood — no dish required. The post sells the *feeling* of the place.

- **When to use**: Friday/Saturday night energy, slow Tuesday mood, holiday week, post-rain warmth
- **Slides 3-4**: a specific moment from the night → a connection moment (people, candlelight, conversation)
- **Refs needed**: venue + character
- **Frequency cap**: max 2 per week
- **Why it works**: most underused post type. Universal — viewers project themselves in.

### 3. `behind-the-scenes`

The work that goes into the meal. Kitchen prep, the chef's morning, ingredient delivery, plating practice.

- **When to use**: weekday daytime posts (people are at work scrolling), trust-building moments, when the team or process is the story
- **Slides 3-4**: the craft moment (hands, motion, kitchen) → the payoff (finished plate or service starting)
- **Refs needed**: venue (kitchen if available) + character (chef, staff)
- **Frequency cap**: max 1-2 per week
- **Why it works**: humans relate to humans. Pulls back the curtain.

### 4. `story`

A narrative — about a recipe's origin, the building's history, why the restaurant exists, a specific tradition.

- **When to use**: when the restaurant has substance worth telling. Pull from `knowledge-base/*.json` (chef story, recipes, sourcing info). Never invent.
- **Slides 3-4**: story illustration 1 (the source — old photo recreation, the place the recipe came from) → story illustration 2 (the present-day execution — the dish today, the chef now)
- **Refs needed**: venue + character; dish optional
- **Frequency cap**: max 1 per week (depth, not volume)
- **Why it works**: bookings follow prestige. Story = prestige.

### 5. `seasonal`

Tied to a specific season, ingredient-arrival, weather, or calendar moment.

- **When to use**: first cold day, first warm day, ingredient peak season, holiday adjacent (1-2 weeks before so people can plan)
- **Slides 3-4**: the seasonal trigger (first frost, first asparagus, first patio table) → the dish or moment that responds to it
- **Refs needed**: venue + character; dish optional
- **Frequency cap**: triggered by calendar/weather, not on a schedule

### 6. `regular`

A specific recurring guest or "their order". Either anonymized ("our Tuesday-night couple") or with explicit consent (named regular).

- **When to use**: when the restaurant has genuine regulars and the owner is comfortable. Excellent for trust + community signal.
- **Slides 3-4**: the regular arriving / their order being prepared → them mid-meal, in their usual spot
- **Refs needed**: venue + character (specific recurring archetype across multiple posts works well)
- **Frequency cap**: max 1-2 per month (rare = special)
- **Sensitivity**: never use without explicit owner OK; never name without consent.

### 7. `neighborhood`

The restaurant in the context of its location — the block, the street, the local landmark, the city itself.

- **When to use**: tourist-heavy weeks, when the neighborhood has news, when discovery is the goal (new audience that doesn't know the area)
- **Slides 3-4**: local landmark or street scene → the restaurant within that context (window-lit at dusk, your awning above your block)
- **Refs needed**: venue (exterior + interior) + character optional; no dish required
- **Frequency cap**: max 1 per week
- **Why it works**: helps with local SEO + makes the restaurant feel placed in a real geography.

### 8. `promo`

An active promotion. Bias toward this when one is running.

- **When to use**: when `~/social-marketing/promotions/<active>.json` exists and is in window. Coordinate with the promo calendar (teaser → launch → mid-run → last-chance).
- **Slides 3-4**: the promo dish or element → people enjoying the promo (or the calendar/urgency angle if it's a last-chance post)
- **Refs needed**: dish (if applicable) + venue + character
- **Frequency cap**: per the promo's own calendar, not the global cap

### 9. `trend-driven`

A trending format from the latest `trend-report.json`. Adapted to this restaurant.

- **When to use**: when `trend-report.json` has a format flagged `testNext: true` AND it fits the restaurant's voice. Don't force a trend that doesn't suit them.
- **Slides 3-4**: trend execution shot 1 → trend execution shot 2 (depends on the trend — could be a meme format, a transition, a specific composition)
- **Refs needed**: depends on the trend
- **Frequency cap**: max 1 per week (trends burn out fast; don't be the restaurant chasing every one)

### 10. `event`

A specific event happening at the restaurant — guest chef, tasting menu night, collaboration, holiday menu drop.

- **When to use**: when an event is on the calendar (typically `restaurant-profile.json.events[]` or surfaced through the conversation with the owner). Promote 7 + 3 + 1 days out.
- **Slides 3-4**: event setup or arrival → event in full swing
- **Refs needed**: venue + character + (if relevant) the event-specific element
- **Frequency cap**: per the event timing, not the global cap

---

## How Hermes Picks a Post Type

Order of priority for `auto-post.js` and the manual `/post` flow:

1. **Active promo?** Bias toward `promo` if one is in-window (check `promotions/*.json` for active ones).
2. **Active event in the next 7 days?** Bias toward `event` for at least 1 of the 3 lead-up posts.
3. **Cold start (zero or near-zero post history)?** Default sequence: `vibe-moment` → `dish-feature` → `behind-the-scenes` → `story` → `vibe-moment`. Establishes visual identity before going deep.
4. **Otherwise** — pick from the available types weighted by:
   - Recent post-type history (avoid back-to-back same type; never 3 of the same type in 5 posts)
   - Day of week / time (Tuesday lunch ≈ `solo-lunch-pause` scenario which works for `vibe-moment` or `behind-the-scenes`; Friday night ≈ scenarios that pair with `dish-feature` or `vibe-moment`)
   - Season / weather triggers
   - What's underserved in the recent feed (if last 5 posts had no `behind-the-scenes`, weight it higher)

## The Healthy Mix (over 14 days)

For a restaurant posting daily, a healthy 14-post mix looks roughly like:

| Type | Count | %  |
|---|---|---|
| `dish-feature` | 4-5 | 30-35% |
| `vibe-moment` | 3-4 | 21-28% |
| `behind-the-scenes` | 2 | 14% |
| `story` | 1-2 | 7-14% |
| `neighborhood` | 1-2 | 7-14% |
| `seasonal` / `regular` / `promo` / `trend-driven` / `event` | 0-2 | 0-14% (varies) |

`auto-post.js` doesn't enforce these ratios with hard caps — it weights its choice each day. The 7-day repetition guards (no same dish twice in 7 days, no same scenario twice in 7 days, no same postType 3× in 5 posts) handle most of it.

## Cold-Start Defaults

For restaurants with zero post history, override the weighted picker with this fixed sequence for the first 5 posts:

1. `vibe-moment` — establishes the visual identity (place + people, no dish required)
2. `dish-feature` — first signature dish (introduces the food)
3. `behind-the-scenes` — pulls back the curtain (humanizes the team)
4. `story` — the narrative differentiator (the why)
5. `vibe-moment` — variant of #1 (consolidates the look)

After 5 posts, the weighted picker takes over.

## What This Replaces

In the previous design, `auto-post.js` rotated through `restaurant-profile.signatureDishes` and asked Hermes to write a post *about that dish*. That produced dish-catalog feeds — every post anchored on a specific food item, no breathing room for vibe/story/place posts.

The new model: the LLM picks a `postType` first, picks a `dish` only if `postType === 'dish-feature'` (or the chosen type benefits from one), and the 6-beat blueprint adapts. Slides 1, 2, 5, 6 stay the same regardless. Slides 3 and 4 shift per the table in `content-preparation/SKILL.md`.

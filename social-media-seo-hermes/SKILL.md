---
name: social-media-seo-hermes
description: Hook library, caption patterns, and Instagram/TikTok SEO heuristics for restaurant social content. Load when writing hooks (slide 1 text), captions, CTAs, or deciding what angle a post should take. Includes 100+ embedded hook patterns grouped by category, with restaurant-specific examples and engagement signals.
---

# Social Media SEO for Restaurants

Hook library + caption heuristics for Instagram and TikTok restaurant content. This skill is a knowledge reference — no API calls. Load it when writing slide-1 text, captions, or choosing an angle. Used by the [restaurant-marketing orchestrator](../../skills/restaurant-marketing/SKILL.md) and [content-preparation](../../skills/content-preparation/SKILL.md).

## How to Use This Skill

When writing a post's hook (slide 1 text):

1. Read `restaurant-profile.json` and any prior `memory` entries for what this restaurant's hooks have done.
2. Pick a category from the library below that fits the content type (regular dish post, promo, knowledge-base story, etc.).
3. Write 2-3 hook variants in that category's pattern. Use the restaurant's voice, not the template's.
4. If a trend report exists (`~/social-marketing/trend-report.json`), bias toward hook formats flagged as trending.
5. After posting, log the chosen hook + category to `memory` so future runs know what's been tried and what worked.

## Hook Library

100+ patterns across 12 categories with engagement signals: [references/hooks.md](references/hooks.md). Load when selecting a hook for a post.

## Caption Heuristics

### Instagram: keyword-first

The first 125 characters are indexable. Lead with what the post is about in plain language, not with the hook. Hook belongs on slide 1 as visual text.

**Good:**
> *"Hand-pulled rigatoni with slow-cooked pork ragu — bronze-die extruded, simmered 6 hours. Book at [Restaurant], link in bio. [City]'s best pasta [hook continues]…"*

**Bad:**
> *"You won't BELIEVE what happened in our kitchen today [keywords buried on line 9]"*

### TikTok: hook-first

Opposite of Instagram. TikTok's algorithm weights the first few words heavily for retention. Hook hard, keyword later.

### CTA (slide 6 + caption end)

Every post ends with a booking CTA. Variants, placement rules, UTM convention: [references/ctas.md](references/ctas.md).

## Hashtag Strategy

- 3-5 hyper-specific hashtags (neighborhood, cuisine, dish): `#gamlaStanPasta`, `#stockholmItalian`, `#bolognesestockholm`
- 3-5 mid-tail (category): `#italianfood`, `#freshpasta`, `#stockholmrestaurants`
- **Skip mega hashtags** (>10M posts like `#foodporn`, `#instafood`). They bury small accounts.
- Max 10 hashtags total. More looks spammy.

## SEO Keyword Seeds for Restaurants

Load a full list from [references/keywords.md](references/keywords.md). Top-level seeds:

- `{cuisine} restaurant {city}` — core geo SEO
- `best {dish} {city}` — high-intent
- `{city} {meal occasion}` — "stockholm date night", "gamla stan lunch"
- `{cuisine} near me` — local intent (don't use `near me` in captions, but target the entity)

## Engagement Signals (What We Track)

For every post, `memory` records:

- `hookCategory` — which category we pulled from
- `hookText` — the exact slide-1 text we wrote
- `dish` — what food
- `platform` — ig / tiktok / fb
- `viewsDelta` — vs the restaurant's rolling average
- `bookingsDelta` — tied to this post via UTM + 48h window
- `approach` — img2img vs txt2img (perf differs)

After 20+ posts, patterns emerge: which categories work for this specific restaurant. Feed that back into hook selection on the next post.

## Never

- Use a hook pattern literally — always rewrite in the restaurant's voice.
- Write a generic hook like *"Come try our amazing pasta!"*. Specific > generic, always.
- Put the CTA in slide 1. CTA is slide 6. Slide 1 is the stop-scroll hook.
- Use hashtags that don't match the content. `#foodporn` on a quiet chef-story post is noise.

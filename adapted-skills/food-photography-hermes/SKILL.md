---
name: food-photography-hermes
description: Knowledge-only adaptation of the eachlabs food-photography-generation skill. Provides prompt patterns, lighting presets, and food photography vocabulary for AI image generation. All API calls are stripped — generation goes through OpenRouter in content-preparation.
metadata:
  hermes-agent:
    requirements:
      env: []
      binaries: []
---

# Food Photography (Hermes Adaptation)

**This is a knowledge document, not an execution skill.** No API keys beyond what `restaurant-marketing` already requires. All actual image generation goes through `content-preparation` → OpenRouter → whatever model the Installer set in `config.imageGen.model`.

**Upstream source:** https://skills.sh/eachlabs/skills/food-photography-generation

**What was adapted from upstream:**
- Strip all `eachlabs` API call patterns and endpoints.
- Keep the prompt engineering vocabulary, lighting presets, and style anchors.
- Re-map the `session_id` consistency concept to "consistent base prompt across all slides of a carousel" for OpenRouter.

---

## What This Skill Provides

Vocabulary and prompt scaffolding for `content-preparation` to use when building either img2img or txt2img prompts.

### Camera / Realism Anchors

Include at least one of these in every prompt to avoid generic AI look:

- `iPhone photo of …` — the single most effective realism anchor.
- `taken on iPhone 15 Pro`
- `natural lighting, warm ambient tones`
- `candid phone photography, slight motion blur`
- `shot through a restaurant window, soft reflections`

### Lighting Presets

| Preset           | Vocabulary                                                  |
|------------------|-------------------------------------------------------------|
| Cozy candlelit   | warm amber glow, long shadows, golden highlights            |
| Bright & fresh   | natural daylight, soft white, airy, window-lit              |
| Rustic           | warm tungsten, uneven light, honey tones, kitchen warmth    |
| Sleek / modern   | cool neutrals, directional spot, clean shadows              |
| Late-night bar   | neon accents, blue-red contrast, low-key ambient            |

Pick one per restaurant based on `config.restaurant.vibe` and lock it into the base prompt.

### Plating / Texture Vocabulary

- Surfaces: `white ceramic bowl`, `dark walnut table`, `slate board`, `copper pan`, `rustic wooden cutting board`.
- Textures: `rough hand-pulled texture`, `blistered crust`, `glistening sauce`, `charred edges`, `soft pillowy dough`.
- Garnish: `shaved pecorino`, `micro basil`, `flaked sea salt`, `a single fresh basil leaf`.

Specificity beats quantity. *"Hand-pulled rigatoni with slow-cooked pork ragu, shaved pecorino, fresh basil on a white ceramic plate"* always outperforms *"a nice pasta"*.

### Consistency Across a 6-Slide Set

The upstream `session_id` concept becomes: **all 6 slides share the exact same base description; only the dish / angle / action changes.** Lock these in the base prompt:

- Same table or surface.
- Same plateware family.
- Same lighting direction.
- Same background (e.g. exposed brick, dark velvet curtain, open kitchen).

Slides that look like different restaurants break the narrative and kill completion rate.

### What NOT to Put in Prompts

- No `text`, `watermark`, `logo`.
- No emoji characters.
- Avoid vague descriptors (`nice`, `delicious`, `tasty`).
- Avoid overbaked adjectives (`mouthwatering`, `to-die-for`).

---

## Integration

`content-preparation` references this vocabulary when building prompts. Nothing in this skill makes API calls — if you see code here that does, remove it.

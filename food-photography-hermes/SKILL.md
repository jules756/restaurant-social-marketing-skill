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

**This is a knowledge document, not an execution skill.** No API keys beyond what `restaurant-marketing` already requires. All actual image generation goes through `content-preparation` → Composio MCP → `gpt-image-2` (the OpenAI credential lives in the Composio project).

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

### Documentary / Lifestyle Vocabulary (the most important section)

**The biggest mistake AI food gen makes is producing sterile product photography — six identical hero shots of the dish on a clean table with nobody around.** That kills the carousel. Real restaurant content tells a story with people in it. Use this vocabulary to push generations toward documentary food photography, not catalog photography.

#### Anchors to use on every non-dish slide

- `documentary food photography, candid moment`
- `lifestyle composition, real moment in motion`
- `phone snapshot from a real dinner, not staged`
- `subjects in motion, slight motion blur`
- `humans in the frame — hands, body language, faces partial`
- `crops imply the rest of the scene — leave space for context`

#### How to handle people

- **Faces can be partial, blurred, three-quarter, over-shoulder, or out-of-frame.** Hands and body language carry the emotion; you do not need a sharp front-facing face. AI gen also tends to produce uncanny faces — partial faces are both more cinematic *and* lower-risk.
- *"Two people seated at the table, one mid-laugh, faces softly out of focus, hands holding wine glasses, candlelight"* — this works.
- *"Two people smiling at the camera"* — this fails (uncanny, staged, dead).
- Specify number of people, age range, outfit register, posture. Don't specify exact features.

#### What goes WHERE in a 6-slide carousel

| Slide | What's in the frame | Dish present? | Humans? |
|---|---|---|---|
| 1 — hook | Anything that earns the swipe (object, character pre-context, place, detail, text-led — see [social-media-seo-hermes/references/hook-archetypes.md](../social-media-seo-hermes/references/hook-archetypes.md)) | Optional, usually no | Optional |
| 2 — scene-set | Wide shot of the dining room with the characters seated | No | **Yes — required** |
| 3 — dish-arrives | The dish landing on the table, server's hand visible, characters' faces lighting up | **Yes — the moment** | Yes (hands + reaction) |
| 4 — the-bite | First-bite moment, fork twirl, candid mid-action | Yes (mid-eating, partial) | **Yes — required** |
| 5 — connection | Mid-conversation, leaning in, candlelight; **dish off-frame or blurred in foreground** | No | **Yes — required** |
| 6 — outro / CTA | Exterior at the right time of day, OR aftermath (empty plate, candle burning down, paid bill) | Optional (empty plate OK) | Optional |

**Only slides 3 and 4 are dish-focused.** Five out of six slides are about the *experience*, the *place*, the *people*. This is what real restaurant Instagram does — the dish is a beat in the story, not the subject.

#### Anti-patterns (never use these)

- `professional food photography` — produces sterile catalog shots
- `studio lighting` — wrong; restaurants have ambient lighting
- `food on white background` — kills the venue context
- `top-down flat lay` — overused, signals "Pinterest food blog"
- `photorealistic` alone, with no human/motion anchor — defaults to product shots

### What NOT to Put in Prompts

- No `text`, `watermark`, `logo`.
- No emoji characters.
- Avoid vague descriptors (`nice`, `delicious`, `tasty`).
- Avoid overbaked adjectives (`mouthwatering`, `to-die-for`).

---

## Integration

`content-preparation` references this vocabulary when building prompts. Nothing in this skill makes API calls — if you see code here that does, remove it.

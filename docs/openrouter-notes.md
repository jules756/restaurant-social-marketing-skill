# OpenRouter Notes

Working notes on OpenRouter quirks that affect this skill suite. Update as we learn.

## All models are config-driven

Every model used by this suite is declared in `config.models.*` in `social-marketing/config.json`. To swap a model, edit config — do not touch scripts.

| Config key             | Used by                              | Default (update as needed)                |
|------------------------|--------------------------------------|-------------------------------------------|
| `config.models.image`  | `scripts/generate-slides.js`         | `google/gemini-2.5-flash-image-preview`   |
| `config.models.vision` | `scripts/drive-inventory.js`         | `openai/gpt-4o-mini`                      |
| `config.models.chat`   | orchestrator conversational replies  | `anthropic/claude-3.5-sonnet`             |
| `config.models.caption`| caption writing (SEO skill)          | `anthropic/claude-3.5-sonnet`             |
| `config.models.research`| weekly trend + competitor synthesis | `anthropic/claude-3.5-sonnet`             |

Browse the live catalog at https://openrouter.ai/models before changing a value — only models listed there work.

## Endpoints Used

| Endpoint                                                 | Used by                              |
|----------------------------------------------------------|--------------------------------------|
| `GET  /api/v1/models`                                    | `scripts/setup.js` (catalog check)   |
| `POST /api/v1/chat/completions`                          | `scripts/drive-inventory.js` (vision) |
| `POST /api/v1/images/generations`                        | `scripts/generate-slides.js` (txt2img) |
| `POST /api/v1/images/edits`                              | `scripts/generate-slides.js` (img2img) |

## img2img Availability

Not every image model on OpenRouter supports the `images/edits` endpoint. Behavior in this code:

1. `generate-slides.js` attempts `images/edits` when a reference photo is selected from Drive inventory.
2. If OpenRouter returns an error (model doesn't support the endpoint, or the endpoint is unavailable), the script logs a warning and falls back to `images/generations` (txt2img) for that slide. The post is never blocked.
3. If img2img is consistently failing, the fallback noise in logs will surface it. At that point either swap to a model that supports edits (e.g. Gemini image models do; some Flux variants do not) or live with txt2img.

To test img2img availability end-to-end, run a single-slide generate with `--dish` pointing at a dish that has a `bestFile` in `photo-inventory.json`.

## Headers

All OpenRouter calls set:

```
Authorization: Bearer $OPENROUTER_API_KEY
HTTP-Referer: https://akira-agent.com
X-Title: restaurant-social-marketing
```

The `HTTP-Referer` and `X-Title` are not functionally required.

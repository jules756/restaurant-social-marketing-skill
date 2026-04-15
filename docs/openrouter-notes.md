# OpenRouter Notes

Working notes on how this skill suite uses OpenRouter.

## Scope

This suite uses OpenRouter **only for image generation**. Chat, caption writing, and trend / competitor research all run on Hermes's configured model — they do not go through OpenRouter from this code.

Vision classification in `drive-inventory.js` is an internal implementation detail of the image pipeline; it uses a default vision model and is not surfaced in config.

## Configurable Image Model

| Config key               | Used by                       | Default                                   |
|--------------------------|-------------------------------|-------------------------------------------|
| `config.imageGen.model`  | `scripts/generate-slides.js`  | `google/gemini-2.5-flash-image-preview`   |

Swap by editing `social-marketing/config.json`. Browse the live catalog at https://openrouter.ai/models — only models listed there work.

## Endpoints Used

| Endpoint                                                 | Used by                              |
|----------------------------------------------------------|--------------------------------------|
| `GET  /api/v1/models`                                    | `scripts/setup.js` (catalog check)   |
| `POST /api/v1/chat/completions`                          | `scripts/drive-inventory.js` (internal vision classification) |
| `POST /api/v1/images/generations`                        | `scripts/generate-slides.js` (txt2img) |
| `POST /api/v1/images/edits`                              | `scripts/generate-slides.js` (img2img) |

## img2img Availability

Not every image model on OpenRouter supports the `images/edits` endpoint. Behavior:

1. `generate-slides.js` attempts `images/edits` when a reference photo is selected from Drive inventory.
2. If OpenRouter returns an error (model doesn't support the endpoint, or the endpoint is unavailable), the script logs a warning and falls back to `images/generations` (txt2img) for that slide. The post is never blocked.
3. If img2img is consistently failing, either swap to a model that supports edits (Gemini image models do; some Flux variants do not) or live with txt2img.

Test img2img end-to-end by running a single-slide generate with `--dish` pointing at a dish that has a `bestFile` in `photo-inventory.json`.

## Headers

All OpenRouter calls set:

```
Authorization: Bearer $OPENROUTER_API_KEY
HTTP-Referer: https://akira-agent.com
X-Title: restaurant-social-marketing
```

The `HTTP-Referer` and `X-Title` are not functionally required.

# OpenRouter Notes

Working notes on OpenRouter quirks that affect this skill suite. Update as we learn.

## Endpoints Used

| Endpoint                                                 | Used by                              |
|----------------------------------------------------------|--------------------------------------|
| `GET  /api/v1/models`                                    | `scripts/setup.js` (catalog check)   |
| `POST /api/v1/chat/completions`                          | `scripts/drive-inventory.js` (vision, `openai/gpt-4o-mini`) |
| `POST /api/v1/images/generations`                        | `scripts/generate-slides.js` (txt2img) |
| `POST /api/v1/images/edits`                              | `scripts/generate-slides.js` (img2img) |

## Image Model

**Always `openai/gpt-image-1.5`.** Never `openai/gpt-image-1` — the quality delta is large enough that it's worth blocking the script from running with the older model (see `generate-slides.js` guard).

## img2img Availability

OpenRouter's `images/edits` endpoint support for `openai/gpt-image-1.5` has been flagged in the PRD as "verify before building." Behavior in this code:

1. `generate-slides.js` attempts `images/edits` when a reference photo is selected from Drive inventory.
2. If OpenRouter returns an error (model doesn't support the endpoint, or the endpoint is unavailable), the script logs a warning and falls back to `images/generations` (txt2img) for that slide. The post is never blocked.
3. If img2img is consistently failing, the fallback noise in logs will surface it — at that point switch to direct OpenAI `images/edits` as the explicit fallback for img2img only (keep everything else on OpenRouter).

To test img2img availability end-to-end, run a single-slide generate with `--dish` pointing at a dish that has a `bestFile` in `photo-inventory.json`.

## Headers

All OpenRouter calls set:

```
Authorization: Bearer $OPENROUTER_API_KEY
HTTP-Referer: https://akira-agent.com
X-Title: restaurant-social-marketing
```

The `HTTP-Referer` and `X-Title` are not functionally required.

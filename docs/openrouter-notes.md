# OpenRouter Notes

Working notes on how this skill suite uses OpenRouter.

## Scope

This suite uses OpenRouter **only for image generation**. Chat, caption writing, and trend / competitor research all run on Hermes's configured model — they do not go through OpenRouter from this code.

Vision classification in `drive-inventory.js` is an internal implementation detail of the image pipeline; it uses a default vision model and is not surfaced in config.

## Configurable Image Model

| Config key               | Used by                       | Default                                   |
|--------------------------|-------------------------------|-------------------------------------------|
| `config.imageGen.model`  | `scripts/generate-slides.js`  | `google/gemini-2.5-flash-image-preview`   |

Swap by editing `social-marketing/config.json`. Browse the live catalog at https://openrouter.ai/models — only models listed there with an image output modality work.

## How Image Generation Works

Both txt2img and img2img go through the **chat completions endpoint with image modality output** — the native format for Gemini image models on OpenRouter. The OpenAI-style `/images/generations` and `/images/edits` endpoints are NOT used by this code.

| Endpoint                                                 | Used by                              |
|----------------------------------------------------------|--------------------------------------|
| `GET  /api/v1/models`                                    | `scripts/setup.js` (catalog check)   |
| `POST /api/v1/chat/completions`                          | `scripts/generate-slides.js` (txt2img + img2img) and `scripts/drive-inventory.js` (internal vision classification) |

Request shape for txt2img:

```json
{
  "model": "google/gemini-2.5-flash-image-preview",
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "<prompt>" }] }
  ],
  "modalities": ["image", "text"]
}
```

For img2img, the reference photo is attached as a second content part:

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<prompt>" },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
      ]
    }
  ],
  "modalities": ["image", "text"]
}
```

Aspect ratio (portrait 9:16 for TikTok, portrait 4:5 for Instagram, landscape 16:9 for Facebook) is hinted **inside the prompt text**, not via a `size` parameter — chat-completions image models don't accept one.

## Response Parsing

OpenRouter's image-modality response shape varies slightly between providers. `generate-slides.js` probes three shapes in order:

1. `message.images[0].image_url.url` as a `data:image/...;base64,...` URL.
2. `message.content[]` containing an `image_url` part with a data URL.
3. `message.content` as a string containing an embedded `data:image/...;base64,...` URL.

First match wins. If none matches, the script errors out clearly — usually indicating the configured model doesn't support the image output modality.

## Swapping Models

If `google/gemini-2.5-flash-image-preview` stops working or a better one ships:

1. Browse https://openrouter.ai/models and filter for image-output models.
2. Update `config.imageGen.model` in `social-marketing/config.json`.
3. Re-run `scripts/setup.js --config social-marketing/config.json` to confirm the new model is in the OpenRouter catalog.

No code changes required — the script is model-agnostic within the chat-completions-with-image-modality family.

## Headers

All OpenRouter calls set:

```
Authorization: Bearer $OPENROUTER_API_KEY
HTTP-Referer: https://akira-agent.com
X-Title: restaurant-social-marketing
```

The `HTTP-Referer` and `X-Title` are not functionally required.

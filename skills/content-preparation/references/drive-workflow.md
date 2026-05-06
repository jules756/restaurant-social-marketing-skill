# Drive Workflow

The restaurant's owner drops photos into a Google Drive folder (default name: `akira-agent_src`). Our pipeline uses them as **reference material** for image generation — the model re-interprets them in the restaurant's style, producing posts that look like the actual food without being copies.

## Sync

```bash
node ~/restaurant-social-marketing-skill/scripts/drive-sync.js --config ~/social-marketing/config.json
```

What it does:
1. Connects to Drive via the Composio SDK using `config.composio.{apiKey, userId}`.
2. Lists files in the folder (auto-creates the folder if missing — matches the client onboarding flow).
3. Downloads each new image to `~/social-marketing/photos/unsorted/`.
4. Appends file metadata to `~/social-marketing/photos/drive-index.json`.

Idempotent — re-running only pulls new files.

## Inventory (vision classification)

```bash
node ~/restaurant-social-marketing-skill/scripts/drive-inventory.js --config ~/social-marketing/config.json
```

What it does:
1. For each photo in `drive-index.json` without a `category`, sends it to a vision tool over Composio MCP (the OpenAI credential lives in the Composio project — no key on the VM).
2. Classifies each into `dish` / `ambiance` / `kitchen` / `exterior`, extracts `dishName` when the menu matches, scores quality (`high|medium|low`).
3. Moves each file from `unsorted/` to the matching subdirectory.
4. Writes the aggregated inventory to `~/social-marketing/photo-inventory.json`.

Pass `--full` to re-classify every photo (useful if the menu changed or a new dish was added).

## Inventory Schema

```json
{
  "lastUpdated": "2026-04-15",
  "totalPhotos": 47,
  "byDish": {
    "Bolognese": {
      "files": ["bolognese-1.jpg", "bolognese-2.jpg"],
      "bestFile": "bolognese-2.jpg",
      "quality": "high",
      "lastUsed": "2026-04-10",
      "usedInPosts": 3
    }
  },
  "byCategory": {
    "dish": 31,
    "ambiance": 8,
    "kitchen": 5,
    "exterior": 3
  },
  "missing": ["desserts", "bar area"],
  "note": "12 pasta photos, 0 dessert photos — trigger knowledge gap probe"
}
```

`content-preparation` reads this on every post to decide img2img vs txt2img. The orchestrator reads `missing` to probe for gaps (via the knowledge-gap flow).

## Rules

- Drive photos are **references**, never post content. Never say *"I'll post your photos"* — wrong model. Always *"I'll use them as references to generate posts that look like your food"*.
- If the folder is empty, that's fine — the pipeline falls back to txt2img with profile + knowledge-base context. Prompt the owner naturally to add photos when they have time, but never block posting on it.
- Inventory write-back is non-destructive — it only adds/updates entries.

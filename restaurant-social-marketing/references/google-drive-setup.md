# Google Drive Photo Integration

## Overview

Restaurant owners share a Google Drive folder with photos of their restaurant, dishes, kitchen, and events. The AI can browse these photos and use them in posts — either instead of or alongside AI-generated images.

## Setup for Restaurant Owners

### Step 1: Create a Photo Folder in Google Drive

Create a folder in Google Drive and organize it with subfolders:

```
Restaurant Photos/
  dishes/          — Close-ups of individual dishes
  ambiance/        — Interior shots, table settings, lighting
  kitchen/         — Kitchen action, chef at work, prep
  exterior/        — Storefront, outdoor seating, signage
  events/          — Special events, busy nights, celebrations
  team/            — Staff photos, chef portraits
```

### Step 2: Add Photos

Drop photos into the appropriate subfolders. Tips:
- **Phone photos are fine** — they look authentic on TikTok/Instagram
- **Portrait orientation preferred** (for TikTok) but landscape works too
- **Good lighting matters** — natural light or warm ambient lighting
- **Show food at its best** — plated, with steam if hot, sauce glistening
- **Include context** — don't just show the dish, show it on the table with the restaurant in the background

### Step 3: Connect via Composio

In the Composio dashboard:
1. Go to Toolkits -> Google Drive -> Connect
2. Authorize access to your Google Drive
3. Note the `connected_account_id` (format: `ca_xxxxx`)
4. Add it to your config under `composio.connectedAccounts.googledrive`

### Step 4: Configure

Add to `tiktok-marketing/config.json`:
```json
{
  "googleDrive": {
    "enabled": true,
    "folderId": "the-folder-id-from-the-url",
    "localCachePath": "tiktok-marketing/photos/"
  },
  "composio": {
    "connectedAccounts": {
      "googledrive": "ca_gdrive_xxxxx"
    }
  }
}
```

The folder ID is in the Google Drive URL: `https://drive.google.com/drive/folders/{THIS_IS_THE_FOLDER_ID}`

### Step 5: Sync Photos

Run:
```bash
node scripts/google-drive-sync.js --sync --config tiktok-marketing/config.json
```

This downloads all images to the local cache and creates a `photo-index.json` for fast lookup.

## How the AI Uses Photos

### Provider Options in generate-slides.js

| Provider | Behavior |
|----------|----------|
| `openai` | All slides are AI-generated using gpt-image-1.5 |
| `local` | All slides come from local files (user places them manually) |
| `googledrive` | All slides come from the synced Google Drive cache |
| `mixed` | Some slides use real photos, others are AI-generated |

### Mixed Mode (Recommended for Restaurants)

The `mixed` provider is ideal because:
- **Real photos** of your actual dishes are more authentic
- **AI-generated images** fill gaps (dishes not yet photographed, specific angles, atmospheric shots)
- The AI picks the best source for each slide based on what's available

### Photo Tagging

After syncing, tag photos so the AI can find the right ones:

```bash
# Tag manually
node scripts/google-drive-sync.js --tag --config config.json --photo gdrive_id --tags "dish,carbonara,pasta,closeup"

# The AI can also auto-tag photos by analyzing them
node scripts/google-drive-sync.js --auto-tag --config config.json
```

### Linking Photos to Menu Items

When a photo is tagged with a dish name that matches a menu item in the knowledge base, the `menuItemId` field is populated. This lets the AI:
- Find the real photo of a specific dish when creating a post about it
- Know which dishes have real photos and which need AI generation
- Prioritize real photos during promotions (authenticity matters more when selling)

## Photo Index

The sync creates `tiktok-marketing/photos/photo-index.json`:

```json
{
  "lastSynced": "2026-04-08T10:00:00Z",
  "folderId": "google-drive-folder-id",
  "photos": [
    {
      "fileId": "gdrive_file_id_123",
      "name": "carbonara-closeup.jpg",
      "localPath": "tiktok-marketing/photos/carbonara-closeup.jpg",
      "mimeType": "image/jpeg",
      "tags": ["dish", "pasta", "carbonara", "closeup"],
      "menuItemId": "carbonara",
      "description": "Close-up of carbonara with visible egg yolk and guanciale",
      "usedInPosts": [],
      "addedAt": "2026-04-08T10:00:00Z"
    }
  ]
}
```

## Tips for Great Restaurant Photos

### Food Photography
- Shoot from **slightly above** (45-degree angle) — most appetizing angle
- Use **natural light** whenever possible (near a window)
- Include **texture details** — sauce drips, steam, cheese pulls, crispy edges
- Show **human elements** — a hand holding a fork, breaking bread, pouring wine
- Include **props** — wine glass, napkin, breadbasket — makes it feel like a real meal

### Ambiance Photography
- Shoot during **golden hour** or with the restaurant's actual lighting
- Capture **empty tables set for service** — the "before guests arrive" moment
- Show **cozy details** — candles, flowers, exposed brick, soft lighting
- Include the **bar** or **open kitchen** if you have one

### Kitchen Photography
- Action shots: **flames, steam, chopping, plating**
- Chef's hands at work — more personal than a posed portrait
- Fresh ingredients laid out — shows the quality of what goes into the food
- The pass (where dishes are sent out) — dramatic lighting often looks great

## Troubleshooting

**"No photos found in folder"**
- Check the folder ID is correct (from the Drive URL)
- Ensure the Composio Google Drive connection is active
- Verify the folder contains images (not just subfolders)

**"Permission denied"**
- The Google account connected in Composio must have access to the folder
- If the folder is in someone else's Drive, they need to share it

**"Photos look bad on TikTok"**
- TikTok uses portrait (1024x1536). If your photos are landscape, the AI will need to crop or use AI generation instead
- Tag photos with aspect ratio suitability: `portrait`, `landscape`, `square`

**"Sync is slow"**
- Large folders take time on first sync. Subsequent syncs only download new files
- Consider organizing into subfolders so the AI only syncs what's needed

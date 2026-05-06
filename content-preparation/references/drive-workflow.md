# Drive Workflow

The owner organizes their Google Drive into **two folders**:

- **One folder for dish photos.** Filenames matter — name them after the dish (`carbonara-1.jpg`, `cacio-pepe-tuesday.jpg`) so the skill can match a photo to a requested post.
- **One folder for venue photos.** Dining room, exterior, bar, kitchen — anything that shows what the place looks like. Filenames don't matter here; the script picks one at random per post for variety.

Folder names can vary by language and habit. The skill auto-detects names matching common patterns:

- **Dishes folder**: `dishes`, `food`, `plats`, `plates`, `menu`, `cuisine`, `dish-photos`, `food-photos` (case-insensitive)
- **Venue folder**: `venue`, `place`, `lieu`, `salle`, `decor`, `restaurant`, `interior`, `ambiance`, `space`, `room`, `dining-room`, `venue-photos` (case-insensitive)

Resolution is cached in `config.googleDrive.resolvedFolders` after the first sync — subsequent runs skip the lookup. Pass `--refresh-folders` to re-detect (e.g. if the owner renamed a folder).

## Sync (on-demand, per post)

```bash
node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/drive-sync.js \
  --config $HOST_AGENT_HOME/social-marketing/config.json \
  --dish "Carbonara"
```

What it does:
1. Resolves the Drive root folder (`config.googleDrive.folderName`).
2. Auto-detects the dish + venue subfolders inside it.
3. Lists images in each subfolder.
4. Downloads new ones (skips files already cached, keyed by Drive file ID).
5. Filters dish photos by `--dish "<name>"` using fuzzy filename matching.
6. Writes `photos/last-sync.json` with absolute paths to `venuePhotos[]` and `dishPhotos[]`.

`generate-slides.js` reads `last-sync.json` to pick references per slide:
- One venue photo (random pick from the available pool — varies across posts) for slides 2–6
- One dish photo (matched to `--dish`) for slides 3 and 4

## Hard Rules

- **Venue photos are required.** If `last-sync.json` has zero venue photos, `generate-slides.js` exits with code 2 ("missing-venue-refs"). The orchestrator catches this and asks the owner to add venue photos. **The skill never proceeds to generation without venue references.**
- **Dish photos are best-effort.** If no dish photo matches the requested dish name, the script falls back to any dish photo in the folder. If the dishes folder is empty entirely, slides 3–4 generate from text alone — degraded quality but not a hard fail.
- **Drive photos are REFERENCES only.** They are not posted. The orchestrator's owner-facing language: *"I'll use them as references to generate posts that look like your space and your food"* — never *"I'll post your photos"*.

## Why On-Demand, Not Cron

Photos in a restaurant's Drive don't change every 30 minutes. Cron syncing is wasted work. Sync when actually generating: the cost is paid once per post, the latest photos are always picked up before generation, and there's no stale-cache problem.

## One-Time Setup (Per Restaurant)

```bash
node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/drive-sync.js \
  --config $HOST_AGENT_HOME/social-marketing/config.json \
  --refresh-folders
```

Run once after the owner shares their Drive folder. This:
1. Confirms the agent's Composio Google Drive connection works.
2. Detects and persists the dish + venue subfolder IDs.
3. Reports which subfolders were found.

If a subfolder is missing, the orchestrator asks the owner to create one with a recognized name.

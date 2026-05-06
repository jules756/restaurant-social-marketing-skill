# Optimization Plan: Akira Social Marketing Pipeline
## Session: May 6, 2026 | Honest post-mortem + fixes needed

---

## PART A: WHAT WAS ACTUALLY SLOW (Performance Bottlenecks)

### 1. Sequential Image Generation (Biggest)
**Where:** `generate-slides.js`, lines 278–295
**Problem:** Plain `for` loop generating 6 slides one at a time via gpt-image-2. Each image takes ~20–60s. ×6 = 2–6 min wall-clock.
**Fix:** Parallelize with `Promise.all()` or `p-limit(3)` for rate-limit safety. Should drop to ~60–90s total.

### 2. Double Image Generation During Post (Second Biggest)
**Where:** `post-to-instagram.js`, lines 91–109 (`getS3KeyForSlide()`)
**Problem:** I re-generate images via `OPENAI_CREATE_IMAGE` to get Composio S3 keys for Instagram. So every slide gets generated TWICE (once in generate-slides, once in posting).
**Fix:** Do NOT regenerate images just for S3 keys. Find the proper Composio MCP tool to upload a local file and get back an S3 key / URL. Or find if the Instagram tool accepts direct file paths.

### 3. Sequential Instagram Carousel Items
**Where:** `post-to-instagram.js`, lines 155–168
**Problem:** Creating 6 carousel item containers one at a time in a loop.
**Fix:** Fire `INSTAGRAM_POST_IG_USER_MEDIA` calls in parallel via `Promise.all()`. Only the final CAROUSEL container must wait for IDs.

### 4. Synchronous End-to-End Pipeline
**Problem:** Generate → Overlay → S3 keys → Instagram items → Publish. No staging. Fail at step 5 = redo everything.
**Fix:** Split into two stages: (1) Generate & save locally, (2) Post independently. Posting can retry without regenerating.

---

## PART B: WHAT DIDN'T WORK (My Mistakes / Incorrect Approaches)

### 1. Instagram API Parameters — I Guessed Wrong Repeatedly
**What happened:** I kept trying different Composio MCP tool invocations (s3key, file paths, different object shapes) because I didn't know the exact schema the Instagram tools expected. Hit timeouts and "missing parameter" errors multiple times.
**Root cause:** I was reverse-engineering the MCP tool signature by trial-and-error instead of using the tool's discovery endpoint properly.
**What I should have done:**
- Call `listTools()` on the Composio MCP server and inspect the exact JSON schema for `INSTAGRAM_POST_IG_USER_MEDIA` and `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`.
- Pay special attention to whether `image_file` expects `{ name, s3key, mimetype }`, `{ file_path }`, or `{ url }`.
- If the tool accepts local file paths: pass the absolute path to `slide-N.png` directly. No S3 key dance needed.
- If it only accepts S3 keys: find the Composio tool that uploads a local file and returns an S3 key (look for something like `FILE_UPLOAD`, `S3_UPLOAD`, etc.). Do this ONCE per file at posting time, NOT by regenerating images.

### 2. File Upload / S3 Key Confusion
**What happened:** When Instagram posting failed due to bad parameters, my "fix" was to regenerate the image via OpenAI to get a fresh S3 key. This is absurdly wasteful.
**Root cause:** I didn't know how to upload existing local PNG files to Composio's S3 bucket.
**What I should have done:** Look for a dedicated upload tool in the Composio MCP server. Something like:
  - `S3_FILE_UPLOAD`
  - `FILE_UPLOAD`
  - `COMPOSIO_FILE_UPLOAD`
  Generate the image once, save locally, then upload local file → get S3 key → pass to Instagram tool.

### 3. `img2img` Path Was Never Tested Properly
**What happened:** The `referenceImagePath` and `args.image_file` parameter in `generate-slides.js` (line 213) was set up for image-to-image edits via OpenAI, but because inventory management / drive syncing wasn't fully wired, we always fell back to `txt2img`.
**Root cause:** I didn't verify whether Composio MCP's `OPENAI_CREATE_IMAGE` actually supports image file uploads for edits/variations.
**What I should have done:** Test the `image_file` parameter with a sample local image before wiring it into the pipeline. If it fails, disable img2img until properly supported.

### 4. Overlay Function Inconsistency
**What happened:** `post-to-instagram.js` has its own inline `applyOverlay()` (lines 45–89), and there's a separate `add-text-overlay.js` script. The inline one failed silently when `canvas` wasn't installed, only doing `fs.copyFileSync()`.
**Root cause:** Two overlay implementations = two potential failure points.
**What I should have done:** Either always use `add-text-overlay.js` as a standalone step and remove the inline version, OR make the inline version robust. But don't have both.

### 5. Not Using State / Progress Files
**What happened:** No record of what stage each post is in (generated, overlaid, uploaded, posted). I lost track of which images were successfully uploaded vs failed.
**Root cause:** Over-reliance on console logs and local files.
**What I should have done:** Write a `state.json` per post directory:
  ```json
  {
    "status": "generated", // generated | overlaid | uploaded | posted
    "slideUploadUrls": ["s3://...", "s3://..."],
    "instagramChildIds": ["179...", "179..."],
    "instagramCarouselId": "179...",
    "instagramMediaId": "179..."
  }
  ```
  This makes the pipeline resumable and prevents double-work.

---

## PART C: RECOMMENDED REWORK PLAN

### Step 1 — Fix the Instagram Tool Contract
  - [ ] Query the Composio MCP server with `listTools()` for exact Instagram tool schemas.
  - [ ] Determine if there's a `file_upload` / `s3_upload` utility tool.
  - [ ] Validate ONE successful Instagram post (single image, no carousel) end-to-end.
  - [ ] Then validate carousel posting.
  - **Do NOT proceed until this works reliably.**

### Step 2 — Separate Pipeline Into Stages
  - [ ] `generate-slides.js`: Generate raw images. Output: `slide-N-raw.png` + `metadata.json`.
  - [ ] `add-text-overlay.js`: Apply text overlays. Output: `slide-N.png`. Update `state.json` → `"overlaid"`.
  - [ ] `upload-slides.js` (NEW): Upload local `slide-N.png` files to Composio S3 (or whatever host Instagram needs). Output: `uploadUrls` array. Update `state.json` → `"uploaded"`.
  - [ ] `post-to-instagram.js`: Read upload URLs / child IDs from `state.json`, create carousel, publish. Update `state.json` → `"posted"`.

### Step 3 — Parallelize Where Safe
  - [ ] `generate-slides.js`: `Promise.all()` or `p-limit(3)` for image generation.
  - [ ] `upload-slides.js`: `Promise.all()` for file uploads.
  - [ ] `post-to-instagram.js`: `Promise.all()` for carousel item container creation.

### Step 4 — Add Resume / Idempotency
  - [ ] Every stage checks `state.json` before doing work.
  - [ ] If a stage already completed, skip it.
  - [ ] If posting fails halfway through, retry only from the failed step.

### Step 5 — Fix the Overlay Dance
  - [ ] Pick ONE overlay method: either inline in `post-to-instagram.js` OR standalone `add-text-overlay.js`, not both.
  - [ ] If standalone: call it explicitly between generation and posting.
  - [ ] If inline: make it mandatory (fail if canvas not installed, don't silently fallback to raw copies).

### Step 6 — Remove the S3 Key Regeneration Hack
  - [ ] Delete `getS3KeyForSlide()` function entirely.
  - [ ] Replace with proper file upload if needed, or direct file reference if Composio Instagram tool supports it.

### Step 7 — Logging & Observability
  - [ ] Replace console.log with structured JSON logging per stage.
  - [ ] Add timings: how long each stage took.
  - [ ] Add `posts/index.json` to track all posts and their status.

---

## PART D: UNKNOWN QUESTIONS TO RESOLVE

1. **Does Composio MCP's `INSTAGRAM_POST_IG_USER_MEDIA` accept local file paths directly?**
   - If YES: skip all S3 upload logic.
   - If NO: what is the correct upload tool name in the MCP server?

2. **Does `OPENAI_CREATE_IMAGE` (via Composio MCP) support image-to-image (`image_file` parameter)?**
   - Test with a real image file and see if it works.
   - If NO: disable img2img path and always use txt2img.

3. **What are the exact Instagram tool names and parameter schemas in the Composio MCP?**
   - `INSTAGRAM_POST_IG_USER_MEDIA` vs `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`
   - What fields does each require?
   - Any `INSTAGRAM_BASIC_DISPLAY` tools that are better for media upload?

4. **What is the Composio S3 key TTL?**
   - Is it really ~1h? If so, uploading during posting is risky if there's a delay.
   - Consider uploading right before posting, or using a different hosting solution.

---

## Current File Inventory (for reference)

```
~/social-marketing/
  config.json                      → Secrets + platform config
  restaurant-profile.json          → Restaurant metadata
  scripts/
    generate-slides.js             → Sequential image gen (SLOW)
    post-to-instagram.js           → Inline overlay + s3key hack (BROKEN APPROACH)
    add-text-overlay.js            → Standalone overlay (not always used)
    mcp-client.js                  → MCP client wrapper
    drive-sync.js                  → Drive sync (inventory mgmt)
    aggregator.js                  → Prompt building
    [other scripts]
  posts/<timestamp>/
    slide-N-raw.png                → Generated raw images
    slide-N.png                    → Overlaid images
    caption.txt, texts.json,
    metadata.json                  → Generation info
```

---

*Plan written by assistant reflecting on May 6 session. Do not trust the current posting logic — test the MCP tool contract first.*

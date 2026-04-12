#!/usr/bin/env node
/**
 * Post to Instagram via Composio API (two-step: create container, then publish).
 *
 * Usage: node post-to-instagram.js --config <config.json> --dir <slides-dir> --caption "text" --type feed|reels|story
 *
 * Supports single-image posts and carousel posts (2-10 slides).
 * Looks for slide1.png through slideN.png in the given directory.
 *
 * Instagram posting is a TWO-STEP process via Composio:
 *   1. INSTAGRAM_POST_IG_USER_MEDIA        — create media container(s)
 *   2. INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH — publish the container
 *
 * For carousel posts (multiple images):
 *   - Create a child container for each image
 *   - Create a carousel container referencing all children
 *   - Publish the carousel container
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const configPath = getArg('config');
const dir = getArg('dir');
const caption = getArg('caption');
const postType = getArg('type') || 'feed';

if (!configPath || !dir || !caption) {
  console.error(
    'Usage: node post-to-instagram.js --config <config.json> --dir <dir> --caption "text" [--type feed|reels|story]'
  );
  process.exit(1);
}

if (!['feed', 'reels', 'story'].includes(postType)) {
  console.error('Invalid --type. Must be one of: feed, reels, story');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config & constants
// ---------------------------------------------------------------------------

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const BASE_URL = 'https://backend.composio.dev';
const API_KEY = config.composio.apiKey;
const CONNECTED_ACCOUNT_ID = config.composio.connectedAccounts.instagram;
const USER_ID = config.composio.userId;

const RATE_LIMIT_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Discover slide images (slide1.png … slideN.png, flexible 1-10)
// ---------------------------------------------------------------------------

function discoverSlides(directory) {
  const slides = [];
  for (let i = 1; i <= 10; i++) {
    const filePath = path.join(directory, `slide${i}.png`);
    if (fs.existsSync(filePath)) {
      slides.push(filePath);
    } else {
      break; // stop at first gap
    }
  }
  if (slides.length === 0) {
    console.error(`No slide images found in ${directory} (expected slide1.png …)`);
    process.exit(1);
  }
  return slides;
}

// ---------------------------------------------------------------------------
// Upload an image via presigned URL flow
// ---------------------------------------------------------------------------

async function uploadImage(filePath) {
  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  // Step 1 — request presigned upload URL
  const presignRes = await fetch(`${BASE_URL}/api/v3/files/upload/request`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      toolkit_slug: 'instagram',
      tool_slug: 'INSTAGRAM_POST_IG_USER_MEDIA',
      filename,
      mimetype: 'image/png'
    })
  });

  if (!presignRes.ok) {
    const text = await presignRes.text();
    throw new Error(`Presign request failed (${presignRes.status}): ${text}`);
  }

  const presignData = await presignRes.json();

  // Step 2 — PUT the file binary to the presigned URL
  const putRes = await fetch(presignData.new_presigned_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: fileBuffer
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`File PUT failed (${putRes.status}): ${text}`);
  }

  return presignData.key;
}

// ---------------------------------------------------------------------------
// Execute a Composio tool
// ---------------------------------------------------------------------------

async function executeTool(toolSlug, toolArguments) {
  const res = await fetch(`${BASE_URL}/api/v3/tools/execute/${toolSlug}`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      connected_account_id: CONNECTED_ACCOUNT_ID,
      user_id: USER_ID,
      arguments: toolArguments
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${toolSlug} failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`${toolSlug} error: ${JSON.stringify(data.error)}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Create a single-image media container
// ---------------------------------------------------------------------------

async function createImageContainer(imageUrl, captionText) {
  return executeTool('INSTAGRAM_POST_IG_USER_MEDIA', {
    image_url: imageUrl,
    caption: captionText
  });
}

// ---------------------------------------------------------------------------
// Create a child container for carousel (no caption on children)
// ---------------------------------------------------------------------------

async function createCarouselChild(imageUrl) {
  return executeTool('INSTAGRAM_POST_IG_USER_MEDIA', {
    image_url: imageUrl,
    is_carousel_item: true
  });
}

// ---------------------------------------------------------------------------
// Create a carousel container from child container IDs
// ---------------------------------------------------------------------------

async function createCarouselContainer(childIds, captionText) {
  return executeTool('INSTAGRAM_POST_IG_USER_MEDIA', {
    media_type: 'CAROUSEL',
    children: childIds,
    caption: captionText
  });
}

// ---------------------------------------------------------------------------
// Publish a media container
// ---------------------------------------------------------------------------

async function publishContainer(creationId) {
  return executeTool('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH', {
    creation_id: creationId
  });
}

// ---------------------------------------------------------------------------
// Helper: pause for rate limiting
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    const slides = discoverSlides(dir);
    const isCarousel = slides.length > 1;

    console.log(`Found ${slides.length} slide(s). Mode: ${isCarousel ? 'carousel' : 'single image'}`);
    console.log(`Post type: ${postType}`);

    // Upload all images and collect their public URLs / keys
    console.log('\nUploading images...');
    const imageUrls = [];
    for (let i = 0; i < slides.length; i++) {
      console.log(`  Uploading slide ${i + 1}/${slides.length}...`);
      const key = await uploadImage(slides[i]);
      imageUrls.push(key);
      console.log(`  Done: ${key}`);
      if (i < slides.length - 1) await delay(RATE_LIMIT_DELAY_MS);
    }

    let containerId;
    let childContainerIds = [];

    if (isCarousel) {
      // --- Carousel flow ---
      console.log('\nCreating child containers...');
      for (let i = 0; i < imageUrls.length; i++) {
        console.log(`  Creating child container ${i + 1}/${imageUrls.length}...`);
        const childResult = await createCarouselChild(imageUrls[i]);
        const childId = childResult.data?.id || childResult.data?.creation_id;
        if (!childId) {
          console.error(`  Failed to get child container ID for slide ${i + 1}:`, JSON.stringify(childResult));
          process.exit(1);
        }
        childContainerIds.push(childId);
        console.log(`  Child container: ${childId}`);
        if (i < imageUrls.length - 1) await delay(RATE_LIMIT_DELAY_MS);
      }

      console.log('\nCreating carousel container...');
      const carouselResult = await createCarouselContainer(childContainerIds, caption);
      containerId = carouselResult.data?.id || carouselResult.data?.creation_id;
      if (!containerId) {
        console.error('Failed to get carousel container ID:', JSON.stringify(carouselResult));
        process.exit(1);
      }
      console.log(`Carousel container: ${containerId}`);
    } else {
      // --- Single image flow ---
      console.log('\nCreating media container...');
      const containerResult = await createImageContainer(imageUrls[0], caption);
      containerId = containerResult.data?.id || containerResult.data?.creation_id;
      if (!containerId) {
        console.error('Failed to get container ID:', JSON.stringify(containerResult));
        process.exit(1);
      }
      console.log(`Media container: ${containerId}`);
    }

    // Publish
    await delay(RATE_LIMIT_DELAY_MS);
    console.log('\nPublishing...');
    const publishResult = await publishContainer(containerId);
    const mediaId = publishResult.data?.id || publishResult.data?.media_id || null;
    console.log('Published!', JSON.stringify(publishResult));

    // Save metadata
    const metaPath = path.join(dir, 'meta.json');
    const meta = {
      platform: 'instagram',
      postType,
      containerId,
      mediaId,
      caption,
      slides: slides.length,
      isCarousel,
      childContainerIds: isCarousel ? childContainerIds : undefined,
      postedAt: new Date().toISOString(),
      successful: publishResult.successful || false
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`\nMetadata saved to ${metaPath}`);
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    process.exit(1);
  }
})();

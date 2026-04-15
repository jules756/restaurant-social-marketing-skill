#!/usr/bin/env node
/**
 * Post a photo to a Facebook Page via Composio API.
 *
 * Usage: node post-to-facebook.js --config <config.json> --dir <slides-dir> --caption "caption text"
 *
 * Uploads slide1.png then creates a Facebook photo post in one step
 * using FACEBOOK_CREATE_PHOTO_POST.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
}

const configPath = getArg('config');
const dir = getArg('dir');
const caption = getArg('caption');

if (!configPath || !dir || !caption) {
  console.error('Usage: node post-to-facebook.js --config <config.json> --dir <dir> --caption "text"');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const BASE_URL = 'https://backend.composio.dev';

/**
 * Request a presigned upload URL from Composio, PUT the file binary to it,
 * and return the file key to reference later in the post request.
 */
async function uploadImage(filePath) {
  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  // Step 1 — request presigned upload URL
  const presignRes = await fetch(`${BASE_URL}/api/v3/files/upload/request`, {
    method: 'POST',
    headers: {
      'x-api-key': config.composio.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      toolkit_slug: 'facebook',
      tool_slug: 'FACEBOOK_CREATE_PHOTO_POST',
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

  // Return the key that Composio uses to reference this file
  return presignData.key;
}

(async () => {
  // Locate the image
  const imagePath = path.join(dir, 'slide1.png');
  if (!fs.existsSync(imagePath)) {
    console.error(`Missing: ${imagePath}`);
    process.exit(1);
  }

  // Upload the image
  console.log('Uploading image...');
  const fileKey = await uploadImage(imagePath);
  console.log(`  Done: ${fileKey}`);

  // Create the Facebook photo post
  console.log('\nCreating Facebook photo post...');
  const pageId = config.platforms?.facebook?.pageId;
  if (!pageId) {
    console.error('Missing platforms.facebook.pageId in config');
    process.exit(1);
  }

  const postRes = await fetch(`${BASE_URL}/api/v3/tools/execute/FACEBOOK_CREATE_PHOTO_POST`, {
    method: 'POST',
    headers: {
      'x-api-key': config.composio.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      connected_account_id: config.composio.connectedAccounts.facebook,
      user_id: config.composio.userId,
      arguments: {
        photo_image: fileKey,
        caption,
        page_id: pageId
      }
    })
  });

  if (!postRes.ok) {
    const text = await postRes.text();
    console.error(`Post request failed (${postRes.status}): ${text}`);
    process.exit(1);
  }

  const result = await postRes.json();

  if (result.error) {
    console.error(`Post error: ${JSON.stringify(result.error)}`);
    process.exit(1);
  }

  console.log('Posted!', JSON.stringify(result));

  // Save metadata
  const metaPath = path.join(dir, 'meta.json');
  const meta = {
    platform: 'facebook',
    postId: result.data?.post_id || result.data?.id || null,
    caption,
    postedAt: new Date().toISOString(),
    successful: result.successful || false
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`Metadata saved to ${metaPath}`);
})();

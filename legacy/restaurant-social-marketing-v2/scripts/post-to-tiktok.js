#!/usr/bin/env node
/**
 * Post a 6-slide TikTok slideshow via Composio API.
 *
 * Usage: node post-to-tiktok.js --config <config.json> --dir <slides-dir> --caption "caption text" --title "post title"
 *
 * Uploads slide1.png through slide6.png, then creates a TikTok photo slideshow post.
 * Posts as SELF_ONLY (draft) by default — user adds music then publishes.
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
const title = getArg('title') || '';

if (!configPath || !dir || !caption) {
  console.error('Usage: node post-to-tiktok.js --config <config.json> --dir <dir> --caption "text" [--title "text"]');
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
      toolkit_slug: 'tiktok',
      tool_slug: 'TIKTOK_POST_PHOTO',
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
  console.log('Uploading slides...');
  const fileKeys = [];
  for (let i = 1; i <= 6; i++) {
    const filePath = path.join(dir, `slide${i}.png`);
    if (!fs.existsSync(filePath)) {
      console.error(`  Missing: ${filePath}`);
      process.exit(1);
    }
    console.log(`  Uploading slide ${i}...`);
    const key = await uploadImage(filePath);
    fileKeys.push(key);
    console.log(`  Done: ${key}`);
    // Rate limit buffer
    if (i < 6) await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\nCreating TikTok photo post...');
  const privacy = config.posting?.privacyLevel || 'SELF_ONLY';

  const postRes = await fetch(`${BASE_URL}/api/v3/tools/execute/TIKTOK_POST_PHOTO`, {
    method: 'POST',
    headers: {
      'x-api-key': config.composio.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      connected_account_id: config.composio.connectedAccounts.tiktok,
      user_id: config.composio.userId,
      arguments: {
        photo_images: fileKeys,
        description: caption,
        privacy_level: privacy,
        title: title
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
    publishId: result.data?.publish_id || null,
    caption,
    title,
    privacy,
    postedAt: new Date().toISOString(),
    images: fileKeys.length,
    successful: result.successful || false
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`Metadata saved to ${metaPath}`);
})();

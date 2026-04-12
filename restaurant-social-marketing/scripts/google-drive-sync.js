#!/usr/bin/env node

/**
 * Google Drive Photo Sync & Management
 *
 * Syncs restaurant photos from a Google Drive folder to a local cache,
 * maintains a photo index with tags and metadata, and provides listing
 * and summary utilities.
 *
 * Usage:
 *   node google-drive-sync.js --sync    --config <config.json>
 *   node google-drive-sync.js --list    --config <config.json>
 *   node google-drive-sync.js --tag     --config <config.json> --photo <fileId> --tags "dish,pasta"
 *   node google-drive-sync.js --summary --config <config.json>
 */

const fs = require('fs');
const path = require('path');
const { executeTool } = require('./composio-helpers');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sync':
        args.command = 'sync';
        break;
      case '--list':
        args.command = 'list';
        break;
      case '--tag':
        args.command = 'tag';
        break;
      case '--summary':
        args.command = 'summary';
        break;
      case '--config':
        args.configPath = argv[++i];
        break;
      case '--photo':
        args.photoId = argv[++i];
        break;
      case '--tags':
        args.tags = argv[++i];
        break;
      default:
        break;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Config & index helpers
// ---------------------------------------------------------------------------

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

function indexPath(config) {
  return path.resolve(config.googleDrive.localCachePath, 'photo-index.json');
}

function loadIndex(config) {
  const p = indexPath(config);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return {
    lastSynced: null,
    folderId: config.googleDrive.folderId,
    photos: []
  };
}

function saveIndex(config, index) {
  const p = indexPath(config);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(p, JSON.stringify(index, null, 2));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * --sync: pull new images from Google Drive into the local cache.
 */
async function cmdSync(config) {
  const { apiKey, connectedAccounts, userId } = config.composio;
  const accountId = connectedAccounts.googledrive;
  const { folderId, localCachePath } = config.googleDrive;

  console.log(`Listing images in Google Drive folder ${folderId} ...`);

  const listResult = await executeTool(apiKey, accountId, userId, 'GOOGLEDRIVE_LIST_FILES', {
    folder_id: folderId,
    q: "mimeType contains 'image'"
  });

  const files = listResult.data?.files
    || listResult.response_data?.files
    || listResult.files
    || [];

  if (files.length === 0) {
    console.log('No image files found in the configured Drive folder.');
    return;
  }

  const index = loadIndex(config);
  const existingIds = new Set(index.photos.map((p) => p.fileId));

  let newCount = 0;

  for (const file of files) {
    const fileId = file.id || file.fileId;
    if (existingIds.has(fileId)) {
      continue;
    }

    const fileName = file.name || file.title || `${fileId}.jpg`;
    const relativePath = path.join(localCachePath, fileName);
    const absolutePath = path.resolve(relativePath);

    console.log(`  Downloading ${fileName} (${fileId}) ...`);

    const downloadResult = await executeTool(apiKey, accountId, userId, 'GOOGLEDRIVE_DOWNLOAD_FILE', {
      file_id: fileId
    });

    // Write file contents if the API returns binary/base64 data
    const fileDir = path.dirname(absolutePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    const content = downloadResult.data?.content
      || downloadResult.response_data?.content
      || downloadResult.content;

    if (content) {
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(absolutePath, buffer);
    }

    index.photos.push({
      fileId,
      name: fileName,
      localPath: relativePath,
      mimeType: file.mimeType || 'image/jpeg',
      tags: [],
      menuItemId: null,
      description: '',
      usedInPosts: [],
      addedAt: new Date().toISOString()
    });

    newCount++;
  }

  index.lastSynced = new Date().toISOString();
  index.folderId = folderId;
  saveIndex(config, index);

  console.log(`\nSync complete: ${newCount} new photo(s), ${index.photos.length} total.`);
}

/**
 * --list: display all indexed photos with their tags.
 */
function cmdList(config) {
  const index = loadIndex(config);

  if (index.photos.length === 0) {
    console.log('No photos in index. Run --sync first.');
    return;
  }

  console.log(`Photos (${index.photos.length}):\n`);

  for (const photo of index.photos) {
    const tags = photo.tags.length > 0 ? photo.tags.join(', ') : '(none)';
    console.log(`  ${photo.name}`);
    console.log(`    ID:    ${photo.fileId}`);
    console.log(`    Path:  ${photo.localPath}`);
    console.log(`    Tags:  ${tags}`);
    if (photo.description) {
      console.log(`    Desc:  ${photo.description}`);
    }
    console.log();
  }
}

/**
 * --tag: add tags to a specific photo by fileId.
 */
function cmdTag(config, photoId, rawTags) {
  if (!photoId) {
    throw new Error('--photo <fileId> is required for --tag');
  }
  if (!rawTags) {
    throw new Error('--tags "tag1,tag2" is required for --tag');
  }

  const index = loadIndex(config);
  const photo = index.photos.find((p) => p.fileId === photoId);

  if (!photo) {
    throw new Error(`Photo with fileId "${photoId}" not found in index. Run --sync first.`);
  }

  const newTags = rawTags.split(',').map((t) => t.trim()).filter(Boolean);
  const merged = new Set([...photo.tags, ...newTags]);
  photo.tags = [...merged];

  saveIndex(config, index);

  console.log(`Updated tags for "${photo.name}": ${photo.tags.join(', ')}`);
}

/**
 * --summary: show sync status and photo counts.
 */
function cmdSummary(config) {
  const index = loadIndex(config);

  console.log('Google Drive Photo Sync — Summary');
  console.log('─'.repeat(40));
  console.log(`  Folder ID:    ${index.folderId || '(not set)'}`);
  console.log(`  Last synced:  ${index.lastSynced || 'never'}`);
  console.log(`  Total photos: ${index.photos.length}`);

  const tagged = index.photos.filter((p) => p.tags.length > 0).length;
  const untagged = index.photos.length - tagged;
  console.log(`  Tagged:       ${tagged}`);
  console.log(`  Untagged:     ${untagged}`);

  const used = index.photos.filter((p) => p.usedInPosts.length > 0).length;
  console.log(`  Used in posts: ${used}`);

  // Collect tag frequency
  const tagCounts = {};
  for (const photo of index.photos) {
    for (const tag of photo.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const tagEntries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  if (tagEntries.length > 0) {
    console.log('\n  Top tags:');
    for (const [tag, count] of tagEntries.slice(0, 10)) {
      console.log(`    ${tag}: ${count}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.command) {
    console.error('Usage: node google-drive-sync.js --sync|--list|--tag|--summary --config <config.json>');
    process.exit(1);
  }

  if (!args.configPath) {
    console.error('Error: --config <path> is required.');
    process.exit(1);
  }

  const config = loadConfig(args.configPath);

  if (!config.googleDrive?.enabled) {
    console.error('Google Drive sync is not enabled in the config.');
    process.exit(1);
  }

  switch (args.command) {
    case 'sync':
      await cmdSync(config);
      break;
    case 'list':
      cmdList(config);
      break;
    case 'tag':
      cmdTag(config, args.photoId, args.tags);
      break;
    case 'summary':
      cmdSummary(config);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

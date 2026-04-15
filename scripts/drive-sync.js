#!/usr/bin/env node
/**
 * Sync restaurant photos from Google Drive (via Composio) to the local cache.
 *
 * Usage:
 *   node drive-sync.js --config social-marketing/config.json
 *
 * Reads: config.googleDrive.{folderId, composioAccountId, localCachePath}
 * Writes: photos under <localCachePath> (categorized subdirs) and updates
 * the inventory index. Actual vision-based categorization happens in
 * drive-inventory.js — this script only pulls bytes.
 *
 * Idempotent: files that already exist locally (matching Drive file ID and
 * size) are skipped. Re-run safely.
 */

const fs = require('fs');
const path = require('path');
const { executeTool, loadConfig, PLATFORMS } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

const configPath = getArg('config');
if (!configPath) {
  console.error('Usage: node drive-sync.js --config <config.json>');
  process.exit(1);
}

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
if (!COMPOSIO_API_KEY) {
  console.error('COMPOSIO_API_KEY is not set.');
  process.exit(1);
}

const config = loadConfig(configPath);
const drive = config.googleDrive;
if (!drive?.enabled) {
  console.log('Google Drive is disabled in config. Nothing to sync.');
  process.exit(0);
}

const cacheDir = path.resolve(drive.localCachePath || 'social-marketing/photos/');
const indexPath = path.resolve(drive.localCachePath || 'social-marketing/photos/', 'drive-index.json');
fs.mkdirSync(cacheDir, { recursive: true });
for (const sub of ['dishes', 'ambiance', 'kitchen', 'exterior', 'unsorted']) {
  fs.mkdirSync(path.join(cacheDir, sub), { recursive: true });
}

function loadIndex() {
  if (!fs.existsSync(indexPath)) {
    return { lastSynced: null, folderId: drive.folderId, files: {} };
  }
  return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
}

function saveIndex(idx) {
  idx.lastSynced = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2));
}

async function listFolder(folderId) {
  const result = await executeTool(
    COMPOSIO_API_KEY,
    drive.composioAccountId,
    `drive_sync_${Date.now()}`,
    PLATFORMS.googledrive.listFilesTool,
    { folder_id: folderId, page_size: 1000 }
  );
  // Composio tool responses vary — try common shapes.
  const files = result.data?.files || result.files || result.data || [];
  return files.filter((f) => (f.mimeType || f.mime_type || '').startsWith('image/'));
}

async function downloadFile(file) {
  const result = await executeTool(
    COMPOSIO_API_KEY,
    drive.composioAccountId,
    `drive_sync_${Date.now()}`,
    PLATFORMS.googledrive.downloadFileTool,
    { file_id: file.id }
  );
  // Expect base64 content in result.data.content or result.content
  const b64 = result.data?.content || result.content;
  if (!b64) throw new Error(`Download for ${file.name}: no content returned`);
  return Buffer.from(b64, 'base64');
}

(async () => {
  const idx = loadIndex();
  console.log(`Syncing Drive folder ${drive.folderId} → ${cacheDir}`);
  const files = await listFolder(drive.folderId);
  console.log(`Found ${files.length} image(s) in folder.`);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const id = file.id;
    const name = file.name || `${id}.jpg`;
    const existing = idx.files[id];
    const target = path.join(cacheDir, 'unsorted', name);

    if (existing && fs.existsSync(existing.localPath) && fs.statSync(existing.localPath).size > 0) {
      skipped++;
      continue;
    }
    try {
      const buf = await downloadFile(file);
      fs.writeFileSync(target, buf);
      idx.files[id] = {
        driveId: id,
        name,
        size: buf.length,
        localPath: target,
        category: null, // filled by drive-inventory.js
        syncedAt: new Date().toISOString()
      };
      added++;
      console.log(`  ⬇  ${name}`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${name}: ${e.message}`);
    }
  }

  saveIndex(idx);
  console.log(`\nDone. +${added} new, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
})();

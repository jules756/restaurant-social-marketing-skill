#!/usr/bin/env node
/**
 * Sync the restaurant's Google Drive folder → local photo cache.
 *
 * Per the Composio Google Drive toolkit:
 *   - GOOGLEDRIVE_FIND_FILE: list files in a folder (folder_id required;
 *     'root' alias for My Drive root). Folder names are NOT searchable —
 *     must resolve folder name → id first.
 *   - GOOGLEDRIVE_DOWNLOAD_FILE: download by fileId. Workspace docs need
 *     mime_type for export; binary files (images) come back native.
 *
 * Flow:
 *   1. Resolve folder by name (one-shot list with name+mimeType filter).
 *   2. List files in folder. Compare to local drive-index.json.
 *   3. Download anything new to <localCachePath>/unsorted/.
 *   4. Update drive-index.json with the union of local + remote ids.
 *
 * Idempotent. Existing files are skipped. Cron-callable every N minutes.
 *
 * Usage:
 *   node drive-sync.js --config <config.json>
 */

const fs = require('fs');
const path = require('path');
const { callTool, loadConfig } = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : null; };
const configPath = getArg('config');
if (!configPath) { console.error('Usage: node drive-sync.js --config <config.json>'); process.exit(1); }

const config = loadConfig(configPath);
const drive = config.googleDrive;
if (!drive?.enabled) { console.log('Google Drive is disabled in config. Nothing to do.'); process.exit(0); }
if (!drive.folderName) { console.error('config.googleDrive.folderName is required'); process.exit(1); }
if (!drive.localCachePath) { console.error('config.googleDrive.localCachePath is required'); process.exit(1); }

const cachePath = drive.localCachePath;
const unsortedDir = path.resolve(cachePath, 'unsorted');
const indexPath = path.resolve(cachePath, 'drive-index.json');
const IMAGE_MIME_RE = /^image\/(jpeg|png|webp|heic|heif)$/i;

async function resolveFolderId(folderName) {
  // Search for folder by name. Composio's GOOGLEDRIVE_FIND_FILE accepts a
  // q (Google Drive query string) param.
  const escaped = folderName.replace(/'/g, "\\'");
  const result = await callTool(config, 'GOOGLEDRIVE_FIND_FILE', {
    q: `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`,
    page_size: 5,
  });
  const files = result?.data?.files || result?.files || result?.data || [];
  const folder = Array.isArray(files) ? files.find((f) => (f.name || f.title) === folderName) : null;
  if (!folder?.id) throw new Error(`Folder "${folderName}" not found in Drive (or not shared with the connected account).`);
  return folder.id;
}

async function listImagesInFolder(folderId) {
  const result = await callTool(config, 'GOOGLEDRIVE_FIND_FILE', {
    q: `'${folderId}' in parents and trashed=false`,
    page_size: 100,
  });
  const files = result?.data?.files || result?.files || result?.data || [];
  return (Array.isArray(files) ? files : []).filter((f) => IMAGE_MIME_RE.test(f.mimeType || ''));
}

async function downloadFile(fileId, destPath) {
  const result = await callTool(config, 'GOOGLEDRIVE_DOWNLOAD_FILE', { fileId });
  // Composio Drive download usually returns base64 in result.data.content
  // or a URL in result.data.url. Probe both.
  const b64 = result?.data?.content || result?.content;
  const url = result?.data?.download_url || result?.data?.url;
  if (b64 && typeof b64 === 'string') {
    fs.writeFileSync(destPath, Buffer.from(b64, 'base64'));
    return true;
  }
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download URL fetch failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return true;
  }
  throw new Error(`GOOGLEDRIVE_DOWNLOAD_FILE response had neither content nor url: ${JSON.stringify(result).slice(0, 300)}`);
}

function loadIndex() {
  if (!fs.existsSync(indexPath)) return { files: {} };
  try { return JSON.parse(fs.readFileSync(indexPath, 'utf-8')); }
  catch { return { files: {} }; }
}
function saveIndex(idx) {
  idx.updatedAt = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2) + '\n');
}

(async () => {
  fs.mkdirSync(unsortedDir, { recursive: true });
  const index = loadIndex();

  console.log(`Resolving Drive folder "${drive.folderName}"…`);
  const folderId = await resolveFolderId(drive.folderName);
  console.log(`  ✓ folder id ${folderId}`);

  console.log(`Listing image files…`);
  const remote = await listImagesInFolder(folderId);
  console.log(`  ✓ ${remote.length} image(s) in folder`);

  let downloaded = 0, skipped = 0, failed = 0;
  for (const file of remote) {
    if (index.files[file.id]) { skipped++; continue; }
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0] || '.jpg';
    const safeName = `${file.id}${ext}`;
    const destPath = path.join(unsortedDir, safeName);
    try {
      await downloadFile(file.id, destPath);
      index.files[file.id] = {
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        localPath: destPath,
        downloadedAt: new Date().toISOString(),
      };
      downloaded++;
      console.log(`  ✅ ${file.name} → ${safeName}`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${file.name}: ${e.message}`);
    }
  }
  saveIndex(index);

  console.log(`\nDrive sync done: ${downloaded} new, ${skipped} already cached, ${failed} failed.`);
  if (failed > 0) process.exit(1);
})();

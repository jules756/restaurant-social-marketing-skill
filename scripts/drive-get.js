#!/usr/bin/env node
/**
 * Query Drive (via Composio) and download a single photo on demand. Drive
 * is the source of truth — no local cache, no sync job. The restaurant
 * owner adds photos to Drive; the AI agent queries Drive each time it
 * needs a reference, so it always sees the latest content.
 *
 * Usage:
 *   # List top-level subfolders in akira-agent_src
 *   node drive-get.js --config <config> --list-folders
 *
 *   # List files in a specific subfolder (optionally case-insensitive match)
 *   node drive-get.js --config <config> --folder "Food"
 *
 *   # Download first file whose name contains <match> (case-insensitive)
 *   # from the given subfolder; prints the local path on stdout's last line.
 *   node drive-get.js --config <config> --folder "Food" --match "bolognese" --out /tmp/ref.jpg
 *
 *   # Download a specific file by Drive ID
 *   node drive-get.js --config <config> --file-id <drive-id> --out /tmp/ref.jpg
 *
 * Output (stdout, last line is machine-readable JSON):
 *   {"ok": true, "path": "/tmp/ref.jpg", "driveId": "...", "name": "bolognese.jpg"}
 *   {"ok": true, "folders": [{"id":"...","name":"Food"}, ...]}
 *   {"ok": true, "files": [{"id":"...","name":"bolognese.jpg"}, ...]}
 *   {"ok": false, "error": "..."}
 */

const fs = require('fs');
const path = require('path');
const { executeTool, findDriveFolderByName, loadConfig, PLATFORMS } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config') || `${process.env.HOME}/social-marketing/config.json`;
const listFolders = hasFlag('list-folders');
const subfolder = getArg('folder');
const match = getArg('match');
const fileId = getArg('file-id');
const outPath = getArg('out');

function fail(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

async function listFolderEntries(folderId) {
  const result = await executeTool(config, PLATFORMS.googledrive.listFilesTool, {
    folder_id: folderId,
    page_size: 1000
  });
  return result.data?.files || result.files || result.data || [];
}

async function downloadFileToPath(driveId, outputPath) {
  const result = await executeTool(config, PLATFORMS.googledrive.downloadFileTool, {
    file_id: driveId
  });
  const data = result.data || result;
  const localPath =
    data.file_path || data.filePath || data.local_path || data.localPath ||
    data.path || data.file;
  if (localPath && fs.existsSync(localPath)) {
    fs.copyFileSync(localPath, outputPath);
    return outputPath;
  }
  const b64 = data.content || data.file_content;
  if (b64) {
    fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
    return outputPath;
  }
  throw new Error(`Download returned neither path nor content. Keys: ${Object.keys(data).join(',')}`);
}

const config = loadConfig(configPath);
const drive = config.googleDrive;
if (!drive?.enabled) fail('Google Drive is disabled in config');
if (!drive.folderName) fail('config.googleDrive.folderName is required');

(async () => {
  try {
    // Resolve the root folder by name every time (no cached ID trust).
    const rootId = await findDriveFolderByName(config, drive.folderName);
    if (!rootId) fail(`Drive folder "${drive.folderName}" not found`);

    if (fileId) {
      const target = outPath || `/tmp/drive-${fileId}`;
      await downloadFileToPath(fileId, target);
      console.log(JSON.stringify({ ok: true, path: target, driveId: fileId }));
      return;
    }

    const rootEntries = await listFolderEntries(rootId);
    const folders = rootEntries.filter((f) => (f.mimeType || f.mime_type) === 'application/vnd.google-apps.folder');

    if (listFolders) {
      console.log(JSON.stringify({
        ok: true,
        rootId,
        folders: folders.map((f) => ({ id: f.id, name: f.name }))
      }));
      return;
    }

    if (subfolder) {
      const sub = folders.find((f) => (f.name || '').toLowerCase() === subfolder.toLowerCase())
        || folders.find((f) => (f.name || '').toLowerCase().includes(subfolder.toLowerCase()));
      if (!sub) fail(`Subfolder "${subfolder}" not found in "${drive.folderName}". Available: ${folders.map((f) => f.name).join(', ')}`);

      const subEntries = await listFolderEntries(sub.id);
      const images = subEntries.filter((f) => (f.mimeType || f.mime_type || '').startsWith('image/'));

      if (!match) {
        console.log(JSON.stringify({
          ok: true,
          folder: sub.name,
          folderId: sub.id,
          files: images.map((f) => ({ id: f.id, name: f.name }))
        }));
        return;
      }

      const m = images.find((f) => (f.name || '').toLowerCase().includes(match.toLowerCase()));
      if (!m) fail(`No file matching "${match}" in "${sub.name}". Available: ${images.map((f) => f.name).join(', ')}`);

      const target = outPath || `/tmp/drive-${m.id}-${m.name}`;
      await downloadFileToPath(m.id, target);
      console.log(JSON.stringify({
        ok: true,
        path: target,
        driveId: m.id,
        name: m.name,
        folder: sub.name
      }));
      return;
    }

    fail('Specify --list-folders, --folder <name>, or --file-id <id>');
  } catch (e) {
    fail(e.message);
  }
})();

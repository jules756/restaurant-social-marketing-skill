#!/usr/bin/env node
/**
 * Sync restaurant photos from Google Drive (via Composio) to the local cache.
 *
 * Usage:
 *   node drive-sync.js --config social-marketing/config.json
 *
 * Reads: config.googleDrive.{folderId?, folderName, localCachePath}.
 *        If folderId is missing, resolves it via findOrCreateDriveFolder.
 * Writes: photos under <localCachePath> (categorized subdirs) and updates
 * the drive index. Vision-based categorization happens in drive-inventory.js.
 *
 * Idempotent: files that already exist locally (matching Drive file ID and
 * size) are skipped. Re-run safely.
 */

const fs = require('fs');
const path = require('path');
const { executeTool, findDriveFolderByName, findOrCreateDriveFolder, loadConfig, PLATFORMS } = require('./composio-helpers');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config');
const noRecurse = hasFlag('no-recurse');
if (!configPath) {
  console.error('Usage: node drive-sync.js --config <config.json> [--no-recurse]');
  process.exit(1);
}

/**
 * Map a Drive subfolder name to one of our categories. Case-insensitive,
 * tolerant of misspellings ("Menue" → menu, "Diches" → dish). Photos in
 * unmapped folders get category=null and go through vision classification.
 */
function mapSubfolderToCategory(folderName) {
  const n = (folderName || '').toLowerCase().trim();
  if (/^(food|foods|dish|diches|dishes|plate|plates|meal|meals)$/.test(n)) return 'dish';
  if (/^(place|places|ambiance|ambience|interior|dining|dining[-_ ]?room|restaurant|venue|atmosphere|atmosph|vibe)$/.test(n)) return 'ambiance';
  if (/^(kitchen|cuisine|chef|chefs|back[-_ ]?of[-_ ]?house|prep)$/.test(n)) return 'kitchen';
  if (/^(exterior|outside|facade|street|entrance|front|outdoor)$/.test(n)) return 'exterior';
  if (/^(menu|menue|menus|card|carte)$/.test(n)) return 'menu';
  return null; // vision will classify
}

const config = loadConfig(configPath);
const drive = config.googleDrive;
if (!drive?.enabled) {
  console.log('Google Drive is disabled in config. Nothing to sync.');
  process.exit(0);
}

// Resolve paths relative to the config file's directory, not cwd.
const configDir = path.dirname(path.resolve(configPath));
const rawCachePath = drive.localCachePath || 'photos/';
const cacheDir = path.isAbsolute(rawCachePath)
  ? rawCachePath
  : path.resolve(configDir, rawCachePath.replace(/^social-marketing\//, ''));
const indexPath = path.join(cacheDir, 'drive-index.json');
fs.mkdirSync(cacheDir, { recursive: true });
for (const sub of ['dishes', 'ambiance', 'kitchen', 'exterior', 'unsorted']) {
  fs.mkdirSync(path.join(cacheDir, sub), { recursive: true });
}

function loadIndex(folderId) {
  if (!fs.existsSync(indexPath)) {
    return { lastSynced: null, folderId, files: {} };
  }
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  idx.folderId = folderId;
  return idx;
}

function saveIndex(idx) {
  idx.lastSynced = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2));
}

async function listFolder(folderId) {
  const result = await executeTool(config, PLATFORMS.googledrive.listFilesTool, {
    folder_id: folderId,
    page_size: 1000
  });
  const files = result.data?.files || result.files || result.data || [];
  return files;
}

function isImage(f) {
  return (f.mimeType || f.mime_type || '').startsWith('image/');
}

function isFolder(f) {
  return (f.mimeType || f.mime_type || '') === 'application/vnd.google-apps.folder';
}

async function downloadFile(file) {
  const result = await executeTool(config, PLATFORMS.googledrive.downloadFileTool, {
    file_id: file.id
  });
  const b64 = result.data?.content || result.content;
  if (!b64) throw new Error(`Download for ${file.name}: no content returned`);
  return Buffer.from(b64, 'base64');
}

/**
 * Always search Drive for the folder by name, save the ID back to config.
 * Caching the folder ID is unreliable — the folder could be moved, deleted,
 * renamed, or a duplicate created. Better to search every time and keep
 * config in sync with reality.
 */
async function resolveFolderId() {
  if (!drive.folderName) {
    throw new Error('config.googleDrive.folderName is required (default: "akira-agent_src")');
  }
  console.log(`Searching Drive for folder "${drive.folderName}" …`);
  const foundId = await findDriveFolderByName(config, drive.folderName);
  if (foundId) {
    // Persist if changed (or write fresh)
    if (drive.folderId !== foundId) {
      drive.folderId = foundId;
      const fullConfig = loadConfig(configPath);
      fullConfig.googleDrive = drive;
      fs.writeFileSync(path.resolve(configPath), JSON.stringify(fullConfig, null, 2) + '\n');
      console.log(`  ✏  Updated config.googleDrive.folderId → ${foundId}`);
    }
    return foundId;
  }
  // Not found — create it (matches the Installer UX where the folder may
  // not exist yet the first time we sync).
  const { id, created } = await findOrCreateDriveFolder(config, drive.folderName);
  if (created) {
    console.log(`  ✨ Created new Drive folder "${drive.folderName}" (${id})`);
    // Persist the new folder ID
    drive.folderId = id;
    const fullConfig = loadConfig(configPath);
    fullConfig.googleDrive = drive;
    fs.writeFileSync(path.resolve(configPath), JSON.stringify(fullConfig, null, 2) + '\n');
  }
  return id;
}

async function collectImagesRecursive(folderId, folderName, depth = 0) {
  const entries = await listFolder(folderId);
  const collected = [];
  const images = entries.filter(isImage);
  const folders = entries.filter(isFolder);
  // Tag each image with the subfolder it came from → drives category mapping.
  const category = mapSubfolderToCategory(folderName);
  for (const img of images) {
    collected.push({ ...img, sourceFolder: folderName, sourceCategory: category });
  }
  if (noRecurse) {
    return { collected, subfolders: folders };
  }
  for (const sub of folders) {
    const subResult = await collectImagesRecursive(sub.id, sub.name, depth + 1);
    collected.push(...subResult.collected);
  }
  return { collected, subfolders: folders };
}

(async () => {
  const folderId = await resolveFolderId();
  const idx = loadIndex(folderId);
  console.log(`Syncing Drive folder ${drive.folderName} (${folderId}) → ${cacheDir}`);
  const { collected: files, subfolders } = await collectImagesRecursive(folderId, drive.folderName);
  if (subfolders.length > 0) {
    console.log(`Discovered subfolders:`);
    subfolders.forEach((s) => {
      const cat = mapSubfolderToCategory(s.name);
      console.log(`  - ${s.name} → category=${cat || 'unsorted (vision)'}`);
    });
  }
  console.log(`Found ${files.length} image(s) across all folders.`);

  if (files.length === 0 && subfolders.length === 0) {
    console.log('');
    console.log(`  Folder "${drive.folderName}" (${folderId}) is empty.`);
    console.log('  Check: are you adding photos to the same Google account Composio is connected to?');
  }

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const id = file.id;
    const name = file.name || `${id}.jpg`;
    const existing = idx.files[id];
    // Drop into the subfolder-mapped category dir when we know it; else unsorted.
    const cat = file.sourceCategory || 'unsorted';
    const categoryDir = { dish: 'dishes', ambiance: 'ambiance', kitchen: 'kitchen', exterior: 'exterior', menu: 'menu', unsorted: 'unsorted' }[cat];
    fs.mkdirSync(path.join(cacheDir, categoryDir), { recursive: true });
    const target = path.join(cacheDir, categoryDir, name);

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
        category: file.sourceCategory || null, // pre-categorized if subfolder mapped; null → vision
        sourceFolder: file.sourceFolder || null,
        syncedAt: new Date().toISOString()
      };
      added++;
      console.log(`  ⬇  ${cat}/${name}  (from "${file.sourceFolder}")`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${name}: ${e.message}`);
    }
  }

  saveIndex(idx);
  console.log(`\nDone. +${added} new, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
})();

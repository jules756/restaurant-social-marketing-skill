#!/usr/bin/env node
/**
 * Drive sync — on-demand, structure-aware.
 *
 * The owner organizes their Drive into two folders: one for dish photos,
 * one for venue photos. Folder names vary by language and habit, so we
 * auto-detect by name pattern and cache the resolution.
 *
 * Run on-demand (per-post), not on a schedule. content-preparation Phase 3
 * calls this before generate-slides.js. Cron entry removed.
 *
 * Flow:
 *   1. Resolve the *root* folder by config.googleDrive.folderName.
 *   2. Inside it, detect a "dishes" subfolder and a "venue" subfolder by
 *      name pattern (English, French, multi-language).
 *   3. Cache resolved folder IDs in config.googleDrive.resolvedFolders so
 *      we don't re-detect every run.
 *   4. List files in each subfolder, download new ones (skip cached by
 *      Drive file ID).
 *   5. If --dish "<name>" passed, fuzzy-match dish photos by filename.
 *   6. Write photos/last-sync.json with venuePhotos[] + dishPhotos[]
 *      (absolute paths) for generate-slides.js to consume.
 *
 * Usage:
 *   node drive-sync.js --config <config.json>             # sync, write last-sync.json
 *   node drive-sync.js --config <config.json> --dish "Carbonara"  # also filter dish photos by name
 *   node drive-sync.js --config <config.json> --refresh-folders  # force folder re-detection
 */

const fs = require('fs');
const path = require('path');
const { callTool, loadConfig } = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const configPath = getArg('config');
const dishName = getArg('dish');
const skipDish = hasFlag('no-dish');     // post types that don't need any dish refs (vibe-moment, neighborhood, etc.)
const refreshFolders = hasFlag('refresh-folders');
if (!configPath) {
  console.error('Usage: node drive-sync.js --config <config.json> [--dish "<name>"] [--no-dish] [--refresh-folders]');
  process.exit(1);
}

const config = loadConfig(configPath);
const drive = config.googleDrive;
if (!drive?.enabled) { console.log('Google Drive disabled in config. Nothing to do.'); process.exit(0); }
if (!drive.folderName) { console.error('config.googleDrive.folderName is required (the Drive root folder you share with the agent).'); process.exit(1); }
if (!drive.localCachePath) { console.error('config.googleDrive.localCachePath is required.'); process.exit(1); }

const cachePath = drive.localCachePath;
const dishesCacheDir = path.resolve(cachePath, 'dishes');
const venueCacheDir = path.resolve(cachePath, 'venue');
const indexPath = path.resolve(cachePath, 'drive-index.json');
const lastSyncPath = path.resolve(cachePath, 'last-sync.json');

// Folder-name patterns (case-insensitive). Order doesn't matter — match any.
const DISH_FOLDER_PATTERNS = [
  /^dish(es)?$/i, /^food$/i, /^plats?$/i, /^plates?$/i,
  /^menu$/i, /^cuisine$/i, /^dish[-_ ]?photos?$/i, /^food[-_ ]?photos?$/i,
];
const VENUE_FOLDER_PATTERNS = [
  /^venue$/i, /^place$/i, /^lieu$/i, /^salle$/i,
  /^decor$/i, /^restaurant$/i, /^interior$/i, /^ambian(c|ç)e$/i,
  /^space$/i, /^room$/i, /^dining[-_ ]?room$/i, /^venue[-_ ]?photos?$/i,
];

const IMAGE_MIME_RE = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i;

async function findFolderByName(name, parentId) {
  const escaped = name.replace(/'/g, "\\'");
  let q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const result = await callTool(config, 'GOOGLEDRIVE_FIND_FILE', { q, page_size: 5 });
  const files = result?.data?.files || result?.files || result?.data || [];
  const folder = Array.isArray(files) ? files.find((f) => (f.name || f.title) === name) : null;
  return folder?.id || null;
}

async function listSubfolders(parentId) {
  const result = await callTool(config, 'GOOGLEDRIVE_FIND_FILE', {
    q: `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    page_size: 50,
  });
  const files = result?.data?.files || result?.files || result?.data || [];
  return Array.isArray(files) ? files.map((f) => ({ id: f.id, name: f.name || f.title })) : [];
}

function matchPattern(name, patterns) {
  return patterns.some((re) => re.test(name));
}

async function resolveFolders() {
  // Reuse cached resolution unless --refresh-folders or it's missing.
  if (!refreshFolders && drive.resolvedFolders?.dishes && drive.resolvedFolders?.venue) {
    return drive.resolvedFolders;
  }
  console.log(`Resolving Drive folder structure under "${drive.folderName}"…`);
  const rootId = await findFolderByName(drive.folderName, null);
  if (!rootId) throw new Error(`Root folder "${drive.folderName}" not found in Drive (or not shared with this userId's account).`);
  const subs = await listSubfolders(rootId);
  console.log(`  ✓ root id ${rootId}, ${subs.length} subfolders`);

  let dishesId = null, venueId = null;
  let dishesName = null, venueName = null;
  for (const sub of subs) {
    if (!dishesId && matchPattern(sub.name, DISH_FOLDER_PATTERNS)) {
      dishesId = sub.id; dishesName = sub.name;
    }
    if (!venueId && matchPattern(sub.name, VENUE_FOLDER_PATTERNS)) {
      venueId = sub.id; venueName = sub.name;
    }
  }
  if (!dishesId) {
    console.warn(`  ⚠ no dish-photos folder found under "${drive.folderName}". Looked for: ${DISH_FOLDER_PATTERNS.map(r => r.source).join(', ')}`);
  }
  if (!venueId) {
    console.warn(`  ⚠ no venue-photos folder found under "${drive.folderName}". Looked for: ${VENUE_FOLDER_PATTERNS.map(r => r.source).join(', ')}`);
  }
  const resolved = {
    dishes: dishesId ? { id: dishesId, name: dishesName } : null,
    venue:  venueId  ? { id: venueId,  name: venueName  } : null,
  };

  // Persist resolution back to config so subsequent runs skip the lookup.
  config.googleDrive.resolvedFolders = resolved;
  fs.writeFileSync(path.resolve(configPath), JSON.stringify(config, null, 2) + '\n');
  console.log(`  ✓ saved resolution: dishes=${dishesName || '(none)'}, venue=${venueName || '(none)'}`);
  return resolved;
}

async function listImagesInFolder(folderId) {
  const result = await callTool(config, 'GOOGLEDRIVE_FIND_FILE', {
    q: `'${folderId}' in parents and trashed=false`,
    page_size: 200,
  });
  const files = result?.data?.files || result?.files || result?.data || [];
  return (Array.isArray(files) ? files : []).filter((f) => IMAGE_MIME_RE.test(f.mimeType || ''));
}

async function downloadFile(fileId, destPath) {
  const result = await callTool(config, 'GOOGLEDRIVE_DOWNLOAD_FILE', { fileId });
  const b64 = result?.data?.content || result?.content;
  const url = result?.data?.download_url || result?.data?.url;
  if (b64 && typeof b64 === 'string') {
    fs.writeFileSync(destPath, Buffer.from(b64, 'base64'));
    return true;
  }
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download URL fetch failed: ${res.status}`);
    fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    return true;
  }
  throw new Error(`GOOGLEDRIVE_DOWNLOAD_FILE returned neither content nor url: ${JSON.stringify(result).slice(0, 300)}`);
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

async function syncFolder(folderInfo, destDir, label) {
  if (!folderInfo) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const remote = await listImagesInFolder(folderInfo.id);
  console.log(`  ${label}: ${remote.length} image(s) in "${folderInfo.name}"`);
  const index = loadIndex();
  const localPaths = [];
  let downloaded = 0, skipped = 0, failed = 0;
  for (const file of remote) {
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0] || '.jpg';
    const safeName = `${file.id}${ext}`;
    const destPath = path.join(destDir, safeName);
    if (index.files[file.id] && fs.existsSync(destPath)) {
      skipped++;
      localPaths.push({ path: destPath, originalName: file.name });
      continue;
    }
    try {
      await downloadFile(file.id, destPath);
      index.files[file.id] = {
        name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime,
        localPath: destPath, category: label.toLowerCase(),
        downloadedAt: new Date().toISOString(),
      };
      downloaded++;
      localPaths.push({ path: destPath, originalName: file.name });
    } catch (e) {
      failed++;
      console.error(`    ❌ ${file.name}: ${e.message}`);
    }
  }
  saveIndex(index);
  console.log(`    ${downloaded} new, ${skipped} cached, ${failed} failed`);
  return localPaths;
}

function fuzzyMatchDish(localPaths, dishName) {
  if (!dishName) return localPaths.map((p) => p.path);
  const needle = dishName.toLowerCase().replace(/\s+/g, '');
  // Score each filename: contains needle (full match), contains any word, no match.
  const scored = localPaths.map((p) => {
    const haystack = p.originalName.toLowerCase().replace(/[\s\-_.]/g, '');
    if (haystack.includes(needle)) return { p, score: 2 };
    const words = dishName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (words.some((w) => haystack.includes(w))) return { p, score: 1 };
    return { p, score: 0 };
  });
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (matched.length > 0) return matched.map((s) => s.p.path);
  // Soft fallback: any dish photo is better than no food reference.
  console.warn(`  ⚠ no dish photo matched "${dishName}" by name — falling back to any dish photo. ` +
               `Add e.g. "${dishName.toLowerCase().replace(/\s+/g, '-')}-1.jpg" to your Drive dishes folder for better matching.`);
  return localPaths.map((p) => p.path);
}

(async () => {
  fs.mkdirSync(cachePath, { recursive: true });
  const folders = await resolveFolders();

  const venuePhotos = await syncFolder(folders.venue, venueCacheDir, 'venue');
  const dishPhotos = skipDish
    ? (console.log('  dishes: skipped (--no-dish)'), [])
    : await syncFolder(folders.dishes, dishesCacheDir, 'dishes');

  // Hard rule: venue photos are required for image generation. If the
  // venue folder is missing or empty, write last-sync.json with empty
  // venuePhotos so generate-slides.js can fail with a clear "missing-venue"
  // exit code, which the orchestrator converts into an owner-facing message.
  if (venuePhotos.length === 0) {
    console.error('✗ No venue photos available. The blueprint requires venue references on 5 of 6 slides.');
    console.error('  → Owner must add photos of the dining room / exterior to their Drive venue folder.');
  }

  // Filter dish photos by --dish if provided.
  const filteredDishPaths = fuzzyMatchDish(dishPhotos, dishName);

  fs.writeFileSync(lastSyncPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    rootFolder: drive.folderName,
    resolvedFolders: folders,
    venuePhotos: venuePhotos.map((p) => p.path),
    dishPhotos: filteredDishPaths,
    dishFilter: dishName || null,
  }, null, 2) + '\n');

  console.log(`\nLast-sync written → ${lastSyncPath}`);
  console.log(`  venue photos: ${venuePhotos.length}`);
  console.log(`  dish photos:  ${filteredDishPaths.length}${dishName ? ` (filtered for "${dishName}")` : ''}`);
  if (venuePhotos.length === 0) process.exit(2);  // distinct exit code
})();

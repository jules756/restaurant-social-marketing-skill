#!/usr/bin/env node
/**
 * Find the restaurant's Drive folder by name (via Composio) and save the
 * folder's Drive ID to config.json. That's the ONLY job of this script.
 *
 * The AI agent (Hermes, called via Composio Drive tools at runtime) does
 * all actual reading / downloading / classifying of photos on demand.
 * Drive is the source of truth — no local cache, no sync of file bytes,
 * no stale state.
 *
 * Usage:
 *   node drive-sync.js --config <config.json>
 *
 * Reads:  config.googleDrive.folderName (default: "akira-agent_src").
 * Writes: config.googleDrive.folderId (the Drive folder ID).
 *
 * If the folder doesn't exist under the connected Drive account, creates
 * it. Idempotent — re-runs update the saved ID if it changed.
 */

const fs = require('fs');
const path = require('path');
const { findDriveFolderByName, findOrCreateDriveFolder, loadConfig } = require('./composio-helpers');

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

const config = loadConfig(configPath);
const drive = config.googleDrive;
if (!drive?.enabled) {
  console.log('Google Drive is disabled in config. Nothing to do.');
  process.exit(0);
}
if (!drive.folderName) {
  console.error('config.googleDrive.folderName is required (default: "akira-agent_src")');
  process.exit(1);
}

(async () => {
  console.log(`Searching Drive for folder "${drive.folderName}" …`);
  let folderId = await findDriveFolderByName(config, drive.folderName);
  let created = false;
  if (!folderId) {
    const result = await findOrCreateDriveFolder(config, drive.folderName);
    folderId = result.id;
    created = result.created;
  }

  if (drive.folderId === folderId) {
    console.log(`  ✅ folderId already current: ${folderId}`);
  } else {
    drive.folderId = folderId;
    const full = loadConfig(configPath);
    full.googleDrive = drive;
    fs.writeFileSync(path.resolve(configPath), JSON.stringify(full, null, 2) + '\n');
    console.log(`  ✅ saved config.googleDrive.folderId = ${folderId}${created ? ' (folder newly created)' : ''}`);
  }

  console.log(
    `\nDone. AI agents can now query this folder via Composio tools ` +
    `(GOOGLEDRIVE_LIST_FILES with folder_id=${folderId}) to list subfolders / files ` +
    `on demand. No local cache is maintained by this script.`
  );
})();

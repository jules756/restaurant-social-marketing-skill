#!/usr/bin/env node
/**
 * Verify the restaurant's Drive folder exists by name (via Composio MCP).
 * Creates it if missing. The folder ID is NOT cached in config — Composio
 * MCP resolves the folder from the OAuth connection on each tool call,
 * so callers can use the folder name directly.
 *
 * Usage:
 *   node drive-sync.js --config <config.json>
 *
 * Reads:  config.googleDrive.folderName (default: "akira-agent_src").
 *
 * Idempotent — re-runs are no-ops once the folder exists.
 */

const path = require('path');
const { callTool, loadConfig } = require('./mcp-client');

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

async function findFolder(folderName) {
  const escaped = folderName.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`;
  const result = await callTool(config, 'GOOGLEDRIVE_LIST_FILES', { q, page_size: 10 });
  const files = result.data?.files || result.files || result.data || [];
  return Array.isArray(files) ? files.find((f) => (f.name || f.title) === folderName) : null;
}

(async () => {
  console.log(`Searching Drive for folder "${drive.folderName}" …`);
  let folder = await findFolder(drive.folderName);
  let created = false;
  if (!folder) {
    const result = await callTool(config, 'GOOGLEDRIVE_CREATE_FOLDER', { name: drive.folderName });
    const id = result.data?.id || result.id || result.data?.file?.id;
    if (!id) throw new Error(`createFolder("${drive.folderName}") returned no id`);
    folder = { id, name: drive.folderName };
    created = true;
  }
  console.log(`  ✅ folder "${drive.folderName}" present${created ? ' (newly created)' : ''} — id ${folder.id}`);
  console.log(
    `\nDone. Hermes can list / read this folder via Composio MCP tools ` +
    `(GOOGLEDRIVE_LIST_FILES, GOOGLEDRIVE_DOWNLOAD_FILE) by folder name on demand. ` +
    `No id is cached in config; Composio resolves it server-side.`
  );
})();

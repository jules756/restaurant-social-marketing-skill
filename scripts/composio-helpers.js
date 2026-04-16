/**
 * Composio SDK helpers for all scripts.
 *
 * Single integration path: @composio/core SDK.
 * No MCP, no hand-rolled REST. Every external call is
 * composio.tools.execute(slug, { userId, arguments }).
 *
 * Config needs exactly two Composio fields:
 *   config.composio.apiKey   — org-scoped API key (one org per restaurant)
 *   config.composio.userId   — entity identifier within that org
 */

const fs = require('fs');
const path = require('path');
const { Composio } = require('@composio/core');

let _client = null;

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file not found: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

function getClient(config) {
  if (_client) return _client;
  if (!config.composio?.apiKey) throw new Error('config.composio.apiKey is required');
  _client = new Composio({ apiKey: config.composio.apiKey });
  return _client;
}

function getUserId(config) {
  if (!config.composio?.userId) throw new Error('config.composio.userId is required');
  return config.composio.userId;
}

/**
 * Execute a Composio tool directly by slug.
 *
 * @param {object} config     — loaded config.json
 * @param {string} toolSlug   — e.g. 'INSTAGRAM_POST_IG_USER_MEDIA'
 * @param {object} args       — tool-specific arguments
 * @returns {Promise<object>} — tool execution result
 */
async function executeTool(config, toolSlug, args = {}) {
  const composio = getClient(config);
  const userId = getUserId(config);
  return composio.tools.execute(toolSlug, {
    userId,
    arguments: args
  });
}

/**
 * Upload a file via Composio. The SDK may expose this natively; if not,
 * we fall back to the REST presigned-upload pattern.
 */
async function uploadFile(config, toolkitSlug, toolSlug, filePath, mimetype = 'image/png') {
  // Try SDK upload first; fall back to REST if not exposed
  const composio = getClient(config);
  if (typeof composio.files?.upload === 'function') {
    return composio.files.upload({
      toolkitSlug,
      toolSlug,
      filePath,
      mimetype
    });
  }
  // REST fallback (presigned URL pattern)
  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const apiKey = config.composio.apiKey;
  const presignRes = await fetch('https://backend.composio.dev/api/v3/files/upload/request', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolkit_slug: toolkitSlug, tool_slug: toolSlug, filename, mimetype })
  });
  if (!presignRes.ok) throw new Error(`uploadFile presign failed (${presignRes.status})`);
  const presignData = await presignRes.json();
  if (presignData.error) throw new Error(`uploadFile presign error: ${JSON.stringify(presignData.error)}`);
  const putRes = await fetch(presignData.new_presigned_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimetype },
    body: fileBuffer
  });
  if (!putRes.ok) throw new Error(`uploadFile PUT failed (${putRes.status})`);
  return presignData.key;
}

const PLATFORMS = {
  tiktok: {
    toolkit: 'tiktok',
    postPhotoTool: 'TIKTOK_POST_PHOTO',
    listVideosTool: 'TIKTOK_LIST_VIDEOS',
    userStatsTool: 'TIKTOK_GET_USER_STATS',
    dimensions: { width: 1024, height: 1536 },
    slides: 6
  },
  instagram: {
    toolkit: 'instagram',
    createMediaTool: 'INSTAGRAM_POST_IG_USER_MEDIA',
    publishMediaTool: 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH',
    mediaInsightsTool: 'INSTAGRAM_GET_IG_MEDIA_INSIGHTS',
    userInsightsTool: 'INSTAGRAM_GET_USER_INSIGHTS',
    dimensions: { width: 1080, height: 1350 },
    maxSlides: 10
  },
  facebook: {
    toolkit: 'facebook',
    createPhotoTool: 'FACEBOOK_CREATE_PHOTO_POST',
    pageInsightsTool: 'FACEBOOK_GET_PAGE_INSIGHTS',
    postInsightsTool: 'FACEBOOK_GET_POST_INSIGHTS',
    dimensions: { width: 1200, height: 630 },
    slides: 1
  },
  googledrive: {
    toolkit: 'googledrive',
    listFilesTool: 'GOOGLEDRIVE_LIST_FILES',
    downloadFileTool: 'GOOGLEDRIVE_DOWNLOAD_FILE',
    createFolderTool: 'GOOGLEDRIVE_CREATE_FOLDER'
  }
};

async function findDriveFolderByName(config, folderName) {
  const query = `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`;
  const attempts = [
    { q: query, page_size: 10 },
    { query, page_size: 10 },
    { search_query: query, page_size: 10 }
  ];
  let lastError;
  for (const args of attempts) {
    try {
      const result = await executeTool(config, PLATFORMS.googledrive.listFilesTool, args);
      const files = result.data?.files || result.files || result.data || [];
      const folder = files.find((f) => (f.name || f.title) === folderName);
      if (folder?.id) return folder.id;
    } catch (e) {
      lastError = e;
    }
  }
  return null;
}

async function createDriveFolder(config, folderName) {
  const attempts = [
    { name: folderName },
    { folder_name: folderName },
    { title: folderName }
  ];
  let lastError;
  for (const args of attempts) {
    try {
      const result = await executeTool(config, PLATFORMS.googledrive.createFolderTool, args);
      const id = result.data?.id || result.id || result.data?.file?.id;
      if (id) return id;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`createDriveFolder("${folderName}") failed: ${lastError?.message || 'no id'}`);
}

async function findOrCreateDriveFolder(config, folderName) {
  const existing = await findDriveFolderByName(config, folderName);
  if (existing) return { id: existing, created: false };
  const created = await createDriveFolder(config, folderName);
  return { id: created, created: true };
}

module.exports = {
  loadConfig,
  getClient,
  getUserId,
  executeTool,
  uploadFile,
  findDriveFolderByName,
  createDriveFolder,
  findOrCreateDriveFolder,
  PLATFORMS
};

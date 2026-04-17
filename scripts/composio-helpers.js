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
const crypto = require('crypto');
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
  const composio = getClient(config);
  const absPath = path.resolve(filePath);
  const fileBuffer = fs.readFileSync(absPath);
  const filename = path.basename(absPath);
  const md5 = crypto.createHash('md5').update(fileBuffer).digest('hex');

  // SDK path — the v0.1.55 SDK's files.upload signature keeps rejecting
  // every shape we try. Skip it and go straight to the REST fallback
  // until the SDK is upgraded (latest is 0.6.10). One warning per run,
  // not per file.
  if (typeof composio.files?.upload === 'function' && !uploadFile._warnedSdk) {
    uploadFile._warnedSdk = true;
    // Uncomment to verbose: console.warn('Skipping SDK files.upload; using REST fallback.');
  }

  // REST fallback. v3 presign now requires md5 of the payload.
  const apiKey = config.composio.apiKey;
  const presignRes = await fetch('https://backend.composio.dev/api/v3/files/upload/request', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolkit_slug: toolkitSlug,
      tool_slug: toolSlug,
      filename,
      mimetype,
      md5
    })
  });
  if (!presignRes.ok) throw new Error(`uploadFile presign failed (${presignRes.status}): ${await presignRes.text()}`);
  const presignData = await presignRes.json();
  if (presignData.error) throw new Error(`uploadFile presign error: ${JSON.stringify(presignData.error)}`);
  if (process.env.COMPOSIO_DEBUG && !uploadFile._loggedFields) {
    uploadFile._loggedFields = true;
    console.error('[DEBUG] presign response keys:', Object.keys(presignData));
    console.error('[DEBUG] presign response:', JSON.stringify(presignData).slice(0, 500));
  }
  const uploadUrl = presignData.new_presigned_url || presignData.presigned_url || presignData.url;
  if (!uploadUrl) throw new Error(`uploadFile: presign returned no URL: ${JSON.stringify(presignData).slice(0, 200)}`);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimetype },
    body: fileBuffer
  });
  if (!putRes.ok) throw new Error(`uploadFile PUT failed (${putRes.status}): ${await putRes.text()}`);
  // Return a URL Instagram (or any downstream tool) can actually fetch.
  // Composio's v3 file upload uses Cloudflare R2 with SHORT-LIVED signed URLs.
  // The signed URL itself (including query string) IS the fetchable URL —
  // valid ~15-60 min, enough time for Instagram's media-creation download.
  // Do NOT strip the query string — that breaks the signature.
  const publicUrl =
    presignData.public_url ||
    presignData.download_url ||
    presignData.file_url ||
    presignData.access_url ||
    uploadUrl; // full signed URL, query string intact
  return {
    key: presignData.key || presignData.file_key || presignData.id,
    url: publicUrl,
    raw: presignData
  };
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

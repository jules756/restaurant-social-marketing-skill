/**
 * Shared Composio v3 REST utilities used by cron scripts.
 *
 * All scripts now pass the loaded `config` object; helpers read
 * config.composio.{projectApiKey, userId} once, eliminating the old pattern
 * of threading apiKey / userId / connected_account_id as explicit args.
 *
 * Composio v3's tools-execute endpoint resolves the correct connected account
 * from (user_id, toolkit) when the user has exactly one connection per
 * toolkit, so we no longer maintain per-platform `connected_account_id`
 * values in config.json. If a restaurant ever connects multiple accounts
 * for the same toolkit, we'll reintroduce a `connected_account_id` override
 * parameter at that time.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://backend.composio.dev';

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file not found: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

function requireComposioAuth(config) {
  const c = config.composio;
  if (!c?.projectApiKey) throw new Error('config.composio.projectApiKey is required');
  if (!c?.userId) throw new Error('config.composio.userId is required');
  return c;
}

async function executeTool(config, toolSlug, args = {}) {
  const { projectApiKey, userId } = requireComposioAuth(config);
  const res = await fetch(`${BASE_URL}/api/v3/tools/execute/${toolSlug}`, {
    method: 'POST',
    headers: { 'x-api-key': projectApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, arguments: args })
  });
  if (!res.ok) {
    throw new Error(`executeTool(${toolSlug}) failed (${res.status}): ${await res.text()}`);
  }
  const result = await res.json();
  if (result.error) {
    throw new Error(`executeTool(${toolSlug}) returned error: ${JSON.stringify(result.error)}`);
  }
  return result;
}

/**
 * Proxy an arbitrary HTTP request to an external service whose credential
 * is stored in this Composio Project (e.g. OpenRouter). Composio injects the
 * stored credential into the outbound request. Used for image generation and
 * vision classification so no third-party API keys live on the VM.
 */
async function executeProxy(config, endpoint, method, body = null) {
  const { projectApiKey, userId } = requireComposioAuth(config);
  const payload = { user_id: userId, endpoint, method };
  if (body !== null) payload.body = body;
  const res = await fetch(`${BASE_URL}/api/v3/tools/execute/proxy`, {
    method: 'POST',
    headers: { 'x-api-key': projectApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error(`executeProxy(${method} ${endpoint}) failed (${res.status}): ${await res.text()}`);
  }
  const result = await res.json();
  if (result.error) {
    throw new Error(`executeProxy(${method} ${endpoint}) returned error: ${JSON.stringify(result.error)}`);
  }
  return result;
}

async function uploadFile(config, toolkitSlug, toolSlug, filePath, mimetype = 'image/png') {
  const { projectApiKey } = requireComposioAuth(config);
  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const presignRes = await fetch(`${BASE_URL}/api/v3/files/upload/request`, {
    method: 'POST',
    headers: { 'x-api-key': projectApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolkit_slug: toolkitSlug, tool_slug: toolSlug, filename, mimetype })
  });
  if (!presignRes.ok) {
    throw new Error(`uploadFile presign failed (${presignRes.status}): ${await presignRes.text()}`);
  }
  const presignData = await presignRes.json();
  if (presignData.error) {
    throw new Error(`uploadFile presign error: ${JSON.stringify(presignData.error)}`);
  }
  const putRes = await fetch(presignData.new_presigned_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimetype },
    body: fileBuffer
  });
  if (!putRes.ok) {
    throw new Error(`uploadFile PUT failed (${putRes.status}): ${await putRes.text()}`);
  }
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
  if (lastError) {
    console.warn(`findDriveFolderByName("${folderName}") failed: ${lastError.message}`);
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
  throw new Error(
    `createDriveFolder("${folderName}") failed. Last error: ${lastError?.message || 'no id in response'}`
  );
}

async function findOrCreateDriveFolder(config, folderName) {
  const existing = await findDriveFolderByName(config, folderName);
  if (existing) return { id: existing, created: false };
  const created = await createDriveFolder(config, folderName);
  return { id: created, created: true };
}

module.exports = {
  executeTool,
  executeProxy,
  uploadFile,
  findDriveFolderByName,
  createDriveFolder,
  findOrCreateDriveFolder,
  PLATFORMS,
  BASE_URL,
  loadConfig,
  requireComposioAuth
};

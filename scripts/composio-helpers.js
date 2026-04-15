/**
 * Shared Composio v3 API utilities used across every script.
 *
 * Exposes:
 *   - executeTool(apiKey, connectedAccountId, userId, toolSlug, args)
 *   - executeProxy(apiKey, connectedAccountId, endpoint, method, body)
 *   - uploadFile(apiKey, toolkitSlug, toolSlug, filePath, mimetype)
 *   - PLATFORMS constant (tiktok, instagram, facebook, googledrive)
 *
 * All paths are platform-agnostic — scripts never hardcode tiktok-marketing/.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://backend.composio.dev';

async function executeTool(apiKey, connectedAccountId, userId, toolSlug, args = {}) {
  const res = await fetch(`${BASE_URL}/api/v3/tools/execute/${toolSlug}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connected_account_id: connectedAccountId,
      user_id: userId,
      arguments: args
    })
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

async function executeProxy(apiKey, connectedAccountId, endpoint, method, body = null) {
  const payload = { connected_account_id: connectedAccountId, endpoint, method };
  if (body !== null) payload.body = body;
  const res = await fetch(`${BASE_URL}/api/v3/tools/execute/proxy`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
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

async function uploadFile(apiKey, toolkitSlug, toolSlug, filePath, mimetype = 'image/png') {
  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const presignRes = await fetch(`${BASE_URL}/api/v3/files/upload/request`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
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
    downloadFileTool: 'GOOGLEDRIVE_DOWNLOAD_FILE'
  }
};

/**
 * Find a Google Drive folder by name via Composio. Returns the folder's
 * Drive file ID, or null if no folder with that name is reachable by the
 * connected account. Case-sensitive exact match on the folder name.
 *
 * Uses the Drive `q` search parameter via GOOGLEDRIVE_LIST_FILES. Different
 * Composio tool versions expose the query parameter under slightly different
 * names, so we try a few shapes and pick the first that works.
 */
async function findDriveFolderByName(apiKey, connectedAccountId, folderName) {
  const userId = `drive_folder_search_${Date.now()}`;
  const query = `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`;

  const attempts = [
    { q: query, page_size: 10 },
    { query, page_size: 10 },
    { search_query: query, page_size: 10 }
  ];

  let lastError;
  for (const args of attempts) {
    try {
      const result = await executeTool(
        apiKey,
        connectedAccountId,
        userId,
        PLATFORMS.googledrive.listFilesTool,
        args
      );
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

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file not found: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

module.exports = { executeTool, executeProxy, uploadFile, findDriveFolderByName, PLATFORMS, BASE_URL, loadConfig };

/**
 * Shared Composio API utilities for all platform posting scripts.
 *
 * Provides helpers for executing tools, proxy requests, and file uploads
 * against the Composio backend, plus platform configuration constants.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://backend.composio.dev';

/**
 * Execute a Composio tool.
 * POST /api/v3/tools/execute/{toolSlug}
 *
 * @param {string} apiKey        - Composio API key
 * @param {string} connectedAccountId - Connected account ID for the platform
 * @param {string} userId        - Composio user ID
 * @param {string} toolSlug      - Tool identifier (e.g. TIKTOK_POST_PHOTO)
 * @param {object} args          - Tool-specific arguments
 * @returns {Promise<object>}    - Parsed JSON response from Composio
 */
async function executeTool(apiKey, connectedAccountId, userId, toolSlug, args = {}) {
  const res = await fetch(`${BASE_URL}/api/v3/tools/execute/${toolSlug}`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      connected_account_id: connectedAccountId,
      user_id: userId,
      arguments: args
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`executeTool(${toolSlug}) failed (${res.status}): ${text}`);
  }

  const result = await res.json();

  if (result.error) {
    throw new Error(`executeTool(${toolSlug}) returned error: ${JSON.stringify(result.error)}`);
  }

  return result;
}

/**
 * Execute a proxy request through Composio (for direct platform API calls).
 * POST /api/v3/tools/execute/proxy
 *
 * @param {string} apiKey              - Composio API key
 * @param {string} connectedAccountId  - Connected account ID for the platform
 * @param {string} endpoint            - Target platform API endpoint URL
 * @param {string} method              - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param {object|null} body           - Request body (null for GET requests)
 * @returns {Promise<object>}          - Parsed JSON response from Composio
 */
async function executeProxy(apiKey, connectedAccountId, endpoint, method, body = null) {
  const payload = {
    connected_account_id: connectedAccountId,
    endpoint,
    method
  };

  if (body !== null) {
    payload.body = body;
  }

  const res = await fetch(`${BASE_URL}/api/v3/tools/execute/proxy`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`executeProxy(${method} ${endpoint}) failed (${res.status}): ${text}`);
  }

  const result = await res.json();

  if (result.error) {
    throw new Error(`executeProxy(${method} ${endpoint}) returned error: ${JSON.stringify(result.error)}`);
  }

  return result;
}

/**
 * Upload a file via Composio's presigned URL pattern.
 *
 * 1. POST /api/v3/files/upload/request  - get a presigned upload URL
 * 2. PUT file binary to the presigned URL
 *
 * Returns the file key for use in tool arguments.
 *
 * @param {string} apiKey       - Composio API key
 * @param {string} toolkitSlug  - Toolkit identifier (e.g. 'tiktok', 'instagram')
 * @param {string} toolSlug     - Tool identifier (e.g. 'TIKTOK_POST_PHOTO')
 * @param {string} filePath     - Absolute path to the file to upload
 * @param {string} mimetype     - MIME type of the file (default: 'image/png')
 * @returns {Promise<string>}   - The file key for referencing in tool arguments
 */
async function uploadFile(apiKey, toolkitSlug, toolSlug, filePath, mimetype = 'image/png') {
  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  // Step 1 - Request a presigned upload URL
  const presignRes = await fetch(`${BASE_URL}/api/v3/files/upload/request`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      toolkit_slug: toolkitSlug,
      tool_slug: toolSlug,
      filename,
      mimetype
    })
  });

  if (!presignRes.ok) {
    const text = await presignRes.text();
    throw new Error(`uploadFile presign request failed (${presignRes.status}): ${text}`);
  }

  const presignData = await presignRes.json();

  if (presignData.error) {
    throw new Error(`uploadFile presign returned error: ${JSON.stringify(presignData.error)}`);
  }

  // Step 2 - PUT the file binary to the presigned URL
  const putRes = await fetch(presignData.new_presigned_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimetype },
    body: fileBuffer
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`uploadFile PUT failed for ${filename} (${putRes.status}): ${text}`);
  }

  return presignData.key;
}

/**
 * Platform configuration constants.
 */
const PLATFORMS = {
  tiktok: {
    toolkit: 'tiktok',
    postPhotoTool: 'TIKTOK_POST_PHOTO',
    listVideosTool: 'TIKTOK_LIST_VIDEOS',
    userStatsTool: 'TIKTOK_GET_USER_STATS',
    dimensions: { width: 1024, height: 1536 },
    maxSlides: 35,
    minSlides: 6
  },
  instagram: {
    toolkit: 'instagram',
    createMediaTool: 'INSTAGRAM_POST_IG_USER_MEDIA',
    publishMediaTool: 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH',
    mediaInsightsTool: 'INSTAGRAM_GET_IG_MEDIA_INSIGHTS',
    userInsightsTool: 'INSTAGRAM_GET_USER_INSIGHTS',
    feedDimensions: { width: 1080, height: 1350 },
    reelsDimensions: { width: 1080, height: 1920 },
    maxCarouselSlides: 10
  },
  facebook: {
    toolkit: 'facebook',
    createPhotoTool: 'FACEBOOK_CREATE_PHOTO_POST',
    pageInsightsTool: 'FACEBOOK_GET_PAGE_INSIGHTS',
    postInsightsTool: 'FACEBOOK_GET_POST_INSIGHTS',
    feedDimensions: { width: 1200, height: 630 }
  }
};

module.exports = { executeTool, executeProxy, uploadFile, PLATFORMS, BASE_URL };

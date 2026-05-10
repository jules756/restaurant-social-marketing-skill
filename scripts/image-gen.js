/**
 * Dual-backend image generation.
 *
 *   primary:    azure | composio
 *   fallback:   on error, swap to the other backend (if fallbackOnError)
 *
 * Both backends speak the same public surface:
 *   generateImage({ prompt, size, references? }) → Buffer (PNG bytes)
 *
 * Azure backend is *native* Azure OpenAI (ai.azure.com deployments),
 * URL shape:
 *   {endpoint}/openai/deployments/{deployment}/images/{generations|edits}
 *     ?api-version={apiVersion}
 * Auth: Authorization: Bearer <key>. Body shape matches OpenAI's
 * gpt-image-* contract (no response_format — Azure always returns b64).
 *
 * Composio backend goes through MCP using OPENAI_CREATE_IMAGE /
 * OPENAI_CREATE_IMAGE_EDIT.
 *
 * Why dual: owners with Azure credits run Azure as primary (free); Composio
 * is the durable fallback. Flip imageGen.primary in config to switch.
 */

const fs = require('fs');
const path = require('path');
const { callTool, findToolByPattern, listAllTools } = require('./mcp-client');

// ─── Composio backend ─────────────────────────────────────────────────
let _composioTxt2img = null;
let _composioImg2img = null;

async function resolveComposioTools(config) {
  if (_composioTxt2img && _composioImg2img) return;
  if (config.imageGen?.composio?.toolSlug) _composioTxt2img = config.imageGen.composio.toolSlug;
  if (!_composioTxt2img) {
    const exact = await findToolByPattern(config, /^OPENAI_CREATE_IMAGE$/i);
    if (exact) _composioTxt2img = exact.tool.name;
    else {
      const fuzzy = await findToolByPattern(config, /^OPENAI_.*IMAGE.*GENERAT/i);
      if (!fuzzy) {
        const all = await listAllTools(config);
        const names = all.map((t) => t.name).slice(0, 30).join(', ');
        throw new Error(`Composio: no OpenAI image tool. First tools: ${names}`);
      }
      _composioTxt2img = fuzzy.tool.name;
    }
  }
  if (!_composioImg2img) {
    const exact = await findToolByPattern(config, /^OPENAI_CREATE_IMAGE_EDIT$/i);
    if (exact) _composioImg2img = exact.tool.name;
  }
  if (!_composioImg2img) {
    throw new Error('Composio: OPENAI_CREATE_IMAGE_EDIT not advertised.');
  }
}

function extractImageB64(result) {
  const candidates = [
    result?.data?.[0]?.b64_json, result?.data?.b64_json,
    result?.images?.[0]?.b64_json, result?.images?.[0]?.b64,
    result?.b64_json, result?.image_b64,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}

async function composioGenerate(config, { prompt, size, references }) {
  await resolveComposioTools(config);
  const useEdit = references && references.length > 0;
  const slug = useEdit ? _composioImg2img : _composioTxt2img;
  const baseArgs = { prompt, model: config.imageGen?.model || 'gpt-image-2', n: 1, size };
  let toolArgs;
  if (useEdit) {
    // Composio's OPENAI_CREATE_IMAGE_EDIT accepts `images` as base64 strings
    // or objects with `image_b64`. Read each ref into base64.
    toolArgs = {
      ...baseArgs,
      images: references.map((p) => ({
        image_b64: fs.readFileSync(path.resolve(p)).toString('base64'),
      })),
    };
  } else {
    toolArgs = { ...baseArgs, response_format: 'b64_json' };
  }
  const result = await callTool(config, slug, toolArgs);
  if (result?.error) throw new Error(result.error?.message || JSON.stringify(result.error).slice(0, 300));
  const b64 = extractImageB64(result);
  if (!b64) throw new Error(`Composio: no image in ${slug} response. First 300 chars: ${JSON.stringify(result).slice(0, 300)}`);
  return Buffer.from(b64, 'base64');
}

// ─── Azure OpenAI backend (native ai.azure.com deployments) ───────────
function azureConfig(config) {
  const az = config.imageGen?.azure || {};
  // Back-compat: old configs used baseUrl (full path incl. /openai/v1).
  // New configs use endpoint (host only) + deployment + apiVersion.
  const endpoint = (az.endpoint || az.baseUrl || '').replace(/\/+$/, '');
  const deployment = az.deployment || config.imageGen?.model || 'gpt-image-2';
  const apiVersion = az.apiVersion || '2024-02-01';
  const apiKeyEnv = az.apiKeyEnv || 'AZURE_API_KEY';
  const apiKey = az.apiKey || process.env[apiKeyEnv] || '';
  const quality = az.quality || 'high';
  return { endpoint, deployment, apiVersion, apiKey, quality };
}

function azureUrl({ endpoint, deployment, apiVersion }, kind) {
  // kind: 'generations' | 'edits'
  return `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/images/${kind}?api-version=${encodeURIComponent(apiVersion)}`;
}

async function azureGenerate(config, { prompt, size, references }) {
  const az = azureConfig(config);
  if (!az.endpoint) throw new Error('Azure: imageGen.azure.endpoint is empty.');
  if (!az.apiKey) throw new Error(`Azure: api key missing — set imageGen.azure.apiKey or env ${config.imageGen?.azure?.apiKeyEnv || 'AZURE_API_KEY'}.`);

  const useEdit = references && references.length > 0;
  const url = azureUrl(az, useEdit ? 'edits' : 'generations');

  let res;
  if (useEdit) {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('n', '1');
    for (const p of references) {
      const buf = fs.readFileSync(path.resolve(p));
      form.append('image', new Blob([buf], { type: 'image/png' }), path.basename(p));
    }
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${az.apiKey}` },
      body: form,
    });
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${az.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        size,
        n: 1,
        quality: az.quality,
        output_format: 'png',
        output_compression: 100,
      }),
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Azure ${url} → ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const b64 = extractImageB64(json);
  if (!b64) throw new Error(`Azure: no image in response. First 300 chars: ${JSON.stringify(json).slice(0, 300)}`);
  return Buffer.from(b64, 'base64');
}

// ─── Public ───────────────────────────────────────────────────────────
async function generateImage(config, opts) {
  const primary = config.imageGen?.primary || 'composio';
  const fallback = config.imageGen?.fallbackOnError !== false;
  const order = primary === 'azure' ? ['azure', 'composio'] : ['composio', 'azure'];
  if (!fallback) order.length = 1;
  let lastErr;
  for (const backend of order) {
    try {
      const buf = backend === 'azure'
        ? await azureGenerate(config, opts)
        : await composioGenerate(config, opts);
      return { buf, backend };
    } catch (e) {
      lastErr = e;
      console.log(`  ⚠ ${backend} failed: ${e.message.slice(0, 200)}${order.length > 1 ? ' — trying fallback' : ''}`);
    }
  }
  throw lastErr || new Error('All image-gen backends failed.');
}

// Exported for setup.js preflight.
async function azurePreflight(config) {
  const az = azureConfig(config);
  if (!az.endpoint || !az.apiKey) {
    return { ok: false, reason: 'endpoint or apiKey not set' };
  }
  const url = azureUrl(az, 'generations');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${az.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'a small red square on white background',
        size: '1024x1024',
        n: 1,
        quality: 'low',
        output_format: 'png',
      }),
    });
    if (res.ok) return { ok: true, deployment: az.deployment };
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { generateImage, azurePreflight };

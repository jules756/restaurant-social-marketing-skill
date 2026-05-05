const assert = require('assert');
const Module = require('module');

// Stub the MCP SDK before requiring mcp-client.
const fakeTools = [
  { name: 'INSTAGRAM_POST_IG_USER_MEDIA', description: 'post to ig', inputSchema: {} },
  { name: 'OPENAI_GENERATE_IMAGE', description: 'gpt-image-2', inputSchema: {} }
];
let lastCallToolArgs = null;
const stubClient = {
  connect: async () => {},
  listTools: async () => ({ tools: fakeTools }),
  callTool: async (args) => { lastCallToolArgs = args; return { content: [{ type: 'text', text: '{"ok":true}' }] }; },
  close: async () => {}
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === '@modelcontextprotocol/sdk/client/index.js') return req;
  if (req === '@modelcontextprotocol/sdk/client/streamableHttp.js') return req;
  return origResolve.call(this, req, ...rest);
};
require.cache['@modelcontextprotocol/sdk/client/index.js'] = {
  id: '@modelcontextprotocol/sdk/client/index.js',
  filename: '@modelcontextprotocol/sdk/client/index.js',
  loaded: true,
  exports: { Client: function () { return stubClient; } }
};
require.cache['@modelcontextprotocol/sdk/client/streamableHttp.js'] = {
  id: '@modelcontextprotocol/sdk/client/streamableHttp.js',
  filename: '@modelcontextprotocol/sdk/client/streamableHttp.js',
  loaded: true,
  exports: { StreamableHTTPClientTransport: function () { return {}; } }
};

const { connectMcp, callTool, listTools, resetForTests } = require('../scripts/mcp-client');

(async () => {
  const cfg = { composio: { apiKey: 'k', mcpServerUrl: 'https://example/mcp' } };

  // listTools returns the advertised tools.
  const tools = await listTools(cfg);
  assert.deepStrictEqual(tools.map(t => t.name).sort(), ['INSTAGRAM_POST_IG_USER_MEDIA', 'OPENAI_GENERATE_IMAGE']);

  // callTool forwards name + args to the MCP transport.
  await callTool(cfg, 'INSTAGRAM_POST_IG_USER_MEDIA', { ig_user_id: 'x', media_type: 'IMAGE' });
  assert.strictEqual(lastCallToolArgs.name, 'INSTAGRAM_POST_IG_USER_MEDIA');
  assert.deepStrictEqual(lastCallToolArgs.arguments, { ig_user_id: 'x', media_type: 'IMAGE' });

  // Missing mcpServerUrl throws a clear error.
  resetForTests();
  await assert.rejects(
    () => callTool({ composio: { apiKey: 'k' } }, 'X', {}),
    /mcpServerUrl/
  );

  console.log('test-mcp-client: 3 assertions passed');
})();

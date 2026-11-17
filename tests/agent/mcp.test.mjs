import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '../../agent/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../agent/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

test('real MCP stdio handshake exposes bounded tools and rejects unknown or malformed writes', async t => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../../agent/server.mjs', import.meta.url))], stderr: 'pipe' });
  const client = new Client({ name: 'clips-test', version: '1.0.0' });
  await client.connect(transport); t.after(() => client.close());
  const { tools } = await client.listTools();
  assert.equal(tools.length, 5); assert.equal(tools.find(t => t.name === 'clips_create_note').annotations.destructiveHint, false);
  assert.equal(tools.find(t => t.name === 'clips_search').annotations.readOnlyHint, true);
  assert.match(client.getInstructions(), /untrusted/);
  for (const name of ['CONFIG_GET', 'clips_create_note']) {
    const result = await client.callTool({ name, arguments: {} }); assert.equal(result.isError, true);
  }
});

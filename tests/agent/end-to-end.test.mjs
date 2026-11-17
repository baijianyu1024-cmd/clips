import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocket } from '../../agent/node_modules/ws/wrapper.mjs';
import { Client } from '../../agent/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../agent/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { startBroker } from '../../agent/broker.mjs';
import { createMCPServer } from '../../agent/server.mjs';
import { startAgentBridge } from '../../extension/agent-bridge.js';
import { diskFolder } from '../extension/folder-fixture.mjs';
import { openFolder, createFolderRepository } from '../../extension/folder-store.js';
import { AGENT_ORIGIN } from '../../extension/agent-protocol.js';

test('MCP → loopback broker → extension bridge → real folder, including switching and disconnect', async t => {
  const disk = await diskFolder(t), target = await openFolder(disk.root), ext = 'a'.repeat(32);
  target.connection = 'test'; const key = `local:${target.id}:test`;
  const repo = createFolderRepository(disk.root, target.id);
  const config = { version: 1, token: randomBytes(32).toString('hex') };
  const broker = await startBroker({ config, port: 0, persist: async () => {} }); t.after(() => broker.close());
  const origin = `http://127.0.0.1:${broker.server.address().port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => realFetch(String(url).replace(AGENT_ORIGIN, origin), String(url) === AGENT_ORIGIN + '/pair' ? { ...init, headers: { ...init.headers, Origin: 'chrome-extension://' + ext } } : init);
  globalThis.WebSocket = class extends WebSocket { constructor(url) { super(String(url).replace(AGENT_ORIGIN.replace('http:', 'ws:'), origin.replace('http:', 'ws:')), { origin: 'chrome-extension://' + ext }); } };
  const data = { clipsStorageTarget: target }, event = { addListener() {} };
  globalThis.chrome = {
    runtime: { id: ext, getManifest: () => ({ version: '0.16.0' }), onStartup: event },
    permissions: { contains: async () => true, onRemoved: event },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: event },
    storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])), set: async values => Object.assign(data, values), remove: async k => { delete data[k]; } }, onChanged: event },
  };
  const rpc = async (path, body) => {
    const r = await realFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token }, body: body ? JSON.stringify(body) : undefined });
    const out = await r.json(); if (out.error) throw Object.assign(new Error(out.error), { code: out.code }); return out;
  };
  const bridge = startAgentBridge({ request: repo.request, noteURL: id => 'https://clips.example/?note=' + id });
  t.after(async () => { await bridge.handle({ type: 'AGENT_DISCONNECT' }); globalThis.fetch = realFetch; });
  const pair = await rpc('/pairing', { extension_id: ext });
  await bridge.handle({ type: 'AGENT_PAIR', code: pair.code });
  for (let i = 0; i < 100 && !(await rpc('/status')).connected; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal((await rpc('/status')).connected, true);
  const server = createMCPServer(async (name, args) => (await rpc('/call', { name, arguments: args })).result);
  const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'test', version: '1' });
  await server.connect(a); await client.connect(b); t.after(() => client.close());
  const tool = async (name, args) => client.callTool({ name, arguments: args });
  const input = { request_id: crypto.randomUUID(), title: 'MCP 完整流程测试', content: '**结论**：使用统一保存通道。', tags: ['test'], source: { app: 'Codex' } };
  const created = await tool('clips_create_note', input); assert.equal(created.isError, undefined); assert.equal(created.structuredContent.saved, true);
  const again = await tool('clips_create_note', input); assert.equal(again.structuredContent.already_saved, true);
  const n = created.structuredContent;
  const append = await tool('clips_append_record', { request_id: crypto.randomUUID(), note_id: n.id, revision: n.revision, content: '第二条想法' }); assert.equal(append.structuredContent.saved, true);
  const search = await tool('clips_search', { query: '第二条想法' }); assert.equal(search.structuredContent.total, 1);
  const read = await tool('clips_get_note', { note_id: n.id }); assert.match(read.structuredContent.text, /第二条想法/);
  const saved = JSON.parse(await disk.read('clips.json')); assert.equal(saved.notes.length, 1); assert.equal(saved.notes[0].clips.length, 1);
  assert.equal(data.clipsAgentLastWrite.noteId, n.id);
  data.clipsStorageTarget = { mode: 'cloud', name: 'Other' };
  const blocked = await tool('clips_search', {}); assert.equal(blocked.isError, true); assert.match(blocked.content[0].text, /LIBRARY_CHANGED/);
  await bridge.handle({ type: 'AGENT_DISCONNECT' });
  for (let i = 0; i < 100 && (await rpc('/status')).connected; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal((await rpc('/status')).connected, false);
});

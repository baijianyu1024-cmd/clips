import test from 'node:test';
import assert from 'node:assert/strict';
let query;
globalThis.chrome = { runtime: { id: 'test' }, windows: { getCurrent: async () => ({ id: 42 }) }, tabs: { query: async options => { query = options; return [{ id: 6, url: 'https://example.com/old', pendingUrl: 'https://example.com/new', status: 'loading', title: 'Old title' }]; } } };
const { adapter } = await import('../../extension/adapter.js');
test('sidepanel reads its own window and does not reuse the previous title during navigation', async () => {
  const page = await adapter.page();
  assert.deepEqual(query,{active:true,windowId:42}); assert.equal(page.url,'https://example.com/new'); assert.equal(page.status,'loading'); assert.notEqual(page.title,'Old title');
});

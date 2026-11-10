import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueTitleSync } from '../../extension/queue-title-sync.js';
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
test('opening a queued document fills its title without creating, starting or pinning a note', async () => {
  let opened = [], fail = true; const calls = [];
  const note = { id: 'queue', status: 'inbox', title: 'my.feishu.cn', sources: [{ url: 'https://my.feishu.cn/wiki/one' }] };
  const sync = createQueueTitleSync({ tabs: async () => opened, cloud: async request => { calls.push(request); if (fail) throw Error('offline'); return { note: { ...note, title: '文档标题' } }; } });
  sync.update([note, { ...note, id: 'custom', title: '自己的标题' }, { ...note, id: 'reading', status: 'reading' }]); await flush(); assert.equal(calls.length, 0);
  opened = [{ url: note.sources[0].url, title: '文档标题', status: 'complete' }];
  await sync.refresh(); assert.equal(calls.length, 1);
  fail = false; await sync.refresh(); assert.equal(calls.length, 2);
  await sync.refresh(); assert.equal(calls.length, 2, 'resolved titles stop retrying');
  assert.deepEqual(calls[1].body, { action: 'resolve_title', id: 'queue', browser: { url: note.sources[0].url, title: '文档标题' }, browserOnly: true });
});

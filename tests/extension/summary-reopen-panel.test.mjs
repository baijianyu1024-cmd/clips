import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

test('reopening the panel displays the saved summary from the library, with Markdown and image actions', async () => {
  const { window, document } = parseHTML(await readFile(new URL('../../extension/panel.html', import.meta.url), 'utf8'));
  globalThis.window = window; globalThis.document = document;
  const summary = { id: 'saved-core', text: '**核心判断**\n\n- 以 `state` 保存状态\n- 通过事件继续执行', images: [{ key: 'notes/diagram.png', name: '架构图.png' }] };
  const note = { id: 'reopened-note', title: '已有笔记', kind: 'article', sources: [{ url: 'https://example.com/read' }], status: 'reading', revision: 2, tags: [], clips: [], images: [], aiSummaries: [], coreSummary: summary };
  const { adapter } = await import('../../extension/adapter.js');
  const storage = new Map([['activeNoteId', note.id], ['cachedNotes', [{ ...note, coreSummary: { ...summary, text: '过期缓存' } }]]]);
  let offline = false;
  adapter.read = async key => structuredClone(storage.get(key));
  adapter.write = async (key, value) => storage.set(key, structuredClone(value));
  adapter.pending = async () => null; adapter.subscribe = () => {};
  adapter.page = async () => ({ url: note.sources[0].url, title: note.title });
  adapter.cloud = async request => {
    assert.equal(request.method, undefined, 'opening a panel never mutates the saved summary');
    if (offline) throw Error('暂时离线');
    return { notes: [structuredClone(note)] };
  };
  const interval = globalThis.setInterval; globalThis.setInterval = () => 1;
  try { await import('../../extension/panel.js'); } finally { globalThis.setInterval = interval; }
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  await flush();
  const card = document.querySelector('#manual-summary');
  assert.equal(card.hidden, false);
  assert.equal(card.querySelector('strong').textContent, '核心判断');
  assert.equal(card.querySelector('code').textContent, 'state');
  assert.equal(card.querySelectorAll('li').length, 2);
  assert.equal(card.querySelector('[data-action="view-record-images"]').dataset.id, 'core:new');
  assert.equal(card.querySelector('[data-image-key]').dataset.imageKey, summary.images[0].key);
  assert.equal(card.querySelector('[data-kind="core"]').textContent, '编辑');
  assert.equal(card.querySelector('[data-action="ai"]').textContent, '重新生成');
  assert.doesNotMatch(card.textContent, /过期缓存/);
  assert.deepEqual(storage.get('cachedNotes')[0].coreSummary, summary);
  offline = true;
  // A failed refresh leaves the last successful saved content visible.
  const refresh = document.createElement('button'); refresh.dataset.action = 'refresh'; document.body.append(refresh);
  refresh.dispatchEvent(new window.Event('click', { bubbles: true })); await flush();
  assert.equal(card.querySelector('strong').textContent, '核心判断');
  assert.match(document.querySelector('#notice').textContent, /暂时离线/);
});

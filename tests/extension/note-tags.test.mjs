import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createTag, setNoteTag, createNoteTags } from '../../extension/note-tags.js';

function backend() {
  let note = { id: 'a', tags: ['阅读'], thought: '未变的内容', revision: 1 }, catalog = ['阅读', 'AI'], revision = 0, conflict = false, lost = false;
  const calls = [];
  const cloud = async ({ path, method = 'GET', body } = {}) => {
    calls.push({ path, method, body });
    if (method === 'POST' && body?.action === 'create_tag') { catalog.push(body.name); revision++; return { created: body.name }; }
    if (path === '/api/tags') {
      if (method === 'GET') return { tags: catalog.map(name => ({ name })), revision };
      catalog.push(body.name); revision++; return { created: body.name };
    }
    if (method === 'GET') return { notes: [structuredClone(note)], tagState: { tags: catalog.map(name => ({ name })), revision } };
    if (conflict) { conflict = false; note.tags.push('另一端标签'); note.thought = '另一端新内容'; note.revision++; throw Object.assign(Error('conflict'), { status: 409 }); }
    assert.equal(body.revision, note.revision);
    note.tags = body.selected ? [...note.tags, body.tag] : note.tags.filter(t => t !== body.tag); note.revision++;
    if (lost) { lost = false; throw Error('网络断开'); }
    return { note: structuredClone(note) };
  };
  return { cloud, calls, get note() { return note; }, conflict: () => conflict = true, lose: () => lost = true };
}
test('tag retry preserves concurrent content and tags; lost response retry is idempotent', async () => {
  const b = backend(); b.conflict();
  const note = await setNoteTag(b.cloud, 'a', 'AI', true);
  assert.deepEqual(note.tags, ['阅读', '另一端标签', 'AI']); assert.equal(note.thought, '另一端新内容');
  b.lose(); await assert.rejects(setNoteTag(b.cloud, 'a', '阅读', false), /网络/);
  const writes = b.calls.filter(r => r.method === 'PATCH').length;
  await setNoteTag(b.cloud, 'a', '阅读', false);
  assert.equal(b.calls.filter(r => r.method === 'PATCH').length, writes);
  b.note.archived = true; await assert.rejects(setNoteTag(b.cloud, 'a', 'AI', false), /归档/);
});
test('creation reuses an existing case-insensitive tag and validates before creating', async () => {
  const b = backend(); assert.equal(await createTag(b.cloud, 'ai'), 'AI');
  assert.equal(b.calls.filter(r => r.method === 'POST').length, 0);
  for (const name of ['', 'a,b', '#tag', 'x'.repeat(31)]) await assert.rejects(createTag(b.cloud, name));
});
test('inline selection and creation survive page refresh without touching the writing draft', async () => {
  const { document, window } = parseHTML('<body><textarea id="draft">未保存的想法</textarea><section id="tags"></section></body>');
  const b = backend(); let active = b.note;
  const picker = createNoteTags({ root: document.querySelector('#tags'), cloud: b.cloud, active: () => active, onSaved: note => active = note }); picker.render();
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
  const click = async selector => { document.querySelector(selector).dispatchEvent(new window.Event('click', { bubbles: true })); await flush(); };
  await click('[data-tag-action="open"]');
  await click('[data-name="AI"]'); assert.deepEqual(active.tags, ['阅读', 'AI']);
  const input = document.querySelector('#tag-search'); input.value = '新想法'; input.dispatchEvent(new window.Event('input'));
  picker.render(); assert.equal(input.value, '新想法');
  await click('[data-tag-action="create"]'); assert.ok(active.tags.includes('新想法')); assert.equal(input.value, '');
  await click('[data-name="阅读"]'); assert.ok(!active.tags.includes('阅读'));
  assert.equal(document.querySelector('#draft').value, '未保存的想法');
  active = { ...active, id: 'b', tags: [] }; picker.render(); assert.equal(document.querySelector('#tag-picker').hidden, true);
});
test('an untagged note enumerates the entire synced library catalog, including unused tags', async () => {
  const { document, window } = parseHTML('<section id="tags"></section>');
  const note = { id: 'untagged', tags: [] };
  const names = ['产品体验&竞品调研', '个人成长', 'AI产品搭建', 'harness'];
  const snapshot = { notes: [note], tagState: { revision: 4, tags: names.map(name => ({ name, count: 0 })) } };
  let resolve, request;
  const picker = createNoteTags({ root: document.querySelector('#tags'), cloud: input => { request = input; return new Promise(r => resolve = r); }, active: () => note, onSaved: () => {} });
  picker.sync(snapshot); picker.render();
  document.querySelector('[data-tag-action="open"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(document.querySelectorAll('.tag-option').length, 4, 'all library tags remain visible during refresh');
  assert.equal(document.querySelector('.tag-total').textContent, '4');
  assert.deepEqual(request, {}, 'catalog uses the same notes response as the notebook');
  resolve(snapshot); await new Promise(r => setImmediate(r));
  assert.deepEqual([...document.querySelectorAll('.tag-name')].map(el => el.textContent).sort(), names.sort());
  assert.equal(document.querySelectorAll('[aria-pressed="true"]').length, 0);
  const input = document.querySelector('input'); input.value = 'AI'; input.dispatchEvent(new window.Event('input'));
  assert.equal(document.querySelectorAll('.tag-option').length, 1);
  input.value = ''; input.dispatchEvent(new window.Event('input')); assert.equal(document.querySelectorAll('.tag-option').length, 4);
});
test('failed or malformed catalog loads never report an empty library and remain retryable', async () => {
  const { document, window } = parseHTML('<section id="tags"></section>');
  let response = { notes: [] };
  const picker = createNoteTags({ root: document.querySelector('#tags'), cloud: async () => response, active: () => ({ id: 'a', tags: [] }), onSaved: () => {} }); picker.render();
  const click = async selector => { document.querySelector(selector).dispatchEvent(new window.Event('click', { bubbles: true })); await new Promise(r => setImmediate(r)); };
  await click('[data-tag-action="open"]');
  assert.match(document.querySelector('.tag-empty').textContent, /暂未加载成功/);
  assert.equal(document.querySelector('.tag-retry').hidden, false);
  const input = document.querySelector('input'); input.value = 'test'; input.dispatchEvent(new window.Event('input'));
  assert.match(document.querySelector('.tag-feedback').textContent, /未返回/);
  assert.equal(document.querySelector('[data-tag-action="create"]'), null);
  response = { notes: [], tagState: { revision: 1, tags: [{ name: 'test' }] } };
  await click('[data-tag-action="reload"]'); assert.equal(document.querySelectorAll('.tag-option').length, 1);
  assert.equal(document.querySelector('.tag-retry').hidden, true);
});

test('new tag uses stable notes relay even when older background rejects the tag endpoint', async () => {
  const b = backend();
  const oldRelay = request => { if (request.path && request.path !== '/api/notes') throw Error('不支持的笔记请求。'); return b.cloud(request); };
  assert.equal(await createTag(oldRelay, '长期记忆'), '长期记忆');
  const note = await setNoteTag(oldRelay, 'a', '长期记忆', true);
  assert.ok(note.tags.includes('长期记忆'));
  assert.equal(note.thought, '未变的内容');
  assert.equal(await createTag(oldRelay, '长期记忆'), '长期记忆');
  assert.equal(b.calls.filter(r => r.method === 'POST').length, 1);
});

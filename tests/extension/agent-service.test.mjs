import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentService } from '../../extension/agent-service.js';
import { validateAgentInput } from '../../extension/agent-protocol.js';
import { createFolderRepository, openFolder } from '../../extension/folder-store.js';
import { diskFolder } from './folder-fixture.mjs';

async function setup(t) {
  const disk = await diskFolder(t), target = await openFolder(disk.root);
  let chain = Promise.resolve(), allowed = true;
  const repo = createFolderRepository(disk.root, target.id, task => { const result = chain.then(task); chain = result.catch(() => {}); return result; });
  const service = createAgentService({ request: repo.request, library: async () => { if (!allowed) throw new Error('资料库已切换'); return target; }, noteURL: id => 'https://clips.example/?note=' + id });
  return { ...disk, service, repo, switch: () => { allowed = false; } };
}
const input = () => ({ request_id: crypto.randomUUID(), title: 'Agent 架构', content: '**持久状态**\n\n```js\nconst state = {};\n```', tags: ['Agent'], source: { app: 'Codex', title: '讨论架构', conversation_id: 'known-conversation' } });
test('MCP writes survive disk reopen, preserve Markdown/provenance and retry without duplication', async t => {
  const s = await setup(t), a = input();
  const [first, retry] = await Promise.all([s.service('clips_create_note', a), s.service('clips_create_note', a)]);
  assert.equal(first.id, retry.id); assert.equal(retry.already_saved, true);
  const disk = JSON.parse(await s.read('clips.json')); assert.equal(disk.notes.length, 1); assert.equal(disk.notes[0].kind, 'idea');
  const note = await s.service('clips_get_note', { note_id: first.id });
  assert.match(note.text, /```js/); assert.match(note.text, /known-conversation/);
  assert.equal((await s.service('clips_search', { query: '持久状态', tag: 'Agent' })).total, 1);
  await assert.rejects(s.service('clips_create_note', { ...a, content: 'different' }), e => e.code === 'REQUEST_ID_REUSED');
});
test('append detects concurrent edits, preserves all previous contents and deduplicates retries', async t => {
  const s = await setup(t), n = await s.service('clips_create_note', input()), a = { request_id: crypto.randomUUID(), note_id: n.id, revision: n.revision, content: '后续理解', quote: '原句' };
  const saved = await s.service('clips_append_record', a);
  const retry = await s.service('clips_append_record', a); assert.equal(retry.already_saved, true);
  await assert.rejects(s.service('clips_append_record', { ...a, request_id: crypto.randomUUID() }), e => e.code === 'REVISION_CONFLICT');
  await assert.rejects(s.service('clips_append_record', { ...a, quote: 'different' }), e => e.code === 'REQUEST_ID_REUSED');
  const note = (await s.repo.request()).notes[0]; assert.equal(note.clips.length, 1); assert.match(note.thought, /持久状态/); assert.equal(note.revision, saved.revision);
});
test('switched library, invalid tool or malformed input cannot mutate data', async t => {
  const s = await setup(t), before = await s.read('clips.json');
  for (const a of [{ ...input(), title: '' }, { ...input(), source: { url: 'javascript:alert(1)' } }, { ...input(), tags: ['a'.repeat(31)] }, { ...input(), secret: 'private' }]) await assert.rejects(s.service('clips_create_note', a));
  assert.throws(() => validateAgentInput('CONFIG_GET', {}));
  s.switch(); await assert.rejects(s.service('clips_create_note', input()), /切换/);
  assert.equal(await s.read('clips.json'), before);
});
test('pagination is explicit and missing original material is not reported as a complete article', async t => {
  const s = await setup(t), n = await s.service('clips_create_note', { ...input(), content: '一段内容。'.repeat(2000) });
  const page = await s.service('clips_get_note', { note_id: n.id, max_chars: 1000 }); assert.equal(page.text.length, 1000); assert.equal(page.next_offset, 1000);
  const next = await s.service('clips_get_note', { note_id: n.id, max_chars: 1000, offset: page.next_offset }); assert.equal(next.next_offset, 2000);
  const material = await s.service('clips_get_note', { note_id: n.id, section: 'materials' }); assert.equal(material.text, ''); assert.match(material.warnings[0], /不是全文/);
  await s.repo.request({ method: 'PATCH', body: { id: n.id, revision: n.revision, action: 'archive' } });
  assert.equal((await s.service('clips_search', {})).total, 0);
  await assert.rejects(s.service('clips_get_note', { note_id: n.id }), e => e.code === 'NOT_FOUND');
});
test('disk failure is not acknowledged; UI-cache failure after commit does not discard success', async t => {
  const s = await setup(t); s.state.failPath = 'clips.json'; const a = input();
  await assert.rejects(s.service('clips_create_note', a), /Disk full/);
  s.state.failPath = ''; const service = createAgentService({ request: s.repo.request, library: async () => ({}), noteURL: id => id, changed: async () => { throw new Error('cache quota'); } });
  assert.equal((await service('clips_create_note', a)).saved, true);
});

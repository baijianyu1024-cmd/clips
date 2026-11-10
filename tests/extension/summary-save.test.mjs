import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCoreDraft } from '../../extension/summary-save.js';

const job = { id: 'job', noteId: 'note', purpose: 'core', text: '- 生成的摘要。', record: { id: 'summary', text: '- 生成的摘要。', scope: 'scope', provider: 'DeepSeek' } };
function backend() {
  let note = { id: 'note', status: 'reading', revision: 1, coreSummary: null, coreSummaryHistory: [], thought: '我的原记录' }, lost = false, race = null;
  const requests = [];
  return { get note() { return note; }, requests, lose: () => lost = true, race: value => race = value, cloud: async request => {
    if (!request.method) return { notes: [structuredClone(note)] };
    requests.push(request);
    if (race) { note = { ...note, ...race, revision: note.revision + 1 }; race = null; throw Object.assign(Error('conflict'), { status: 409 }); }
    assert.equal(request.body.revision, note.revision);
    assert.equal(request.body.expectedCoreSummaryId, note.coreSummary?.id || null);
    if (note.coreSummary) note.coreSummaryHistory.push(note.coreSummary);
    note.coreSummary = request.body.coreSummary; note.revision++;
    if (lost) { lost = false; throw Error('network'); }
    return { note: structuredClone(note) };
  } };
}
test('legacy draft with no baseline saves a first summary with explicit null and edited text', async () => {
  const b = backend(); const result = await saveCoreDraft(b.cloud, job, '- 我已改写的摘要。');
  assert.equal(result.coreSummary.text, '- 我已改写的摘要。'); assert.equal(result.coreSummary.edited, true);
  assert.equal(b.requests[0].body.expectedCoreSummaryId, null); assert.equal(result.thought, '我的原记录');
});
test('a legacy or stale draft cannot replace an existing summary until its current version is reviewed', async () => {
  const b = backend(); b.note.coreSummary = { id: 'current', text: '另一端修改的摘要' };
  for (const draft of [job, { ...job, expectedCoreSummaryId: 'older' }]) {
    await assert.rejects(saveCoreDraft(b.cloud, draft, '我的草稿'), error => error.currentNote.coreSummary.text === '另一端修改的摘要');
  }
  assert.equal(b.requests.length, 0);
  const result = await saveCoreDraft(b.cloud, { ...job, expectedCoreSummaryId: 'current' }, '我的草稿');
  assert.equal(result.coreSummaryHistory[0].text, '另一端修改的摘要');
});
test('summary revisions are rechecked on retry while unrelated edits are preserved', async () => {
  const b = backend(); b.race({ thought: '并发的新记录' });
  const result = await saveCoreDraft(b.cloud, job, job.text); assert.equal(result.thought, '并发的新记录');
  const c = backend(); c.race({ coreSummary: { id: 'new-summary', text: '别人已保存' } });
  await assert.rejects(saveCoreDraft(c.cloud, job, job.text), error => error.currentNote.coreSummary.id === 'new-summary');
  assert.equal(c.requests.length, 1);
});
test('lost responses retry without duplicate versions and later draft edits require review', async () => {
  const b = backend(); b.lose(); await assert.rejects(saveCoreDraft(b.cloud, job, job.text), /network/);
  await saveCoreDraft(b.cloud, job, job.text); assert.equal(b.requests.length, 1);
  await assert.rejects(saveCoreDraft(b.cloud, job, '保存后又改过的草稿'), error => !!error.currentNote);
  assert.equal(b.note.coreSummary.text, job.text);
});

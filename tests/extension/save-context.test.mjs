import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { saveContext, rememberWritingPage, confirmSaveContext, createSaveContextPrompt, renderSaveContext } from '../../extension/save-context.js';
const note = { id: 'a', title: '文章 A', sources: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }] };
const page = name => ({ url: 'https://example.com/' + name, title: '文章 ' + name });
test('primary article controls warnings; auto-linked secondary sources are not silent consent', () => {
  assert.equal(saveContext(note, page('a')).needsConfirmation, false);
  assert.equal(saveContext(note, page('b')).needsConfirmation, true);
  assert.equal(saveContext(note, { ...page('a'), status: 'loading' }).needsConfirmation, true);
  assert.equal(saveContext(note, { url: 'chrome://extensions' }).needsConfirmation, true);
  const video = { ...note, sources: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] };
  assert.equal(saveContext(video, { url: 'https://youtu.be/dQw4w9WgXcQ?t=23' }).needsConfirmation, false);
});
test('foreign excerpts and writing contexts still warn after returning to the primary page', () => {
  let draft = rememberWritingPage({}, page('b')); draft = rememberWritingPage(draft, page('b'));
  assert.equal(draft.contexts.length, 1);
  assert.equal(saveContext(note, page('a'), draft).needsConfirmation, true);
  assert.equal(saveContext(note, page('a'), { quote: { sourceUrl: page('b').url } }).needsConfirmation, true);
});
test('mismatch approval is per save and is invalidated by another tab switch', async () => {
  let current = page('b'), asks = 0;
  const snapshot = async () => saveContext(note, current);
  const result = await confirmSaveContext({ snapshot, prompt: async context => { asks++; if (asks === 1) current = page('c'); else assert.equal(context.changed, true); return 'save'; } });
  assert.ok(result.allowed); assert.equal(asks, 2);
  await confirmSaveContext({ snapshot, prompt: async () => { asks++; return 'save'; } });
  assert.equal(asks, 3, 'next record asks again');
  await confirmSaveContext({ snapshot, approved: result.signature, prompt: () => assert.fail('same-save recheck need not repeat') });
  current = page('d');
  assert.equal((await confirmSaveContext({ snapshot, approved: result.signature, prompt: async () => 'cancel' })).allowed, false);
});
test('cancel, switch and matching pages never imply a cross-note save', async () => {
  let switched = false;
  assert.equal((await confirmSaveContext({ snapshot: async () => saveContext(note, page('b')), prompt: async () => 'cancel' })).allowed, false);
  assert.equal((await confirmSaveContext({ snapshot: async () => saveContext(note, page('b')), prompt: async () => 'switch', switchPage: async () => { switched = true; } })).allowed, false);
  assert.equal(switched, true);
  assert.equal((await confirmSaveContext({ snapshot: async () => saveContext(note, page('a')), prompt: () => assert.fail() })).allowed, true);
});
test('confirmation displays both titles safely, defaults to cancel and Escape keeps the draft', async () => {
  const { document, window } = parseHTML('<aside></aside><div id="target"></div><dialog></dialog>');
  const dialog = document.querySelector('dialog');
  dialog.showModal = () => dialog.open = true; dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  const ask = createSaveContextPrompt(dialog), context = saveContext(note, { ...page('b'), title: '<img src=x onerror=bad()>文章 B' });
  const response = ask(context);
  assert.match(dialog.textContent, /文章 A/); assert.match(dialog.textContent, /文章 B/); assert.equal(dialog.querySelector('img'), null);
  assert.equal(dialog.querySelector('[autofocus]').dataset.contextChoice, 'cancel');
  dialog.dispatchEvent(new window.Event('cancel', { cancelable: true })); assert.equal(await response, 'cancel');
  renderSaveContext(document.querySelector('aside'), document.querySelector('#target'), note, page('b'));
  assert.equal(document.querySelector('aside').hidden, false);
  assert.match(document.querySelector('#target').textContent, /文章 A/);
  renderSaveContext(document.querySelector('aside'), document.querySelector('#target'), note, page('a'));
  assert.equal(document.querySelector('aside').hidden, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://clips.test', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','Element','Node','DOMParser','MutationObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) globalThis[key] = typeof dom.window[key] === 'function' && ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.innerHeight = 800; globalThis.innerWidth = 1200;
dom.window.Range.prototype.getClientRects = () => [];
dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 });
const { attachMarkdownEditor, installMarkdownEditors } = await import('../../extension/markdown-editor.js');
const tick = () => new Promise(r => setTimeout(r, 15));
async function setup(t, value = '') {
  const root = document.createElement('section'); root.innerHTML = '<label>内容<textarea rows="4" maxlength="40000"></textarea></label>'; document.body.append(root);
  const input = root.querySelector('textarea'); input.value = value;
  const binding = await attachMarkdownEditor(input); assert.ok(binding);
  t.after(() => { binding.destroy(); root.remove(); });
  return { root, input, ...binding, editor: binding.api.editor };
}
function event(type, props = {}) { const e = new window.Event(type, { bubbles: true, cancelable: true }); for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v }); return e; }

test('one surface renders saved Markdown and opening alone never normalizes or writes it', async t => {
  const source = '# 标题\n\n- **要点**\n- `inline`\n\n```js\nconst x = "<script>";\n```\n\n> 引用\n\n| 名称 | 值 |\n| --- | --- |\n| a | b |\n\n- [x] 完成\n- [ ] 待办';
  const { root, input, editor } = await setup(t, source);
  assert.equal(input.value, source); assert.ok(input.classList.contains('rich-source'));
  assert.equal(root.querySelectorAll('[contenteditable=true]').length, 1); assert.equal(root.querySelector('.markdown-live'), null);
  for (const selector of ['h1', 'strong', 'p code', 'pre code', 'blockquote', 'table', 'li[data-type=taskItem]']) assert.ok(root.querySelector(selector), selector);
  editor.commands.insertContentAt(1, '新增');
  assert.match(input.value, /新增/); assert.match(input.value, /```js/); assert.match(input.value, /\| a/); assert.match(input.value, /\[x\]/);
  editor.commands.undo(); assert.equal(editor.getText().startsWith('标题'), true);
});

test('formatting edits persist, external drafts replace the surface, disabled state propagates', async t => {
  const { root, input, editor, refresh } = await setup(t, '一个想法'); let changes = 0;
  input.addEventListener('input', () => changes++);
  editor.commands.selectAll(); editor.commands.toggleBold();
  assert.equal(input.value, '**一个想法**'); assert.equal(changes, 1);
  input.value = '## 恢复草稿\n\n`code`'; assert.equal(root.querySelector('h2').textContent, '恢复草稿'); assert.equal(changes, 1);
  input.disabled = true; refresh(); assert.equal(editor.isEditable, false);
  input.disabled = false; refresh(); assert.equal(editor.isEditable, true);
});

test('typed Markdown shortcuts apply inline, lists continue, code block stays literal', async t => {
  const { input, editor, api } = await setup(t);
  function type(text) { for (const char of text) { const { from, to } = editor.state.selection; let handled = false; editor.view.someProp('handleTextInput', f => { if (f(editor.view, from, to, char)) handled = true; return handled; }); if (!handled) editor.view.dispatch(editor.state.tr.insertText(char)); } }
  type('- '); assert.equal(editor.isActive('bulletList'), true);
  type('第一条'); editor.commands.splitListItem('listItem'); type('第二条'); assert.equal(editor.state.doc.firstChild.childCount, 2);
  api.setValue(''); editor.commands.setTextSelection(1); type('**重点**'); assert.ok(editor.getJSON().content[0].content[0].marks.some(m => m.type === 'bold'));
  api.setValue(''); editor.commands.setTextSelection(1); type('`代码`'); assert.equal(input.value, '`代码`');
  assert.equal(editor.commands.toggleCodeBlock(), true); assert.equal(editor.isActive('codeBlock'), true); editor.commands.selectAll();
  const paste = event('paste', { clipboardData: { getData: type => type === 'text/plain' ? '**literal**\n<script>safe()</script>' : '', files: [], items: [] } });
  editor.view.dom.dispatchEvent(paste); assert.match(editor.getText(), /\*\*literal\*\*/); assert.equal(document.querySelector('script'), null);
});

test('paste Markdown renders once and image paste/drop reach the existing upload handler exactly once', async t => {
  const { input, root, editor } = await setup(t, '开头');
  editor.commands.setTextSelection('end');
  editor.view.dom.dispatchEvent(event('paste', { clipboardData: { getData: type => type === 'text/plain' ? '\n\n- 第一项\n- 第二项' : '', files: [], items: [] } }));
  assert.equal(root.querySelectorAll('.rich-document li').length, 2); assert.match(input.value, /第二项/);
  let images = 0, drops = 0;
  root.addEventListener('paste', e => { if (e.clipboardData.files.length) { assert.equal(e.target, input); images++; e.preventDefault(); input.setRangeText('图的说明', input.selectionStart, input.selectionEnd); } });
  root.addEventListener('drop', e => { assert.equal(e.target, input); drops++; e.preventDefault(); });
  const file = new window.File(['png'], 'shot.png', { type: 'image/png' });
  editor.view.dom.dispatchEvent(event('paste', { clipboardData: { files: [file], items: [], getData: () => '' } }));
  editor.view.dom.dispatchEvent(event('drop', { dataTransfer: { files: [file], types: ['Files'] } }));
  assert.equal(images, 1); assert.equal(drops, 1); assert.match(input.value, /图的说明/);
});

test('literal HTML and unsafe URLs cannot become executable content; long paste does not discard the original', async t => {
  const { root, input, editor, api } = await setup(t, '保留');
  input.maxLength = 10; editor.commands.insertContent('x'.repeat(50)); assert.equal(input.value, '保留');
  input.maxLength = 40000;
  api.setValue('<script>alert(1)</script>\n\n![x](javascript:alert(1))\n\n[bad](javascript:alert(2))');
  assert.equal(root.querySelector('script'), null); assert.equal(root.querySelector('img[src^="javascript:"]'), null); assert.equal(root.querySelector('a[href^="javascript:"]'), null);
  assert.match(editor.getText(), /<script>/);
});

test('composition does not reset the editing document, async updates wait for composition end', async t => {
  const { input, editor, api } = await setup(t, '中文');
  editor.view.input.composing = true;
  editor.view.dispatch(editor.state.tr.insertText('输入', 3));
  assert.equal(input.value, '中文输入');
  api.setValue('外部草稿'); assert.equal(editor.getText(), '中文输入');
  editor.view.input.composing = false; editor.view.dom.dispatchEvent(event('compositionend')); await tick();
  assert.equal(editor.getText(), '外部草稿');
});

test('dynamic editors attach once and clean up on removal', async () => {
  const root = document.createElement('section'); document.body.append(root); const manager = installMarkdownEditors(root);
  root.innerHTML = '<textarea>**动态**</textarea>'; await tick(); await tick();
  assert.equal(root.querySelectorAll('[contenteditable=true]').length, 1);
  manager.refresh(); assert.equal(root.querySelectorAll('[contenteditable=true]').length, 1);
  root.querySelector('textarea').disabled = true; await tick(); assert.equal(root.querySelector('[role=textbox]').getAttribute('contenteditable'), 'false');
  manager.destroy(); assert.equal(root.querySelector('.rich-markdown'), null); root.remove();
});

test('React controlled fields receive edits and submit shortcuts without replacing selection', async t => {
  const React = await import('react'); const { createRoot } = await import('react-dom/client');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const mount = document.createElement('div'); document.body.append(mount); const reactRoot = createRoot(mount);
  let binding, latest, setValue, submits = 0, pasted = 0;
  function Field() {
    const [value, set] = React.useState('原始 `value`'); setValue = set; latest = value;
    const ref = React.useRef(null);
    React.useEffect(() => { let stopped = false; attachMarkdownEditor(ref.current).then(b => { if(stopped)b?.destroy();else binding=b; }); return () => { stopped=true;binding?.destroy(); }; }, []);
    return React.createElement('form', { onPaste: e => { if (e.clipboardData.files.length) { pasted++; e.preventDefault(); } } }, React.createElement('textarea', { ref, value, onChange: e => set(e.target.value), onKeyDown: e => { if (e.ctrlKey && e.key === 'Enter') { submits++; e.preventDefault(); } } }));
  }
  await React.act(async () => { reactRoot.render(React.createElement(Field)); await tick(); });
  t.after(async () => { await React.act(async () => reactRoot.unmount()); mount.remove(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
  assert.ok(binding);
  await React.act(async () => { binding.api.editor.commands.insertContentAt(1, '增加'); });
  assert.match(latest, /^增加/); assert.equal(mount.querySelector('textarea').value, latest);
  const pos = binding.api.editor.state.selection.from;
  await React.act(async () => { reactRoot.render(React.createElement(Field)); });
  assert.equal(binding.api.editor.state.selection.from, pos);
  await React.act(async () => { setValue('**更新草稿**'); });
  assert.equal(binding.host.querySelector('strong').textContent, '更新草稿');
  binding.api.editor.view.dom.dispatchEvent(event('keydown', { key: 'Enter', ctrlKey: true })); assert.equal(submits, 1);
  binding.api.editor.view.dom.dispatchEvent(event('paste', { clipboardData: { files: [new window.File(['png'], 'x.png', {type:'image/png'})], getData:()=>'' } })); assert.equal(pasted, 1);
});

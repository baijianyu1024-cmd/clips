import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import { Plugin, EditorState, AllSelection } from '@tiptap/pm/state';
import { Marked, Tokenizer } from 'marked';
const safeURL = value => {
  if (/[\u0000-\u0020\u007f]/.test(value)) return false;
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(value, 'https://clips.invalid').protocol); } catch { return false; }
};
function safeDocument(node) {
  if (node.type === 'image' && !safeURL(node.attrs?.src || '')) return { type: 'text', text: `![${node.attrs?.alt || ''}](${node.attrs?.src || ''})` };
  return { ...node, ...(node.marks ? { marks: node.marks.filter(m => m.type !== 'link' || safeURL(m.attrs?.href || '')) } : {}), ...(node.content ? { content: node.content.map(safeDocument) } : {}) };
}

export function createRichEditor(host, options) {
  // Each editor owns its tokenizer registry. Raw HTML stays literal like the read view.
  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({ tokenizer: {
    html(src) { const token = Tokenizer.prototype.html.call(this, src); return token ? { type: 'paragraph', raw: token.raw, text: token.raw, tokens: [{ type: 'text', raw: token.raw, text: token.raw }] } : false; },
    tag(src) { const token = Tokenizer.prototype.tag.call(this, src); return token ? { type: 'text', raw: token.raw, text: token.raw } : false; },
  } });
  const doc = host.ownerDocument;
  host.className = 'rich-markdown';
  host.innerHTML = '<div class="rich-toolbar" role="toolbar" aria-label="文字格式"></div><div class="rich-surface"></div><small class="rich-limit" role="status" hidden></small>';
  const surface = host.querySelector('.rich-surface'), toolbar = host.querySelector('.rich-toolbar'), limit = host.querySelector('.rich-limit');
  let setting = false, destroyed = false, pendingValue = null;
  let value = options.value || '';
  let editor;
  const parse = text => safeDocument(editor.markdown.parse(text));
  const maxLength = () => options.maxLength?.() || 0;
  const boundary = Extension.create({
    name: 'clipsBoundary',
    addProseMirrorPlugins() { return [new Plugin({ filterTransaction(tr) {
      if (!editor || !tr.docChanged || setting || editor?.view.composing || !maxLength()) return true;
      const size = editor.markdown.serialize(tr.doc.toJSON()).length;
      if (size > maxLength() && size > value.length) { limit.textContent = `最多 ${maxLength()} 字，内容未插入。`; if (limit.hidden) limit.hidden = false; return false; }
      return true;
    } })]; },
  });
  const tools = [
    ['加粗', 'B', e => e.chain().focus().toggleBold().run()],
    ['斜体', 'I', e => e.chain().focus().toggleItalic().run()],
    ['行内代码', '`代码`', e => e.chain().focus().toggleCode().run()],
    ['项目列表', '• 列表', e => e.chain().focus().toggleBulletList().run()],
    ['引用', '❯ 引用', e => e.chain().focus().toggleBlockquote().run()],
    ['代码块', '{ }', e => e.chain().focus().toggleCodeBlock().run()],
  ];
  for (const [label, text, action] of tools) {
    const b = doc.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.textContent = text;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => { if (editor.isEditable) action(editor); }); toolbar.append(b);
  }
  function updateState() {
    const dom = editor.view.dom;
    dom.dataset.empty = editor.isEmpty ? 'true' : 'false';
    dom.dataset.placeholder = options.placeholder?.() || '';
    const label = options.label?.() || options.placeholder?.() || '编辑内容';
    dom.setAttribute('aria-label', label); dom.setAttribute('aria-multiline', 'true'); dom.setAttribute('role', 'textbox');
    const disabled = !!options.disabled?.();
    if (editor.isEditable === disabled) editor.setEditable(!disabled, false);
    toolbar.querySelectorAll('button').forEach(b => { if (b.disabled !== disabled) b.disabled = disabled; });
    host.dataset.disabled = String(disabled);
    if (maxLength() && value.length > maxLength()) { limit.textContent = `内容超过 ${maxLength()} 字，请精简后保存。`; if (limit.hidden) limit.hidden = false; dom.setAttribute('aria-invalid', 'true'); }
    else { if (!limit.hidden) limit.hidden = true; dom.removeAttribute('aria-invalid'); }
  }
  function changed() {
    if (setting || destroyed) return;
    value = editor.getMarkdown(); options.onChange(value); updateState();
  }
  function relay(event) { return options.forward?.(event) || false; }
  editor = new Editor({
    element: surface, injectCSS: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' }, isAllowedUri: safeURL } }),
      Image.configure({ inline: true, allowBase64: false, HTMLAttributes: { referrerpolicy: 'no-referrer' } }),
      TableKit, TaskList, TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }), Markdown.configure({ marked }), boundary,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'markdown-body rich-document' },
      handleDOMEvents: {
        paste(_view, event) { const handled = relay(event); event.stopPropagation(); if (handled) event.preventDefault(); return handled; },
        drop(_view, event) { const handled = relay(event); event.stopPropagation(); if (handled) event.preventDefault(); return handled; },
        dragover(_view, event) { const handled = relay(event); if (handled) event.preventDefault(); return handled; },
        keydown(_view, event) {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { const handled = relay(event); event.stopPropagation(); if (handled) event.preventDefault(); return handled; }
          return false;
        },
        compositionend() { setTimeout(() => { if (!destroyed) { if (pendingValue !== null) { const next = pendingValue; pendingValue = null; setValue(next); } else changed(); } }, 0); return false; },
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        const blocks = []; view.state.doc.forEach(node => { if (node.type.name !== 'paragraph' || node.content.size) blocks.push(node); });
        if (view.state.selection instanceof AllSelection && blocks.length === 1 && blocks[0].type.spec.code) view.dispatch(view.state.tr.replaceSelectionWith(blocks[0].type.create(blocks[0].attrs, view.state.schema.text(text))));
        else if (editor.isActive('codeBlock')) view.dispatch(view.state.tr.insertText(text));
        else editor.commands.insertContent(parse(text));
        return true;
      },
    },
    onUpdate: changed,
  });
  function setValue(next) {
    next = String(next ?? ''); if (next === value) return;
    if (editor.view.composing) { pendingValue = next; return; }
    setting = true;
    try { replaceDocument(next); value = next; } finally { setting = false; }
    updateState();
  }
  function replaceDocument(text) {
    editor.chain().setMeta('addToHistory', false).setContent(parse(text), { emitUpdate: false }).run();
    // Loading another draft starts a fresh undo history; it cannot undo into old content.
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }));
  }
  // Do not normalize the persisted Markdown merely by opening an editor.
  setting = true; replaceDocument(value); setting = false; updateState();
  return {
    editor, setValue, updateState,
    focus() { editor.commands.focus(); },
    blur() { editor.commands.blur(); },
    select() { editor.commands.selectAll(); editor.commands.focus(); },
    selection() { return { start: editor.state.selection.from, end: editor.state.selection.to }; },
    insert(text, start, end) {
      const max = editor.state.doc.content.size;
      const range = { from: Math.min(start ?? editor.state.selection.from, max), to: Math.min(end ?? editor.state.selection.to, max) };
      editor.commands.insertContentAt(range, parse(text));
    },
    destroy() { destroyed = true; editor.destroy(); host.replaceChildren(); },
  };
}

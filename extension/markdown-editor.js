// One editing surface. The textarea remains the form/draft integration boundary.
let engine;
const loadEngine = () => engine ||= import('./vendor/rich-editor.mjs');
export const hasMarkdown = text => /[`*_~]|^\s*(?:#{1,6}\s|>\s|[-+]\s|\d+\.\s)|\[[^\]]+\]\(|\|.+\|/m.test(text || '');
const instances = new WeakMap();
export const isMarkdownFocused = input => input.ownerDocument.activeElement === input || !!instances.get(input)?.host.contains(input.ownerDocument.activeElement);

export async function attachMarkdownEditor(input, container) {
  if (instances.has(input)) return instances.get(input);
  const doc = input.ownerDocument, win = doc.defaultView;
  if (!win?.getSelection || !doc.createRange) return null;
  const { createRichEditor } = await loadEngine();
  if (!input.isConnected) return null;
  if (instances.has(input)) return instances.get(input);
  const host = container || doc.createElement('div');
  if (!container) input.insertAdjacentElement('afterend', host);
  const originals = new Map();
  const nativeValue = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value');
  const priorValue = Object.getOwnPropertyDescriptor(input, 'value') || nativeValue;
  let fromEditor = false;
  const define = (key, descriptor) => { originals.set(key, Object.getOwnPropertyDescriptor(input, key)); Object.defineProperty(input, key, { configurable: true, ...descriptor }); };
  function forward(event) {
    const proxy = new win.Event(event.type, { bubbles: true, cancelable: true });
    for (const k of ['clipboardData', 'dataTransfer', 'key', 'code', 'ctrlKey', 'metaKey', 'shiftKey', 'altKey']) if (k in event) Object.defineProperty(proxy, k, { value: event[k] });
    input.dispatchEvent(proxy); return proxy.defaultPrevented;
  }
  const api = createRichEditor(host, {
    value: input.value,
    placeholder: () => input.placeholder,
    label: () => input.getAttribute('aria-label') || (input.id && doc.querySelector(`label[for="${input.id}"]`)?.textContent) || input.closest('label')?.firstChild?.textContent || '',
    maxLength: () => Number(input.getAttribute('maxlength')) || 0,
    disabled: () => input.disabled || input.readOnly || !!input.closest('fieldset[disabled]'),
    onChange(value) {
      fromEditor = true;
      try {
        // Bypass React's value tracker so the ordinary input event reaches onChange.
        nativeValue.set.call(input, value);
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
      } finally { fromEditor = false; }
    },
    forward,
  });
  define('value', { get() { return priorValue.get.call(input); }, set(value) { priorValue.set.call(input, value); if (!fromEditor) api.setValue(String(value ?? '')); } });
  define('focus', { value: () => api.focus() });
  define('blur', { value: () => api.blur() });
  define('select', { value: () => api.select() });
  define('selectionStart', { get: () => api.selection().start });
  define('selectionEnd', { get: () => api.selection().end });
  define('setRangeText', { value: (text, start, end) => api.insert(text, start, end) });
  const hadFocus = doc.activeElement === input;
  input.classList.add('rich-source'); input.setAttribute('aria-hidden', 'true');
  host.style.setProperty('--editor-lines', String(Math.max(2, Math.min(12, input.rows || 4))));
  function refresh() { if (host.hidden !== input.hidden) host.hidden = input.hidden; api.setValue(input.value); api.updateState(); }
  input.addEventListener('input', refresh);
  const binding = {
    api, host, refresh,
    destroy() {
      input.removeEventListener('input', refresh);
      for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(input, key, descriptor); else delete input[key]; }
      input.classList.remove('rich-source'); input.removeAttribute('aria-hidden'); api.destroy();
      if (!container) host.remove(); instances.delete(input);
    },
  };
  instances.set(input, binding); refresh(); if (hadFocus || input.autofocus) api.focus();
  return binding;
}

export function installMarkdownEditors(root = document.body) {
  const entries = new Map(); let stopped = false;
  function refresh() {
    for (const [input, binding] of entries) if (!root.contains(input)) { binding?.destroy(); entries.delete(input); }
    for (const input of root.querySelectorAll('textarea:not([data-plain-text])')) {
      if (entries.has(input)) { entries.get(input)?.refresh(); continue; }
      entries.set(input, null);
      attachMarkdownEditor(input).then(binding => {
        if (stopped || !root.contains(input)) { binding?.destroy(); entries.delete(input); }
        else entries.set(input, binding);
      }).catch(() => { input.classList.remove('rich-source'); });
    }
  }
  const Observer = root.ownerDocument.defaultView.MutationObserver;
  const observer = new Observer(refresh);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden', 'placeholder'] });
  root.addEventListener('input', refresh); refresh();
  return { refresh, destroy() { stopped = true; observer.disconnect(); root.removeEventListener('input', refresh); for (const binding of entries.values()) binding?.destroy(); entries.clear(); } };
}

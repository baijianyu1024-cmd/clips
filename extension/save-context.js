import { canonical } from './core.js';
import { titleUrlKey } from './link-metadata.js';
const key = url => titleUrlKey(canonical(url));
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = value => value?.title || value?.sourceTitle || '未命名页面';
export const isReadingPage = page => !!key(page?.url) && page.status !== 'loading';

export function rememberWritingPage(draft, page) {
  if (!isReadingPage(page)) return draft;
  const contexts = Array.isArray(draft.contexts) ? draft.contexts : [];
  if (contexts.some(p => key(p.url) === key(page.url))) return draft;
  return { ...draft, contexts: [...contexts.slice(0, 7), { url: canonical(page.url), title: String(page.title || '').slice(0, 200) }] };
}

export function saveContext(note, page, record = {}) {
  // Secondary sources can have been auto-linked by a previous excerpt. They
  // must not silently make another article the current note's main subject.
  const primary = key(note?.sources?.[0]?.url);
  const current = key(page?.url);
  const pageMismatch = !isReadingPage(page) || !primary || primary !== current;
  const origins = [...(record.contexts || []), ...(record.quote?.sourceUrl ? [{ url: record.quote.sourceUrl, title: record.quote.sourceTitle }] : [])];
  const foreign = [...new Map(origins.filter(p => key(p.url) && key(p.url) !== primary).map(p => [key(p.url), p])).values()];
  return {
    note, page, foreign, needsConfirmation: pageMismatch || foreign.length > 0,
    heading: pageMismatch ? isReadingPage(page) ? '当前网页与笔记不一致' : '暂时无法确认当前网页' : '草稿包含其他网页的内容',
    signature: JSON.stringify([note?.id, note?.title, primary, current, isReadingPage(page), foreign.map(p => key(p.url)).sort()]),
  };
}

function contextRows(context, compact = false) {
  const row = (name, title, url, cls = '') => `<div class="context-row ${cls}"><span>${name}</span><div><strong>${escape(title)}</strong>${url ? `<small title="${escape(url)}">${escape(url)}</small>` : ''}</div></div>`;
  return row('当前网页', label(context.page), context.page?.url)
    + row('将保存到', context.note?.title || '未命名笔记', context.note?.sources?.[0]?.url, 'context-destination')
    + context.foreign.filter(p => key(p.url) !== key(context.page?.url)).slice(0, compact ? 1 : 8).map(p => row('草稿来源', label(p), p.url)).join('');
}

export function renderSaveContext(banner, target, note, page, record = {}) {
  const context = saveContext(note, page, record), warn = !!note && context.needsConfirmation;
  banner.hidden = !warn;
  const html = warn ? `<div class="context-warning-title"><span aria-hidden="true">⚠</span><strong>${escape(context.heading)}</strong></div>${contextRows(context, true)}<div class="context-warning-actions"><button type="button" data-action="choose">切换笔记</button>${note.sources?.[0]?.url ? '<button type="button" data-action="return-source">返回笔记原文 ↗</button>' : ''}</div>` : '';
  if (banner.innerHTML !== html) banner.innerHTML = html;
  target.hidden = !note; target.classList.toggle('context-target-warning', warn);
  target.innerHTML = note ? `<span>${warn ? '⚠ 保存前需要确认' : '保存到'}</span><strong>${escape(note.title || '未命名笔记')}</strong>` : '';
  return warn;
}

export function createSaveContextPrompt(dialog) {
  let finish;
  function close(choice) { if (!finish) return; const resolve = finish; finish = null; dialog.close(); resolve(choice); }
  dialog.addEventListener('click', event => {
    const button = event.target.closest('[data-context-choice]');
    if (button) close(button.dataset.contextChoice);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close('cancel'); });
  dialog.addEventListener('close', () => { if (finish) { const resolve = finish; finish = null; resolve('cancel'); } });
  return context => new Promise(resolve => {
    // No remembered acknowledgement: every cross-page record needs its own decision.
    if (finish) { resolve('cancel'); return; }
    finish = resolve;
    dialog.innerHTML = `<div class="dialog-head"><h2 id="save-context-title">确认记录归属</h2><button type="button" data-context-choice="cancel" aria-label="取消保存">×</button></div><p class="context-confirm-lead">${escape(context.changed ? '页面或笔记已变化，请重新确认。' : context.heading + '。')}</p><div class="context-confirm-rows">${contextRows(context)}</div><p class="hint">这条记录将写入上面的笔记。取消或切换笔记时，文字和图片仍留在原笔记的草稿中。</p><div class="context-confirm-actions"><button type="button" class="secondary" data-context-choice="cancel" autofocus>取消，继续编辑</button><button type="button" class="secondary" data-context-choice="switch">先切换笔记</button><button type="button" class="primary" data-context-choice="save">仍保存到这篇笔记</button></div>`;
    dialog.showModal(); dialog.querySelector('[data-context-choice="cancel"][autofocus]')?.focus();
  });
}

// Read live tab state before asking and again after the answer. An approval
// belongs only to this note/page/draft context, not to subsequent navigation.
export async function confirmSaveContext({ snapshot, prompt, switchPage, approved = '' }) {
  let changed = false;
  for (;;) {
    const context = await snapshot();
    if (!context.needsConfirmation || context.signature === approved) return { allowed: true, signature: context.signature };
    const choice = await prompt({ ...context, changed });
    if (choice === 'cancel') return { allowed: false };
    const fresh = await snapshot();
    if (fresh.signature !== context.signature) { approved = ''; changed = true; continue; }
    if (choice === 'switch') { await switchPage(); return { allowed: false }; }
    if (choice === 'save') return { allowed: true, signature: fresh.signature };
    return { allowed: false };
  }
}

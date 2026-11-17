const invalid = message => Object.assign(new Error(message), { status: 400 });
// Shared by the website, extension, local repository and Agent bridge.
export const recordKinds = ['clip', 'legacy', 'image', 'review', 'ai', 'core'];
export function recordEntries(note) {
  const entries = [];
  const add = (kind, id, record) => entries.push({ ...record, kind, id, text: record.text || '', thought: record.thought || '', images: record.images || [], createdAt: record.createdAt || note.createdAt });
  if (note.summary || note.thought || note.legacyRecordImages?.length) add('legacy', 'legacy', { text: note.summary, thought: note.thought, images: note.legacyRecordImages || [] });
  for (const c of note.clips || []) add('clip', c.id, c);
  for (const r of note.reviews || []) add('review', r.id, r);
  for (const s of note.aiSummaries || []) add('ai', s.id, s);
  for (const i of note.images || []) add('image', i.key, { images: [i], createdAt: i.createdAt });
  if (note.coreSummary) { const { id: version, ...record } = note.coreSummary; add('core', 'core', { ...record, version }); }
  return entries;
}
export function recordTarget(kind, id) { return { kind, id: kind === 'image' ? id.replace(/^image:/, '') : kind === 'core' ? 'core' : id }; }
export function findRecord(note, target) {
  if (!target || !recordKinds.includes(target.kind) || typeof target.id !== 'string') throw invalid('请选择有效的记录。');
  const ref = recordTarget(target.kind, target.id);
  return recordEntries(note).find(r => r.kind === ref.kind && r.id === ref.id);
}
export function removeContent(note, target) {
  const record = findRecord(note, target);
  if (!record) throw Object.assign(new Error('这条记录已不存在，请刷新后核对。'), { status: 404 });
  if (note.deletedAt || note.archived || note.status === 'inbox') throw invalid('请先恢复并开始阅读笔记，再删除记录。');
  const n = { ...note };
  if (record.kind === 'legacy') { n.summary = ''; n.thought = ''; n.legacyRecordImages = []; }
  if (record.kind === 'clip') n.clips = note.clips.filter(r => r.id !== record.id);
  if (record.kind === 'image') n.images = note.images.filter(r => r.key !== record.id);
  if (record.kind === 'review') n.reviews = note.reviews.filter(r => r.id !== record.id);
  if (record.kind === 'ai') n.aiSummaries = note.aiSummaries.filter(r => r.id !== record.id);
  if (record.kind === 'core') { n.coreSummaryHistory = [...(note.coreSummaryHistory || []), note.coreSummary].slice(-20); n.coreSummary = null; }
  // Original snapshots and shared image files belong to the library, not one record.
  return n;
}
export function applyNoteChanges(note, changes) {
  validateNoteChanges(changes);
  if (note.deletedAt || note.archived) throw invalid('请先恢复笔记，再修改。');
  const n = { ...note };
  for (const key of ['title', 'kind', 'status', 'published', 'timestamp', 'sources', 'tags']) if (Object.hasOwn(changes, key)) n[key] = changes[key];
  if (changes.title !== undefined && changes.title !== note.title) n.linkTitleStatus = 'ready';
  if (changes.status !== undefined && changes.status !== note.status) n.nextReviewAt = changes.status === 'read' ? new Date(Date.now() + 7 * 86400000).toISOString() : null;
  if (Object.hasOwn(changes, 'core_summary')) {
    if (n.status === 'inbox') throw invalid('开始阅读后再保存核心摘要。');
    const text = changes.core_summary.trim(), old = note.coreSummary;
    if (!text && !old?.images?.length) throw invalid('摘要不能为空；需要删除时请使用删除记录。');
    if (old?.text !== text) {
      n.coreSummaryHistory = old ? [...(note.coreSummaryHistory || []), old].slice(-20) : note.coreSummaryHistory;
      n.coreSummary = { ...old, id: crypto.randomUUID(), text, images: old?.images || [], origin: old?.origin || 'manual', scope: old?.scope || '手动填写', provider: old?.provider || '', model: old?.model || '', edited: true, createdAt: new Date().toISOString() };
    }
  }
  return n;
}
export function validateNoteChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw invalid('请选择需要修改的字段。');
  const text = { title: 200, published: 30, timestamp: 30, core_summary: 40000 };
  for (const [key, value] of Object.entries(changes)) {
    if (Object.hasOwn(text, key)) { if (typeof value !== 'string' || value.length > text[key] || (key === 'title' && !value.trim())) throw invalid('字段内容无效：' + key); }
    else if (key === 'kind') { if (!['article','video','podcast','idea','other'].includes(value)) throw invalid('内容类型无效。'); }
    else if (key === 'status') { if (!['inbox','reading','read'].includes(value)) throw invalid('阅读状态无效。'); }
    else if (key === 'tags') { if (!Array.isArray(value) || value.length > 15 || value.some(t => typeof t !== 'string' || !t.trim() || t.length > 30)) throw invalid('标签无效。'); }
    else if (key === 'sources') {
      if (!Array.isArray(value) || value.length > 10) throw invalid('来源链接无效。');
      for (const s of value) {
        if (!s || typeof s.url !== 'string' || s.url.length > 2000 || typeof s.label !== 'string' || s.label.length > 100) throw invalid('来源链接无效。');
        const url = new URL(s.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw invalid('来源需为无凭据的 http(s) 链接。');
      }
    } else throw invalid('不支持修改字段：' + key);
  }
}
export function deletionMessage(note, target) {
  if (!target) return `删除笔记「${note.title || '未命名笔记'}」？\n\n整篇笔记及其中的记录将移到「已删除」，可以恢复。`;
  const r = findRecord(note, target);
  if (!r) throw invalid('记录已不存在，请刷新后核对。');
  const label = { clip: '随读记录', legacy: '想法记录', image: '截图记录', review: '补充理解', ai: 'AI 摘要', core: '核心摘要' }[r.kind];
  const preview = (r.thought || r.text || r.images.map(i => i.name).join('、')).slice(0, 160);
  return `删除这条${label}？\n\n所属笔记：${note.title || '未命名笔记'}\n${preview}${r.images.length ? `\n包含 ${r.images.length} 张图片` : ''}\n\n${r.kind === 'core' ? '当前摘要会移除，历史版本保留。' : '本条内容及图片关联会移除，无法在页面恢复。'}其他记录和原文副本保留。`;
}

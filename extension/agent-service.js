import { validateAgentInput } from './agent-protocol.js';
import { validateTag } from './note-tags.js';
import { terms } from './learning-retrieval.js';

const active = n => !n.deletedAt && !n.archived && n.status !== 'inbox';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const httpURL = value => {
  if (!value) return '';
  let url; try { url = new URL(value); } catch { fail('INVALID_SOURCE', '来源链接必须是 http(s) 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('INVALID_SOURCE', '来源链接必须是无凭据的 http(s) 地址。');
  return url.href;
};
function thought(input) {
  const content = input.content.trim();
  if (!content) fail('EMPTY_CONTENT', '想法内容不能为空。');
  const source = input.source || {}, url = httpURL(source.url);
  const label = [source.app || 'Agent', source.title].filter(Boolean).join(' · ').replace(/[\r\n]/g, ' ');
  const provenance = [label, source.conversation_id && `对话 ID：${source.conversation_id.replace(/[\r\n]/g, ' ')}`, url].filter(Boolean).join('\n');
  return `${content}\n\n---\n来源：${provenance}`;
}
function noteText(n) {
  return [n.title, ...(n.tags || []), n.coreSummary?.text, n.summary, n.thought,
    ...(n.clips || []).flatMap(c => [c.text, c.translation?.text, c.thought]), ...(n.reviews || []).map(r => r.text),
    ...(n.aiSummaries || []).map(s => s.text)].filter(Boolean).join('\n\n');
}
function noteMarkdown(n) {
  return [`# ${n.title}`, n.coreSummary?.text && `## 核心摘要\n${n.coreSummary.text}`, n.summary && `## 摘录\n${n.summary}`, n.thought && `## 想法\n${n.thought}`,
    ...(n.clips || []).map(c => `## 记录 ${c.id}\n${c.createdAt}\n${[c.text, c.translation?.text, c.thought].filter(Boolean).join('\n\n')}`),
    ...(n.reviews || []).map(r => `## 补充理解 ${r.id}\n${r.createdAt}\n${r.text}`),
    ...(n.aiSummaries || []).map(s => `## AI 摘要 ${s.id}\n${s.text}`)].filter(Boolean).join('\n\n');
}
const imagesOf = n => [...(n.images || []), ...(n.legacyRecordImages || []), ...(n.coreSummary?.images || []), ...(n.clips || []).flatMap(c => c.images || [])];

// All persistence passes through the existing adapter (including its lock/revision checks).
export function createAgentService({ request, library, noteURL, changed = async () => {} }) {
  const brief = n => ({ id: n.id, title: n.title, revision: n.revision, tags: n.tags, kind: n.kind, status: n.status, published: n.published || '', updated_at: n.updatedAt, url: noteURL(n.id), sources: n.sources });
  let writes = Promise.resolve();
  async function execute(name, input = {}) {
    validateAgentInput(name, input);
    const target = await library(); // Rejects a changed/unauthorized library before any data access.
    if (name === 'clips_status') {
      const result = await request({});
      return { connected: true, library: target, notes: result.notes.filter(active).length, tags: (result.tagState?.tags || []).slice(0, 100), tag_count: result.tagState?.tags?.length || 0 };
    }
    const { notes } = await request({});
    if (name === 'clips_search') {
      const q = (input.query || '').trim().toLowerCase(), tokens = terms(q), limit = input.limit || 10, offset = input.offset || 0;
      const ranked = notes.filter(active).filter(n => !input.tag || n.tags.some(t => t.toLowerCase() === input.tag.toLowerCase())).map(n => {
        const text = noteText(n).toLowerCase(), title = n.title.toLowerCase();
        return { n, text, score: !q ? 1 : (text.includes(q) ? 20 : 0) + tokens.reduce((s, t) => s + (text.includes(t) ? 1 : 0) + (title.includes(t) ? 2 : 0), 0) };
      }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || b.n.updatedAt.localeCompare(a.n.updatedAt));
      return { library: target, scope: '笔记标题、标签、摘要、摘录、想法和补充理解；不含未保存的网页或图片 OCR', total: ranked.length,
        next_offset: offset + limit < ranked.length ? offset + limit : null,
        results: ranked.slice(offset, offset + limit).map(({ n, text }) => {
          const index = q ? Math.max(0, text.indexOf(q) - 80) : 0;
          return { ...brief(n), excerpt: noteText(n).slice(index, index + 500) };
        }) };
    }
    if (name === 'clips_get_note') {
      const n = notes.find(n => n.id === input.note_id && active(n));
      if (!n) fail('NOT_FOUND', '未找到可读取的笔记（不包含待阅读、已归档和已删除）。');
      let text = '', warnings = [], images = [], section = input.section || 'note', snapshots = [];
      if (section === 'note') { text = noteMarkdown(n); images = imagesOf(n); }
      if (section === 'materials') {
        const result = await request({ path: '/api/materials?note=' + n.id });
        snapshots = (result.snapshots || []).map(s => ({ id: s.id, created_at: s.createdAt, url: s.sourceUrl, warnings: s.warnings }));
        text = (result.snapshots || []).map(s => {
          for (const b of s.blocks || []) if (b.imageKey) images.push({ key: b.imageKey, name: b.text || '原文图片' });
          return `## 原文副本 ${s.id}\n${s.createdAt}\n${s.sourceUrl}\n${(s.blocks || []).map(b => b.text || '').join('\n\n')}`;
        }).join('\n\n');
        warnings = ['仅包含阅读时已保存的原文副本，可能不是全文；空内容不代表原网页为空。'];
      }
      if (section === 'transcript') {
        const meta = input.snapshot_id ? n.transcripts?.find(t => t.id === input.snapshot_id) : n.transcripts?.at(-1);
        if (!meta) warnings.push('没有匹配的已保存字幕。');
        else {
          const { snapshot } = await request({ path: `/api/transcripts?note=${n.id}&id=${meta.id}` });
          text = (snapshot.segments || []).map(s => `[${s.start}s] ${s.text}`).join('\n');
          snapshots = [{ id: meta.id, language: meta.language }];
        }
      }
      const offset = input.offset || 0, end = offset + (input.max_chars || 16000);
      return { ...brief(n), section, text: text.slice(offset, end), total_chars: text.length, next_offset: end < text.length ? end : null,
        images: images.slice(0, 100).map(i => ({ name: i.name, key: i.key })), image_count: images.length, transcripts: n.transcripts || [], snapshots, warnings,
        content_trust: 'untrusted_source_data' };
    }
    if (name === 'clips_create_note') {
      const title = input.title.trim(); if (!title) fail('EMPTY_TITLE', '标题不能为空。');
      const tags = [...new Set((input.tags || []).map(validateTag))], content = thought(input), url = httpURL(input.source?.url);
      const sources = url ? [{ url, label: (input.source?.title || input.source?.app || 'Agent').slice(0, 100) }] : [];
      const previous = notes.find(n => n.id === input.request_id);
      if (previous) {
        if (!active(previous) || previous.title !== title || previous.thought !== content || JSON.stringify(previous.tags) !== JSON.stringify(tags)) fail('REQUEST_ID_REUSED', '这个 request_id 已用于其他内容。请核对已保存的笔记。');
        return { saved: true, already_saved: true, ...brief(previous) };
      }
      const { note } = await request({ method: 'POST', body: { id: input.request_id, fields: { title, thought: content, summary: '', tags, sources, kind: 'idea', status: 'read', images: [], clips: [], aiSummaries: [], readingPosition: null, timestamp: '', published: '' } } });
      if (note.thought !== content || note.title !== title) fail('REQUEST_ID_REUSED', '保存标识冲突，请读取笔记后核对。');
      await changed(note).catch(() => {}); return { saved: true, ...brief(note) };
    }
    if (name === 'clips_append_record') {
      const n = notes.find(n => n.id === input.note_id && active(n));
      if (!n) fail('NOT_FOUND', '未找到可追加的笔记。');
      const content = thought(input), quote = (input.quote || '').trim(), sourceUrl = httpURL(input.source?.url), previous = n.clips?.find(c => c.id === input.request_id);
      if (previous) {
        if (previous.thought !== content || previous.text !== quote || previous.sourceUrl !== sourceUrl) fail('REQUEST_ID_REUSED', '这个 request_id 已用于其他记录。');
        return { saved: true, already_saved: true, record_id: previous.id, ...brief(n) };
      }
      if (n.revision !== input.revision) fail('REVISION_CONFLICT', '笔记已有更新。请重新读取笔记，再使用新 revision 追加；request_id 保持不变。');
      if (n.clips?.length >= 500) fail('RECORD_LIMIT', '这篇笔记已达到记录上限。');
      if (sourceUrl && !n.sources.some(s => s.url === sourceUrl) && n.sources.length >= 10) fail('SOURCE_LIMIT', '这篇笔记已达到来源链接上限，请把对话来源保留为文字。');
      const clip = { id: input.request_id, text: quote, thought: content, sourceUrl, sourceTitle: (input.source?.title || input.source?.app || 'Agent').slice(0, 200), createdAt: new Date().toISOString(), images: [], videoTime: null };
      const { note } = await request({ method: 'PATCH', body: { id: n.id, revision: n.revision, action: 'add_clip', clip } });
      await changed(note).catch(() => {}); return { saved: true, record_id: clip.id, ...brief(note) };
    }
  }
  return (name, input) => {
    if (!['clips_create_note', 'clips_append_record'].includes(name)) return execute(name, input);
    const result = writes.catch(() => {}).then(() => execute(name, input)); writes = result; return result;
  };
}

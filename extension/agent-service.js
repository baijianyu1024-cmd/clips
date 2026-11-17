import { recordEntries, findRecord, deletionMessage, validateNoteChanges } from './record-actions.js';
import { AGENT_TOOLS, validateAgentInput } from './agent-protocol.js';
import { validateTag } from './note-tags.js';
import { terms } from './learning-retrieval.js';

const inScope = (n, scope = 'active') => scope === 'all' || (scope === 'trash' ? !!n.deletedAt : !n.deletedAt && (scope === 'archived' ? n.archived : scope === 'inbox' ? !n.archived && n.status === 'inbox' : !n.archived && n.status !== 'inbox'));
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
  const confirmations = new Map();
  const requireRevision = (n, revision) => { if (n.revision !== revision) fail('REVISION_CONFLICT', '笔记已有更新，请重新读取后再操作；删除需要重新确认。'); };
  const committed = async n => { await changed(n).catch(() => {}); return n; };
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
      const ranked = notes.filter(n => inScope(n, input.scope)).filter(n => !input.tag || n.tags.some(t => t.toLowerCase() === input.tag.toLowerCase())).map(n => {
        const text = noteText(n).toLowerCase(), title = n.title.toLowerCase();
        return { n, text, score: !q ? 1 : (text.includes(q) ? 20 : 0) + tokens.reduce((s, t) => s + (text.includes(t) ? 1 : 0) + (title.includes(t) ? 2 : 0), 0) };
      }).filter(r => r.score > 0).sort((a, b) => b.score - a.score || b.n.updatedAt.localeCompare(a.n.updatedAt));
      return { library: target, scope_filter: input.scope || 'active', scope: '笔记标题、标签、摘要、摘录、想法和补充理解；不含未保存的网页或图片 OCR', total: ranked.length,
        next_offset: offset + limit < ranked.length ? offset + limit : null,
        results: ranked.slice(offset, offset + limit).map(({ n, text }) => {
          const index = q ? Math.max(0, text.indexOf(q) - 80) : 0;
          return { ...brief(n), excerpt: noteText(n).slice(index, index + 500) };
        }) };
    }
    if (name === 'clips_get_note') {
      const n = notes.find(n => n.id === input.note_id && inScope(n, input.scope));
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
      return { ...brief(n), archived: n.archived, deleted_at: n.deletedAt, record_count: recordEntries(n).length, section, text: text.slice(offset, end), total_chars: text.length, next_offset: end < text.length ? end : null,
        images: images.slice(0, 100).map(i => ({ name: i.name, key: i.key })), image_count: images.length, transcripts: n.transcripts || [], snapshots, warnings,
        content_trust: 'untrusted_source_data' };
    }
    if (['clips_list_records', 'clips_get_record'].includes(name)) {
      const n = notes.find(n => n.id === input.note_id && inScope(n, input.scope));
      if (!n) fail('NOT_FOUND', '未找到当前范围内的笔记。');
      const entries = recordEntries(n), offset = input.offset || 0;
      if (name === 'clips_list_records') {
        const list = entries.filter(r => !input.kind || r.kind === input.kind), limit = input.limit || 10;
        return { note_id: n.id, revision: n.revision, total: list.length, next_offset: offset + limit < list.length ? offset + limit : null, records: list.slice(offset, offset + limit).map(r => ({ kind:r.kind, record_id:r.id, created_at:r.createdAt, excerpt:(r.thought || r.text || r.images.map(i=>i.name).join('、')).slice(0,500), image_count:r.images.length })), content_trust:'untrusted_source_data' };
      }
      const r = findRecord(n, {kind:input.kind,id:input.record_id});
      if (!r) fail('NOT_FOUND', '记录不存在。');
      const end = offset + (input.max_chars || 16000), fields = {text:r.text,thought:r.thought,translation:r.translation?.text || ''};
      const total = Math.max(...Object.values(fields).map(s=>s.length));
      return { note_id:n.id, revision:n.revision, kind:r.kind, record_id:r.id, fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.slice(offset,end)])), next_offset:end<total?end:null, images:r.images.slice(0,30).map(i=>({key:i.key,name:i.name})), source_url:r.sourceUrl || '', source_title:r.sourceTitle || '', created_at:r.createdAt, content_trust:'untrusted_source_data' };
    }
    if (name === 'clips_prepare_delete') {
      const n = notes.find(n => n.id === input.note_id && !n.deletedAt);
      if (!n) fail('NOT_FOUND', '笔记不存在或已删除。');
      const ref = input.target ? {kind:input.target.kind,id:input.target.record_id} : null;
      if (ref && (!active(n) || !findRecord(n,ref))) fail('NOT_FOUND', '记录不存在或笔记只读，请先恢复笔记。');
      for (const [key,p] of confirmations) if (p.expires < Date.now()) confirmations.delete(key);
      if (confirmations.size >= 100) confirmations.delete(confirmations.keys().next().value);
      const token = crypto.randomUUID(), expires = Date.now()+5*60000;
      confirmations.set(token,{noteId:n.id,revision:n.revision,ref,library:JSON.stringify(target),expires});
      return { note_id:n.id, revision:n.revision, target:input.target || null, confirmation_token:token, expires_at:new Date(expires).toISOString(), preview:deletionMessage(n,ref), affected_records:ref?1:recordEntries(n).length, requires_user_confirmation:true, instruction:'向用户展示预览，获得明确确认后才能删除。' };
    }
    if (['clips_delete_note','clips_delete_record'].includes(name)) {
      const p = confirmations.get(input.confirmation_token), ref = name === 'clips_delete_record' ? {kind:input.kind,id:input.record_id} : null;
      if (!p || p.expires < Date.now() || p.noteId !== input.note_id || p.revision !== input.revision || JSON.stringify(p.ref) !== JSON.stringify(ref) || p.library !== JSON.stringify(target)) fail('CONFIRMATION_REQUIRED','删除确认已过期或目标不匹配，请重新预览并向用户确认。');
      const n = notes.find(n=>n.id===input.note_id); if(!n) fail('NOT_FOUND','笔记不存在。');
      if ((!ref && n.deletedAt) || (ref && !findRecord(n,ref))) return {deleted:true,already_deleted:true,...brief(n)};
      requireRevision(n,input.revision);
      const {note} = await request({method:'PATCH',body:{id:n.id,revision:n.revision,action:ref?'remove_content':'trash',...(ref?{target:ref}:{})}});
      await committed(note);
      return {deleted:true,recoverable:!ref,...brief(note),...(ref?{record_id:ref.id,kind:ref.kind}:{})};
    }
    if (name === 'clips_restore_note') {
      const n = notes.find(n=>n.id===input.note_id); if(!n) fail('NOT_FOUND','笔记不存在。');
      if(!n.deletedAt) return {restored:true,already_restored:true,...brief(n)};
      requireRevision(n,input.revision);
      const {note}=await request({method:'PATCH',body:{id:n.id,revision:n.revision,action:'restore'}}); await committed(note);
      return {restored:true,...brief(note)};
    }
    if (name === 'clips_update_note') {
      const n=notes.find(n=>n.id===input.note_id); if(!n||n.deletedAt||n.archived) fail('NOT_FOUND','请先恢复笔记，再修改。');
      validateNoteChanges(input.changes);
      const changes=structuredClone(input.changes);
      for(const k of ['title','published','timestamp','core_summary']) if(k in changes) changes[k]=changes[k].trim();
      if(changes.tags) changes.tags=[...new Set(changes.tags.map(validateTag))];
      if(Object.entries(changes).every(([k,v])=>JSON.stringify(k==='core_summary'?n.coreSummary?.text:n[k])===JSON.stringify(v))) return {saved:true,already_saved:true,...brief(n)};
      requireRevision(n,input.revision);
      const {note}=await request({method:'PATCH',body:{id:n.id,revision:n.revision,action:'update_note',changes}}); await committed(note);
      return {saved:true,...brief(note)};
    }
    if (name === 'clips_update_record') {
      const n=notes.find(n=>n.id===input.note_id&&active(n)); if(!n) fail('NOT_FOUND','请先恢复笔记，再修改记录。');
      const changes=Object.fromEntries(Object.entries(input.changes).map(([k,v])=>[k,v.trim()]));
      if(!Object.keys(changes).length) fail('EMPTY_CHANGES','请提供需要修改的字段。');
      if(!['clip','legacy','image'].includes(input.kind)&&Object.hasOwn(changes,'thought')) fail('INVALID_FIELD','这类记录请修改 text 字段。');
      const r=findRecord(n,{kind:input.kind,id:input.record_id});
      if(!r) {
        const converted=input.kind==='image'&&n.clips.find(c=>c.id===input.request_id);
        if(converted&&Object.entries(changes).every(([k,v])=>converted[k]===v)) return {saved:true,already_saved:true,record_id:converted.id,kind:'clip',...brief(n)};
        fail('NOT_FOUND','记录已不存在。');
      }
      const next={text:r.text,thought:r.thought,...changes};
      if(Object.entries(changes).every(([k,v])=>r[k]===v)) return {saved:true,already_saved:true,record_id:r.id,kind:r.kind,...brief(n)};
      if(['clip','image'].includes(r.kind)&&[next.text,next.thought].some(v=>v.length>20000)) fail('CONTENT_LIMIT','一条随读记录每个字段最多 20,000 字。');
      if(!next.text&&!next.thought&&!r.images.length) fail('EMPTY_CONTENT','内容不能为空；需要删除时请使用删除工具。');
      requireRevision(n,input.revision);
      let body={id:n.id,revision:n.revision};
      if(['clip','legacy'].includes(r.kind)) body={...body,action:'edit_record',record:{id:r.id,...next,images:r.images}};
      if(r.kind==='image') {
        if(n.clips.length>=500) fail('RECORD_LIMIT','这篇笔记已达到记录上限。');
        if(n.clips.some(c=>c.id===input.request_id)) fail('REQUEST_ID_REUSED','此 request_id 已用于另一条记录。');
        body={...body,action:'edit_image_record',imageKey:r.id,record:{id:input.request_id,...next,images:r.images}};
      }
      if(r.kind==='review') body={...body,action:'edit_review',reviewId:r.id,text:next.text};
      if(r.kind==='ai') body={...body,action:'edit_ai_summary',aiSummaryId:r.id,text:next.text};
      if(r.kind==='core') body={...body,action:'update_note',changes:{core_summary:next.text}};
      const {note}=await request({method:'PATCH',body}); await committed(note);
      return {saved:true,record_id:r.kind==='image'?input.request_id:r.id,kind:r.kind==='image'?'clip':r.kind,...brief(note)};
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
      const n = notes.find(n => n.id === input.note_id && inScope(n, input.scope));
      if (!n) fail('NOT_FOUND', '未找到可追加的笔记。');
      if (input.record_kind === 'review') {
        if (n.status !== 'read') fail('NOT_READ','标记读完后才能补充理解。');
        if (input.quote) fail('INVALID_FIELD','补充理解请放在 content 中，不使用 quote。');
        const content = thought(input), previous = n.reviews.find(r=>r.id===input.request_id);
        if(previous) { if(previous.text!==content) fail('REQUEST_ID_REUSED','request_id 已用于其他内容。'); return {saved:true,already_saved:true,record_id:previous.id,kind:'review',...brief(n)}; }
        requireRevision(n,input.revision); if(n.reviews.length>=500) fail('RECORD_LIMIT','补充理解已达到上限。');
        const {note}=await request({method:'PATCH',body:{id:n.id,revision:n.revision,action:'review',reviewId:input.request_id,text:content,days:0}}); await committed(note);
        return {saved:true,record_id:input.request_id,kind:'review',...brief(note)};
      }
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
    if (AGENT_TOOLS.find(t=>t.name===name)?.annotations.readOnlyHint !== false) return execute(name, input);
    const result = writes.catch(() => {}).then(() => execute(name, input)); writes = result; return result;
  };
}

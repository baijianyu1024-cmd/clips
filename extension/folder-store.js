import { canonical, createFields } from './core.js';
import { titleUrlKey, cleanPageTitle } from './link-metadata.js';
import { quoteRangeKey, anchoredTranscriptText } from './quote-context.js';
import { youtubeId } from './youtube.js';
import { validateTag } from './note-tags.js';
import {validateChat,validateCapture} from './learning-model.js';

const FILE = 'clips.json';
const now = () => new Date().toISOString();
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const conflict = () => { throw Object.assign(new Error('内容已被修改，请刷新后再保存。你的草稿仍保留。'), { status: 409 }); };
const normalize = x => String(x).trim().toLowerCase();
export async function sha256(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2,'0')).join(''); }
async function fileAt(root, path, create = false) {
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f]/.test(p))) throw new Error('无效文件路径。');
  let dir = root; for (const part of parts.slice(0,-1)) dir = await dir.getDirectoryHandle(part, { create });
  return dir.getFileHandle(parts.at(-1), { create });
}
async function readJSON(root, path, optional = false) {
  try {
    const file = await (await fileAt(root, path)).getFile();
    if (file.size > 100 * 1024 * 1024) throw new Error('资料库文件过大。');
    return JSON.parse(await file.text());
  } catch (e) {
    if (optional && e.name === 'NotFoundError') return null;
    if (e instanceof SyntaxError) throw new Error(`${path} 格式损坏，已停止写入。请使用备份恢复。`);
    throw e;
  }
}
async function write(root, path, value) {
  const stream = await (await fileAt(root, path, true)).createWritable();
  try { await stream.write(value); await stream.close(); }
  catch (e) { await stream.abort().catch(() => {}); throw e; }
}
function validateLibrary(data) {
  if (data?.format !== 'clips-folder' || data.version !== 1 || !uuid(data.id) || !Array.isArray(data.notes) || !Array.isArray(data.tags) || !Number.isInteger(data.revision)) throw new Error('不是支持的 Clips 资料库，未修改文件。');
  const ids = new Set();
  for (const n of data.notes) {
    if (!uuid(n?.id) || ids.has(n.id) || typeof n.title !== 'string' || !Array.isArray(n.clips) || !Array.isArray(n.sources) || !Array.isArray(n.tags) || !Number.isInteger(n.revision)) throw new Error('笔记数据不完整，已停止写入。请从备份恢复。');
    if (n.clips.some(c=>!uuid(c?.id)||typeof c.text!=='string'||typeof c.thought!=='string') || n.sources.some(s=>typeof s?.url!=='string') || n.tags.some(t=>typeof t!=='string')) throw new Error('笔记记录格式损坏，已停止写入。');
    ids.add(n.id);
  }
  return data;
}
export async function openFolder(root) {
  let data = await readJSON(root, FILE, true);
  if (!data) {
    for await (const [name] of root.entries()) if (!['.DS_Store','desktop.ini','Thumbs.db'].includes(name)) throw new Error('请选择空文件夹，或包含 clips.json 的已有资料库。不会覆盖其他文件。');
    data = { format: 'clips-folder', version: 1, id: crypto.randomUUID(), createdAt: now(), revision: 0, tagRevision: 0, tags: [], notes: [] };
    await write(root, FILE, JSON.stringify(data, null, 2));
    await write(root, 'README.txt', 'Clips 本地资料库\n\nclips.json 是笔记与标签的原始数据；images/ 保存图片，transcripts/ 保存字幕与阅读资料。\n迁移或备份时请复制整个文件夹。在新电脑安装 Clips 后选择此文件夹。\n不要同时在多个浏览器或电脑中写入同一个资料库；不支持网盘并发编辑。\n最近一次修改前的数据保存在 backups/。API Key 不会写入资料库。\n');
  }
  validateLibrary(data); return { mode: 'local', id: data.id, name: root.name };
}
function blankNote(id, fields) {
  if (!uuid(id)) throw new Error('笔记标识无效。');
  return { title:'未命名笔记', summary:'', thought:'', sources:[], kind:'article', tags:[], timestamp:'', published:'', images:[], status:'reading', clips:[], aiSummaries:[], readingPosition:null,
    ...fields, id, createdAt:now(), updatedAt:now(), revision:1, starred:false, archived:false, deletedAt:null, reviews:[], coreSummary:null, coreSummaryHistory:[], transcripts:[], nextReviewAt:null };
}
function allTags(data) { return [...new Set([...data.tags, ...data.notes.flatMap(n => n.tags || [])])].sort((a,b) => a.localeCompare(b)); }
function tagsState(data) { return { revision:data.tagRevision || 0, tags:allTags(data).map(name => ({ name, count:data.notes.filter(n => !n.deletedAt && n.tags.includes(name)).length })) }; }
export function mutateLocalNote(current, body) {
  if (current.revision !== body.revision) conflict();
  const n = structuredClone(current), action = body.action;
  if (action === 'add_clip') { if (!uuid(body.clip?.id)) throw new Error('记录无效。'); if (!n.clips.some(c => c.id === body.clip.id)) { n.clips.push(body.clip); if (body.clip.sourceUrl && !n.sources.some(s=>s.url===body.clip.sourceUrl)) n.sources.push({url:body.clip.sourceUrl,label:body.clip.sourceTitle||''}); } }
  else if (action === 'edit_record') { if(body.record?.id==='legacy'){n.summary=body.record.text;n.thought=body.record.thought;if(body.record.images)n.legacyRecordImages=body.record.images;}else{const record = n.clips.find(c=>c.id===body.record?.id); if (!record) throw new Error('记录不存在。'); if(record.text!==body.record.text) { delete record.anchor; delete record.transcriptAnchor; delete record.translation; } Object.assign(record,{text:body.record.text||'',thought:body.record.thought||'',...(body.record.images ? {images:body.record.images} : {})});} }
  else if(action==='edit_image_record'){const image=n.images.find(i=>i.key===body.imageKey);if(!image){if(n.clips.some(c=>c.id===body.record.id))return current;throw new Error('截图记录不存在。');}n.images=n.images.filter(i=>i.key!==image.key);n.clips.push({...body.record,sourceUrl:n.sources[0]?.url||'',sourceTitle:n.sources[0]?.label||'',createdAt:image.createdAt||n.createdAt,videoTime:null});}
  else if(action==='edit_ai_summary'){const a=n.aiSummaries.find(a=>a.id===body.aiSummaryId);if(!a)throw new Error('摘要不存在。');a.text=body.text;}
  else if (action === 'remove_record') n.clips = n.clips.filter(c=>c.id!==body.recordId);
  else if (action === 'set_clip_translation') { const clip = n.clips.find(c=>c.id===body.clip?.id); if (!clip) throw new Error('记录不存在。'); if(clip.text!==body.clip.text||clip.sourceUrl!==body.clip.sourceUrl||JSON.stringify(clip.transcriptAnchor)!==JSON.stringify(body.clip.transcriptAnchor)) conflict(); clip.translation = body.clip.translation; }
  else if (action === 'set_core_summary') { if(n.coreSummary?.id===body.coreSummary.id)return current;if ((n.coreSummary?.id||null)!==(body.expectedCoreSummaryId??null)) conflict(); if (n.coreSummary) n.coreSummaryHistory=[...(n.coreSummaryHistory||[]),n.coreSummary].slice(-20); n.coreSummary=body.coreSummary; }
  else if (action === 'add_ai_summary') { if (!n.aiSummaries.some(a=>a.id===body.aiSummary.id)) n.aiSummaries.push(body.aiSummary); }
  else if (action === 'edit_metadata') { const m=body.metadata; for(const key of ['title','kind','status','sources','tags','published','timestamp']) if(key in m) n[key]=m[key]; }
  else if (action === 'edit') { for(const key of ['title','summary','thought','kind','status','sources','tags','published','timestamp','images']) if(key in body.fields) n[key]=body.fields[key]; }
  else if (action === 'start_reading') { if(n.status==='inbox') { n.status='reading'; if(body.title) n.title=body.title; } }
  else if (action === 'status') { if(!['reading','read','inbox'].includes(body.status)) throw new Error('阅读状态无效。'); n.status=body.status; }
  else if (action === 'star') n.starred=!n.starred;
  else if (action === 'archive') n.archived=!n.archived;
  else if (action === 'trash') n.deletedAt=now();
  else if (action === 'restore') n.deletedAt=null;
  else if (action === 'review') {if(!n.reviews.some(r=>r.id===body.reviewId))n.reviews.push({id:body.reviewId||crypto.randomUUID(),text:body.text||'',createdAt:now(),nextAt:null});}
  else if (action === 'edit_review') { const r=n.reviews.find(r=>r.id===body.reviewId); if(!r) throw new Error('补充记录不存在。'); r.text=body.text; }
  else if (action === 'tag') { n.tags=n.tags.filter(t=>normalize(t)!==normalize(body.tag)); if(body.selected) n.tags.push(validateTag(body.tag)); }
  else if (action === 'position') n.readingPosition=body.position;
  else throw new Error('本地资料库暂不支持这个操作。');
  if (!String(n.title).trim() || n.title.length > 200 || n.tags.length > 15) throw new Error('标题不能为空且不超过 200 字，每篇最多 15 个标签。');
  n.tags = [...new Map(n.tags.map(t=>{const name=validateTag(t);return [normalize(name),name];})).values()];
  n.revision++; n.updatedAt=now(); return n;
}

export function createFolderRepository(root, id, lock = task => task()) {
  async function load() { const data=validateLibrary(await readJSON(root,FILE)); if(data.id!==id) throw new Error('这个文件夹的资料库已改变，请重新选择。'); return data; }
  async function commit(data, old) {
    validateLibrary(data);
    const prefix = await sha256(id);
    for (const n of data.notes) {
      const images=[...(n.images||[]),...(n.legacyRecordImages||[]),...(n.coreSummary?.images||[]),...(n.coreSummaryHistory||[]).flatMap(s=>s.images||[]),...n.clips.flatMap(c=>c.images||[])];
      for (const image of images) {
        if(!new RegExp(`^${prefix}/[a-f0-9-]{36}\\.(png|jpg|webp|gif)$`).test(image?.key)) throw new Error('图片不属于当前资料库。请重新添加图片。');
        await fileAt(root,'images/'+image.key);
      }
    }
    const current=await load(); if(current.revision!==old.revision) conflict();
    // createWritable commits only on close. Never acknowledge an uncommitted write.
    await write(root,'backups/clips.previous.json',JSON.stringify(old,null,2));
    data.revision=old.revision+1; data.updatedAt=now();
    await write(root,FILE,JSON.stringify(data,null,2));
  }
  async function request({path='/api/notes',method='GET',body={}}={}) {
    if(!['/api/notes','/api/tags','/api/media','/api/transcripts','/api/learning','/api/materials'].includes(path.split('?')[0]) || !['GET','POST','PATCH'].includes(method)) throw new Error('不支持的资料库请求。');
    return lock(async()=>{
      const old=await load(), data=structuredClone(old), prefix=await sha256(id);
      if(path.startsWith('/api/learning')){
        const chatId=new URL(path,'https://clips.local').searchParams.get('id');
        if(method==='GET'){
          if(chatId){if(!uuid(chatId))throw new Error('对话标识无效');return {chat:await readJSON(root,'conversations/'+chatId+'.json',true)};}
          let dir;try{dir=await root.getDirectoryHandle('conversations');}catch(e){if(e.name==='NotFoundError')return {chats:[]};throw e;}
          const chats=[];for await(const [name,entry] of dir.entries()){if(entry.kind==='file'&&/^[a-f0-9-]{36}\.json$/.test(name)){const c=validateChat(await readJSON(root,'conversations/'+name));chats.push({id:c.id,title:c.title,revision:c.revision,updatedAt:c.updatedAt});}}
          return {chats:chats.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100)};
        }
        if(method!=='POST')throw new Error('不支持的对话操作');
        const chat=validateChat(body.chat);if(chat.materials.some(m=>m.imageKey&&!m.imageKey.startsWith(prefix+'/')))throw new Error('图片不属于当前资料库');
        const file='conversations/'+chat.id+'.json',previous=await readJSON(root,file,true);
        if((previous?.revision||0)!==chat.revision)conflict();
        const next={...chat,revision:chat.revision+1,updatedAt:now()};
        if(previous)await write(root,'backups/chat-'+chat.id+'.json',JSON.stringify(previous));
        await write(root,file,JSON.stringify(next,null,2));return {chat:next};
      }
      if(path.startsWith('/api/materials')){
        const noteId=body.noteId||new URL(path,'https://clips.local').searchParams.get('note');
        const note=data.notes.find(n=>n.id===noteId);if(!note||note.deletedAt)throw new Error('笔记不存在');
        if(method==='GET'){
          const metas=(data.materials||[]).filter(s=>s.noteId===noteId).slice(-12).reverse();
          return {snapshots:await Promise.all(metas.map(m=>readJSON(root,'materials/'+m.id+'.json')))};
        }
        if(method!=='POST')throw new Error('不支持的材料操作');
        const snapshot=validateCapture(body,note,prefix);
        if((data.materials||[]).some(m=>m.id===snapshot.id))return {saved:true};
        for(const b of snapshot.blocks)if(b.imageKey)await fileAt(root,'images/'+b.imageKey);
        await write(root,'materials/'+snapshot.id+'.json',JSON.stringify(snapshot,null,2));
        data.materials=[...(data.materials||[]),{id:snapshot.id,noteId,createdAt:snapshot.createdAt}];await commit(data,old);return {saved:true};
      }
      if(path.startsWith('/api/media')) {
        if(method==='GET') {
          const key=new URL(path,'https://clips.local').searchParams.get('key');
          if(!new RegExp(`^${prefix}/[a-f0-9-]{36}\\.(png|jpg|webp|gif)$`).test(key)) throw new Error('图片不属于当前资料库。');
          const f=await (await fileAt(root,'images/'+key)).getFile();
          if(f.size>8*1024*1024) throw new Error('图片过大。');
          const bytes=new Uint8Array(await f.arrayBuffer()); let binary=''; for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
          const ext=key.split('.').at(-1); return {dataUrl:`data:image/${ext==='jpg'?'jpeg':ext};base64,${btoa(binary)}`};
        }
        if(method!=='POST'||typeof body.base64!=='string'||body.base64.length>11200000) throw new Error('图片无效或超过 8 MB。');
        const bytes=Uint8Array.from(atob(body.base64),c=>c.charCodeAt(0));
        const text=(a,b)=>new TextDecoder().decode(bytes.slice(a,b));
        const ext=bytes[0]===137&&text(1,4)==='PNG'?'png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpg':text(0,4)==='RIFF'&&text(8,12)==='WEBP'?'webp':['GIF87a','GIF89a'].includes(text(0,6))?'gif':'';
        if(!ext||bytes.length>8*1024*1024) throw new Error('支持 PNG、JPG、WebP 和 GIF，单张不超过 8 MB。');
        const image={key:`${prefix}/${crypto.randomUUID()}.${ext}`,name:String(body.name||'图片').slice(0,200),createdAt:now()};
        await write(root,'images/'+image.key,bytes); return {image};
      }
      if(path.startsWith('/api/transcripts')) {
        const query=new URL(path,'https://clips.local').searchParams, noteId=body.noteId||query.get('note'), snapshotId=body.snapshotId||query.get('id');
        const note=data.notes.find(n=>n.id===noteId); if(!note) throw new Error('笔记不存在。');
        if(method==='GET'||body.action==='save_assist') {
          if(!/^[a-f0-9]{64}$/.test(snapshotId)||!note.transcripts?.some(t=>t.id===snapshotId)) throw new Error('字幕不属于当前笔记。');
          const file=`transcripts/${snapshotId}.json`, snapshot=await readJSON(root,file), assistFile=`transcripts/${noteId}-${snapshotId}-assist.json`;
          let assist=await readJSON(root,assistFile,true)||{overview:null,translations:{},quoteTranslations:{}}; assist.quoteTranslations ||= {};
          if(method==='POST') {
            const a=body.assist;
            if(a?.kind==='overview') {
              if(!uuid(a.id)||typeof a.content?.summary!=='string'||!Array.isArray(a.content.chapters)||!Array.isArray(a.content.quotes)||!a.content.chapters.every(c=>Number.isInteger(c.from)&&c.from>=0&&c.from<snapshot.segments.length)||!a.content.quotes.every(q=>Number.isInteger(q.from)&&Number.isInteger(q.to)&&q.from>=0&&q.to>=q.from&&q.to<snapshot.segments.length)) throw new Error('概览位置与字幕不匹配。');
              if(assist.overview?.id!==a.id && (assist.overview?.id||null)!==(a.expectedOverviewId??null)) conflict(); assist.overview={...a.content,id:a.id,model:a.model,createdAt:now()};
            }
            else if(a?.kind==='translation') { for(const segment of a.segments) { if(!Number.isInteger(segment.index)||!snapshot.segments[segment.index]) throw new Error('译文与字幕段落不匹配。'); assist.translations[segment.index] ||= {text:segment.text,model:a.model,createdAt:now()}; } }
            else if(a?.kind==='quote_translation') { if(!anchoredTranscriptText(snapshot.segments,a)) throw new Error('引用范围与字幕不匹配。'); assist.quoteTranslations[quoteRangeKey(a)] ||= {text:a.text,model:a.model,createdAt:now()}; }
            else throw new Error('阅读资料格式不完整。');
            const previous=await readJSON(root,assistFile,true); if(previous) await write(root,`backups/${noteId}-${snapshotId}-assist.previous.json`,JSON.stringify(previous));
            await write(root,assistFile,JSON.stringify(assist,null,2));
          }
          return {snapshot,assist,assistProtocol:1};
        }
        if(method!=='POST'||!Array.isArray(body.transcript?.segments)||body.transcript.segments.length>20000) throw new Error('字幕格式无效。');
        if(!note.sources.some(s=>youtubeId(s.url)===body.transcript.videoId)) throw new Error('字幕与当前视频不匹配。');
        if(body.transcript.segments.some(s=>!Number.isFinite(s.start)||s.start<0||!Number.isFinite(s.duration)||s.duration<0||typeof s.text!=='string')) throw new Error('字幕内容无效。');
        const snap={...body.transcript,id:await sha256(JSON.stringify({videoId:body.transcript.videoId,language:body.transcript.language,segments:body.transcript.segments})),segmentCount:body.transcript.segments.length,createdAt:now()};
        if(note.transcripts?.some(t=>t.id===snap.id)) return {note,snapshot:await readJSON(root,`transcripts/${snap.id}.json`)};
        await write(root,`transcripts/${snap.id}.json`,JSON.stringify(snap,null,2));
        const {segments,...meta}=snap; note.transcripts=[meta,...(note.transcripts||[]).filter(t=>t.id!==snap.id)]; note.revision++; note.updatedAt=now();
        await commit(data,old); return {note,snapshot:snap,assist:{overview:null,translations:{}},assistProtocol:1};
      }
      if(path==='/api/tags'||body.action==='create_tag') {
        if(method==='GET') return tagsState(data);
        if(body.revision!==data.tagRevision) conflict();
        const name=validateTag(body.name), names=allTags(data), existing=names.find(t=>normalize(t)===normalize(name));
        if(body.action==='rename'||body.action==='delete') {
          const from=body.previous; if(!names.includes(from)) throw new Error('标签不存在。');
          data.tags=names.filter(t=>t!==from); if(body.action==='rename'&&!existing) data.tags.push(name);
          for(const n of data.notes) if(n.tags.includes(from)) { n.tags=[...new Set(n.tags.flatMap(t=>t===from?(body.action==='rename'?[existing||name]:[]):[t]))]; n.revision++; }
        } else if(!existing) data.tags=[...names,name];
        data.tagRevision++; await commit(data,old); return {...tagsState(data),created:existing||name};
      }
      if(path!=='/api/notes') throw new Error('不支持的资料库请求。');
      if(method==='GET') return {notes:data.notes,tagState:tagsState(data)};
      if(method==='POST') {
        if(body.action==='resolve_title') {
          const n=data.notes.find(n=>n.id===body.id); if(!n) throw new Error('笔记不存在。');
          if(body.browser&&titleUrlKey(body.browser.url)===titleUrlKey(n.sources[0]?.url)) { const title=cleanPageTitle(body.browser.title,body.browser.url); if(title) { n.title=title; n.linkTitleStatus='ready'; n.revision++; await commit(data,old); } }
          return {note:n};
        }
        if(body.action==='save_link') {
          const url=canonical(body.url); if(!url) throw new Error('请输入 http:// 或 https:// 链接。');
          const found=data.notes.find(n=>!n.deletedAt&&n.sources.some(s=>titleUrlKey(s.url)===titleUrlKey(url)));
          if(found) return {note:found,existing:true};
          const note=blankNote(body.id,{...createFields({url,title:new URL(url).hostname}),status:'inbox',linkTitleStatus:'unavailable'}); data.notes.unshift(note); await commit(data,old); return {note};
        }
        if(body.action) throw new Error('请通过选择完整的资料库文件夹来恢复笔记和图片。');
        const found=data.notes.find(n=>n.id===body.id); if(found) return {note:found};
        const note=blankNote(body.id,body.fields);
        if(note.status!=='inbox') data.notes=data.notes.filter(n=>n.status!=='inbox'||!n.sources.some(s=>note.sources.some(t=>titleUrlKey(t.url)===titleUrlKey(s.url))));
        data.notes.unshift(note); await commit(data,old); return {note};
      }
      if(method!=='PATCH') throw new Error('不支持的保存方式。');
      const index=data.notes.findIndex(n=>n.id===body.id); if(index<0) throw new Error('笔记不存在。');
      const note=mutateLocalNote(data.notes[index],body); data.notes[index]=note;
      await commit(data,old); return {note};
    });
  }
  return {request};
}

export async function copyLibrary(root, destination) {
  for await(const [name] of destination.entries()) if(!['.DS_Store','desktop.ini','Thumbs.db'].includes(name)) throw new Error('备份目标必须是空文件夹。');
  if(await root.isSameEntry(destination)) throw new Error('请选择另一个空文件夹。');
  if(await root.resolve(destination)!==null) throw new Error('备份文件夹不能位于当前资料库内部。');
  validateLibrary(await readJSON(root,FILE));
  async function copy(src,dst) { for await(const [name,entry] of src.entries()) { if(entry.kind==='directory') await copy(entry,await dst.getDirectoryHandle(name,{create:true})); else await write(dst,name,await entry.getFile()); } }
  await copy(root,destination); return destination.name;
}

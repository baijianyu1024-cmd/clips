import { adapter } from './adapter.js';
import { createFields, timeLabel } from './core.js';
import { getTarget, setTarget, targetKey, handleStore, folderHandle } from './storage-target.js';
import { openFolder, copyLibrary } from './folder-store.js';
import { renderMarkdown, markdownText, markdownHelpHTML } from './markdown.js';
import { quoteView } from './quote-context.js';
import { transferImages, stageImages, draftImageStore, blobDataUrl, uploadDraftImages } from './image-drafts.js';
import { youtubeUrl } from './youtube.js';
import { installMarkdownEditors } from './markdown-editor.js';
installMarkdownEditors();

const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = x => x ? new Date(x).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '时间未记录';
const safeURL = url => { try { const x=new URL(url); return ['https:','http:'].includes(x.protocol) ? x.href : ''; } catch { return ''; } };
let target=await adapter.target(), notes=[], tags=[], view='records', filter='', query='', detail=new URL(location.href).searchParams.get('note')||'', rendering=0, editing=null, busy=false, persist=Promise.resolve();
const imageCache=new Map(), objectURLs=new Set();
function notice(text='') { $('#notice').hidden=!text; $('#notice').textContent=text; }
const noteById=id=>notes.find(n=>n.id===id);
const selected=()=>notes.filter(n=>view==='trash'?!!n.deletedAt:!n.deletedAt&&(view==='archive'?n.archived:!n.archived&&(view==='inbox'?n.status==='inbox':n.status!=='inbox'))).filter(n=>!filter||n.tags.includes(filter));
const searchable=n=>[n.title,n.published,...n.tags,n.summary,n.thought,n.coreSummary?.text,...(n.clips||[]).flatMap(c=>[c.text,c.thought,c.translation?.text]),...(n.reviews||[]).map(r=>r.text)].join('\n').toLowerCase();
const gallery=images=>images?.length?`<div class="images">${images.map(i=>`<button data-action="image" data-key="${esc(i.key)}" aria-label="查看图片：${esc(i.name)}"><img data-key="${esc(i.key)}" alt="${esc(i.name||'图片')}" loading="lazy"></button>`).join('')}</div>`:'';
const md=text=>`<div class="md-content markdown-body">${renderMarkdown(text||'')}</div>`;
const actions=(id,action,label)=>`<button data-action="${action}" data-id="${esc(id)}">${label}</button>`;

async function refresh() {
  if(!target||target.mode!=='local') { showSetup(); return; }
  try {
    const result=await adapter.cloud({}); notes=result.notes; tags=result.tagState.tags;
    $('#setup').hidden=true; $('#library').hidden=false; $('#new-note').disabled=false;
    $('#storage-label').textContent='本地 · '+target.name;
    notice(); render();
  } catch(e) { showSetup(); notice(e.message); }
}
function showSetup() {
  $('#setup').hidden=false; $('#library').hidden=true; $('#new-note').disabled=true;
  $('#reconnect-folder').hidden=target?.mode!=='local';
  $('#storage-label').textContent=target?.name||'尚未选择文件夹';
  $('#counts').textContent='';
}
async function chooseFolder() {
  if(!window.showDirectoryPicker) throw new Error('请在最新版桌面 Chrome 中打开此页面。');
  if(target&&!confirm('切换资料库会重新打开 Clips 页面。原资料库和草稿会保留；请先保存正在编辑的内容。继续？')) return;
  const root=await showDirectoryPicker({mode:'readwrite',id:'clips-library'});
  const next=await openFolder(root); next.connection=crypto.randomUUID();
  await handleStore(next.id,root); await setTarget(next); location.href=chrome.runtime.getURL('library.html');
}
async function reconnect() {
  const root=await handleStore(target.id);
  if(!root) throw new Error('文件夹授权已清除，请重新选择原资料库文件夹。');
  if(await root.requestPermission({mode:'readwrite'})!=='granted') throw new Error('未获得文件夹读写授权，文件没有被修改。');
  await refresh();
}
function render() {
  const live=notes.filter(n=>!n.deletedAt&&!n.archived&&n.status!=='inbox');
  $('#counts').textContent=`${live.length} 篇笔记 · ${live.reduce((a,n)=>a+(n.clips?.length||0)+(n.coreSummary?1:0)+(n.reviews?.length||0),0)} 条记录`;
  $('#tag-list').innerHTML=tags.map(t=>`<button data-action="tag-filter" data-tag="${esc(t.name)}" class="${filter===t.name?'selected':''}"># ${esc(t.name)} <small>${t.count||0}</small></button>`).join('');
  $('#clear-filter').hidden=!filter;
  if(detail&&noteById(detail)) renderDetail(noteById(detail)); else { detail=''; renderList(); }
  void loadImages();
}
function renderList() {
  $('#heading').textContent=({records:'笔记库',notes:'笔记库',inbox:'待阅读',archive:'已归档',trash:'已删除'})[view];
  $('.filters').hidden=false; $('#thoughts-only').closest('label').hidden=view!=='records';
  const list=selected().filter(n=>!query||searchable(n).includes(query)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  if(view!=='records') {
    $('#content').innerHTML=(view==='inbox'?'<p><button data-action="queue">＋ 添加链接</button></p>':'')+list.map(n=>`<article class="note-row"><div class="meta">${esc(({article:'文章',video:'视频',podcast:'播客',idea:'灵感',other:'其他'})[n.kind]||n.kind)} · ${n.status==='read'?'已读完':n.status==='inbox'?'待阅读':'正在读'} ${n.published?' · 内容发布时间：'+esc(n.published):''}</div><h2><a href="#" data-action="detail" data-id="${n.id}">${esc(n.title)}</a></h2><p>${esc(markdownText(n.coreSummary?.text||n.thought||n.summary||n.clips?.[0]?.thought||n.clips?.[0]?.text||'').slice(0,180))}</p>${n.tags.map(t=>`<span class="chip">${esc(t)}</span>`).join('')}${view==='inbox'?`<p>${actions(n.id,'start-reading','开始阅读')}</p>`:''}</article>`).join('')||'<p class="empty">还没有笔记。点击「添加笔记」，或在阅读页面打开侧栏开始记录。</p>';
    return;
  }
  const rows=[];
  for(const n of list) {
    if(n.coreSummary?.text||n.coreSummary?.images?.length) rows.push({n,type:'summary',id:n.coreSummary.id,text:n.coreSummary.text,images:n.coreSummary.images,at:n.coreSummary.createdAt||n.updatedAt});
    if(n.summary||n.thought||n.images?.length) rows.push({n,type:'legacy',id:'legacy',text:n.summary,thought:n.thought,images:n.images,at:n.createdAt});
    for(const c of n.clips||[]) rows.push({n,type:'record',id:c.id,text:[quoteView(c).original,quoteView(c).translation].filter(Boolean).join('\n\n')||(quoteView(c).pending?'中文译文待补齐':''),thought:c.thought,images:c.images,at:c.createdAt});
    for(const r of n.reviews||[]) rows.push({n,type:'review',id:r.id,thought:r.text,at:r.createdAt});
  }
  let previous='';
  $('#content').innerHTML=rows.filter(r=>!$('#thoughts-only').checked||r.thought).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).map(r=>{
    const day=date(r.at).split(' ')[0], heading=day!==previous?`<h3 class="date-heading">${esc(day)}</h3>`:''; previous=day;
    return `${heading}<article class="record"><div class="record-head"><time>${esc(date(r.at))}</time><a href="#" data-action="detail" data-id="${r.n.id}">${esc(r.n.title)}</a><span>${({summary:'核心摘要',record:r.thought?'想法':'摘录',review:'后来的理解',legacy:'记录'})[r.type]}</span><button data-action="edit-${r.type}" data-id="${r.n.id}" data-record="${r.id}">编辑</button></div>${r.thought?md(r.thought):''}${r.text?`<div class="${r.thought?'original':''}">${md(r.text)}</div>`:''}${gallery(r.images)}</article>`;
  }).join('')||'<p class="empty">还没有符合条件的记录。可以先添加笔记，或清除筛选。</p>';
}
function renderDetail(n) {
  $('#heading').textContent='笔记详情'; $('.filters').hidden=true;
  $('#content').innerHTML=`<div class="detail-top"><button data-action="back">← 返回列表</button>${actions(n.id,'edit-metadata','基础信息')}${actions(n.id,'toggle-read',n.status==='read'?'继续阅读':'标记读完')}${actions(n.id,'archive',n.archived?'取消归档':'归档')}${actions(n.id,n.deletedAt?'restore':'trash',n.deletedAt?'恢复':'删除')}</div><h1 class="detail-title">${esc(n.title)}</h1><div class="meta">${n.published?'内容发布时间：'+esc(n.published)+' · ':''}${n.status==='read'?'已读完':'正在读'} ${n.tags.map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</div>${n.sources.map(s=>safeURL(s.url)?`<p class="source"><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.label||s.url)} ↗</a></p>`:'').join('')}${learningOrigin(n)}<section class="detail-section"><header><h2>核心摘要</h2>${actions(n.id,'edit-summary',n.coreSummary?'编辑':'添加')}</header>${md(n.coreSummary?.text)}${gallery(n.coreSummary?.images)}</section><section class="detail-section"><header><h2>随读记录</h2>${actions(n.id,'add-record','＋ 记录')}</header>${n.summary||n.thought||n.images?.length?`<article class="record"><div class="record-head">记录${actions(n.id,'edit-legacy','编辑')}</div>${md(n.thought)}${md(n.summary)}${gallery(n.images)}</article>`:''}${(n.clips||[]).map(c=>{const q=quoteView(c);return `<article class="record"><div class="record-head"><time>${esc(date(c.createdAt))}</time><button data-action="edit-record" data-id="${n.id}" data-record="${c.id}">编辑</button></div>${q.original?`<div class="original">${md(q.original)}</div>`:''}${q.translation?md(q.translation):q.pending?'<p class="hint">中文译文待补齐</p>':''}${md(c.thought)}${gallery(c.images)}</article>`}).join('')||'<p class="hint">尚无随读记录</p>'}</section><section class="detail-section"><header><h2>后来的理解</h2>${actions(n.id,'add-review','＋ 补充')}</header>${(n.reviews||[]).map(r=>`<article class="record"><div class="record-head"><time>${esc(date(r.createdAt))}</time><button data-action="edit-review" data-id="${n.id}" data-record="${r.id}">编辑</button></div>${md(r.text)}</article>`).join('')}</section>${n.transcripts?.length?`<section class="detail-section"><h2>字幕与 Overview</h2>${n.transcripts.map(t=>`<button data-action="transcript" data-id="${n.id}" data-snapshot="${t.id}">${esc(t.language)} · ${t.segmentCount} 段</button>`).join(' ')}<div id="transcript-content"></div></section>`:''}`;
}
function learningOrigin(n){const o=n.learningOrigin;if(!o)return '';return `<section class="detail-section"><header><h2>对话来源</h2><a href="learning.html?chat=${o.chatId}">返回对话 ↗</a></header><p>${esc(o.questions.join('；'))}</p><details><summary>${o.materials.length} 段参考材料</summary>${o.materials.map(m=>`<article class="record"><a href="library.html?note=${m.noteId}">[${m.number}] ${esc(m.title)} ↗</a>${md(m.text)}${m.imageKey?gallery([{key:m.imageKey,name:m.title}]):''}</article>`).join('')}</details></section>`;}
async function imageURL(key) { if(!imageCache.has(key)) imageCache.set(key,adapter.cloud({path:'/api/media?key='+encodeURIComponent(key)}).then(x=>x.dataUrl).catch(e=>{imageCache.delete(key);throw e;})); return imageCache.get(key); }
async function loadImages() { const seq=++rendering; for(const img of document.querySelectorAll('#content img[data-key]')) { try { const src=await imageURL(img.dataset.key); if(seq!==rendering)return; img.src=src; } catch { img.alt+='（文件不可用）'; } } }
async function mutation(n,action,extra={}) { const r=await adapter.cloud({method:'PATCH',body:{id:n.id,revision:n.revision,action,...extra}}); notes=notes.map(x=>x.id===r.note.id?r.note:x); render(); return r.note; }
function field(name,label,value='',textarea=false) { return `<label>${label}${textarea?`<textarea name="${name}" rows="${name==='text'?6:4}">${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}" ${name==='title'?'required maxlength="200"':''}>`}</label>`; }
function editScope(e) { return `library-edit:${e.noteId||'new'}:${e.type}:${e.recordId||''}`; }
async function openEditor(type,n,recordId) {
  let original=type==='record'?n?.clips.find(c=>c.id===recordId):type==='summary'?n?.coreSummary:type==='review'?n?.reviews.find(r=>r.id===recordId):null;
  editing={type,noteId:n?.id||'',recordId,operationId:crypto.randomUUID(),revision:n?.revision,baseline:structuredClone(original||n||null),attachments:(original?.images||(type==='legacy'?n.images:[])||[]).map(image=>({id:crypto.randomUUID(),name:image.name,image})),values:{}};
  const saved=await adapter.read(editScope(editing)); if(saved) editing=saved;
  $('#edit-title').textContent=({metadata:'基础信息',new:'添加笔记',record:recordId?'编辑记录':'添加记录',summary:'核心摘要',review:recordId?'编辑补充':'补充理解',legacy:'编辑记录',queue:'添加待阅读',tags:'标签管理'})[type];
  const initial=editing.values;
  if(type==='metadata'||type==='new') {
    $('#edit-fields').innerHTML=field('title','标题',initial.title??n?.title)+field('url','来源链接',initial.url??n?.sources[0]?.url)+`<div class="form-row"><label>内容类型<select name="kind">${[['article','文章'],['video','视频'],['podcast','播客'],['idea','灵感'],['other','其他']].map(([v,t])=>`<option value="${v}" ${v===(initial.kind??n?.kind)?'selected':''}>${t}</option>`).join('')}</select></label><label>阅读状态<select name="status">${[['reading','正在读'],['read','已读完'],['inbox','待阅读']].map(([v,t])=>`<option value="${v}" ${v===(initial.status??n?.status)?'selected':''}>${t}</option>`).join('')}</select></label></div>`+field('published','内容发布时间',initial.published??n?.published)+field('tags','标签（逗号分隔，可选择已有标签）',initial.tags??n?.tags.join(', '))+`<div>${tags.map(t=>`<button type="button" data-add-tag="${esc(t.name)}">${esc(t.name)}</button>`).join(' ')}</div>`;
  } else if(type==='queue') $('#edit-fields').innerHTML=field('url','文章或视频链接',initial.url);
  else if(type==='tags') $('#edit-fields').innerHTML=`<label>已有标签<select name="previous"><option value="">新建标签</option>${tags.map(t=>`<option>${esc(t.name)}</option>`).join('')}</select></label>`+field('name','新名称')+'<label><input type="checkbox" name="deleteTag"> 删除所选标签（保留笔记）</label>';
  else if(type==='record'||type==='legacy') $('#edit-fields').innerHTML=field('text','原文摘录',initial.text??original?.text??(type==='legacy'?n.summary:''),true)+field('thought','我的想法',initial.thought??original?.thought??(type==='legacy'?n.thought:''),true)+markdownHelpHTML;
  else $('#edit-fields').innerHTML=field('text',type==='summary'?'摘要':'我的理解',initial.text??original?.text,true)+markdownHelpHTML;
  $('#image-tools').hidden=!['record','summary','legacy'].includes(type); $('#editor-error').textContent=saved?'已恢复未保存的草稿':''; $('#editor-conflict').hidden=true;
  $('#editor').showModal(); await editImages(); $('#edit-fields input, #edit-fields textarea')?.focus();
}
function keepEdit() {
  if(!editing)return Promise.resolve();
  editing.values=Object.fromEntries(new FormData($('#edit-form')));
  const value=structuredClone(editing), key=editScope(value);
  persist=persist.catch(()=>{}).then(()=>adapter.write(key,value)); persist.catch(()=>{$('#editor-error').textContent='草稿未能缓存，请先复制输入。';}); return persist;
}
async function editImages() {
  for(const u of objectURLs) URL.revokeObjectURL(u); objectURLs.clear(); $('#edit-gallery').replaceChildren();
  for(const item of editing?.attachments||[]) {
    const fig=document.createElement('figure'),img=document.createElement('img'),btn=document.createElement('button'); img.alt=item.name;btn.type='button';btn.textContent='×';btn.setAttribute('aria-label','移除图片');
    btn.onclick=()=>{if(busy)return;editing.attachments=editing.attachments.filter(x=>x.id!==item.id);void keepEdit();void editImages();};fig.append(img,btn);$('#edit-gallery').append(fig);
    try { if(item.image) img.src=await imageURL(item.image.key); else {const blob=await draftImageStore.get(editScope(editing),item.id);if(blob){const url=URL.createObjectURL(blob);objectURLs.add(url);img.src=url;}} }catch{img.alt+='（不可用）';}
  }
}
async function addImages(files) { if(!editing)return; const added=await stageImages(editScope(editing),files,editing.attachments);editing.attachments.push(...added);await keepEdit();await editImages(); }
async function saveEdit() {
  $('#edit-form').inert=true;
  await keepEdit();const e=editing, v=e.values;
  const fresh=(await adapter.cloud({})).notes, n=fresh.find(n=>n.id===e.noteId);
  if(e.noteId&&(!n||n.revision!==e.revision)) {
    if(n) {
      const current=e.type==='summary'?n.coreSummary:e.type==='record'?n.clips.find(c=>c.id===e.recordId):e.type==='review'?n.reviews.find(r=>r.id===e.recordId):e.type==='legacy'?{text:n.summary,thought:n.thought,images:n.images}:{title:n.title,sources:n.sources,tags:n.tags,status:n.status,published:n.published};
      $('#editor-current').textContent=JSON.stringify(current||'当前内容已移除',null,2); $('#editor-conflict').hidden=false; e.pendingRevision=n.revision;
    }
    throw new Error('这篇笔记已更新。上方草稿已保留，请核对下方最新内容后再确认保存。');
  }
  let images=[];
  if(['record','summary','legacy'].includes(e.type)) images=await uploadDraftImages(editScope(e),e.attachments,async(blob,item)=>(await adapter.cloud({path:'/api/media',method:'POST',body:{base64:(await blobDataUrl(blob)).split(',')[1],type:item.type,name:item.name}})).image,keepEdit);
  if(e.type==='new'||e.type==='metadata') {
    const url=v.url.trim();if(url&&!safeURL(url))throw new Error('来源链接需要以 http:// 或 https:// 开头。');
    const metadata={title:v.title.trim(),kind:v.kind,status:v.status,published:v.published.trim(),tags:[...new Set(v.tags.split(/[,，\n]/).map(t=>t.trim()).filter(Boolean))],sources:url?[{url,label:v.title.trim()},...(n?.sources||[]).slice(1)]:[]};
    if(!metadata.title)throw new Error('请填写标题。');
    if(e.type==='new') {const id=e.operationId;const {note:saved}=await adapter.cloud({method:'POST',body:{id,fields:{...createFields({url:url||'https://clips.invalid',title:metadata.title}),...metadata}}});if(Object.keys(metadata).some(k=>JSON.stringify(saved[k])!==JSON.stringify(metadata[k])))throw new Error('上一次已创建这篇笔记，本次草稿已保留。请刷新笔记库，在笔记详情中核对后修改。');detail=id;}
    else await mutation(n,'edit_metadata',{metadata});
  } else if(e.type==='queue') await adapter.cloud({method:'POST',body:{action:'save_link',id:e.operationId,url:v.url.trim()}});
  else if(e.type==='summary') await mutation(n,'set_core_summary',{expectedCoreSummaryId:n.coreSummary?.id||null,coreSummary:{id:crypto.randomUUID(),text:v.text,images,origin:'manual',edited:true,scope:'手动填写',createdAt:new Date().toISOString()}});
  else if(e.type==='record') { const record={id:e.recordId||crypto.randomUUID(),text:v.text,thought:v.thought,images};if(!record.text.trim()&&!record.thought.trim()&&!images.length)throw new Error('请记录文字或添加图片。');if(e.recordId)await mutation(n,'edit_record',{record});else await mutation(n,'add_clip',{clip:{...record,sourceUrl:n.sources[0]?.url||'',sourceTitle:n.title,createdAt:new Date().toISOString()}}); }
  else if(e.type==='legacy') await mutation(n,'edit',{fields:{summary:v.text,thought:v.thought,images}});
  else if(e.type==='review') {if(!v.text.trim())throw new Error('请填写理解。');await mutation(n,e.recordId?'edit_review':'review',{reviewId:e.recordId,text:v.text});}
  else if(e.type==='tags') {const state=await adapter.cloud({path:'/api/tags'});await adapter.cloud({path:'/api/tags',method:'POST',body:{action:v.previous?(v.deleteTag?'delete':'rename'):'create',previous:v.previous,name:v.deleteTag?v.previous:v.name,revision:state.revision}});}
  await adapter.remove(editScope(e)); await Promise.all(e.attachments.map(i=>draftImageStore.remove(editScope(e),i.id).catch(()=>{})));editing=null;$('#editor').close();await refresh();notice('已保存到文件夹。');
}
async function closeEditor(){await keepEdit();editing=null;$('#editor').close();}
async function showTranscript(n,id) {
  const {snapshot,assist}=await adapter.cloud({path:`/api/transcripts?note=${n.id}&id=${id}`});
  const container=$('#transcript-content');if(!container)return;
  container.innerHTML=`${assist?.overview?`<div class="detail-section"><h3>Overview</h3>${md(assist.overview.summary)}${(assist.overview.chapters||[]).map(c=>`<p><a href="${youtubeUrl(snapshot.videoId,snapshot.segments[c.from]?.start||0)}" target="_blank" rel="noopener">${esc(c.title)}</a> ${esc(c.summary||'')}</p>`).join('')}</div>`:''}<div>${snapshot.segments.map((s,i)=>`<div class="transcript-line"><a href="${youtubeUrl(snapshot.videoId,s.start)}" target="_blank" rel="noopener">${timeLabel(s.start)}</a><div>${esc(s.text)}${assist?.translations?.[i]?`<p>${esc(assist.translations[i].text)}</p>`:''}</div></div>`).join('')}</div>`;
}
async function action(button) {
  const a=button.dataset.action,n=noteById(button.dataset.id);
  if(a==='back'){detail='';render();}
  else if(a==='detail'){detail=n.id;render();window.scrollTo(0,0);}
  else if(a==='tag-filter'){detail='';filter=button.dataset.tag;render();}
  else if(a==='queue')await openEditor('queue');
  else if(a.startsWith('edit-'))await openEditor(a.slice(5),n,button.dataset.record);
  else if(a==='add-record')await openEditor('record',n);
  else if(a==='add-review')await openEditor('review',n);
  else if(a==='image'){const src=await imageURL(button.dataset.key);$('#image-viewer img').src=src;$('#image-viewer').showModal();}
  else if(a==='toggle-read')await mutation(n,'status',{status:n.status==='read'?'reading':'read'});
  else if(['archive','restore','trash'].includes(a)){if(a==='trash'&&!confirm('将这篇笔记移到「已删除」？可以恢复。'))return;await mutation(n,a);}
  else if(a==='start-reading'){await mutation(n,'start_reading');if(safeURL(n.sources[0]?.url))await adapter.open(n.sources[0].url);await adapter.write('activeNoteId',n.id);notice('已开始阅读。请在原文页点击 Clips 图标打开侧栏。');}
  else if(a==='transcript')await showTranscript(n,button.dataset.snapshot);
}
async function run(task,error=$('#notice')) {
  if(busy)return;busy=true;
  try{await task();}catch(e){if(e.name!=='AbortError'){error.hidden=false;error.textContent=e.message||'操作失败，文件没有被替换。';}}
  finally{busy=false;$('#edit-form').inert=false;}
}
function showSettings() {$('#current-folder').textContent=target?.mode==='local'?`当前文件夹：${target.name}`:'尚未选择资料库';$('#backup-folder').disabled=$('#export-md').disabled=target?.mode!=='local';$('#settings-error').textContent='';$('#settings').showModal();}
function exportMarkdown() {
  const text=notes.filter(n=>!n.deletedAt).map(n=>`# ${n.title}\n\n${n.sources.map(s=>s.url).join('\n')}\n\n${n.published?'内容发布时间：'+n.published+'\n\n':''}## 核心摘要\n\n${n.coreSummary?.text||''}\n\n${(n.coreSummary?.images||[]).map(i=>`![${i.name}](images/${i.key})`).join('\n')}\n\n${n.summary||''}\n\n${n.thought||''}\n\n${(n.images||[]).map(i=>`![${i.name}](images/${i.key})`).join('\n')}\n\n## 随读记录\n\n${n.clips.map(c=>`${quoteView(c).original}\n\n${quoteView(c).translation}\n\n${c.thought||''}\n\n${(c.images||[]).map(i=>`![${i.name}](images/${i.key})`).join('\n')}`).join('\n\n---\n\n')}\n\n## 后来的理解\n\n${(n.reviews||[]).map(r=>r.text).join('\n\n')}`).join('\n\n---\n\n');
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));a.href=url;a.download='Clips.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('#settings-error').textContent='Markdown 中的图片使用相对路径。将此文件放入资料库文件夹即可与 images/ 一起阅读。';
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b){e.preventDefault();void run(()=>action(b));}const tag=e.target.closest('[data-add-tag]');if(tag){const input=$('#edit-form [name=tags]');input.value=[...new Set([...input.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),tag.dataset.addTag])].join(', ');void keepEdit();}});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;detail='';document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('selected',x===b));render();});
$('#search').oninput=e=>{query=e.target.value.trim().toLowerCase();render();};$('#thoughts-only').onchange=render;
$('#clear-filter').onclick=()=>{filter='';render();};$('#refresh').onclick=()=>run(refresh);$('#new-note').onclick=()=>run(()=>openEditor('new'));$('#manage-tags').onclick=()=>run(()=>openEditor('tags'));
$('#choose-folder').onclick=()=>run(chooseFolder);$('#change-folder').onclick=()=>run(chooseFolder,$('#settings-error'));$('#reconnect-folder').onclick=()=>run(reconnect);
$('#open-settings').onclick=showSettings;$('#close-settings').onclick=()=>$('#settings').close();$('#close-image').onclick=()=>$('#image-viewer').close();
$('#backup-folder').onclick=()=>run(async()=>{const destination=await showDirectoryPicker({mode:'readwrite',id:'clips-backup'});const root=await folderHandle(target);await navigator.locks.request('clips-library:'+target.id,()=>copyLibrary(root,destination));$('#settings-error').textContent='完整备份已保存到 '+destination.name+'。';},$('#settings-error'));
$('#export-md').onclick=()=>run(async()=>{await refresh();exportMarkdown();},$('#settings-error'));
$('#edit-form').onsubmit=e=>{e.preventDefault();run(saveEdit,$('#editor-error'));};$('#edit-form').oninput=()=>void keepEdit();$('#close-editor').onclick=()=>run(closeEditor,$('#editor-error'));$('#editor').addEventListener('cancel',e=>{e.preventDefault();void run(closeEditor,$('#editor-error'));});
$('#rebase-editor').onclick=()=>run(async()=>{if(!editing?.pendingRevision)return;editing.revision=editing.pendingRevision;delete editing.pendingRevision;$('#editor-conflict').hidden=true;await saveEdit();},$('#editor-error'));
$('#add-images').onclick=()=>$('#image-files').click();$('#image-files').onchange=e=>{const files=[...e.target.files];e.target.value='';run(()=>addImages(files),$('#editor-error'));};
$('#editor').onpaste=e=>{const files=transferImages(e.clipboardData);if(files.length&&!$('#image-tools').hidden){e.preventDefault();run(()=>addImages(files),$('#editor-error'));}};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.clipsStorageTarget&&targetKey(changes.clipsStorageTarget.newValue)!==targetKey(target)){notice('资料库已切换。本页保留原资料库的草稿；请关闭后重新打开。');document.querySelectorAll('button').forEach(b=>b.disabled=true);}});
await refresh();const requestedNote=new URL(location.href).searchParams.get('note');if(requestedNote&&notes.some(n=>n.id===requestedNote)){detail=requestedNote;render();}if(new URL(location.href).searchParams.has('settings'))showSettings();

const navigation=new URL(location.href).searchParams;
if(['records','notes','inbox','archive','trash'].includes(navigation.get('view'))){view=navigation.get('view');document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));render();}
if(navigation.has('tag')){filter=navigation.get('tag');render();}
if(navigation.has('new'))void run(()=>openEditor('new'));
if(navigation.get('manage')==='tags')void run(()=>openEditor('tags'));

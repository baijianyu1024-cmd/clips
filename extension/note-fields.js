import { validateTag } from './note-tags.js';
const keys=['title','sources','kind','status','published','timestamp'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const metadataOf=n=>Object.fromEntries(keys.map(k=>[k,structuredClone(n[k]??(k==='sources'?[]:''))]));
export function validateMetadata(m) {
  if(!m.title.trim()||m.title.length>200)throw new Error('请填写标题，最多 200 字。');
  if(!['article','video','podcast','idea','other'].includes(m.kind)||!['inbox','reading','read'].includes(m.status))throw new Error('请选择内容类型与阅读状态。');
  if(m.published.length>30||m.timestamp.length>30)throw new Error('发布时间和关键时间点最多 30 字。');
  if(m.sources.length>10)throw new Error('最多添加 10 个来源。');
  for(const s of m.sources){let url;try{url=new URL(s.url);}catch{}if(!url||!['https:','http:'].includes(url.protocol)||url.username||url.password||s.url.length>2000||s.label.length>100)throw new Error('请填写有效的 http/https 链接；来源名称最多 100 字。');}
  return m;
}
export async function saveMetadata(cloud,id,baseline,values) {
  validateMetadata(values);const changed=keys.filter(k=>!equal(baseline[k],values[k]));
  for(let attempt=0;attempt<3;attempt++){
    const n=(await cloud({})).notes.find(n=>n.id===id&&!n.deletedAt&&!n.archived);if(!n)throw new Error('笔记已移除或归档，请先恢复。');
    if(changed.some(k=>!equal(n[k]??(k==='sources'?[]:''),baseline[k])&&!equal(n[k],values[k])))throw Object.assign(new Error('这些信息已在其他页面修改。草稿已保留，请核对或载入最新信息。'),{code:'METADATA_CONFLICT'});
    if(changed.every(k=>equal(n[k],values[k])))return n;
    const metadata={...metadataOf(n),tags:(n.tags||[]).map(validateTag),...Object.fromEntries(changed.map(k=>[k,values[k]]))};
    try{return (await cloud({method:'PATCH',body:{id,revision:n.revision,action:'edit_metadata',metadata}})).note;}catch(e){if(e.status!==409||attempt===2)throw e;}
  }
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createMetadataEditor({adapter,onSaved}){
  const dialog=document.createElement('dialog');dialog.className='note-metadata-editor';dialog.setAttribute('aria-label','编辑笔记信息');document.body.append(dialog);
  let session=null,busy=false,queue=Promise.resolve();const $=s=>dialog.querySelector(s),key=()=>`metadata-edit:${session.id}`;
  function collect(){const v={...session.values};for(const k of ['title','kind','status','published','timestamp'])v[k]=$(`[name=${k}]`).value.trim();v.sources=[...dialog.querySelectorAll('.metadata-source')].map(row=>({url:row.querySelector('[data-source=url]').value.trim(),label:row.querySelector('[data-source=label]').value.trim()}));return v;}
  function persist(){session.values=collect();const storageKey=key(),value=structuredClone(session);queue=queue.catch(()=>{}).then(()=>adapter.write(storageKey,value));return queue;}
  function draw(){const v=session.values;dialog.innerHTML=`<div class="dialog-head"><h2>编辑信息</h2><button type="button" data-meta="close" aria-label="关闭编辑">×</button></div><form><label>标题<input name="title" maxlength="200" required value="${esc(v.title)}"></label><div class="metadata-grid"><label>内容类型<select name="kind">${Object.entries({article:'文章',video:'视频',podcast:'播客',idea:'灵感',other:'其他'}).map(([k,t])=>`<option value="${k}" ${v.kind===k?'selected':''}>${t}</option>`).join('')}</select></label><label>阅读状态<select name="status">${Object.entries({reading:'正在读',read:'已读完',inbox:'待阅读'}).map(([k,t])=>`<option value="${k}" ${v.status===k?'selected':''}>${t}</option>`).join('')}</select></label></div><label>内容发布时间<input name="published" maxlength="30" value="${esc(v.published)}" placeholder="如：2026-11-10 或 2026.11"></label><label>关键时间点<input name="timestamp" maxlength="30" value="${esc(v.timestamp)}" placeholder="如：12:30，可留空"></label><div class="metadata-source-list">${v.sources.map((s,i)=>`<div class="metadata-source"><div class="metadata-source-head"><span>${i===0?'主要来源':'来源 '+(i+1)}</span><button type="button" data-meta="remove" data-index="${i}">移除</button></div><label>链接<input data-source="url" maxlength="2000" type="url" value="${esc(s.url)}" required></label><label>来源名称<input data-source="label" maxlength="100" value="${esc(s.label)}" placeholder="选填"></label></div>`).join('')}</div><button type="button" data-meta="add" ${v.sources.length>=10?'disabled':''}>＋ 添加来源</button><p class="hint">标签可在笔记标题下直接选择和新建。</p><p class="metadata-error" role="status"></p><button type="button" data-meta="reload" hidden>载入最新信息（本次草稿另存）</button><div class="dialog-actions"><button type="button" data-meta="close">取消</button><button type="submit" class="primary">保存信息</button></div></form>`;}
  async function run(task){if(busy)return;busy=true;dialog.inert=true;try{await task();}catch(e){$('.metadata-error').textContent=e.message;if(e.code==='METADATA_CONFLICT')$('[data-meta=reload]').hidden=false;}finally{busy=false;dialog.inert=false;}}
  dialog.addEventListener('input',()=>{void persist().catch(e=>{$('.metadata-error').textContent='草稿未能缓存：'+e.message;});});
  dialog.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{await persist();const saved=await saveMetadata(adapter.cloud,session.id,session.baseline,session.values);await adapter.remove(key());dialog.close();onSaved(saved);session=null;});});
  dialog.addEventListener('click',e=>{const b=e.target.closest('[data-meta]');if(!b)return;void run(async()=>{await persist();const action=b.dataset.meta;if(action==='close'){dialog.close();session=null;}else if(action==='add'){session.values.sources.push({url:'',label:''});draw();await persist();}else if(action==='remove'){session.values.sources.splice(Number(b.dataset.index),1);draw();await persist();}else if(action==='reload'){await adapter.write(key()+':previous',session);const n=(await adapter.cloud({})).notes.find(n=>n.id===session.id);if(!n)throw new Error('笔记不存在。');session.baseline=metadataOf(n);session.values=metadataOf(n);draw();await persist();}});});
  dialog.addEventListener('cancel',e=>{e.preventDefault();void run(async()=>{await persist();dialog.close();session=null;});});
  return {async open(note){if(!note)throw new Error('先选择一篇笔记。');session={id:note.id,baseline:metadataOf(note),values:metadataOf(note)};session=await adapter.read(key())||session;draw();dialog.showModal();$('[name=published]').focus();}};
}

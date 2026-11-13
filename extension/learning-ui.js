import {renderMarkdown} from './markdown.js';
import {kindNames} from './learning-retrieval.js';
import {attachMarkdownEditor} from './markdown-editor.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountLearning(root,api){
 let chat=null,chats=[],notes=[],scope=[],busy=false,draft=null,requestId=null,destroyed=false,editor=null,materialTurn=null,materialTab='used',pending=null;
 const $=q=>root.querySelector(q),noteURL=id=>api.noteURL(id),number=id=>(chat?.materials.findIndex(m=>m.id===id)??-1)+1;
 root.innerHTML=`<div class="learn-shell"><main class="learn-main"><header class="learn-header"><h1 id="learn-title">新对话</h1><div class="learn-header-actions"><button data-action="scope" id="learn-scope">全部笔记 ▾</button><button data-action="history" aria-label="对话历史" aria-expanded="false">历史</button></div></header><div id="learn-notice" role="status" hidden></div><div id="learn-turns" class="learn-turns" aria-live="polite"></div><form id="learn-form" class="learn-composer"><label class="learn-sr" for="learn-question">问题</label><textarea id="learn-question" rows="2" maxlength="4000" placeholder="问问你的笔记…"></textarea><div><span class="learn-muted" id="learn-progress">依据已保存的笔记、原文片段与字幕回答</span><button class="learn-primary" type="submit" id="learn-send">发送 ↑</button></div></form></main><aside class="learn-history-panel" aria-label="对话历史"><header><h2>对话历史</h2><button data-action="history-close" aria-label="关闭历史">×</button></header><button class="learn-primary" data-action="new">＋ 新对话</button><div id="learn-history"></div><button class="learn-settings" data-action="settings">阅读设置</button></aside></div><dialog id="learn-image-dialog" class="learn-dialog learn-image-dialog"><header><h2>参考图片</h2><button data-close="learn-image-dialog" aria-label="关闭图片">×</button></header><img alt="参考材料图片"></dialog>
 <dialog class="learn-dialog" id="learn-materials" aria-labelledby="learn-material-title"><header><h2 id="learn-material-title">参考材料</h2><button data-close="learn-materials" aria-label="关闭材料">×</button></header><div class="learn-material-tabs" role="tablist"><button role="tab" data-material-tab="used">本轮参考</button><button role="tab" data-material-tab="all">全部检索</button></div><p class="learn-muted" id="learn-material-caption"></p><div id="learn-material-content"></div></dialog>
 <dialog class="learn-dialog" id="learn-scope-dialog" aria-labelledby="learn-scope-title"><header><h2 id="learn-scope-title">笔记范围</h2><button data-close="learn-scope-dialog" aria-label="关闭范围">×</button></header><p class="learn-muted">不勾选时检索全部未归档笔记。范围调整只影响后续回答。</p><input id="learn-note-search" type="search" placeholder="搜索笔记标题" aria-label="搜索笔记标题"><div id="learn-note-options"></div><footer><button data-action="all-notes">全部笔记</button><button class="learn-primary" data-action="scope-done">完成</button></footer></dialog>
 <dialog class="learn-dialog" id="learn-save-dialog" aria-labelledby="learn-save-title"><header><h2 id="learn-save-title">整理成笔记</h2><button data-close="learn-save-dialog" aria-label="关闭草稿">×</button></header><div id="learn-save-choice"><p>提炼问题与回答，保留来源，保存为独立笔记。</p><button data-action="draft-round">只整理这一轮</button><button data-action="draft-chat">整理整段对话</button></div><form id="learn-save-form" hidden><label>标题<input id="learn-draft-title" maxlength="200" required></label><label for="learn-draft-body">正文</label><textarea id="learn-draft-body" maxlength="40000" rows="10" required></textarea><p class="learn-muted">同时保留问题、参考材料快照和原对话链接。</p><footer><span id="learn-save-status" role="status"></span><button class="learn-primary" type="submit">保存笔记</button></footer></form><p id="learn-draft-status" role="status"></p></dialog>`;
 const notice=(text,error=false)=>{if(destroyed)return;$('#learn-notice').hidden=!text;$('#learn-notice').textContent=text;$('#learn-notice').classList.toggle('learn-error',error);};
 function setBusy(value,label='正在检索并整理回答…'){busy=value;$('#learn-question').disabled=value;$('#learn-send').disabled=value;root.querySelectorAll('[data-action="new"],[data-chat],[data-action="save"],[data-action="scope"]').forEach(b=>b.disabled=value);$('#learn-progress').textContent=value?label:'依据已保存的笔记、原文片段与字幕回答';}
 function history(){ $('#learn-history').innerHTML=chats.map(c=>`<button data-chat="${c.id}" class="${c.id===chat?.id?'active':''}" title="${esc(c.title)}">${esc(c.title)}</button>`).join('')||'<p class="learn-muted">暂无对话</p>'; }
 const imageCache=new Map();
 const imageURL=key=>{if(!imageCache.has(key))imageCache.set(key,Promise.resolve().then(()=>api.image(key)).catch(e=>{imageCache.delete(key);throw e;}));return imageCache.get(key);};
 function loadAnswerImages(){for(const image of root.querySelectorAll('[data-answer-image]'))imageURL(image.dataset.answerImage).then(src=>{if(image.isConnected)image.src=src;}).catch(()=>{image.alt='图片暂时无法读取，点击重试';});}
 function paragraphsHTML(answer,turnId,materialList){
   const shown=new Set();return answer.map(p=>{
     const images=p.references.map(id=>materialList.find(m=>m.id===id&&m.imageKey)).filter(m=>m&&!shown.has(m.imageKey)&&shown.add(m.imageKey));
     return `<div class="learn-paragraph">${p.type==='inference'?'<small class="learn-inference">推断</small>':''}<div class="clips-markdown markdown-body">${renderMarkdown(p.text)}</div><span class="learn-refs">${p.references.map(id=>`<button data-ref="${id}" data-turn="${turnId}" ${pending?.id===turnId?'disabled':''} aria-label="查看材料 ${materialList.findIndex(m=>m.id===id)+1}">${materialList.findIndex(m=>m.id===id)+1}</button>`).join('')}</span>${images.length?`<div class="learn-answer-images">${images.map(m=>`<button data-image-key="${esc(m.imageKey)}" aria-label="放大参考图片 ${materialList.indexOf(m)+1}"><img data-answer-image="${esc(m.imageKey)}" alt="${esc(m.title)}中的图片"><span>图片 · ${materialList.indexOf(m)+1}</span></button>`).join('')}</div>`:''}</div>`;
   }).join('');
 }
 function render(forceScroll=false){
   const log=$('#learn-turns'),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<80,scroll=log.scrollTop;
   $('#learn-title').textContent=chat?.title||'新对话';history();
   log.innerHTML=chat?.turns.length||pending?(chat?.turns||[]).map((t,index)=>`<section class="learn-turn" id="turn-${t.id}"><div class="learn-question">${esc(t.question)}</div><div class="learn-answer"><div class="learn-answer-head"><b>Clips</b><button data-action="materials" data-turn="${t.id}">查看材料 · ${t.used.length} 段 ↗</button></div>${paragraphsHTML(t.answer,t.id,chat.materials)}${t.warnings?.length?`<p class="learn-muted learn-warning">${esc(t.warnings.join(' '))}</p>`:''}<footer><button data-action="save" data-turn="${t.id}">整理成笔记</button><span class="learn-muted">${index+1} / 20 轮</span></footer></div></section>`).join('')+(pending?`<section class="learn-turn" id="turn-${pending.id}"><div class="learn-question">${esc(pending.question)}</div><div class="learn-answer" aria-busy="true"><div class="learn-answer-head"><b>Clips</b></div>${paragraphsHTML(pending.answer||[],pending.id,pending.materials||[])}<p class="learn-muted learn-pending" role="status">${esc(pending.status||'正在检索笔记…')}</p></div></section>`:''):`<div class="learn-empty"><h2>从一个问题开始</h2><div>${['对比笔记中的 Agent 架构与适用场景','梳理我对 Agent 的观点变化','基于我的笔记，生成一份分享提纲'].map(q=>`<button data-suggestion="${esc(q)}">${q} ↗</button>`).join('')}</div></div>`;
   log.scrollTop=forceScroll||nearBottom?log.scrollHeight:scroll;loadAnswerImages();
   if(busy)root.querySelectorAll('[data-chat],[data-action="save"]').forEach(b=>b.disabled=true);
 }
 async function refreshList(){chats=(await api.request({path:'/api/learning'})).chats;history();}
 async function openChat(id){if(busy)return;notice('');const data=await api.request({path:'/api/learning?id='+id});if(!data.chat)throw new Error('对话不存在。');chat=data.chat;scope=chat.turns.at(-1)?.scope||[];$('#learn-scope').textContent=scope.length?`已选 ${scope.length} 篇 ▾`:'全部笔记 ▾';requestId=null;$('#learn-question').value='';render();$('.learn-shell').classList.remove('history-open');$('[data-action="history"]').setAttribute('aria-expanded','false');api.setChat?.(id);}
 async function materials(turnId,focus){
   materialTurn=chat.turns.find(t=>t.id===turnId);if(!materialTurn)return;
   if(focus)materialTab='used';
   const used=new Set(materialTurn.used),previous=new Set(chat.turns.slice(0,chat.turns.indexOf(materialTurn)).flatMap(t=>t.retrieved));
   const ids=materialTab==='used'?materialTurn.used:materialTurn.retrieved,rows=ids.map(id=>chat.materials.find(m=>m.id===id)).filter(Boolean),groups=new Map();
   rows.forEach(m=>{if(!groups.has(m.noteId))groups.set(m.noteId,[]);groups.get(m.noteId).push(m);});
   root.querySelectorAll('[data-material-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.materialTab===materialTab)));
   $('#learn-material-caption').textContent=materialTab==='used'?`${rows.length} 段实际提供给本轮回答的材料${materialTurn.history?.length?' · 同时带入最近 '+materialTurn.history.length+' 轮问答理解追问（超长回复节选）':''}。`:`截至本轮共找到 ${rows.length} 段；“未用于本轮”的内容没有作为本轮原文依据。`;
   $('#learn-material-content').innerHTML=[...groups].map(([id,items])=>`<section class="learn-source"><h3><a href="${esc(noteURL(id))}" target="_blank" rel="noopener">${esc(items[0].title)} ↗</a></h3>${items.map(m=>`<article class="learn-material ${focus===m.id?'highlight':''}" id="material-${m.id}"><header><b>[${number(m.id)}] ${kindNames[m.kind]}</b><span>${used.has(m.id)?previous.has(m.id)?'沿用 · 本轮参考':'本轮参考':'未用于本轮'}</span></header><p class="learn-muted">${esc([m.published&&'内容发布：'+m.published,String(m.location||'').replace(/\/[^ ·]+/g,''),m.coverage].filter(Boolean).join(' · '))}</p><div class="clips-markdown markdown-body">${renderMarkdown(m.text)}</div>${m.imageKey?`<img data-material-image="${esc(m.imageKey)}" alt="${esc(m.title)}中的图片">`:''}${/^https?:\/\//.test(m.url||'')?`<a class="learn-original-link" href="${esc(m.url)}" target="_blank" rel="noopener">原文链接 ↗</a>`:''}</article>`).join('')}</section>`).join('')||'<p class="learn-muted">这一轮没有可提供的材料。</p>';
   const modal=$('#learn-materials');if(!modal.open)modal.showModal();
   if(focus)$('#material-'+focus)?.scrollIntoView({block:'center'});else modal.scrollTop=0;
   for(const image of modal.querySelectorAll('[data-material-image]'))imageURL(image.dataset.materialImage).then(src=>{if(image.isConnected)image.src=src;}).catch(()=>{image.alt='图片文件暂时无法读取';});
 }
 function renderScopes(){const q=$('#learn-note-search').value.toLowerCase();$('#learn-note-options').innerHTML=notes.filter(n=>n.title.toLowerCase().includes(q)).map(n=>`<label><input type="checkbox" value="${n.id}" ${scope.includes(n.id)?'checked':''}>${esc(n.title)}</label>`).join('');}
 function openSave(id){materialTurn=chat.turns.find(t=>t.id===id);$('#learn-save-choice').hidden=false;$('#learn-save-form').hidden=true;$('#learn-draft-status').textContent='';$('#learn-save-dialog').showModal();}
 async function makeDraft(all){setBusy(true,'正在整理笔记草稿…');$('#learn-draft-status').textContent='正在提炼问题与回答…';$('#learn-save-choice').hidden=true;
   try{const result=await api.run('draft',{chatId:chat.id,turnId:all?undefined:materialTurn.id});draft=result.draft;$('#learn-save-form button[type="submit"]').disabled=false;$('#learn-draft-title').value=draft.title;$('#learn-draft-body').value=draft.text;$('#learn-save-form').hidden=false;$('#learn-draft-status').textContent='';$('#learn-save-status').textContent='';editor||=await attachMarkdownEditor($('#learn-draft-body'));}
   catch(e){$('#learn-draft-status').textContent=e.message;$('#learn-save-choice').hidden=false;}finally{setBusy(false);}
 }
 async function submit(event){event.preventDefault();if(busy)return;const question=$('#learn-question').value.trim();if(!question)return;requestId||=crypto.randomUUID();chat||={id:crypto.randomUUID(),revision:0,title:question.slice(0,80),materials:[],turns:[]};
   const id=requestId;pending={id,question};$('#learn-question').value='';setBusy(true);notice('');render(true);
   try{
     const result=await api.run('ask',{chatId:chat.id,turnId:id,revision:chat.revision,question,scope},progress=>{if(destroyed||pending?.id!==id)return;Object.assign(pending,progress);render();});
     if(destroyed)return;chat=result.chat;requestId=null;pending=null;render();api.setChat?.(chat.id);
     try{await refreshList();}catch{notice('回复已保存，对话列表暂未刷新。');}
   }catch(e){if(!destroyed){pending=null;$('#learn-question').value=question;render();notice(e.message+' 问题已恢复，可重试。',true);}}
   finally{if(!destroyed){setBusy(false);$('#learn-question').focus();}}
 }
 const click=async e=>{const b=e.target.closest('button');if(!b)return;try{
   if(b.dataset.imageKey){const dialog=$('#learn-image-dialog');dialog.querySelector('img').src=await imageURL(b.dataset.imageKey);dialog.showModal();return;}
   if(b.dataset.action==='history'||b.dataset.action==='history-close'){const open=b.dataset.action==='history'&&!$('.learn-shell').classList.contains('history-open');$('.learn-shell').classList.toggle('history-open',open);$('[data-action="history"]').setAttribute('aria-expanded',String(open));return;}
   if(b.dataset.close){$('#'+b.dataset.close).close();return;}
   if(b.dataset.chat)return await openChat(b.dataset.chat);
   if(b.dataset.ref)return await materials(b.dataset.turn,b.dataset.ref);
   if(b.dataset.materialTab){materialTab=b.dataset.materialTab;return await materials(materialTurn.id);}
   if(b.dataset.suggestion){$('#learn-question').value=b.dataset.suggestion;$('#learn-question').focus();return;}
   if(b.dataset.action==='new'){if(busy)return;chat=null;pending=null;requestId=null;$('#learn-question').value='';render();$('.learn-shell').classList.remove('history-open');$('[data-action="history"]').setAttribute('aria-expanded','false');api.setChat?.('');}
   if(b.dataset.action==='scope'){renderScopes();$('#learn-scope-dialog').showModal();}
   if(b.dataset.action==='all-notes'){scope=[];renderScopes();}
   if(b.dataset.action==='scope-done'){$('#learn-scope-dialog').close();$('#learn-scope').textContent=scope.length?`已选 ${scope.length} 篇 ▾`:'全部笔记 ▾';}
   if(b.dataset.action==='materials'){materialTab='used';await materials(b.dataset.turn);}
   if(b.dataset.action==='save')openSave(b.dataset.turn);
   if(b.dataset.action==='draft-round'||b.dataset.action==='draft-chat')await makeDraft(b.dataset.action==='draft-chat');
   if(b.dataset.action==='settings')await api.settings();
 }catch(e){notice(e.message,true);}};
 root.addEventListener('click',click);$('#learn-form').addEventListener('submit',submit);
 $('#learn-note-search').oninput=renderScopes;$('#learn-note-options').onchange=e=>{scope=e.target.checked?[...new Set([...scope,e.target.value])]:scope.filter(id=>id!==e.target.value);};
 $('#learn-question').oninput=()=>{requestId=null;};$('#learn-question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#learn-form').requestSubmit();}};
 $('#learn-save-form').onsubmit=async e=>{e.preventDefault();if(busy)return;setBusy(true,'正在保存笔记…');$('#learn-save-status').textContent='保存中…';
   try{draft={...draft,title:$('#learn-draft-title').value,text:$('#learn-draft-body').value};const {note}=await api.run('save',{draft});$('#learn-save-status').innerHTML=`已保存 · <a href="${esc(noteURL(note.id))}" target="_blank" rel="noopener">打开笔记 ↗</a>`;$('#learn-save-form button[type="submit"]').disabled=true;}
   catch(e){$('#learn-save-status').textContent=e.message;}finally{setBusy(false);}
 };
 $('#learn-save-dialog').addEventListener('close',()=>{$('#learn-save-form button[type="submit"]').disabled=false;});
 render();
 (async()=>{try{const [{notes:list}]=await Promise.all([api.request({path:'/api/notes'}),refreshList()]);notes=list.filter(n=>!n.deletedAt&&!n.archived&&n.status!=='inbox');if(api.chatId)await openChat(api.chatId);const status=await api.run('status');if(!status.configured)notice('先在阅读设置中配置 DeepSeek，再开始提问。');}catch(e){notice(e.message,true);}})();
 return ()=>{destroyed=true;editor?.destroy();root.removeEventListener('click',click);root.innerHTML='';};
}

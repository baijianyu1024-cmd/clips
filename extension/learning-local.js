import {streamRequest} from './stream-request.js';
import {mountLearning} from './learning-ui.js';
import {adapter} from './adapter.js';
import {targetKey} from './storage-target.js';
const target=await adapter.target(),root=document.querySelector('#learning');
const run=(action,input,onProgress)=>streamRequest({type:'LEARNING',action,input,context:targetKey(target)},onProgress);
mountLearning(root,{draftStorage:adapter,request:r=>adapter.cloud(r),run,libraryURL:'library.html',noteURL:id=>'library.html?note='+id,chatId:new URL(location.href).searchParams.get('chat'),setChat:id=>history.replaceState(null,'','learning.html'+(id?'?chat='+id:'')),image:async key=>(await adapter.cloud({path:'/api/media?key='+encodeURIComponent(key)})).dataUrl,settings:()=>adapter.open(chrome.runtime.getURL('panel.html?settings=1'))});

// Preserve the local library navigation and open its existing editors through explicit routes.
const go=params=>location.assign('library.html?'+new URLSearchParams(params));
document.querySelector('#new-note').onclick=()=>go({new:'1'});
document.querySelector('#manage-tags').onclick=()=>go({manage:'tags'});
document.querySelector('#open-settings').onclick=()=>go({settings:'1'});
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>go({view:b.dataset.nav==='library'?'records':b.dataset.nav}));
document.querySelector('#open-reading-settings').onclick=()=>adapter.open(chrome.runtime.getURL('panel.html?settings=1'));
document.querySelector('#storage-label').textContent=target?.mode==='local'?'本地 · '+target.name:'尚未选择文件夹';
try{const {notes,tagState}=await adapter.cloud({path:'/api/notes'});const tags=[...new Set([...(tagState?.tags||[]).map(t=>t.name),...notes.filter(n=>!n.deletedAt).flatMap(n=>n.tags)])];const list=document.querySelector('#tag-list');for(const tag of tags){const b=document.createElement('button');b.textContent='# '+tag;b.onclick=()=>go({tag});list.append(b);}}catch{document.querySelector('#tag-list').textContent='标签暂未加载';}

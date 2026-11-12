import {mountLearning} from './learning-ui.js';
import {adapter} from './adapter.js';
import {targetKey} from './storage-target.js';
const target=await adapter.target(),root=document.querySelector('#learning');
const run=async(action,input)=>{const r=await chrome.runtime.sendMessage({type:'LEARNING',action,input,context:targetKey(target)});if(!r?.ok)throw new Error(r?.error||'插件连接中断，请刷新后重试。');return r.data;};
mountLearning(root,{request:r=>adapter.cloud(r),run,libraryURL:'library.html',noteURL:id=>'library.html?note='+id,chatId:new URL(location.href).searchParams.get('chat'),setChat:id=>history.replaceState(null,'','learning.html'+(id?'?chat='+id:'')),image:async key=>(await adapter.cloud({path:'/api/media?key='+encodeURIComponent(key)})).dataUrl,settings:()=>adapter.open(chrome.runtime.getURL('panel.html?settings=1'))});

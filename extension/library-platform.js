import {targetKey} from './storage-target.js';
import {titlesFromTabs} from './link-metadata.js';
// Only these local application routes may cross the extension message boundary.
export function createLibraryPlatform({adapter,target,tabs,baseURL,storage=localStorage,onChanged=()=>{}}){
 const scope=targetKey(target),prefix=`clips-ui:local:${target.id}:`,media=new Map();
 const assertCurrent=async()=>{if(targetKey(await adapter.target())!==scope){onChanged();throw Object.assign(new Error('资料库已切换，请重新打开。当前输入仍保留在原资料库。'),{status:409});}};
 const request=async(input,init={})=>{
  const url=new URL(String(input),baseURL),path=url.pathname+url.search;
  if(!/^\/api\/(notes|tags|media|transcripts|materials|learning)(?:\?|$)/.test(path))return Response.json({error:'这份原文副本暂未保存在当前资料库，请返回来源页面阅读。'},{status:404});
  if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
  try{
   await assertCurrent();let body;
   if(init.body instanceof FormData){const file=init.body.get('file');if(!(file instanceof Blob)||file.size>8*1024*1024)throw new Error('图片无效或超过 8 MB。');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));body={base64:btoa(binary),type:file.type,name:file.name||'图片'};}
   else if(init.body)body=JSON.parse(init.body);
   const result=await adapter.cloud({path,method:init.method||'GET',...(body?{body}:{})});
   await assertCurrent();if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
   return Response.json(result);
  }catch(e){if(e.name==='AbortError')throw e;return Response.json({error:e.message||'操作失败，输入仍保留。'},{status:e.status||400});}
 };
 const page=path=>{if(path==='/favicon.svg')return new URL('icons/32.png',baseURL).href;const url=new URL(path,'https://clips.local');const route=url.pathname==='/learn'?'learning.html'+url.search:url.pathname==='/extension-bridge'?'panel.html?settings=1':'library.html'+url.search;return new URL(route,baseURL).href;};
 return {local:true,request,page,settings:()=>adapter.open(new URL('storage.html',baseURL).href),storage:{getItem:k=>storage.getItem(prefix+k),setItem:(k,v)=>storage.setItem(prefix+k,v),removeItem:k=>storage.removeItem(prefix+k)},
  async media(url){await assertCurrent();const key=new URL(url,'https://clips.local').searchParams.get('key');if(!media.has(key))media.set(key,adapter.cloud({path:'/api/media?key='+encodeURIComponent(key)}).then(async r=>{await assertCurrent();return r.dataUrl;}).catch(e=>{media.delete(key);throw e;}));return media.get(key);},
  async queueTitles(urls){await assertCurrent();return titlesFromTabs(urls,await tabs());}
 };
}

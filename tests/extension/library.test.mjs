import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {diskFolder} from './folder-fixture.mjs';
import {openFolder,createFolderRepository} from '../../extension/folder-store.js';

test('local library creates, edits, recovers a conflict, and reloads actual folder records',async t=>{
 const disk=await diskFolder(t),target=await openFolder(disk.root),repo=createFolderRepository(disk.root,target.id);
 const {window,document}=parseHTML(await readFile(new URL('../../extension/library.html',import.meta.url),'utf8'));
 Object.assign(globalThis,{window,document,location:new URL('https://example.test/library.html'),confirm:()=>true});
 window.scrollTo=()=>{};
 window.HTMLElement.prototype.showModal=function(){this.open=true;this.setAttribute('open','');};
 window.HTMLElement.prototype.close=function(){this.open=false;this.removeAttribute('open');};
 globalThis.FormData=class {constructor(form){this.pairs=[...form.querySelectorAll('input[name],select[name],textarea[name]')].filter(x=>x.type!=='checkbox'||x.checked).map(x=>[x.name,x.tagName==='SELECT'?(x.querySelector('option[selected]')||x.querySelector('option')).value:x.value]);}*[Symbol.iterator](){yield* this.pairs;}};
 const {adapter}=await import('../../extension/adapter.js');const cache=new Map();let refreshGate;
 Object.assign(adapter,{target:async()=>target,cloud:async options=>{
  const result=await repo.request(options);
  if(refreshGate){
   if(options?.method==='POST'||options?.method==='PATCH')refreshGate.saved=true;
   else if(refreshGate.saved&&!options?.path){const gate=refreshGate;refreshGate=null;gate.started=true;await gate.wait;}
  }
  return result;
 },read:async k=>structuredClone(cache.get(k)),write:async(k,v)=>cache.set(k,structuredClone(v)),remove:async k=>cache.delete(k)});
 globalThis.chrome={storage:{onChanged:{addListener(){}}}};
 await import('../../extension/library.js');
 const $=s=>document.querySelector(s),until=async pred=>{for(let i=0;i<150;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Timed out: '+document.querySelector('#editor-error').textContent);};
 const click=s=>$(s).click(),input=(name,value)=>{$(`[name="${name}"]`).value=value;$(`[name="${name}"]`).dispatchEvent(new window.Event('input',{bubbles:true}));},submit=()=>$('#edit-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 // Hold the post-save read explicitly: a slow disk must not expose clickable
 // library controls while run() is still busy and would discard their clicks.
 const saveWithDelayedRefresh=async(send=submit)=>{
  let release;const gate={wait:new Promise(resolve=>{release=resolve;}),saved:false,started:false};refreshGate=gate;
  try{
   send();await until(()=>gate.started);
   assert.equal($('#editor').open,true,'Keep the editor open until the saved library has refreshed');
   assert.equal($('#edit-form').inert,true,'Keep the pending save protected from duplicate submissions');
  }finally{
   release();await until(()=>!$('#editor').open&&!$('#edit-form').inert);
  }
 };
 click('#new-note');await until(()=>$('#editor').open);input('title','跨设备的笔记');input('url','https://example.com/a');input('tags','测试');await saveWithDelayedRefresh();
 let note=(await repo.request()).notes[0];assert.equal(note.title,'跨设备的笔记');assert.match($('#content').textContent,/跨设备/);
 click('[data-action="add-record"]');await until(()=>$('#editor').open);input('text','原文中的 `state`');input('thought','```js\nconst n = 1;\n```');
 assert.equal($('#editor .markdown-live'),null);assert.equal($('[name=thought]').value,'```js\nconst n = 1;\n```');await saveWithDelayedRefresh();
 note=(await repo.request()).notes[0];assert.equal(note.clips.length,1);assert.match(note.clips[0].thought,/const n/);
 click('[data-action="edit-summary"]');await until(()=>$('#editor').open);input('text','**自己的总结**');
 await repo.request({method:'PATCH',body:{id:note.id,revision:note.revision,action:'status',status:'read'}});submit();await until(()=>!$('#editor-conflict').hidden);
 assert.equal($('[name=text]').value,'**自己的总结**');assert.match($('#editor-error').textContent,/草稿已保留/);
 await saveWithDelayedRefresh(()=>click('#rebase-editor'));
 const reopened=createFolderRepository(disk.root,target.id);note=(await reopened.request()).notes[0];assert.equal(note.coreSummary.text,'**自己的总结**');assert.equal(note.status,'read');assert.equal(note.clips.length,1);
});

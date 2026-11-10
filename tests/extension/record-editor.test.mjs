import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { saveRecordEdit, createRecordEditor } from '../../extension/record-editor.js';
import { draftImageStore } from '../../extension/image-drafts.js';
const original = { id:'clip-a', text:'保留原始引用\n与时间戳', thought:'原来的想法', images:[], videoTime:30, sourceUrl:'https://www.youtube.com/watch?v=SHIYEDEMO01', transcriptAnchor:{snapshotId:'a'.repeat(64),from:1,to:3} };
function backend() {
 let note={id:'note-a',clips:[structuredClone(original)],revision:1}, writes=0, lost=false, conflict=false;
 return {get note(){return note;},get writes(){return writes;},lose:()=>lost=true,conflict:()=>conflict=true,
 cloud:async request=>{
  if(request.method!=='PATCH')return {notes:[structuredClone(note)]};
  writes++;
  if(conflict){conflict=false;note.revision++;throw Object.assign(Error('revision changed'),{status:409});}
  assert.equal(request.body.revision,note.revision);
  note.clips=note.clips.map(c=>c.id===request.body.record.id?{...c,...request.body.record}:c);note.revision++;
  if(lost){lost=false;throw Error('lost response');}return {note:structuredClone(note)};
 }};
}
test('editing thought/images updates the original record and preserves quote, anchor and time',async()=>{
 const b=backend();const record={id:original.id,text:original.text,thought:'补充理解',images:[{key:'owner/image',name:'截图'}]};
 const saved=await saveRecordEdit(b.cloud,'note-a',original,record);
 assert.equal(saved.clips.length,1);assert.equal(saved.clips[0].thought,'补充理解');assert.deepEqual(saved.clips[0].transcriptAnchor,original.transcriptAnchor);assert.equal(saved.clips[0].videoTime,30);assert.equal(saved.clips[0].images.length,1);
});
test('lost response retry is idempotent and unrelated note changes can retry',async()=>{
 const b=backend(),record={...original,thought:'追加',images:[]};b.lose();
 await assert.rejects(saveRecordEdit(b.cloud,'note-a',original,record),/lost/);
 await saveRecordEdit(b.cloud,'note-a',original,record);assert.equal(b.writes,1);
 const c=backend();c.conflict();await saveRecordEdit(c.cloud,'note-a',original,record);assert.equal(c.writes,2);
});
test('concurrent edits to the same record and removed notes are never overwritten',async()=>{
 const b=backend();b.note.clips[0].thought='网页端新理解';
 await assert.rejects(saveRecordEdit(b.cloud,'note-a',original,{...original,thought:'侧栏草稿'}),/其他地方修改/);assert.equal(b.writes,0);
 b.note.archived=true;await assert.rejects(saveRecordEdit(b.cloud,'note-a',original,original),/移除或归档/);
});
test('inline editor keeps mixed draft separate, survives closing and saves images on the same record',async()=>{
 const {window,document}=parseHTML('<html><body><textarea id="composer">新记录未保存的草稿</textarea><div class="entry"><div data-record-editor="clip-a"></div></div></body></html>');globalThis.document=document;
 const b=backend(),storage=new Map(),blobs=new Map();
 draftImageStore.put=async(n,id,blob)=>blobs.set(n+id,blob);draftImageStore.get=async(n,id)=>blobs.get(n+id);draftImageStore.remove=async(n,id)=>blobs.delete(n+id);
 const adapter={cloud:b.cloud,read:async k=>structuredClone(storage.get(k)),write:async(k,v)=>storage.set(k,structuredClone(v)),remove:async k=>storage.delete(k)};
 let active=b.note,editor;const messages=[];
 editor=createRecordEditor({adapter,native:false,active:()=>active,upsert:n=>active=n,rerender:()=>editor.mount(),notice:m=>messages.push(m)});
 await editor.open(active,'clip-a');const input=document.querySelector('.record-editor textarea');input.setRangeText=function(t,start,end){this.value=this.value.slice(0,start)+t+this.value.slice(end)};
 input.value='第二次理解';input.dispatchEvent(new window.Event('input'));
 const file=new File(['png'],'截图.png',{type:'image/png'}),paste=new window.Event('paste',{bubbles:true,cancelable:true});paste.clipboardData={items:[{kind:'file',type:file.type,getAsFile:()=>file}],getData:()=>''};input.dispatchEvent(paste);
 const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};await flush();
 const key='record-edit:note-a:clip-a';assert.equal(storage.get(key).attachments.length,1);assert.equal(b.writes,0);assert.equal(document.querySelector('#composer').value,'新记录未保存的草稿');
 document.querySelector('[data-edit="close"]').click();await flush();assert.equal(document.querySelector('.record-editor'),null);
 await editor.open(active,'clip-a');assert.equal(document.querySelector('.record-editor textarea').value,'第二次理解');assert.equal(document.querySelectorAll('.record-edit-image').length,1);
 b.lose();document.querySelector('[data-edit="save"]').click();await flush();assert.ok(storage.get(key));assert.match(document.querySelector('.record-edit-status').textContent,/lost/);
 document.querySelector('[data-edit="save"]').click();await flush();assert.equal(storage.get(key),undefined);assert.equal(active.clips.length,1);assert.equal(active.clips[0].thought,'第二次理解');assert.equal(active.clips[0].images.length,1);assert.deepEqual(active.clips[0].transcriptAnchor,original.transcriptAnchor);assert.equal(messages.length,1);assert.equal(document.querySelector('#composer').value,'新记录未保存的草稿');
});

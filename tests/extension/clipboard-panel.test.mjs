import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const {window,document}=parseHTML(await readFile(new URL('../../extension/panel.html',import.meta.url),'utf8'));
globalThis.window=window;globalThis.document=document;
window.HTMLElement.prototype.showModal=function(){this.open=true;this.setAttribute("open", "");};window.HTMLElement.prototype.close=function(){this.open=false;this.removeAttribute("open");this.dispatchEvent(new window.Event('close'));};
const thought=document.querySelector('#thought');thought.setRangeText=function(text,start=0,end=0){this.value=this.value.slice(0,start)+text+this.value.slice(end);};
const {adapter}=await import('../../extension/adapter.js');const {draftImageStore}=await import('../../extension/image-drafts.js');
const blobs=new Map(),storage=new Map();draftImageStore.put=async(n,id,b)=>blobs.set(n+id,b);draftImageStore.get=async(n,id)=>blobs.get(n+id);draftImageStore.remove=async(n,id)=>blobs.delete(n+id);
let note={id:'note-a',title:'阅读页面',sources:[{url:'https://example.com/article',label:'article'}],revision:1,clips:[],aiSummaries:[],images:[],status:'reading',summary:'',thought:''},lostResponse=false,handler;
storage.set('activeNoteId',note.id);adapter.read=async k=>structuredClone(storage.get(k));adapter.write=async(k,v)=>storage.set(k,structuredClone(v));adapter.remove=async k=>storage.delete(k);adapter.page=async()=>({id:1,url:'https://example.com/article',title:'article'});adapter.pending=async()=>null;adapter.subscribe=f=>{handler=f;};
adapter.cloud=async request=>{if(request.method!=='PATCH')return {notes:[structuredClone(note)]};const clip=request.body.clip;if(!note.clips.some(c=>c.id===clip.id)){note.clips.push(structuredClone(clip));note.revision++;}if(lostResponse){lostResponse=false;throw Error('response lost');}return {note:structuredClone(note)};};
const nativeInterval=globalThis.setInterval;globalThis.setInterval=()=>1;await import('../../extension/panel.js');globalThis.setInterval=nativeInterval;
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const click=async selector=>{document.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}));await flush();};
const image=new File(['sample'],'clipboard.png',{type:'image/png'});
const paste=async(files,text='')=>{const e=new window.Event('paste',{bubbles:true,cancelable:true});e.clipboardData={items:files.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),getData:()=>text};thought.dispatchEvent(e);await flush();return e;};
await flush();
test('clipboard images are previewed and persist with text in the pinned draft before any note write',async()=>{
 thought.value='阅读中的想法';thought.selectionStart=thought.value.length;thought.selectionEnd=thought.value.length;
 await paste([image],' + 粘贴文字');assert.equal(note.clips.length,0);assert.equal(document.querySelectorAll('.draft-image').length,1);assert.equal(thought.value,'阅读中的想法 + 粘贴文字');
 const draft=storage.get('draft:note-a');assert.equal(draft.attachments.length,1);assert.equal(draft.thought,thought.value);assert.ok(await draftImageStore.get('note-a',draft.attachments[0].id));
 adapter.page=async()=>({id:2,url:'https://example.com/other',title:'other'});await handler('page');await flush();assert.equal(storage.get('activeNoteId'),'note-a');assert.equal(storage.get('draft:note-a').attachments.length,1);
});
test('a lost save response retains the mixed draft; retry creates no duplicate and clears only after confirmation',async()=>{
 lostResponse=true;await click('[data-action="save"]');assert.equal(note.clips.length,0);assert.equal(document.querySelector("#save-context-dialog").open,true);await click('[data-context-choice="save"]');assert.equal(note.clips.length,1);assert.ok(storage.get('draft:note-a'));assert.equal(note.clips[0].images.length,1);assert.equal(note.images.length,0);
 await click('[data-action="save"]');await click('[data-context-choice="save"]');assert.equal(note.clips.length,1);assert.equal(storage.get('draft:note-a'),undefined);assert.equal(thought.value,'');assert.equal(document.querySelector('.saved-images').getAttribute('aria-label'),'记录中的 1 张图片');assert.equal(document.querySelectorAll('.saved-image-thumb').length,1);
});
test('multiple images can be removed before saving an image-only record; normal text paste is untouched',async()=>{
 await paste([image,image]);assert.equal(document.querySelectorAll('.draft-image').length,2);await click('[data-action="remove-image"]');assert.equal(document.querySelectorAll('.draft-image').length,1);assert.equal(thought.value,'');
 await click('[data-action="save"]');await click('[data-context-choice="save"]');assert.equal(note.clips.length,2);assert.equal(note.clips[1].text,'');assert.equal(note.clips[1].thought,'');assert.equal(note.clips[1].images.length,1);
 assert.equal((await paste([],'普通文字')).defaultPrevented,false);
});
test('local saves clear the composer and autosave when Markdown contains trailing whitespace',async()=>{
 adapter.page=async()=>({id:1,url:'https://example.com/article',title:'article'});await handler('page');await flush();
 adapter.pending=async()=>({text:' 原文内容\n',sourceUrl:'https://example.com/article',sourceTitle:'article'});adapter.clearPending=async()=>{};await click('[data-action="clip"]');assert.match(document.querySelector('#pending-quote').textContent,/原文内容/);
 thought.value='- 新想法\n\n';thought.dispatchEvent(new window.Event('input',{bubbles:true}));await flush();
 const before=note.clips.length;await click('[data-action="save"]');
 assert.equal(note.clips.length,before+1);assert.equal(note.clips.at(-1).thought,'- 新想法\n\n');
 assert.equal(thought.value,'');assert.equal(storage.get('draft:note-a'),undefined);
 assert.equal(document.querySelector('#pending-quote').textContent,'');
 await click('[data-action="save"]');assert.equal(note.clips.length,before+1,'empty composer must not save a duplicate');
});

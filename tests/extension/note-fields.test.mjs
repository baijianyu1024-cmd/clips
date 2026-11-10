import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {metadataOf,saveMetadata,createMetadataEditor,validateMetadata} from '../../extension/note-fields.js';
const original={id:'note',revision:1,title:'原题',sources:[{url:'https://example.com/a',label:'原文'}],kind:'article',status:'reading',published:'',timestamp:'',tags:['已有标签'],clips:[{id:'clip',text:'摘录',thought:'想法'}]};
function backend(){let n=structuredClone(original),writes=0,lost=false;return {get note(){return n;},get writes(){return writes;},lose(){lost=true;},cloud:async r=>{if(!r.method)return {notes:[structuredClone(n)]};assert.equal(r.body.action,'edit_metadata');assert.equal(r.body.revision,n.revision);n={...n,...r.body.metadata,revision:n.revision+1};writes++;if(lost){lost=false;throw Error('lost');}return {note:structuredClone(n)};}};}
test('metadata edits every basic field while preserving concurrent tags, records, and untouched fields',async()=>{
 const b=backend(),base=metadataOf(b.note);b.note.tags.push('新标签');b.note.clips.push({text:'另一台电脑的记录'});b.note.revision++;
 const values={...base,title:'新标题',published:'2026.11',timestamp:'12:34',kind:'video',status:'read',sources:[{url:'https://example.com/b',label:'更正名称'},{url:'https://example.com/c',label:'补充'}]};
 const n=await saveMetadata(b.cloud,'note',base,values);for(const k of Object.keys(values))assert.deepEqual(n[k],values[k]);assert.deepEqual(n.tags,['已有标签','新标签']);assert.equal(n.clips.length,2);
});
test('same-field conflicts preserve draft; lost metadata response is idempotent',async()=>{
 const b=backend(),base=metadataOf(b.note),values={...base,published:'2026-11-10'};b.lose();await assert.rejects(saveMetadata(b.cloud,'note',base,values),/lost/);await saveMetadata(b.cloud,'note',base,values);assert.equal(b.writes,1);
 b.note.published='2025';await assert.rejects(saveMetadata(b.cloud,'note',base,values),e=>e.code==='METADATA_CONFLICT');assert.equal(b.note.published,'2025');
 assert.throws(()=>validateMetadata({...base,sources:[{url:'javascript:alert(1)',label:''}]}),/http/);
});
test('publication field opens with old data, saves, and never rewrites tag selection',async()=>{
 const {window,document}=parseHTML('<html><body></body></html>');globalThis.document=document;window.HTMLElement.prototype.showModal=function(){this.open=true;};window.HTMLElement.prototype.close=function(){this.open=false;};
 const b=backend(),cache=new Map(),saved=[];const editor=createMetadataEditor({adapter:{cloud:b.cloud,read:async k=>cache.get(k),write:async(k,v)=>cache.set(k,structuredClone(v)),remove:async k=>cache.delete(k)},onSaved:n=>saved.push(n)});
 await editor.open(b.note);const form=document.querySelector('form'),input=document.querySelector('[name=published]');input.value='2026-11-10';input.dispatchEvent(new window.Event('input',{bubbles:true}));
 form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.equal(saved[0].published,'2026-11-10');assert.deepEqual(saved[0].tags,['已有标签']);assert.equal(cache.size,0);
});

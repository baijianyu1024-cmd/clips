import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryPlatform} from '../../extension/library-platform.js';
import {openFolder,createFolderRepository} from '../../extension/folder-store.js';
import {diskFolder} from './folder-fixture.mjs';
function memory(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
async function setup(t){const disk=await diskFolder(t),target={...await openFolder(disk.root),connection:'one'},repo=createFolderRepository(disk.root,target.id),storage=memory();let current=target;const p=createLibraryPlatform({target,adapter:{target:async()=>current,cloud:repo.request,open:async()=>{}},tabs:async()=>[],baseURL:'https://extension.test/library.html',storage});return {p,repo,target,storage,disk,switchTo:v=>current=v};}
const send=(p,path,body,method='POST')=>p.request(path,{method,body:JSON.stringify(body)});
test('HTTP interface persists form images, protects concurrent edits, renames associated tags, and exports/imports notes',async t=>{
 const {p,repo,disk}=await setup(t);
 const {note}=await (await send(p,'/api/notes',{id:crypto.randomUUID(),fields:{title:'桥接验证',tags:['旧名']}})).json();
 const form=new FormData();form.set('file',new Blob([Buffer.from([137,80,78,71,13,10,26,10,0,0])],{type:'image/png'}),'image.png');
 const result=await p.request('/api/media',{method:'POST',body:form}),{image}=await result.json();assert.ok(result.ok);assert.match(await p.media('/api/media?key='+encodeURIComponent(image.key)),/^data:image\/png;base64/);
 const tags=await (await p.request('/api/tags')).json();let r=await send(p,'/api/tags',{action:'rename',from:'旧名',name:'新名',revision:tags.revision});const renamed=await r.json();assert.ok(r.ok);assert.equal(renamed.notes[0].tags[0],'新名');assert.deepEqual(renamed.renamed,{from:'旧名',to:'新名'});assert.equal(renamed.tags[0].usageCount,1);
 r=await send(p,'/api/notes',{id:note.id,revision:note.revision,action:'edit_metadata',metadata:{title:'stale'}},'PATCH');assert.equal(r.status,409);assert.equal((await repo.request()).notes[0].title,'桥接验证');
 const current=(await repo.request()).notes[0],copy={...current,id:crypto.randomUUID(),title:'导入笔记'};r=await send(p,'/api/notes',{action:'import',backup:{version:1,notes:[current,copy]}});assert.deepEqual(await r.json(),{added:1,skipped:1});assert.equal(JSON.parse(await disk.read('clips.json')).notes.length,2);
});
test('drafts follow library identity, reconnects preserve them, and stale windows cannot write to a different connection',async t=>{
 const {p,target,storage,switchTo}=await setup(t);p.storage.setItem('draft','未保存内容');
 const reconnect=createLibraryPlatform({target:{...target,connection:'two'},adapter:{},tabs:async()=>[],baseURL:'https://extension.test/library.html',storage});assert.equal(reconnect.storage.getItem('draft'),'未保存内容');
 const other=createLibraryPlatform({target:{...target,id:crypto.randomUUID()},adapter:{},tabs:async()=>[],baseURL:'https://extension.test/library.html',storage});assert.equal(other.storage.getItem('draft'),null);
 switchTo({...target,connection:'two'});assert.equal((await p.request('/api/notes')).status,409);assert.equal(p.storage.getItem('draft'),'未保存内容');
});
test('routing preserves linked conversations and aborts are explicit',async t=>{
 const {p}=await setup(t);assert.equal(p.page('/learn?chat=abc'),'https://extension.test/learning.html?chat=abc');assert.equal(p.page('/?note=abc'),'https://extension.test/library.html?note=abc');assert.equal((await p.request('/api/unsupported')).status,404);
 const controller=new AbortController();controller.abort();await assert.rejects(p.request('/api/notes',{signal:controller.signal}),{name:'AbortError'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {openFolder,createFolderRepository,copyLibrary} from '../../extension/folder-store.js';
import {diskFolder} from './folder-fixture.mjs';
import {createFields} from '../../extension/core.js';
import {createLearningEngine} from '../../extension/learning-engine.js';
import {buildMaterials,retrieve,validateAnswer} from '../../extension/learning-retrieval.js';
import {fingerprint} from '../../extension/learning-model.js';
import {retainMaterial} from '../../extension/learning-capture.js';
import {JSDOM} from 'jsdom';
import {mountLearning} from '../../extension/learning-ui.js';
const url='https://example.com/agent',id=()=>crypto.randomUUID();
async function setup(t){const disk=await diskFolder(t),target=await openFolder(disk.root);const repo=createFolderRepository(disk.root,target.id);const {note}=await repo.request({method:'POST',body:{id:id(),fields:{...createFields({url,title:'Agent 架构'}),thought:'Agent 应当管理任务状态。'}}});const cache={};return {...disk,target,repo,note,storage:{get:async key=>({[key]:cache[key]}),set:async data=>Object.assign(cache,data),remove:async key=>delete cache[key]}};}
function aiReply(data){return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]}),{status:200});}
function engine(s,options={}){return createLearningEngine({request:s.repo.request,storage:s.storage,credentials:async()=>({key:'fixture',config:{model:'fixture'}}),allowed:async()=>true,...options});}
test('context capture only retains a matching active source, with deduplication and portable files',async t=>{
 const s=await setup(t);await s.storage.set({activeNoteId:s.note.id});
 const different={url:'https://example.com/other',text:'私有的另一个页面'};await retainMaterial(different,{storage:s.storage,request:s.repo.request});assert.deepEqual((await s.repo.request({path:'/api/materials?note='+s.note.id})).snapshots,[]);
 const material={url,title:'Agent 架构',text:'Agent 通过状态和事件继续执行。\n\n必须避免重复交付。',reason:'已加载内容，非全文'};
 await retainMaterial(material,{storage:s.storage,request:s.repo.request});await retainMaterial(material,{storage:s.storage,request:s.repo.request});
 const {snapshots}=await s.repo.request({path:'/api/materials?note='+s.note.id});assert.equal(snapshots.length,1);assert.equal(snapshots[0].blocks.length,2);
 const copy=await diskFolder(t);await copyLibrary(s.root,copy.root);const dest=await openFolder(copy.root),r=createFolderRepository(copy.root,dest.id);assert.equal((await r.request({path:'/api/materials?note='+s.note.id})).snapshots[0].warnings[0],material.reason);
});
test('answers retain an exact supplied manifest, stable fragment IDs, history reuse, and independent saved provenance',async t=>{
 const s=await setup(t);await s.repo.request({path:'/api/materials',method:'POST',body:{id:id(),noteId:s.note.id,url,text:'Agent 持久状态与事件接续。\n\n事件需要去重。'}});
 const calls=[];const run=engine(s,{fetcher:async(_u,options)=>{const body=JSON.parse(options.body);calls.push(body);if(body.max_tokens===500)return aiReply({queries:['Agent 状态']});if(body.max_tokens===2300)return aiReply({title:'Agent 的持久状态',text:'- 状态与事件让任务持续执行。\n- 具体实现尚需核对。'});const data=JSON.parse(body.messages.at(-1).content);return aiReply({paragraphs:[{text:'持久状态让任务可以继续。',type:'evidence',references:[data.evidence[0].reference]},{text:'具体实现尚需核对。',type:'gap',references:[]}]});}});
 const first=await run('ask',{chatId:id(),turnId:id(),revision:0,question:'Agent 如何持久执行？'});assert.ok(first.chat.turns[0].used.length);assert.equal(first.chat.turns[0].retrieved.length,first.chat.materials.length);
 const firstRequest=JSON.parse(calls.find(c=>c.max_tokens===3500).messages.at(-1).content);assert.equal(firstRequest.evidence.length,first.chat.turns[0].used.length);
 const next=await run('ask',{chatId:first.chat.id,turnId:id(),revision:1,question:'继续解释这些状态'});assert.equal(next.chat.materials[0].id,first.chat.materials[0].id);assert.ok(next.chat.turns[1].used.some(x=>first.chat.turns[0].used.includes(x)));assert.deepEqual(next.chat.turns[1].history,[first.chat.turns[0].id]);
 const {draft}=await run('draft',{chatId:next.chat.id});const saved=await run('save',{draft});assert.equal(saved.note.learningOrigin.chatId,next.chat.id);assert.equal(saved.note.learningOrigin.questions.length,2);assert.notEqual(saved.note.summary,next.chat.turns[1].answer[0].text);assert.ok(saved.note.learningOrigin.materials.some(m=>m.kind==='original'));
 assert.equal((await run('save',{draft})).note.id,saved.note.id);assert.equal((await s.repo.request()).notes.length,2);
 const reopened=createFolderRepository(s.root,s.target.id);assert.equal((await reopened.request({path:'/api/learning?id='+next.chat.id})).chat.turns.length,2);
 await assert.rejects(s.repo.request({path:'/api/learning',method:'POST',body:{chat:first.chat}}),e=>e.status===409);
});
test('invalid references, deleted sources and unavailable images cannot be silently used',async t=>{
 assert.throws(()=>validateAnswer({paragraphs:[{text:'伪造',type:'evidence',references:['madeup']}]},['real']),/引用/);
 const s=await setup(t),run=engine(s,{fetcher:async(_u,options)=>JSON.parse(options.body).max_tokens===500?aiReply({queries:['Agent']}):aiReply({paragraphs:[{text:'伪造',type:'evidence',references:[999]}]})});
 await assert.rejects(run('ask',{chatId:id(),turnId:id(),revision:0,question:'Agent 架构'}),/引用/);assert.equal((await s.repo.request({path:'/api/learning'})).chats.length,0);
 const imageKey=await fingerprint(s.target.id)+'/'+id()+'.png';let sent;
 const notes=[{...s.note,images:[{key:imageKey,name:'架构图'}]}];const repo={request:async q=>q.path==='/api/notes'?{notes}:q.path.startsWith('/api/media')?Promise.reject(Error('missing')):s.repo.request(q)};
 const vision=engine({...s,repo},{fetcher:async(_u,o)=>{const b=JSON.parse(o.body);if(b.max_tokens===500)return aiReply({queries:['Agent 架构图']});sent=JSON.parse(b.messages.at(-1).content);return aiReply({paragraphs:[{text:'只根据文字。',type:'evidence',references:[sent.evidence[0].reference]}]});}});
 const result=await vision('ask',{chatId:id(),turnId:id(),revision:0,question:'Agent 架构图是什么意思'});assert.ok(result.chat.turns[0].warnings.some(w=>w.includes('图片')));assert.ok(sent.evidence.every(m=>!m.hasImage));
 const deleted=engine({...s,repo:{request:async q=>q.path==='/api/notes'?{notes:[{...s.note,deletedAt:new Date().toISOString()}]}:s.repo.request(q)}},{fetcher:()=>{throw new Error('must not call AI');}});
 const empty=await deleted('ask',{chatId:id(),turnId:id(),revision:0,question:'Agent'});assert.deepEqual(empty.chat.turns[0].used,[]);assert.equal(empty.chat.turns[0].answer[0].type,'gap');
});
test('saving a generated answer can be retried without another paid request and failed disk writes never acknowledge success',async t=>{
 const s=await setup(t);let fail=true,calls=0;
 const run=engine({...s,repo:{request:async q=>{if(q.path==='/api/learning'&&q.method==='POST'&&fail)throw Error('Disk full');return s.repo.request(q);}}},{fetcher:async(_u,o)=>{calls++;return aiReply(JSON.parse(o.body).max_tokens===500?{queries:['Agent']}:{paragraphs:[{text:'任务状态',type:'evidence',references:[1]}]});}});
 const input={chatId:id(),turnId:id(),revision:0,question:'Agent 状态'};await assert.rejects(run('ask',input),/Disk full/);assert.equal((await s.repo.request({path:'/api/learning'})).chats.length,0);fail=false;const result=await run('ask',input);assert.equal(result.chat.turns.length,1);assert.equal(calls,2);await run('ask',input);assert.equal(calls,2);
});
test('material dialog shows each fragment, defaults to actual inputs, and citation opens that exact fragment',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://clips.local/learn'}),{window}=dom;window.HTMLDialogElement.prototype.showModal=function(){this.open=true};window.HTMLDialogElement.prototype.close=function(){this.open=false};window.HTMLElement.prototype.scrollIntoView=function(){};
 const nid=id(),cid=id(),tid=id(),one='a'.repeat(64),two='b'.repeat(64),chat={id:cid,title:'测试对话',revision:1,materials:[{id:one,noteId:nid,title:'同一笔记',kind:'thought',text:'用户想法'},{id:two,noteId:nid,title:'同一笔记',kind:'original',text:'原文完整片段'}],turns:[{id:tid,question:'怎么理解',used:[one],retrieved:[one,two],answer:[{text:'有依据的回答',type:'evidence',references:[one]}]}]};
 const root=window.document.querySelector('#root');const dispose=mountLearning(root,{libraryURL:'/',noteURL:x=>'/?note='+x,chatId:cid,request:async q=>q.path==='/api/notes'?{notes:[]}:q.path.includes('?id=')?{chat}:{chats:[chat]},run:async()=>({configured:true})});
 await new Promise(r=>setTimeout(r,30));root.querySelector('[data-ref]').click();assert.equal(root.querySelector('#learn-materials').open,true);assert.equal(root.querySelectorAll('.learn-material').length,1);assert.equal(root.querySelector('.highlight').id,'material-'+one);root.querySelector('[data-material-tab="all"]').click();assert.equal(root.querySelectorAll('.learn-material').length,2);assert.ok(root.textContent.includes('未用于本轮'));assert.ok(!root.textContent.includes('查看引用'));dispose();dom.window.close();
});

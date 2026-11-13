import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDraftStore,browserDraftStorage} from '../../extension/draft-store.js';
import {scopedStorage} from '../../extension/storage-target.js';
import {mountLearning} from '../../extension/learning-ui.js';
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
function storage(){const data=new Map();return {data,read:async key=>structuredClone(data.get(key)||null),write:async(key,value)=>data.set(key,structuredClone(value)),remove:async key=>data.delete(key)};}

test('queued autosaves snapshot input, recover from failure, and cannot resurrect a cleared preview',async()=>{
 const s=storage(),original=s.write;let release;
 s.write=async(key,value)=>{await new Promise(resolve=>release=resolve);return original(key,value);};
 const drafts=createDraftStore(s),value={text:'original'},write=drafts.save('x',value);value.text='mutated';await flush();
 const clear=drafts.clear('x');release();await write;assert.equal(s.data.get('x').text,'original');await clear;assert.equal(await drafts.load('x'),null);
 s.write=async()=>{throw Error('quota');};await assert.rejects(drafts.save('x',value),/quota/);s.write=original;await drafts.save('x',value);assert.equal((await drafts.load('x')).text,'mutated');
});
test('browser drafts survive a new store and extension library scopes remain separate',async()=>{
 const dom=new JSDOM('',{url:'https://clips.local'}),s=browserDraftStorage(dom.window);await createDraftStore(s).save('preview',{text:'test'});assert.equal((await createDraftStore(s).load('preview')).text,'test');dom.window.close();
 const saved={},base={get:async keys=>Object.fromEntries(keys.map(k=>[k,saved[k]])),set:async entries=>Object.assign(saved,entries),remove:async keys=>keys.forEach(k=>delete saved[k])};
 const a=scopedStorage({mode:'local',id:'a'},base),b=scopedStorage({mode:'local',id:'b'},base);await a.set({'preview':{text:'library A'}});assert.equal((await b.get('preview')).preview,undefined);assert.equal((await a.get('preview')).preview.text,'library A');
});
function learningFixture(s,options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://clips.local/learn'}),{window}=dom;window.getSelection=undefined;
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const root=window.document.querySelector('#root'),chat={id:options.chatId||'chat-a',revision:1,title:'对话 A',materials:[],turns:[{id:'turn-a',question:'问题',answer:[],used:[],retrieved:[]}]};
 const calls=[];let fail=false;
 const dispose=mountLearning(root,{chatId:chat.id,draftStorage:s,noteURL:id=>'/?note='+id,request:async q=>q.path==='/api/notes'?{notes:[]}:q.path.includes('?id=')?{chat}:{chats:[chat]},run:async(action,input)=>{
   calls.push({action,input:structuredClone(input)});if(action==='status')return {configured:true};
   if(action==='draft')return {draft:{id:'preview-id',chatId:chat.id,turnIds:['turn-a'],title:'AI 标题',text:'- AI 正文'}};
   if(action==='save'){if(fail)throw Error('保存失败');return {note:{id:input.draft.id}};}
 }});
 const $=q=>root.querySelector(q),click=async q=>{$(q).click();await flush();},type=(q,text)=>{$(q).value=text;$(q).dispatchEvent(new window.Event('input',{bubbles:true}));};
 return {root,$,click,type,calls,fail:v=>fail=v,submit:async()=>{$('#learn-save-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await flush();},close:()=>{dispose();dom.window.close();}};
}
test('learning preview restores edited title/body and provenance after remount, retries without AI, and clears only on successful save',async()=>{
 const s=storage();let f=learningFixture(s);await flush();await f.click('[data-action=save]');await f.click('[data-action=draft-round]');
 assert.equal(f.$('#learn-save-title').textContent,'笔记预览');assert.equal(f.$('#learn-save-status').textContent,'已自动暂存');
 f.type('#learn-draft-title','修改标题');f.type('#learn-draft-body','## 修改正文\n`code`');await flush();f.close();
 const other=learningFixture(s,{chatId:'chat-b'});await flush();assert.equal(other.$('[data-action=resume-preview]').hidden,true);other.close();
 f=learningFixture(s);await flush();assert.equal(f.$('[data-action=resume-preview]').hidden,false);await f.click('[data-action=resume-preview]');
 assert.equal(f.$('#learn-draft-title').value,'修改标题');assert.equal(f.$('#learn-draft-body').value,'## 修改正文\n`code`');assert.equal(f.calls.filter(c=>c.action==='draft').length,0);
 f.fail(true);await f.submit();assert.equal(f.$('#learn-save-status').textContent,'保存失败');assert.ok(s.data.has('learning-preview:chat-a'));
 f.fail(false);await f.submit();assert.match(f.$('#learn-save-status').textContent,/已保存/);assert.equal(s.data.has('learning-preview:chat-a'),false);assert.equal(f.$('[data-action=resume-preview]').hidden,true);
 const saved=f.calls.filter(c=>c.action==='save').at(-1).input.draft;assert.equal(saved.id,'preview-id');assert.deepEqual(saved.turnIds,['turn-a']);assert.equal(saved.title,'修改标题');f.close();
 f=learningFixture(s);await flush();assert.equal(f.$('[data-action=resume-preview]').hidden,true);f.close();
});
test('unsent learning input restores and autosave failures never report success',async()=>{
 const s=storage();let f=learningFixture(s);await flush();f.type('#learn-question','还没问完的问题');await flush();assert.equal(f.$('#learn-progress').textContent,'已自动暂存');f.close();
 f=learningFixture(s);await flush();assert.equal(f.$('#learn-question').value,'还没问完的问题');
 const write=s.write;s.write=async()=>{throw Error('quota');};f.type('#learn-question','最新文字');await flush();assert.match(f.$('#learn-progress').textContent,/暂存失败/);
 await f.click('[data-action=save]');await f.click('[data-action=draft-round]');assert.equal(f.$('#learn-draft-body').value,'- AI 正文');assert.match(f.$('#learn-save-status').textContent,/暂存失败/);
 s.write=write;f.type('#learn-draft-body','重试保存缓存');await flush();assert.equal(f.$('#learn-save-status').textContent,'已自动暂存');f.close();
});

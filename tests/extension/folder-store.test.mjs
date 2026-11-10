import test from 'node:test';
import assert from 'node:assert/strict';
import { openFolder, createFolderRepository, copyLibrary } from '../../extension/folder-store.js';
import { createFields } from '../../extension/core.js';
import { saveCoreDraft } from '../../extension/summary-save.js';
import { diskFolder } from './folder-fixture.mjs';
const page={url:'https://www.youtube.com/watch?v=SHIYEDEMO01',title:'本地阅读测试'};
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0]).toString('base64');
async function setup(t){const disk=await diskFolder(t),target=await openFolder(disk.root);let chain=Promise.resolve();const lock=task=>{const run=chain.then(task);chain=run.catch(()=>{});return run;};const repo=createFolderRepository(disk.root,target.id,lock);const {note}=await repo.request({method:'POST',body:{id:crypto.randomUUID(),fields:createFields(page)}});return {...disk,target,repo,note};}
test('folder initialization is portable, reopens the same library, and never overwrites unrelated files',async t=>{
 const disk=await diskFolder(t);await disk.write('unrelated.txt','keep');await assert.rejects(openFolder(disk.root),/空文件夹/);assert.equal(await disk.read('unrelated.txt'),'keep');
 const second=await diskFolder(t),target=await openFolder(second.root);assert.equal((await openFolder(second.root)).id,target.id);const data=JSON.parse(await second.read('clips.json'));assert.equal(data.format,'clips-folder');assert.deepEqual(data.notes,[]);
});
test('mixed records and manual/AI summaries survive a fresh repository and a complete folder copy',async t=>{
 const {root,repo,note,target,read}=await setup(t);
 const {image}=await repo.request({path:'/api/media',method:'POST',body:{name:'截图.png',base64:png}});
 const clip={id:crypto.randomUUID(),text:'**原文**',thought:'我的理解',images:[image],sourceUrl:page.url,createdAt:new Date().toISOString()};
 let saved=(await repo.request({method:'PATCH',body:{id:note.id,revision:note.revision,action:'add_clip',clip}})).note;
 const record={id:crypto.randomUUID(),text:'简明总结',provider:'DeepSeek',model:'test',scope:'原文',createdAt:new Date().toISOString()};
 saved=await saveCoreDraft(repo.request,{purpose:'core',noteId:note.id,expectedCoreSummaryId:null,record,text:record.text},record.text);
 assert.equal(saved.clips[0].images[0].key,image.key);assert.equal(saved.coreSummary.text,'简明总结');
 assert.equal((await createFolderRepository(root,target.id).request()).notes[0].clips[0].thought,'我的理解');
 assert.ok(JSON.parse(await read('backups/clips.previous.json')).notes.length);
 const copied=await diskFolder(t);await copyLibrary(root,copied.root);const reopened=await openFolder(copied.root),copy=createFolderRepository(copied.root,reopened.id);
 assert.deepEqual((await copy.request()).notes,(await repo.request()).notes);assert.equal((await copy.request({path:'/api/media?key='+encodeURIComponent(image.key)})).dataUrl,'data:image/png;base64,'+png);
});
test('write failures and revision conflicts do not acknowledge or erase records',async t=>{
 const {repo,note,state,read}=await setup(t),before=await read('clips.json');state.failPath='clips.json';
 await assert.rejects(repo.request({method:'PATCH',body:{id:note.id,revision:1,action:'status',status:'read'}}),/Disk full/);assert.equal(await read('clips.json'),before);
 state.failPath='';await repo.request({method:'PATCH',body:{id:note.id,revision:1,action:'status',status:'read'}});
 await assert.rejects(repo.request({method:'PATCH',body:{id:note.id,revision:1,action:'edit_metadata',metadata:{title:'stale'}}}),e=>e.status===409);
 assert.equal((await repo.request()).notes[0].title,note.title);
});
test('malformed files and mismatched library identities fail closed without replacing disk data',async t=>{
 const {root,repo,write,read}=await setup(t);await write('clips.json','{broken');await assert.rejects(repo.request(),/格式损坏/);assert.equal(await read('clips.json'),'{broken');
 const other=await setup(t);await assert.rejects(createFolderRepository(other.root,crypto.randomUUID()).request(),/改变/);
});
test('local tags enumerate, rename across notes, and delete associations while retaining records',async t=>{
 const {repo,note}=await setup(t);const created=await repo.request({method:'POST',body:{action:'create_tag',name:'长期记忆',revision:0}});assert.equal(created.tags[0].name,'长期记忆');
 await repo.request({method:'PATCH',body:{id:note.id,revision:1,action:'tag',tag:'长期记忆',selected:true}});
 await repo.request({path:'/api/tags',method:'POST',body:{action:'rename',previous:'长期记忆',name:'记忆',revision:1}});assert.deepEqual((await repo.request()).notes[0].tags,['记忆']);
 await repo.request({path:'/api/tags',method:'POST',body:{action:'delete',previous:'记忆',name:'记忆',revision:2}});assert.deepEqual((await repo.request()).notes[0].tags,[]);assert.equal((await repo.request()).notes.length,1);
});
test('transcripts, overview, segment and contextual quote translations persist to files with retry semantics',async t=>{
 const {repo,note,root,target}=await setup(t),transcript={videoId:'SHIYEDEMO01',language:'en',segments:[{start:0,duration:4,text:'One complete sentence.'},{start:4,duration:5,text:'Another thought.'}]};
 const {snapshot}=await repo.request({path:'/api/transcripts',method:'POST',body:{noteId:note.id,transcript}});
 const again=await repo.request({path:'/api/transcripts',method:'POST',body:{noteId:note.id,transcript}});assert.equal(again.note.transcripts.length,1);
 const base={path:'/api/transcripts',method:'POST'},body={action:'save_assist',noteId:note.id,snapshotId:snapshot.id};
 const overview={kind:'overview',id:crypto.randomUUID(),expectedOverviewId:null,model:'test',content:{summary:'概要',chapters:[{from:0,title:'开头',summary:'说明'}],quotes:[{from:0,to:0}]}};
 await repo.request({...base,body:{...body,assist:overview}});await repo.request({...base,body:{...body,assist:overview}});
 await repo.request({...base,body:{...body,assist:{kind:'translation',model:'test',segments:[{index:0,text:'完整句子。'}]}}});
 await repo.request({...base,body:{...body,assist:{kind:'quote_translation',model:'test',from:0,to:0,text:'完整句子。'}}});
 const {assist}=await createFolderRepository(root,target.id).request({path:`/api/transcripts?note=${note.id}&id=${snapshot.id}`});assert.equal(assist.overview.summary,'概要');assert.equal(assist.translations[0].text,'完整句子。');assert.equal(Object.values(assist.quoteTranslations)[0].text,'完整句子。');
 await assert.rejects(repo.request({...base,body:{...body,assist:{...overview,id:crypto.randomUUID()}}}),e=>e.status===409);
});
test('foreign media and path traversal cannot be read or attached to a local note',async t=>{
 const {repo,note}=await setup(t);await assert.rejects(repo.request({path:'/api/media?key=../../secrets.txt'}),/不属于/);
 await assert.rejects(repo.request({method:'PATCH',body:{id:note.id,revision:1,action:'add_clip',clip:{id:crypto.randomUUID(),text:'',thought:'',images:[{key:'a'.repeat(64)+'/'+crypto.randomUUID()+'.png'}]}}}),/不属于/);
 assert.equal((await repo.request()).notes[0].clips.length,0);
});
test('starting a manually opened queued source removes its duplicate without altering other queued sources',async t=>{
 const {repo}=await setup(t);const url='https://example.com/article';await repo.request({method:'POST',body:{action:'save_link',id:crypto.randomUUID(),url}});
 await repo.request({method:'POST',body:{action:'save_link',id:crypto.randomUUID(),url:'https://example.com/other'}});
 await repo.request({method:'POST',body:{id:crypto.randomUUID(),fields:createFields({url,title:'文章'})}});
 const all=(await repo.request()).notes;assert.equal(all.filter(n=>n.sources[0].url===url).length,1);assert.equal(all.filter(n=>n.status==='inbox').length,1);
});

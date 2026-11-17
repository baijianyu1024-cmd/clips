import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentService } from '../../extension/agent-service.js';
import { openFolder, createFolderRepository } from '../../extension/folder-store.js';
import { recordEntries } from '../../extension/record-actions.js';
import { diskFolder } from './folder-fixture.mjs';

async function fixture(t) {
  const disk=await diskFolder(t), target=await openFolder(disk.root), repo=createFolderRepository(disk.root,target.id);
  let lost=false, library={key:target.id,mode:'local'};
  const call=createAgentService({request:async r=>{const result=await repo.request(r);if(lost&&r.method==='PATCH'){lost=false;throw Error('Lost response');}return result;},library:async()=>library,noteURL:id=>id});
  const created=await call('clips_create_note',{request_id:crypto.randomUUID(),title:'原笔记',content:'旧想法',tags:['Agent']});
  const get=async()=> (await repo.request()).notes.find(n=>n.id===created.id);
  const patch=async(action,rest={})=>{const n=await get();return (await repo.request({method:'PATCH',body:{id:n.id,revision:n.revision,action,...rest}})).note;};
  return {disk,repo,call,get,patch,id:created.id,lose:()=>lost=true,switch:()=>library={key:'other',mode:'local'}};
}
test('MCP partial note edits preserve records and summary images, paged record CRUD persists',async t=>{
  const f=await fixture(t),{image}=await f.repo.request({path:'/api/media',method:'POST',body:{name:'image.png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}});
  await f.patch('set_core_summary',{expectedCoreSummaryId:null,coreSummary:{id:crypto.randomUUID(),text:'旧摘要',images:[image],origin:'manual',scope:'test',createdAt:new Date().toISOString()}});
  let n=await f.get();
  const change={note_id:n.id,revision:n.revision,changes:{title:'新标题',published:'2026.11',core_summary:'新摘要'}};
  await f.call('clips_update_note',change); assert.equal((await f.call('clips_update_note',change)).already_saved,true);
  n=await f.get();assert.equal(n.title,'新标题');assert.deepEqual(n.coreSummary.images,[image]);assert.match(n.thought,/旧想法/);assert.equal(n.coreSummaryHistory[0].text,'旧摘要');
  await assert.rejects(f.call('clips_update_note',{...change,changes:{title:'过期修改'}}),e=>e.code==='REVISION_CONFLICT');
  await assert.rejects(f.call('clips_update_note',{note_id:n.id,revision:n.revision,changes:{}}));
  const clip={id:crypto.randomUUID(),text:'原文',thought:'想法',images:[image],sourceUrl:'https://example.com/',sourceTitle:'来源',createdAt:new Date().toISOString(),videoTime:25,anchor:{exact:'原文'},translation:{text:'译文'}};
  n=await f.patch('add_clip',{clip});
  const edit={note_id:n.id,record_id:clip.id,kind:'clip',revision:n.revision,request_id:crypto.randomUUID(),changes:{thought:'新想法'}};
  await f.call('clips_update_record',edit);n=await f.get();assert.deepEqual(n.clips[0].images,[image]);assert.deepEqual(n.clips[0].anchor,clip.anchor);assert.equal(n.clips[0].createdAt,clip.createdAt);
  assert.equal((await f.call('clips_update_record',edit)).already_saved,true);
  await assert.rejects(f.call('clips_update_record',{...edit,changes:{thought:'过期内容'}}),e=>e.code==='REVISION_CONFLICT');
  await f.call('clips_update_record',{...edit,revision:n.revision,changes:{text:'新摘录'}});n=await f.get();assert.equal(n.clips[0].anchor,undefined);assert.equal(n.clips[0].translation,undefined);assert.equal(n.clips[0].thought,'新想法');
  const review=await f.call('clips_append_record',{note_id:n.id,revision:n.revision,request_id:crypto.randomUUID(),record_kind:'review',content:'重新理解'});
  await f.call('clips_update_record',{note_id:n.id,revision:review.revision,request_id:crypto.randomUUID(),kind:'review',record_id:review.record_id,changes:{text:'更深入的理解'}});
  const list=await f.call('clips_list_records',{note_id:n.id,limit:2});assert.equal(list.total,4);assert.equal(list.records.length,2);assert.equal(list.next_offset,2);
  const read=await f.call('clips_get_record',{note_id:n.id,kind:'review',record_id:review.record_id});assert.equal(read.fields.text,'更深入的理解');
  assert.equal(JSON.parse(await f.disk.read('clips.json')).notes[0].reviews[0].text,'更深入的理解');
});
test('deletion requires matching unexpired confirmation; stale/changed targets cannot delete',async t=>{
  const f=await fixture(t),id=f.id;
  let n=await f.get();await assert.rejects(f.call('clips_delete_note',{note_id:id,revision:n.revision,confirmation_token:'invented'}),e=>e.code==='CONFIRMATION_REQUIRED');
  const plan=await f.call('clips_prepare_delete',{note_id:id});assert.match(plan.preview,/原笔记/);assert.equal(plan.requires_user_confirmation,true);assert.equal((await f.get()).deletedAt,null);
  const args={note_id:id,revision:plan.revision,confirmation_token:plan.confirmation_token};
  await assert.rejects(f.call('clips_delete_note',{...args,note_id:crypto.randomUUID()}),e=>e.code==='CONFIRMATION_REQUIRED');
  await f.patch('edit_record',{record:{id:'legacy',text:'',thought:'另一设备的新内容'}});
  await assert.rejects(f.call('clips_delete_note',args),e=>e.code==='REVISION_CONFLICT');assert.equal((await f.get()).deletedAt,null);
  const again=await f.call('clips_prepare_delete',{note_id:id}),now=Date.now;Date.now=()=>now()+301000;
  try{await assert.rejects(f.call('clips_delete_note',{...args,revision:again.revision,confirmation_token:again.confirmation_token}),e=>e.code==='CONFIRMATION_REQUIRED');}finally{Date.now=now;}
  const latest=await f.call('clips_prepare_delete',{note_id:id});f.switch();
  await assert.rejects(f.call('clips_delete_note',{...args,revision:latest.revision,confirmation_token:latest.confirmation_token}),e=>e.code==='CONFIRMATION_REQUIRED');
});
test('confirmed note deletion is retryable, searchable in trash and recoverable with all records',async t=>{
  const f=await fixture(t),p=await f.call('clips_prepare_delete',{note_id:f.id}),args={note_id:f.id,revision:p.revision,confirmation_token:p.confirmation_token};
  f.lose();await assert.rejects(f.call('clips_delete_note',args),/Lost response/);
  assert.equal((await f.call('clips_delete_note',args)).already_deleted,true);
  assert.equal((await f.call('clips_search',{})).total,0);assert.equal((await f.call('clips_search',{scope:'trash'})).total,1);
  const read=await f.call('clips_get_note',{note_id:f.id,scope:'trash'});assert.ok(read.deleted_at);assert.match(read.text,/旧想法/);
  await f.call('clips_restore_note',{note_id:f.id,revision:read.revision});assert.equal((await f.call('clips_search',{})).total,1);
  await assert.rejects(f.call('clips_delete_note',args),e=>e.code==='REVISION_CONFLICT');
});
test('each record kind deletes independently, shared images stay available and screenshot updates convert once',async t=>{
  const f=await fixture(t),{image}=await f.repo.request({path:'/api/media',method:'POST',body:{name:'image.png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}});
  await f.patch('add_image',{image});
  let n=await f.get();const edit={note_id:n.id,revision:n.revision,request_id:crypto.randomUUID(),kind:'image',record_id:image.key,changes:{thought:'图片说明'}};
  await f.call('clips_update_record',edit);assert.equal((await f.call('clips_update_record',edit)).already_saved,true);n=await f.get();assert.equal(n.images.length,0);assert.equal(n.clips.length,1);
  await f.patch('add_image',{image});await f.patch('review',{reviewId:crypto.randomUUID(),text:'补充'});
  await f.patch('add_ai_summary',{aiSummary:{id:crypto.randomUUID(),text:'AI 摘要',provider:'test',model:'test',scope:'test',sourceUrl:'https://example.com/',createdAt:new Date().toISOString()}});
  await f.patch('set_core_summary',{expectedCoreSummaryId:null,coreSummary:{id:crypto.randomUUID(),text:'核心',images:[image],origin:'manual',scope:'test',createdAt:new Date().toISOString()}});
  n=await f.get();const originalCount=recordEntries(n).length;assert.equal(originalCount,6);
  for(const record of recordEntries(n)) {
    const target={kind:record.kind,record_id:record.id},plan=await f.call('clips_prepare_delete',{note_id:f.id,target});
    const args={note_id:f.id,...target,revision:plan.revision,confirmation_token:plan.confirmation_token};
    const saved=await f.call('clips_delete_record',args);assert.equal(saved.deleted,true);assert.equal((await f.call('clips_delete_record',args)).already_deleted,true);
  }
  n=await f.get();assert.equal(recordEntries(n).length,0);assert.equal(n.deletedAt,null);assert.equal(n.coreSummaryHistory.length,1);
  const media=await f.repo.request({path:'/api/media?key='+encodeURIComponent(image.key)});assert.ok(media.dataUrl);
  await assert.rejects(f.call('clips_update_record',{note_id:n.id,kind:'legacy',record_id:'legacy',request_id:crypto.randomUUID(),revision:n.revision,changes:{thought:'不能复活被删内容'}}),e=>e.code==='NOT_FOUND');
});

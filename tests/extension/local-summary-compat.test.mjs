import test from 'node:test';
import assert from 'node:assert/strict';
import {diskFolder} from './folder-fixture.mjs';
import {openFolder,createFolderRepository} from '../../extension/folder-store.js';
import {saveCoreDraft} from '../../extension/summary-save.js';

test('legacy local summaries and history get UI defaults without rewriting files on read',async t=>{
 const disk=await diskFolder(t),target=await openFolder(disk.root),repo=createFolderRepository(disk.root,target.id);
 const note=(await repo.request({method:'POST',body:{id:crypto.randomUUID(),fields:{title:'旧侧栏记录'}}})).note;
 const raw=JSON.parse(await disk.read('clips.json'));
 const summary={id:crypto.randomUUID(),text:'完整摘要',origin:'ai',scope:'原文',createdAt:note.createdAt};
 raw.notes[0].coreSummary=summary;raw.notes[0].coreSummaryHistory=[{...summary,id:crypto.randomUUID()}];
 const before=JSON.stringify(raw);await disk.write('clips.json',before);
 const loaded=(await repo.request()).notes[0];
 for(const s of [loaded.coreSummary,...loaded.coreSummaryHistory]){
  assert.deepEqual(s.images,[]);assert.equal(s.edited,false);assert.equal(s.provider,'');assert.equal(s.model,'');
 }
 assert.equal(loaded.revision,note.revision);assert.equal(await disk.read('clips.json'),before);
 const saved=await saveCoreDraft(r=>repo.request(r),{noteId:note.id,purpose:'core',expectedCoreSummaryId:summary.id,text:'新的摘要',record:{...summary,id:crypto.randomUUID()}},'新的摘要');
 assert.deepEqual(saved.coreSummary.images,[]);
 assert.deepEqual(saved.coreSummaryHistory.map(s=>s.text),['完整摘要','完整摘要']);
 assert.deepEqual(JSON.parse(await disk.read('backups/clips.previous.json')),raw);
 const reopened=(await createFolderRepository(disk.root,target.id).request()).notes[0];
 assert.equal(reopened.coreSummary.text,'新的摘要');assert.equal(reopened.coreSummaryHistory.length,2);
});

test('normalization preserves summary images, user edits, revision conflicts and backups',async t=>{
 const disk=await diskFolder(t),target=await openFolder(disk.root),repo=createFolderRepository(disk.root,target.id);
 const note=(await repo.request({method:'POST',body:{id:crypto.randomUUID(),fields:{title:'图文摘要'}}})).note;
 const {image}=await repo.request({path:'/api/media',method:'POST',body:{base64:'iVBORw0KGgo=',name:'截图.png'}});
 const summary={id:crypto.randomUUID(),text:'保留的文字',images:[image],origin:'manual',scope:'手动填写',edited:true,createdAt:note.createdAt};
 const result=await repo.request({method:'PATCH',body:{id:note.id,revision:note.revision,action:'set_core_summary',expectedCoreSummaryId:null,coreSummary:summary}});
 assert.deepEqual(result.note.coreSummary.images,[image]);assert.equal(result.note.coreSummary.edited,true);
 const before=await disk.read('clips.json');
 await assert.rejects(repo.request({method:'PATCH',body:{id:note.id,revision:note.revision,action:'star'}}),e=>e.status===409);
 assert.equal(await disk.read('clips.json'),before);
});

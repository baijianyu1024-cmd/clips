import test from 'node:test';
import assert from 'node:assert/strict';
import {diskFolder} from './folder-fixture.mjs';
import {openFolder,createFolderRepository} from '../../extension/folder-store.js';
import {createFields} from '../../extension/core.js';
import {contentRecord,saveContentEdit} from '../../extension/content-edit.js';
test('sidebar content editors write core images, legacy records, AI text, reviews and standalone screenshots to the folder',async t=>{
 const disk=await diskFolder(t),target=await openFolder(disk.root),repo=createFolderRepository(disk.root,target.id),cloud=repo.request;
 let {note:n}=await cloud({method:'POST',body:{id:crypto.randomUUID(),fields:{...createFields({url:'https://example.com/a',title:'全部字段'}),summary:'旧摘要',thought:'旧想法',status:'read'}}});
 const {image}=await cloud({path:'/api/media',method:'POST',body:{name:'图.png',base64:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}});
 const save=async(kind,id,text,thought='',images=[])=>{const base=contentRecord(n,kind,id);n=await saveContentEdit(cloud,n.id,kind,id,base,{id:crypto.randomUUID(),text,thought,images});};
 await save('core','new','手动摘要','',[image]);assert.equal(n.coreSummary.images.length,1);
 await save('core','new','修改后的摘要','',[image]);assert.equal(n.coreSummaryHistory[0].text,'手动摘要');
 await save('legacy','legacy','改旧摘录','改旧想法',[image]);assert.equal(n.summary,'改旧摘录');assert.equal(n.legacyRecordImages[0].key,image.key);
 const ai={id:crypto.randomUUID(),text:'AI 原答',model:'test',provider:'test',scope:'test',createdAt:new Date().toISOString()};n=(await cloud({method:'PATCH',body:{id:n.id,revision:n.revision,action:'add_ai_summary',aiSummary:ai}})).note;
 await save('ai',ai.id,'精简后的 AI 摘要');assert.equal(n.aiSummaries[0].text,'精简后的 AI 摘要');
 await save('new-review','new','后来的理解');const review=n.reviews[0];await save('review',review.id,'修改的理解');assert.equal(n.reviews[0].createdAt,review.createdAt);assert.equal(n.reviews[0].text,'修改的理解');
 n=(await cloud({method:'PATCH',body:{id:n.id,revision:n.revision,action:'edit',fields:{images:[image]}}})).note;
 await save('image',image.key,'图的摘录','图的想法',[image]);assert.equal(n.images.length,0);assert.equal(n.clips[0].images[0].key,image.key);
 const final=(await createFolderRepository(disk.root,target.id).request()).notes[0];assert.equal(final.clips.length,1);assert.equal(final.reviews.length,1);assert.equal(final.coreSummary.images.length,1);
});
test('content edits do not overwrite newer content and retries after a lost response do not duplicate reviews',async()=>{
 const id=crypto.randomUUID(),record={id,text:'新理解',thought:'',images:[]};let n={id:'n',revision:1,status:'read',reviews:[],clips:[]},calls=0;
 const cloud=async r=>{if(!r.method)return {notes:[structuredClone(n)]};calls++;n.reviews.push({id:r.body.reviewId,text:r.body.text});n.revision++;throw Error('lost');};
 await assert.rejects(saveContentEdit(cloud,'n','new-review','new',{text:'',images:[]},record),/lost/);
 await saveContentEdit(cloud,'n','new-review','new',{text:'',images:[]},record);assert.equal(calls,1);
 n.reviews[0].text='其他设备修改';await assert.rejects(saveContentEdit(cloud,'n','review',id,{text:'新理解'},{...record,text:'旧草稿修改'}),e=>e.code==='RECORD_CONFLICT');assert.equal(calls,1);
});

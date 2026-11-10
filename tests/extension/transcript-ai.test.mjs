import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentBatches, parseOverview, parseTranslations, assistMessages, requestAssistJson } from '../../extension/transcript-ai.js';
import { startReadingAssist, readingAssistStatus } from '../../extension/transcript-assistant.js';
const sample = Array.from({length:75},(_,i)=>({text:'Caption '+i,start:i*4,duration:4}));
const stream = content => new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(content)},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
test('long transcripts are chunked without truncation or changing segment identities',()=>{
 const segments=Array.from({length:3000},(_,i)=>({text:String(i)+'x'.repeat(90)}));
 const batches=segmentBatches(segments,undefined,18000,600);
 assert.ok(batches.length>1);assert.deepEqual(batches.flat().map(s=>s.index),segments.map((_,i)=>i));
 assert.equal(batches.flat().at(-1).text,segments.at(-1).text);
});
test('overview uses validated original positions; invented quotations never replace source text',()=>{
 const batch=segmentBatches(sample)[0],v=parseOverview({summary:'概要',chapters:[{from:1,title:'章节',summary:'内容'},{from:900,title:'假的',summary:'坏位置'}],quotes:[{from:2,to:3,quote:'fabricated'},{from:10,to:999}]},batch);
 assert.deepEqual(v.quotes,[{from:2,to:3}]);assert.equal(v.chapters.length,1);
 assert.throws(()=>parseOverview({summary:'不完整',chapters:[]},batch));
});
test('translations align by stable index, ignoring reordered unknown and duplicate rows',()=>{
 const batch=[{index:8,text:'A'},{index:12,text:'B'}];
 assert.deepEqual(parseTranslations({segments:[{index:12,text:'乙'},{index:8,text:'甲'},{index:8,text:'duplicate'},{index:99,text:'stray'}]},batch),[{index:12,text:'乙'},{index:8,text:'甲'}]);
 const messages=assistMessages('translation',batch,'Title');assert.equal(messages.length,2);assert.deepEqual(JSON.parse(messages[1].content).segments,batch);
});
test('DeepSeek request is bounded and incomplete or upstream-error responses never become usable data',async()=>{
 let seen;const config={model:'deepseek-flash'};
 const valid=await requestAssistJson(config,'FAKE_TEST_KEY',assistMessages('translation',[{index:0,text:'A'}],'T'),async(url,init)=>{seen={url,init};return stream({segments:[{index:0,text:'甲'}]});});
 assert.equal(valid.segments[0].text,'甲');assert.equal(seen.url,'https://api.deepseek.com/chat/completions');assert.equal(seen.init.redirect,'error');assert.equal(seen.init.credentials,'omit');
 assert.equal(JSON.stringify(JSON.parse(seen.init.body).messages).includes('FAKE_TEST_KEY'),false);
 await assert.rejects(requestAssistJson(config,'FAKE',[],async()=>new Response('SECRET_UPSTREAM',{status:401})),e=>!e.message.includes('SECRET_UPSTREAM'));
 await assert.rejects(requestAssistJson(config,'FAKE',[],async()=>new Response('data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"length"}]}\n')));
});
const local={};globalThis.chrome={storage:{local:{get:async k=>({[k]:local[k]}),set:async v=>Object.assign(local,structuredClone(v)),remove:async k=>{delete local[k];}}},permissions:{contains:async()=>true},runtime:{getPlatformInfo:async()=>({})}};
const credential={key:'FAKE_KEY',config:{model:'deepseek-flash'}};
const noteId='11111111-1111-4111-8111-111111111111',snapshotId='a'.repeat(64);
let assist={overview:null,translations:{}},calls=[],cloudFail=false;
const cloud=async request=>{
 calls.push(structuredClone(request));
 if(request.method!=='POST')return {snapshot:{id:snapshotId,videoId:'SHIYEDEMO01',title:'Test',segments:sample},assist:structuredClone(assist),assistProtocol:1};
 if(cloudFail)throw new Error('cloud disconnected');
 const a=request.body.assist;
 if(a.kind==='translation')for(const s of a.segments)assist.translations[s.index]={text:s.text,model:a.model};
 else assist.overview={...a.content,id:a.id,model:a.model};
 return {assist:structuredClone(assist)};
};
async function settled(){for(let i=0;i<100;i++){const job=await readingAssistStatus(noteId,snapshotId);if(job?.status!=='running')return job;await new Promise(r=>setTimeout(r,5));}throw Error('job did not settle');}
test('translation retries only missing rows and keep captured note/snapshot across page changes',async()=>{
 let prompts=[];globalThis.fetch=async(_url,init)=>{const p=JSON.parse(JSON.parse(init.body).messages[1].content);prompts.push(p);return stream({segments:p.segments.slice(0,prompts.length===1?1:undefined).map(s=>({index:s.index,text:'译文'+s.index}))});};
 local.activeNoteId='another-note';
 await startReadingAssist({kind:'translation',noteId,snapshotId,indices:[0,1]},credential,cloud);
 assert.equal((await settled()).status,'error');assert.equal(assist.translations[0].text,'译文0');
 await startReadingAssist({kind:'translation',noteId,snapshotId,indices:[0,1]},credential,cloud);
 assert.equal((await settled()).status,'ready');assert.deepEqual(prompts[1].segments.map(s=>s.index),[1]);
 for(const c of calls.filter(c=>c.method==='POST')){assert.equal(c.body.noteId,noteId);assert.equal(c.body.snapshotId,snapshotId);assert.equal(c.body.action,'save_assist');}
 assert.equal(local.activeNoteId,'another-note');
});
test('a cloud-save failure retains the result; retry persists it without another paid generation',async()=>{
 let count=0;globalThis.fetch=async()=>{count++;return stream({segments:[{index:2,text:'保留译文'}]});};cloudFail=true;
 await startReadingAssist({kind:'translation',noteId,snapshotId,indices:[2]},credential,cloud);assert.equal((await settled()).status,'error');
 cloudFail=false;await startReadingAssist({kind:'translation',noteId,snapshotId,indices:[2]},credential,cloud);assert.equal((await settled()).status,'ready');assert.equal(count,1);assert.equal(assist.translations[2].text,'保留译文');
});
test('overview is separate from personal summary and repeated requests reuse the saved result',async()=>{
 let count=0;globalThis.fetch=async()=>{count++;return stream({summary:'概览',chapters:[{from:0,title:'开头',summary:'开始理解'}],quotes:[{from:1,to:1}]});};
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,cloud);assert.equal((await settled()).status,'ready');
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,cloud);assert.equal((await settled()).status,'ready');assert.equal(count,1);assert.equal(assist.overview.summary,'概览');
 assert.ok(calls.filter(c=>c.method==='POST').every(c=>c.body.action==='save_assist'));
});
test('invalid destinations and requests without a DeepSeek key fail before a model call',async()=>{
 await assert.rejects(startReadingAssist({kind:'overview',noteId:'bad',snapshotId},credential,cloud));
 await assert.rejects(startReadingAssist({kind:'overview',noteId,snapshotId},{...credential,key:''},cloud));
 await assert.rejects(startReadingAssist({kind:'translation',noteId,snapshotId,indices:[99999]},credential,cloud));
});
test('a rejected cached overview does not prevent translation; a later retry saves it without regenerating',async()=>{
 assist={overview:null,translations:{}};let generated=0,overviewWrites=0;
 const legacyKey=`ytAssistPending:${noteId}:${snapshotId}`;
 const pending={kind:'overview',id:crypto.randomUUID(),expectedOverviewId:null,model:'deepseek-flash',content:{summary:'已生成的概览',chapters:[{from:0,title:'开始',summary:'已有章节'}],quotes:[]}};
 local[legacyKey]=structuredClone(pending);
 globalThis.fetch=async()=>{generated++;return stream({segments:[{index:4,text:'单独完成的译文'}]});};
 const guardedCloud=async request=>{if(request.body?.assist?.kind==='overview'){overviewWrites++;throw new Error('Required');}return cloud(request);};
 await startReadingAssist({kind:'translation',noteId,snapshotId,indices:[4]},credential,guardedCloud);
 assert.equal((await settled()).status,'ready');assert.equal(overviewWrites,0);assert.equal(generated,1);
 assert.equal(assist.translations[4].text,'单独完成的译文');assert.deepEqual(local[legacyKey],pending);
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,guardedCloud);
 const failed=await settled();assert.equal(failed.status,'error');assert.match(failed.error,/AI 已生成/);assert.doesNotMatch(failed.error,/Required/);
 assert.deepEqual(local[legacyKey+':overview'],pending);
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,cloud);
 assert.equal((await settled()).status,'ready');assert.equal(generated,1);assert.equal(assist.overview.summary,pending.content.summary);
 assert.equal(local[legacyKey],undefined);assert.equal(local[legacyKey+':overview'],undefined);
});
test('an old cloud interface is detected before any model call and keeps saved results',async()=>{
 let modelCalls=0;globalThis.fetch=async()=>{modelCalls++;throw Error('must not call');};
 const cache=`ytAssistPending:${noteId}:${snapshotId}:translation`;
 local[cache]={kind:'translation',model:'deepseek-flash',segments:[{index:5,text:'尚未同步'}]};
 await assert.rejects(startReadingAssist({kind:'translation',noteId,snapshotId,indices:[5]},credential,async()=>({snapshot:{segments:sample}})),/旧版接口/);
 assert.equal(modelCalls,0);assert.equal(local[cache].segments[0].text,'尚未同步');
 await startReadingAssist({kind:'translation',noteId,snapshotId,indices:[5]},credential,cloud);
 assert.equal((await settled()).status,'ready');assert.equal(modelCalls,0);
 assert.equal(assist.translations[5].text,'尚未同步');assert.equal(local[cache],undefined);
});
test('an existing overview automatically translates only missing quotation ranges and reuses them',async()=>{
 assist={overview:{id:crypto.randomUUID(),summary:'已有概览',chapters:[{from:0,title:'章节',summary:'内容'}],quotes:[{from:10,to:12},{from:12,to:13}]},translations:{11:{text:'已翻译',model:'m'}}};
 let prompts=[];globalThis.fetch=async(_url,init)=>{const rows=JSON.parse(JSON.parse(init.body).messages[1].content).segments;prompts.push(rows.map(s=>s.index));return stream({segments:rows.map(s=>({index:s.index,text:'中文'+s.index}))});};
 const initial=assist.overview.id;
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,cloud);assert.equal((await settled()).status,'ready');
 assert.deepEqual(prompts,[[10,12,13]]);assert.equal(assist.overview.id,initial);assert.equal(assist.translations[11].text,'已翻译');
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,cloud);assert.equal((await settled()).status,'ready');assert.equal(prompts.length,1);
});
test('new overview quote translation save failure retains both overview and translated result for retry',async()=>{
 assist={overview:null,translations:{}};let modelCalls=0;
 globalThis.fetch=async(_url,init)=>{modelCalls++;const instruction=JSON.parse(init.body).messages[0].content;return stream(instruction.includes('视频概览')?{summary:'新概览',chapters:[{from:0,title:'开始',summary:'内容'}],quotes:[{from:20,to:20}]}:{segments:[{index:20,text:'缓存中文'}]});};
 const failTranslation=async req=>{if(req.body?.assist.kind==='translation')throw Error('save unavailable');return cloud(req);};
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,failTranslation);assert.equal((await settled()).status,'error');assert.equal(assist.overview.summary,'新概览');
 assert.equal(local[`ytAssistPending:${noteId}:${snapshotId}:translation`].segments[0].text,'缓存中文');
 await startReadingAssist({kind:'overview',noteId,snapshotId},credential,cloud);assert.equal((await settled()).status,'ready');assert.equal(modelCalls,2);assert.equal(assist.translations[20].text,'缓存中文');
});

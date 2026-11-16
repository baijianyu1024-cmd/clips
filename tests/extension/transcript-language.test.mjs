import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchNativeTranscript} from '../../extension/youtube.js';
import {readYoutubeCaptionInfo,getTranscript} from '../../extension/transcript-service.js';
const videoId='L1OBRtfPS34';
const response=(lang,availableLangs=['ar','en','zh'])=>({lang,availableLangs,content:[{text:lang==='ar'?'كل هذه الأدوات':'All these tools.',offset:1000,duration:2000}]});
test('automatic selection explicitly asks for English; unrelated provider fallback is corrected once',async()=>{
 const calls=[];
 const data=await fetchNativeTranscript(videoId,'FAKE',{fetch:async url=>{calls.push(new URL(url));return Response.json(response(calls.length===1?'ar':'en'));}});
 assert.equal(calls[0].searchParams.get('lang'),'en');assert.equal(data.language,'en');assert.equal(calls.length,2);assert.equal(data.selectionVersion,1);
 assert.ok(calls.every(u=>u.searchParams.get('mode')==='native'));assert.deepEqual(data.availableLanguages,['ar','en','zh']);
});
test('original Chinese is requested, explicit mismatches fail without passing wrong captions to storage',async()=>{
 let requested;
 const data=await fetchNativeTranscript(videoId,'FAKE',{language:'zh-CN',fetch:async url=>{requested=new URL(url).searchParams.get('lang');return Response.json(response('zh'));}});
 assert.equal(requested,'zh-cn');assert.equal(data.language,'zh');
 await assert.rejects(fetchNativeTranscript(videoId,'FAKE',{language:'en',explicit:true,fetch:async()=>Response.json(response('ar'))}),/未取得英语字幕/);
});
test('fallback prefers available Chinese and accurately labels videos with neither English nor Chinese',async()=>{
 const calls=[];const data=await fetchNativeTranscript(videoId,'FAKE',{fetch:async url=>{calls.push(new URL(url).searchParams.get('lang'));return Response.json(response(calls.length===1?'ar':'zh-hans',['ar','zh-hans']));}});
 assert.deepEqual(calls,['en','zh-hans']);assert.equal(data.language,'zh-hans');
 const other=await fetchNativeTranscript(videoId,'FAKE',{fetch:async()=>Response.json(response('ja',['ja']))});assert.equal(other.language,'ja');
 await assert.rejects(fetchNativeTranscript(videoId,'FAKE',{fetch:async()=>Response.json(response('ar'))}),/语言.*不符/);
});
test('nested asynchronous results retain their requested language',async()=>{
 let i=0;const data=await fetchNativeTranscript(videoId,'FAKE',{language:'en',pause:async()=>{},fetch:async()=>i++?Response.json({status:'completed',result:response('en')}):Response.json({jobId:'one'},{status:202})});assert.equal(data.language,'en');
});
test('page language uses marked original, not an Arabic regional default, and rejects stale SPA metadata',()=>{
 globalThis.location=new URL('https://www.youtube.com/watch?v='+videoId);
 let payload={videoDetails:{videoId},streamingData:{adaptiveFormats:[{audioTrack:{id:'ar.3',displayName:'Arabic',audioIsDefault:true}},{audioTrack:{id:'en-US.4',displayName:'English (US) original'}}]},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'ar',kind:'asr'},{languageCode:'en',kind:'asr'}]}}};
 globalThis.document={querySelector:()=>({getPlayerResponse:()=>payload})};
 assert.equal(readYoutubeCaptionInfo(videoId).originalLanguage,'en-us');
 payload.videoDetails.videoId='ANOTHERVID1';assert.deepEqual(readYoutubeCaptionInfo(videoId),{});
 payload={videoDetails:{videoId},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'zh-Hans',kind:'asr'}]}}};assert.equal(readYoutubeCaptionInfo(videoId).originalLanguage,'zh-hans');
 payload.captions.playerCaptionsTracklistRenderer.captionTracks.push({languageCode:'ar',kind:'asr'});assert.equal(readYoutubeCaptionInfo(videoId).originalLanguage,'');
 delete globalThis.location;delete globalThis.document;
});
test('pending caches are language-specific; old Arabic cache is ignored and save retries reuse the new fetch',async()=>{
 const cache={['transcriptPending:'+videoId]:{videoId,language:'ar',segments:[]}};
 const store={get:async key=>({[key]:cache[key]}),set:async values=>Object.assign(cache,values)};
 globalThis.chrome={storage:{local:store,session:{get:async()=>({supadataKey:'FAKE'})}},permissions:{contains:async()=>true},runtime:{getPlatformInfo:async()=>({})},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/watch?v='+videoId}]},scripting:{executeScript:async()=>[{result:{originalLanguage:'en-us'}}]}};
 const original=globalThis.fetch;let count=0;
 globalThis.fetch=async url=>{count++;return Response.json(response(new URL(url).searchParams.get('lang')));};
 try {
  const en=await getTranscript(videoId);assert.equal(en.language,'en-us');assert.match(en.pendingKey,/:v2:/);
  const retry=await getTranscript(videoId);assert.equal(retry.pendingKey,en.pendingKey);assert.equal(count,1);
  const zh=await getTranscript(videoId,{language:'zh'});assert.equal(zh.language,'zh');assert.notEqual(zh.pendingKey,en.pendingKey);assert.equal(count,2);
  await assert.rejects(getTranscript(videoId,{language:'https://evil.test'}),/字幕语言无效/);
 }finally{globalThis.fetch=original;delete globalThis.chrome;}
});

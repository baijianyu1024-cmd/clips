import test from 'node:test';
import assert from 'node:assert/strict';
import { seekYoutube, youtubePlayback, readYoutubePlayer } from '../../extension/transcript-service.js';
import { currentSegmentIndex, currentChapterIndex, overviewQuoteIndices, overviewClip } from '../../extension/youtube.js';
const id='SHIYEDEMO01',url=`https://www.youtube.com/watch?v=${id}`;
let tabs, calls, execute;
function setup() {
 tabs=[{id:1,windowId:1,url,active:false},{id:2,windowId:2,url,active:true}];calls=[];execute=async()=>[{result:{available:true,time:60,paused:false}}];
 globalThis.chrome={tabs:{query:async q=>q.active?tabs.filter(t=>t.active):tabs,get:async id=>tabs.find(t=>t.id===id),update:async(id,v)=>{calls.push(['update',id,v]);return {id,...v};},create:async v=>{calls.push(['create',v]);return {id:3};}},windows:{update:async(...v)=>calls.push(['window',...v])},scripting:{executeScript:async req=>{calls.push(['script',req.target.tabId]);return execute(req);}}};
}
test('seek prefers the current video over another matching tab and never opens a duplicate',async()=>{setup();await seekYoutube(id,60);assert.deepEqual(calls,[['script',2]]);});
test('missing page access is explicit and never reloads an existing video',async()=>{setup();execute=async()=>{throw Error('not granted');};const result=await seekYoutube(id,61);assert.equal(result.restored,false);assert.equal(result.reason,'page-access');assert.deepEqual(calls,[['script',2]]);});
test('a navigation during seek cannot replace the newly opened unrelated page',async()=>{setup();execute=async()=>{tabs[1].url='https://example.com';return [{result:{available:false,reason:'different-video'}}];};await seekYoutube(id,20);assert.equal(calls.filter(c=>c[0]==='update').length,0);assert.equal(calls.filter(c=>c[0]==='create').length,0);});
test('playback is read only and never follows another video or background tab',async()=>{setup();tabs[1].url='https://www.youtube.com/watch?v=OTHERVIDEO1';assert.deepEqual(await youtubePlayback(id),{available:false,reason:'different-video'});assert.deepEqual(calls,[]);tabs[1].url=url;execute=async()=>[{result:{available:true,time:246,paused:false}}];assert.equal((await youtubePlayback(id)).time,246);assert.deepEqual(calls,[['script',2]]);});
test('playhead follows boundaries and backward seeks across pagination',()=>{const rows=Array.from({length:513},(_,i)=>({start:i*4}));assert.equal(currentSegmentIndex(rows,239.9),59);assert.equal(currentSegmentIndex(rows,240),60);assert.equal(currentSegmentIndex(rows,12),3);assert.equal(currentSegmentIndex(rows,9999),512);assert.equal(currentSegmentIndex(rows,NaN),-1);assert.equal(currentSegmentIndex([{start:4}],0),-1);});
test('quote indices deduplicate overlap and overview appends an identifiable editable record',()=>{const o={id:'uuid',summary:'摘要',quotes:[{from:3,to:5},{from:4,to:6}]};assert.deepEqual(overviewQuoteIndices(o),[3,4,5,6]);const clip=overviewClip(o,{videoId:id,title:'视频'});assert.equal(clip.id,o.id);assert.equal(clip.text,'');assert.match(clip.thought,/AI Overview\n\n摘要/);assert.equal(clip.sourceUrl,url);});

test('playback query uses the owning sidepanel window, not whichever window was focused last',async()=>{
 setup();const queries=[];chrome.tabs.query=async q=>{queries.push(q);return [tabs[1]];};await youtubePlayback(id,2);assert.deepEqual(queries,[{active:true,windowId:2}]);
});
test('only absent videos open a timestamp tab; a loading player never reloads',async()=>{
 setup();tabs=[];await seekYoutube(id,15);assert.deepEqual(calls,[['create',{url:url+'&t=15s'}]]);
 setup();execute=async()=>[{result:{available:false,reason:'waiting'}}];const r=await seekYoutube(id,15);assert.equal(r.reason,'waiting');assert.deepEqual(calls,[['script',2]]);
});
test('injected player code seeks the same media element and preserves pause state; ads, other videos and unloaded media are excluded',()=>{
 const media={currentTime:15,duration:1000,readyState:4,paused:true};let ad=false;
 globalThis.location={href:url};globalThis.document={querySelector:s=>s.startsWith('.html5-video-player')?(ad?{}:null):media};
 assert.deepEqual(readYoutubePlayer(id,240),{available:true,time:240,paused:true});assert.equal(location.href,url);media.paused=false;media.currentTime=241;assert.equal(readYoutubePlayer(id).time,241);
 ad=true;assert.equal(readYoutubePlayer(id,50).reason,'ad');assert.equal(media.currentTime,241);ad=false;
 media.readyState=0;assert.equal(readYoutubePlayer(id,50).reason,'waiting');media.readyState=4;
 location.href='https://example.com/watch?v='+id;assert.equal(readYoutubePlayer(id,50).reason,'different-video');assert.equal(media.currentTime,241);
});
test('current chapter follows time boundaries and backward seeks independently of visible subtitle page',()=>{
 const segments=[{start:0},{start:10},{start:45}],chapters=[{from:0},{from:2}];
 assert.equal(currentChapterIndex(chapters,segments,44.9),0);assert.equal(currentChapterIndex(chapters,segments,45),1);assert.equal(currentChapterIndex(chapters,segments,3),0);assert.equal(currentChapterIndex(chapters,segments,NaN),-1);
});

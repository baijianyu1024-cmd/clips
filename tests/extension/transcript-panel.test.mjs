import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
const { window, document }=parseHTML('<html><body><section id="youtube-reading"></section></body></html>');
globalThis.window=window;globalThis.document=document;
window.getSelection=()=>({rangeCount:0,isCollapsed:true});
window.HTMLElement.prototype.getBoundingClientRect=function(){return {top:Number(this.dataset.segment||0)*50,height:50};};
const {adapter}=await import('../../extension/adapter.js');
const {createTranscriptPanel}=await import('../../extension/transcript-panel.js');
const snapshot={id:'a'.repeat(64),videoId:'SHIYEDEMO01',title:'测试视频',language:'en',segments:Array.from({length:513},(_,i)=>({start:i*4,duration:4,text:'Subtitle '+i}))};
const overview={id:'11111111-1111-4111-8111-111111111111',model:'test',summary:'测试概览',chapters:[{from:0,title:'开头',summary:'开头'},{from:120,title:'后半',summary:'后半'}],quotes:[{from:10,to:11}]};
let note={id:'note-a',sources:[{url:'https://www.youtube.com/watch?v=SHIYEDEMO01'}],transcripts:[{id:snapshot.id,videoId:snapshot.videoId}],clips:[]},time=0,available=true,added=[],quoted=[],automatic=0,assist={overview,translations:{}};
adapter.cloud=async()=>({snapshot,assist});adapter.assistStatus=async()=>null;adapter.playback=async()=>({available,time,reason:available?undefined:'different-video'});adapter.assistStart=async()=>{automatic++;};adapter.seek=async(_id,t)=>{time=t;return {restored:true};};
let poll;const realInterval=globalThis.setInterval;globalThis.setInterval=cb=>{poll=cb;return 1;};
const panel=createTranscriptPanel({active:()=>note,upsert:()=>{},notice:()=>{},addOverview:async(id,clip)=>{added.push({id,clip});note.clips.push(clip);},quote:async clip=>quoted.push(clip)});globalThis.setInterval=realInterval;
const settle=()=>new Promise(r=>setImmediate(r));
const action=name=>panel.action(name,{dataset:{}});
const root=document.querySelector('#youtube-reading');
test('subtitle UI crosses pages, preserves manual browsing and resumes at the current playhead',async()=>{
 panel.render();await action('yt-load');await poll();await settle();assert.equal(root.querySelector('.transcript-row[aria-current="true"]').dataset.segment,'0');
 time=244;await poll();await settle();assert.match(root.querySelector('#transcript-pagination').textContent,/2 \/ 9/);assert.equal(root.querySelector('.transcript-row[aria-current="true"]').dataset.segment,'61');
 await action('yt-prev');time=500;await poll();await settle();assert.match(root.querySelector('#transcript-pagination').textContent,/1 \/ 9/);assert.equal(root.querySelector('[data-action="yt-follow"]').getAttribute('aria-pressed'),'false');
 await action('yt-follow');assert.match(root.querySelector('#transcript-pagination').textContent,/3 \/ 9/);assert.equal(root.querySelector('.transcript-row[aria-current="true"]').dataset.segment,'125');
 const field=root.querySelector('#transcript-search');field.value='Subtitle 2';field.dispatchEvent(new window.Event('input',{bubbles:true}));time=1000;await poll();await settle();assert.equal(root.querySelector('[data-action="yt-follow"]').getAttribute('aria-pressed'),'false');assert.match(root.querySelector('#transcript-rows').textContent,/Subtitle 2/);
 await action('yt-follow');assert.equal(root.querySelector('#transcript-search').value,'');assert.equal(root.querySelector('.transcript-row[aria-current="true"]').dataset.segment,'250');
 available=false;await poll();await settle();assert.equal(root.querySelector('.transcript-row[aria-current="true"]'),null);assert.equal(note.id,'note-a');
});
test('opening an old overview translates missing quotes once; addition and quotation preserve the pinned note',async()=>{
 await action('yt-overview-tab');assert.equal(automatic,1);await action('yt-transcript-tab');await action('yt-overview-tab');assert.equal(automatic,1);
 await action('yt-add-overview');assert.equal(added.length,1);assert.equal(added[0].id,'note-a');assert.equal(added[0].clip.id,overview.id);assert.ok(root.querySelector('[data-action="yt-add-overview"]').disabled);
 assist.translations={10:{text:'中文十',model:'m'},11:{text:'中文十一',model:'m'}};panel.render();assert.match(root.querySelector('.yt-key-quote').textContent,/中文十/);
 await panel.action('yt-quote',{dataset:{from:'10',to:'11'}});assert.equal(quoted[0].text,'Subtitle 10\nSubtitle 11');assert.equal(quoted[0].translation.text,'中文十\n中文十一');assert.equal(quoted[0].transcriptAnchor.snapshotId,snapshot.id);
});

test('Overview keeps polling and highlights its chapter; seeking updates both chapter and subtitle across pages',async()=>{
 available=true;time=10;await action('yt-overview-tab');await poll();await settle();
 assert.equal(root.querySelector('.yt-chapter.playing').dataset.index,'0');
 time=500;await poll();await settle();assert.equal(root.querySelector('.yt-chapter.playing').dataset.index,'120');assert.equal(root.querySelector('.yt-chapter.playing .yt-chapter-now').hidden,false);
 await panel.action('yt-seek',{dataset:{index:'5'}});assert.equal(root.querySelector('.yt-chapter.playing').dataset.index,'0');
 await action('yt-transcript-tab');assert.equal(root.querySelector('.transcript-row.playing').dataset.segment,'5');assert.equal(root.querySelector('.transcript-row.playing .yt-line-now').hidden,false);
 available=false;await poll();await settle();assert.equal(root.querySelector('.yt-chapter.playing'),null);assert.equal(root.querySelector('.transcript-row.playing'),null);
});
test('switching video while a playback read is pending cannot apply the previous playhead',async()=>{
 let resolve;adapter.playback=()=>new Promise(r=>{resolve=r;});available=true;poll();
 note={...note,id:'note-b',sources:[{url:'https://www.youtube.com/watch?v=ANOTHERVID1'}],transcripts:[]};panel.render();
 resolve({available:true,time:500,paused:false});await settle();assert.equal(root.querySelector('.yt-chapter.playing'),null);assert.equal(root.querySelector('.transcript-row.playing'),null);
});

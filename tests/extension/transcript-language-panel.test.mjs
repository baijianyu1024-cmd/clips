import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
const {window,document}=parseHTML('<html><body><section id="youtube-reading"></section></body></html>');
globalThis.window=window;globalThis.document=document;window.getSelection=()=>({rangeCount:0});
window.HTMLElement.prototype.getBoundingClientRect=()=>({top:0,bottom:100,height:100});
const {adapter}=await import('../../extension/adapter.js');
const {createTranscriptPanel}=await import('../../extension/transcript-panel.js');
const videoId='L1OBRtfPS34', old={id:'a'.repeat(64),videoId,language:'ar',segments:[{start:0,duration:3,text:'العربية'}]}, english={...old,id:'b'.repeat(64),language:'en',selectionVersion:1,availableLanguages:['ar','en'],segments:[{start:0,duration:3,text:'An English sentence.'}]};
let note={id:'note-one',title:'Video',sources:[{url:'https://www.youtube.com/watch?v='+videoId}],transcripts:[{id:old.id,videoId,language:'ar'}],clips:[]};
const root=document.querySelector('#youtube-reading'), requests=[], fetched=[],removed=[];
adapter.playback=async()=>({available:false});adapter.assistStatus=async()=>null;adapter.remove=async key=>removed.push(key);
adapter.cloud=async request=>{requests.push(request);return request.method==='POST'?{snapshot:english,note:{...note,transcripts:[{id:english.id,videoId,language:'en'},...note.transcripts]}}:{snapshot:old,assist:{overview:null,translations:{0:{text:'旧译文'}}}};};
adapter.transcript=async(id,language)=>{fetched.push({id,language});return {...english,pendingKey:'transcriptPending:v2:test:en'};};
const real=globalThis.setInterval;globalThis.setInterval=()=>0;
const panel=createTranscriptPanel({active:()=>note,upsert:value=>note=value,notice:()=>{},quote:()=>{},addOverview:()=>{}});globalThis.setInterval=real;
const action=name=>panel.action(name,{dataset:{}});
test('old Arabic captions expose a repair selector; switching resets old translations and preserves old reference',async()=>{
 panel.render();await action('yt-load');assert.match(root.textContent,/阿拉伯语/);assert.match(root.textContent,/旧字幕未核对语言/);
 const input=root.querySelector('#transcript-language');input.querySelector('option[value="en"]').selected=true;input.dispatchEvent(new window.Event('change',{bubbles:true}));
 await action('yt-reload');assert.equal(fetched[0].language,'en');assert.equal(requests.find(r=>r.method==='POST').body.activate,true);
 assert.equal(note.transcripts[0].id,english.id);assert.ok(note.transcripts.some(t=>t.id===old.id));assert.match(root.textContent,/An English sentence/);assert.doesNotMatch(root.textContent,/旧译文/);assert.deepEqual(removed,['transcriptPending:v2:test:en']);
});
test('language fetch failure retains visible captions and does not write an unrelated transcript',async()=>{
 const before=requests.filter(r=>r.method==='POST').length;adapter.transcript=async()=>{throw new Error('未取得英语字幕');};
 await assert.rejects(action('yt-reload'),/未取得/);assert.match(root.textContent,/An English sentence/);assert.equal(requests.filter(r=>r.method==='POST').length,before);assert.equal(root.querySelector('[data-action="yt-reload"]').disabled,false);
});
test('finishing a language fetch after switching notes cannot replace the newly opened panel',async()=>{
 let finish;adapter.transcript=()=>new Promise(r=>finish=r);const pending=action('yt-reload');
 note={...note,id:'note-two',transcripts:[]};panel.render();finish({...english,pendingKey:'new'});await pending;
 // upsert updates a note list in production; it must not pin the old note.
 assert.equal(root.querySelector('#transcript-rows'),null);
});

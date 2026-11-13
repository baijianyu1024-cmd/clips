import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompletion,completedParagraphs} from '../../extension/ai-stream.js';
import {streamRequest} from '../../extension/stream-request.js';
const event=(text,finish)=>'data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:finish}]})+'\r\n\r\n';
test('SSE handles byte boundaries, Chinese, empty deltas and requires a complete finish',async()=>{
 const bytes=new TextEncoder().encode(': keepalive\n'+event('中文 `code`',null)+event('\n第二段','stop')+'data: [DONE]\n\n'),seen=[];
 const r=new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}}));
 assert.deepEqual(await readCompletion(r,t=>seen.push(t)),{text:'中文 `code`\n第二段',finish:'stop'});assert.equal(seen[0],'中文 `code`');
 await assert.rejects(readCompletion(new Response(event('中断',null))),/未完成/);
 await assert.rejects(readCompletion(new Response('data: {bad}\n')),/不完整/);
});
test('incremental JSON never exposes a half paragraph or interprets braces inside quoted code',()=>{
 const first={text:'### 标题\n`{"a":[1]}` 和 "引号"',type:'evidence',references:[1]},second={text:'下一段',type:'gap',references:[]},full=JSON.stringify({paragraphs:[first,second]});
 assert.deepEqual(completedParagraphs(full.slice(0,full.indexOf(',{"text":"下一段'))),[first]);
 assert.deepEqual(completedParagraphs(full),[first,second]);assert.deepEqual(completedParagraphs('{"paragraphs":[{"text":"没写完'),[]);
});
test('stream request resolves exactly once, cleans up its port, and rejects disconnections',async()=>{
 let receive,disconnect,posted,closed=0;globalThis.chrome={runtime:{connect:()=>({onMessage:{addListener:f=>receive=f},onDisconnect:{addListener:f=>disconnect=f},postMessage:m=>posted=m,disconnect:()=>closed++})}};
 const seen=[],pending=streamRequest({type:'UNDERSTAND'},x=>seen.push(x));assert.equal(posted.type,'UNDERSTAND');receive({type:'progress',data:{text:'片段'}});receive({type:'result',ok:true,data:{text:'完成'}});assert.deepEqual(await pending,{text:'完成'});assert.equal(seen.length,1);assert.equal(closed,1);
 const failed=streamRequest({type:'UNDERSTAND'},()=>{});disconnect();await assert.rejects(failed,/连接中断/);
});

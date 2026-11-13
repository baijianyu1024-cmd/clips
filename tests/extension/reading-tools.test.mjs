import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readPageContent } from '../../extension/page-content.js';
import { understandingPrompt, understandingThoughtPrompt, contextForQuery, explainReading } from '../../extension/understanding.js';
import { createReadingTools } from '../../extension/reading-tools.js';

function dom(html, url = 'https://example.com/article') {
  const { window, document } = parseHTML(`<html><head><title>测试页面</title></head><body>${html}</body></html>`);
  Object.assign(globalThis, { window, document, location: new URL(url), NodeFilter: { SHOW_TEXT: 4 }, scrollY: 0, innerHeight: 800, innerWidth: 1200, getComputedStyle: el => el.style });
  window.HTMLElement.prototype.getClientRects = () => [{}]; window.getSelection = () => '';
  return { window, document };
}
const paragraph = '产品中的 RAG 指检索增强生成，先查询外部知识，再依据检索结果生成答案。它能补充模型知识，但检索内容仍需验证。'.repeat(4);
test('capture recognizes rendered article text while excluding hidden UI and editable inputs', () => {
  dom(`<article><nav>不能发送的导航</nav><p>${paragraph}</p><div style="display:none"><p>不能发送的隐藏内容</p></div><textarea>私密草稿</textarea><div contenteditable="true">编辑框</div></article>`);
  const result = readPageContent();
  assert.equal(result.status, 'readable'); assert.equal(result.text, paragraph);
});
test('Feishu readable DOM and generic main are partial, not full-document claims', () => {
  dom(`<div class="docx-editor" contenteditable="true"><p>${paragraph}</p></div>`, 'https://my.feishu.cn/wiki/test');
  let result = readPageContent(); assert.equal(result.status, 'partial'); assert.match(result.reason, /已加载/); assert.equal(result.text, paragraph);
  dom(`<main>${paragraph}</main>`); result = readPageContent(); assert.equal(result.status, 'partial'); assert.match(result.reason, /界面文字/);
});
test('login, canvas, video, PDF and bare UI cannot masquerade as body text', () => {
  for (const [url, html] of [['https://my.feishu.cn/wiki/test', '<canvas></canvas>'], ['https://accounts.feishu.cn/login', `<main>${paragraph}</main>`], ['https://example.com/file.pdf', `<article>${paragraph}</article>`], ['https://www.youtube.com/watch?v=abcdefghijk', `<main>${paragraph}</main>`], ['https://example.com', `<nav>${paragraph}</nav>`]]) {
    dom(html, url); const result = readPageContent(); assert.equal(result.status, 'unavailable', url); assert.equal(result.text, ''); assert.ok(result.reason);
  }
});
test('long articles are explicitly truncated and selection retains nearby paragraph context', () => {
  dom(`<article>${'长'.repeat(45000)}</article>`); const result = readPageContent(); assert.equal(result.text.length, 40000); assert.equal(result.truncated, true); assert.equal(result.status, 'partial');
  dom(`<p>${paragraph}</p>`); window.getSelection = () => ({ toString: () => 'RAG', anchorNode: document.querySelector('p').firstChild });
  const selection = readPageContent('selection'); assert.equal(selection.text, 'RAG'); assert.match(selection.context, /检索增强生成/);
});
test('understanding is bounded, uses nearby context, and never claims web access', async () => {
  const context = contextForQuery('RAG', '开头'.repeat(10000) + paragraph, '选区附近');
  assert.match(context, /RAG/); assert.match(context, /选区附近/); assert.ok(context.length <= 14000);
  const messages = understandingPrompt({ query: 'RAG', context, mode: 'translate', title: '文章' });
  assert.match(messages[0].content, /不编造全称/); assert.match(messages[0].content, /没有联网工具/);
  assert.equal(JSON.parse(messages[1].content).task, '翻译成中文');
  assert.throws(() => understandingPrompt({ query: 'x'.repeat(4001) }));
  let payload;
  const result = await explainReading({ query: 'RAG', context }, { credentials: async () => ({ config: { model: 'test' }, key: 'TEST_ONLY' }), allowed: async () => true, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); payload = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: '检索增强生成。' }, finish_reason: 'stop' }] });
  } });
  assert.equal(result.text, '检索增强生成。'); assert.equal(payload.stream, false); assert.equal(JSON.stringify(payload).includes('TEST_ONLY'), false);
});
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
function setup(options={}) {
  dom('<section id="reading-tools"></section>');
  let page = { id: 1, url: 'https://example.com/a', title: 'A' };
  const cache=options.cache||new Map();
  const adapter = { read:async key=>structuredClone(cache.get(key)||null),write:async(key,value)=>cache.set(key,structuredClone(value)),remove:async key=>cache.delete(key), page: async () => page, capture: async () => ({ ...page, status: 'partial', text: paragraph, reason: '仅当前已加载部分' }), config: async () => ({ configured: true }), understand: async () => ({ text: '检索增强生成' }), cloud: () => assert.fail('No cloud writes or reads for understanding') };
  const controller = createReadingTools({ adapter, getPage: () => page, getNotes: () => [], settings: async () => {},...options });
  return { adapter, controller, cache, switchPage: (url='https://example.com/b') => { page = { id: 2, url, title: 'B' }; controller.pageChanged(); }, click: async action => { document.querySelector(`[data-reading-action=${action}]`).click(); await flush(); } };
}
test('material discovers only substantial visible article visuals and reports omissions', () => {
  dom(`<article><p>${paragraph}</p><canvas></canvas><img alt="图示"><img alt="未读区域"></article><aside><canvas></canvas></aside>`);
  const visual = document.querySelector('canvas'); visual.getBoundingClientRect = () => ({ left: 20, top: 100, right: 620, bottom: 500, width: 600, height: 400 });
  const imgs = document.querySelectorAll('img'); imgs[0].getBoundingClientRect = () => ({ left: 20, top: 600, right: 400, bottom: 900, width: 380, height: 300 });
  imgs[1].getBoundingClientRect = () => ({ left: 20, top: 1000, right: 400, bottom: 1300, width: 380, height: 300 });
  const result = readPageContent('material');
  assert.equal(result.visuals.length, 2); assert.equal(result.visuals[1].rect.height, 200); assert.equal(result.visualsOmitted, 1);
  assert.equal(readPageContent('body').visuals, undefined);
});

const field=()=>document.querySelector('#understand-message');
const type=text=>{field().value=text;field().dispatchEvent(new window.Event('input',{bubbles:true}));};
globalThis.FileReader=class{readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:image/png;base64,'+Buffer.from(buffer).toString('base64');this.onload();});}};
const pasteImage=async(text='')=>{const event=new window.Event('paste',{bubbles:true,cancelable:true});event.clipboardData={files:[new Blob(['img'],{type:'image/png'})],getData:()=>text};field().dispatchEvent(event);await flush();};
const imageOptions={prepareImage:async(dataUrl,label)=>({dataUrl,label})};

test('IM uses a single plain composer, accepts a question without a source and retains multiline user text literally',async()=>{
 const t=setup();let request;t.adapter.understand=async input=>{request=input;return {text:'**检索增强生成**'};};
 assert.equal(field().hasAttribute('data-plain-text'),true);assert.equal(document.querySelector('#understand-query'),null);assert.equal(document.querySelector('[data-reading-mode]'),null);assert.equal(document.querySelector('#understand-followup'),null);
 type('**RAG**\n是什么意思？');await t.click('send');
 assert.equal(request.chat,true);assert.equal(request.source,'');assert.match(request.context,/RAG/);assert.equal(request.question,'**RAG**\n是什么意思？');
 assert.equal(document.querySelector('.user .im-message-text').textContent,'**RAG**\n是什么意思？');assert.equal(document.querySelector('.user strong'),null);
 assert.equal(document.querySelector('.assistant strong').textContent,'检索增强生成');assert.equal(field().value,'');
 t.switchPage();assert.equal(document.querySelector('.understand-result').textContent,'');assert.equal(t.controller.snapshot(),null);
});

test('quote and image attachments share the composer, can be removed and travel with the sent message',async()=>{
 const t=setup(imageOptions);let request;
 t.adapter.capture=async(_id,mode)=>mode==='selection'?{url:'https://example.com/a',text:'原文选区',context:'附近段落'}:{url:'https://example.com/a',text:paragraph,status:'partial'};
 t.adapter.understand=async input=>{request=input;return {text:'解释'};};
 await t.click('selection');assert.match(document.querySelector('.im-attachments').textContent,/原文选区/);
 await t.click('remove-quote');assert.equal(document.querySelector('.im-attachments').hidden,true);
 await t.click('selection');await pasteImage('这是我不明白的地方');
 assert.equal(document.querySelectorAll('.im-attachments img').length,1);assert.equal(field().value,'这是我不明白的地方');
 document.querySelector('[data-remove-understand]').click();assert.equal(document.querySelectorAll('.im-attachments img').length,0);
 await pasteImage();await t.click('send');
 assert.equal(request.source,'原文选区');assert.equal(request.quoteContext,'附近段落');assert.equal(request.images.length,1);
 assert.equal(document.querySelector('.user blockquote').textContent,'原文选区');assert.equal(document.querySelectorAll('.user img').length,1);assert.equal(document.querySelector('.im-attachments').hidden,true);
});

test('each follow-up may add a new quotation and image while preserving earlier turns and their attachments',async()=>{
 const t=setup(imageOptions);const calls=[];let captures=0,quote='第一段引用';
 t.adapter.capture=async(_id,mode)=>mode==='selection'?{url:'https://example.com/a',text:quote}:{url:'https://example.com/a',text:'固定上下文 '+ ++captures,status:'partial'};
 t.adapter.understand=async input=>{calls.push(structuredClone(input));return {text:'回答 '+calls.length};};
 await t.click('selection');await pasteImage();type('请翻译');await t.click('send');
 quote='第二段引用';await t.click('selection');await pasteImage();type('和前一段有什么区别？');await t.click('send');
 assert.equal(captures,1);assert.equal(calls[1].context,calls[0].context);assert.equal(calls[1].source,'第二段引用');assert.equal(calls[1].images.length,1);
 assert.equal(calls[1].turns[0].source,'第一段引用');assert.equal(calls[1].turns[0].images.length,1);assert.equal(calls[1].turns[0].answer,'回答 1');
 assert.deepEqual([...document.querySelectorAll('.user blockquote')].map(x=>x.textContent),['第一段引用','第二段引用']);assert.equal(document.querySelectorAll('.user img').length,2);
});

test('failed requests keep text and attachments; retry adds exactly one completed turn',async()=>{
 const t=setup(imageOptions);let attempts=0;t.adapter.understand=async()=>{if(++attempts===1)throw Error('网络连接失败');return {text:'已恢复'};};
 await pasteImage();type('解释这张图片');await t.click('send');assert.equal(field().value,'解释这张图片');assert.equal(document.querySelectorAll('.im-attachments img').length,1);assert.equal(document.querySelectorAll('.understand-message').length,0);
 assert.match(document.querySelector('.understand-status').textContent,/网络连接失败/);
 await t.click('send');assert.equal(document.querySelectorAll('.understand-message').length,2);assert.equal(document.querySelectorAll('.user img').length,1);assert.equal(field().value,'');
});

test('image-only messages and plain questions work even when page content is unavailable',async()=>{
 const t=setup(imageOptions);let request;t.adapter.capture=async()=>{throw Error('需要先授权页面');};t.adapter.understand=async input=>{request=input;return {text:'图示解释'};};
 await pasteImage();await t.click('send');assert.equal(request.question,'帮我解释这张图片');assert.equal(request.images.length,1);assert.match(document.querySelector('.reading-source').textContent,/需要先授权/);
 await t.click('new-chat');type('这个缩写是什么意思？');await t.click('send');assert.equal(request.images.length,0);assert.equal(request.source,'');assert.equal(request.turns.length,0);
});

test('Enter sends, Shift+Enter preserves newlines and IME or duplicate submissions cannot send twice',async()=>{
 const t=setup();let calls=0,resolve;t.adapter.understand=()=>{calls++;return new Promise(r=>resolve=r);};
 type('为什么？');const key=attrs=>{const e=new window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(e,{key:'Enter',...attrs});field().dispatchEvent(e);return e;};
 assert.equal(key({shiftKey:true}).defaultPrevented,false);key({isComposing:true});key({keyCode:229});await flush();assert.equal(calls,0);
 key({});await flush();key({});await flush();assert.equal(calls,1);resolve({text:'答案'});await flush();assert.equal(field().disabled,false);assert.equal(document.querySelectorAll('.understand-message').length,2);
});

test('late captures, images and answers cannot leak across pages or a new conversation',async()=>{
 const t=setup();let resolve;t.adapter.capture=()=>new Promise(r=>resolve=r);
 const capture=t.controller.read();t.switchPage();resolve({url:'https://example.com/a',text:paragraph});await assert.rejects(capture,/切换/);assert.equal(t.controller.snapshot(),null);
 t.adapter.capture=async()=>({url:'https://example.com/b',text:paragraph,status:'partial'});t.adapter.understand=()=>new Promise(r=>resolve=r);
 type('旧问题');await t.click('send');await t.click('new-chat');resolve({text:'旧答案'});await flush();assert.equal(document.querySelector('.understand-result').textContent,'');
 let imageResolve;const imageTest=setup({prepareImage:()=>new Promise(r=>imageResolve=r)});await pasteImage();imageTest.switchPage();imageResolve({dataUrl:'data:image/png;base64,AAAA',label:'旧图片'});await flush();assert.equal(document.querySelectorAll('.im-attachments img').length,0);
});

test('chat-to-thought includes all questions, quotations and manual images and never writes before confirmation',async()=>{
 let saved;const t=setup({...imageOptions,getActive:()=>({id:'note-1',title:'目标笔记'}),saveThought:async draft=>{saved=draft;}}),calls=[];let quote='引用一';
 t.adapter.capture=async(_id,mode)=>mode==='selection'?{url:'https://example.com/a',text:quote}:{url:'https://example.com/a',text:paragraph,status:'partial'};
 t.adapter.understand=async input=>{calls.push(structuredClone(input));return {text:input.purpose==='thought'?'最终澄清的结论':'回答'};};
 await t.click('selection');await pasteImage();type('先解释这段');await t.click('send');quote='引用二';await t.click('selection');type('这段呢？');await t.click('send');await t.click('prepare-thought');
 assert.equal(calls.at(-1).turns.length,2);assert.equal(calls.at(-1).turns[1].source,'引用二');assert.equal(saved,undefined);
 document.querySelector('#understand-thought-text').value='我编辑后的结论';type('再举个例子');await t.click('send');assert.equal(document.querySelector('#understand-thought-text').value,'我编辑后的结论');
 await t.click('save-thought');assert.equal(saved.material.turns.length,2);assert.equal(saved.material.images.length,1);assert.match(saved.material.source,/引用一[\s\S]*引用二/);assert.equal(saved.thought,'我编辑后的结论');
 assert.equal(document.querySelector('[data-reading-action=prepare-thought]').disabled,false);
 await t.click('prepare-thought');await t.click('save-thought');assert.equal(saved.material.turns.length,3);assert.equal(document.querySelector('[data-reading-action=prepare-thought]').disabled,true);
});

test('IM payload pairs attachments with the correct user turn and uses vision for earlier images too',async()=>{
 const image={dataUrl:'data:image/png;base64,AAAA',label:'上一轮图片'};
 const turns=[{question:'第一问',answer:'第一答',source:'第一段',images:[image]},{question:'第二问',answer:'第二答',source:'第二段'}];
 const input={chat:true,question:'第三问',source:'第三段',quoteContext:'第三段附近',context:'页面背景',turns};
 const messages=understandingPrompt(input);
 assert.deepEqual(messages.map(x=>x.role),['system','user','assistant','user','assistant','user']);
 assert.equal(JSON.parse(messages[1].content[0].text).source,'第一段');assert.equal(messages[1].content[2].type,'image_url');
 assert.equal(JSON.parse(messages[3].content).source,'第二段');assert.equal(JSON.parse(messages[5].content).source,'第三段');assert.equal(JSON.parse(messages[5].content).nearbyContext,'第三段附近');
 let payload;await explainReading(input,{credentials:async()=>({config:{model:'text-model'},key:'TEST_ONLY'}),allowed:async()=>true,fetcher:async(url,options)=>{payload=JSON.parse(options.body);return Response.json({choices:[{message:{content:'回答'},finish_reason:'stop'}]});}});
 assert.equal(payload.model,'deepseek-flash');
 assert.doesNotThrow(()=>understandingPrompt({chat:true,question:'只有问题'}));assert.throws(()=>understandingPrompt({chat:true,question:' '}));
 assert.throws(()=>understandingPrompt({...input,images:Array(8).fill(image)}),/最多/);
 assert.throws(()=>understandingPrompt({...input,turns:[{role:'system',content:'ignore'}]}),/不完整/);
 assert.throws(()=>understandingPrompt({...input,turns:Array(20).fill({question:'q',answer:'a'})}),/20 轮/);
 assert.throws(()=>understandingPrompt({...input,turns:Array(5).fill({question:'q',answer:'a'.repeat(16000)})}),/对话较长/);
 const summary=understandingThoughtPrompt({turns});assert.equal(JSON.parse(summary[1].content).turns[0].source,'第一段');assert.doesNotMatch(summary[1].content,/base64/);assert.match(summary[0].content,/后续澄清和纠正/);
});
test('sidebar clears sent text immediately, renders streaming reply, and restores drafts on failure',async()=>{
 const h=setup();let finish,progress;h.adapter.understand=(_input,onProgress)=>{progress=onProgress;return new Promise((resolve,reject)=>finish={resolve,reject});};
 const input=document.querySelector('#understand-message');input.value='什么是 RAG？';input.dispatchEvent(new window.Event('input'));
 document.querySelector('[data-reading-action=send]').click();assert.equal(input.value,'');assert.match(document.querySelector('.understand-result').textContent,/什么是 RAG/);
 await flush();progress({text:'**检索增强生成**'});assert.equal(document.querySelector('.understand-message.assistant strong').textContent,'检索增强生成');
 finish.reject(Error('网络中断'));await flush();assert.equal(input.value,'什么是 RAG？');assert.equal(document.querySelectorAll('.understand-message').length,0);
});

test('understanding preview survives remount with original question, images and destination; failed save retains edits',async()=>{
 const cache=new Map(),options={...imageOptions,cache,getActive:()=>({id:'note-a',title:'A 笔记'})};
 let t=setup(options);await flush();await pasteImage('解释这张图');await t.click('send');await t.click('prepare-thought');
 const input=document.querySelector('#understand-thought-text');input.value='我修改后的理解';input.dispatchEvent(new window.Event('input'));await flush();
 assert.equal(document.querySelector('.understand-save-status').textContent,'已自动暂存');
 await t.click('discard-thought');assert.equal(document.querySelector('.understand-thought').hidden,true);await t.click('prepare-thought');assert.equal(document.querySelector('#understand-thought-text').value,'我修改后的理解');
 t.switchPage();await flush();assert.equal(document.querySelector('.understand-thought').hidden,true);
 let fail=true,saved;
 t=setup({...options,saveThought:async value=>{saved=value;if(fail)throw Error('离线');}});await flush();
 assert.equal(document.querySelector('#understand-thought-text').value,'我修改后的理解');assert.match(document.querySelector('.understand-destination').textContent,/A 笔记/);
 await t.click('save-thought');assert.equal(document.querySelector('.understand-save-status').textContent,'离线');assert.equal(cache.size,1);
 fail=false;await t.click('save-thought');assert.equal(saved.noteId,'note-a');assert.equal(saved.thought,'我修改后的理解');assert.equal(saved.material.turns[0].question,'解释这张图');assert.equal(saved.material.images.length,1);assert.equal(cache.size,0);
 t=setup(options);await flush();assert.equal(document.querySelector('.understand-thought').hidden,true);
});
test('understanding keeps preview usable on quota errors and delayed generation stays with its original page',async()=>{
 const t=setup({getActive:()=>({id:'note-a',title:'A'})});await flush();type('问题');await t.click('send');
 t.adapter.write=async()=>{throw Error('quota');};await t.click('prepare-thought');assert.match(document.querySelector('.understand-save-status').textContent,/暂存失败/);assert.equal(document.querySelector('.understand-thought').hidden,false);
 const cache=new Map(),u=setup({cache,getActive:()=>({id:'note-a',title:'A'})});await flush();type('问题');await u.click('send');let complete;u.adapter.understand=()=>new Promise(resolve=>complete=resolve);
 document.querySelector('[data-reading-action=prepare-thought]').click();await flush();u.switchPage();complete({text:'稍后完成的预览'});await flush();assert.equal(document.querySelector('.understand-thought').hidden,true);
 assert.equal(cache.get('understanding-preview:https://example.com/a').text,'稍后完成的预览');u.switchPage('https://example.com/a');await flush();assert.equal(document.querySelector('#understand-thought-text').value,'稍后完成的预览');
});

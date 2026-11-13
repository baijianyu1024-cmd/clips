import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {diskFolder} from './folder-fixture.mjs';
import {openFolder,createFolderRepository} from '../../extension/folder-store.js';

test('shared library UI writes actual files: create, records, summary, drafts, tags and reopening',async t=>{
 const interval=globalThis.setInterval;globalThis.setInterval=(...args)=>interval(...args).unref();t.after(()=>{globalThis.setInterval=interval;});
 const disk=await diskFolder(t),target={...await openFolder(disk.root),connection:'session'},repo=createFolderRepository(disk.root,target.id);
 // 0.15.0 side-panel AI summaries were stored without optional images/edited.
 // Start from that on-disk format, not only notes created by this UI.
 const seeded=(await repo.request({method:'POST',body:{id:crypto.randomUUID(),fields:{title:'侧栏 AI 摘要兼容验证'}}})).note;
 const legacy=JSON.parse(await disk.read('clips.json'));
 legacy.notes[0].coreSummary={id:crypto.randomUUID(),text:'- 从侧栏保存的纯文字摘要',origin:'ai',scope:'原文与随读记录',provider:'DeepSeek',model:'deepseek-flash',createdAt:seeded.createdAt};
 legacy.notes[0].coreSummaryHistory=[{...legacy.notes[0].coreSummary,id:crypto.randomUUID(),text:'上一版纯文字摘要'}];
 await disk.write('clips.json',JSON.stringify(legacy));
 const dom=new JSDOM(await readFile(new URL('../../extension/library.html',import.meta.url),'utf8'),{url:'https://extension.test/library.html',pretendToBeVisual:true});
 t.after(()=>dom.window.close());
 for(const name of ['window','document','localStorage','sessionStorage','location','history','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLDialogElement','Element','Node','MutationObserver','Event','MouseEvent','getComputedStyle','navigator'])Object.defineProperty(globalThis,name,{configurable:true,value:typeof dom.window[name]==='function'&&name==='getComputedStyle'?dom.window[name].bind(dom.window):dom.window[name]});
 window.confirm=()=>true;window.scrollTo=()=>{};Element.prototype.scrollIntoView=()=>{};
 globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
 globalThis.requestAnimationFrame=window.requestAnimationFrame.bind(window);globalThis.cancelAnimationFrame=window.cancelAnimationFrame.bind(window);
 const cache={clipsStorageTarget:target};globalThis.chrome={runtime:{id:'test',getURL:path=>'https://extension.test/'+path,async sendMessage(m){try{return {ok:true,data:await repo.request(m.request)};}catch(e){return {ok:false,error:e.message,status:e.status};}}},tabs:{query:async()=>[]},storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,cache[k]])),set:async values=>Object.assign(cache,values),remove:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(k=>delete cache[k])},onChanged:{addListener(){}}}};
 await import('../../extension/library-app.js?integration');
 const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)],until=async pred=>{for(let i=0;i<250;i++){if(pred())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Timed out: '+document.body.textContent.slice(-1800));};
 const clickText=(text,scope=document)=>{const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert.ok(b,'Button '+text);b.click();};
 const input=(selector,value)=>{const el=$(selector);assert.ok(el,selector);const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
 const submit=selector=>$(selector).dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 const pause=()=>new Promise(r=>setTimeout(r,40));
 await until(()=>!!$('.library-record')&&document.body.textContent.includes('从侧栏保存的纯文字摘要'));
 $('.new-note').click();await until(()=>$('dialog.editor-modal'));
 input('.title-input','共享界面验证');await pause();submit('dialog.editor-modal form');await until(()=>!$('dialog.editor-modal'));
 let note=(await repo.request()).notes[0];assert.equal(note.title,'共享界面验证');
 // Detail entry uses the same records UI as the hosted notebook.
 await until(()=>document.body.textContent.includes('共享界面验证'));
 await until(()=>$('.note-detail'));
 clickText('记一笔');await until(()=>$('[aria-label="我的想法内容"]'));
 input('[aria-label="我的想法内容"]','**本地与云端共用界面**');await pause();submit('form.reading-inline-editor');await until(()=>!$('form.reading-inline-editor'));
 note=(await repo.request()).notes[0];assert.equal(note.clips.length,1);assert.equal(note.clips[0].thought,'**本地与云端共用界面**');assert.ok($('.reading-log strong'));
 // A new record starts empty and its draft survives a component round trip.
 clickText('记一笔');await until(()=>$('[aria-label="我的想法内容"]'));assert.equal($('[aria-label="我的想法内容"]').value,'');input('[aria-label="我的想法内容"]','下一条未保存');await pause();assert.ok(Object.values(localStorage).some(v=>v.includes('下一条未保存')));clickText('放弃修改');await pause();
 // The summary is edited inline and keeps the most recent record revision.
 clickText('自己写');await until(()=>$('section.core-summary textarea'));input('section.core-summary textarea','- 简洁的核心摘要');await pause();clickText('保存摘要');await until(()=>!$('section.core-summary textarea'));assert.equal((await repo.request()).notes[0].coreSummary.text,'- 简洁的核心摘要');
 $('[aria-label="管理标签"]').click();await until(()=>$('[aria-label="新标签名称"]'));input('[aria-label="新标签名称"]','测试标签');await pause();submit('.tag-manager-create');await until(()=>!!$('[aria-label="重命名标签 测试标签"]'));
 $('[aria-label="重命名标签 测试标签"]').click();await pause();input('input[aria-label="重命名标签 测试标签"]','已改名');await pause();submit('.tag-rename-form');await until(()=>!!$('[aria-label="筛选标签 已改名"]'));$('[aria-label="关闭标签管理"]').click();await pause();
 const reopened=createFolderRepository(disk.root,target.id);assert.equal((await reopened.request()).notes[0].clips.length,1);assert.ok((await reopened.request({path:'/api/tags'})).tags.some(t=>t.name==='已改名'));
 // Unmount to remove polling timers before closing the DOM.
 dom.window.close();
});

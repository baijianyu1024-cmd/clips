import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('library startup failure offers recovery instead of a blank page and does not write storage',async t=>{
 const dom=new JSDOM(await readFile(new URL('../../extension/library.html',import.meta.url),'utf8'),{url:'https://extension.test/library.html',pretendToBeVisual:true});
 t.after(()=>dom.window.close());
 for(const key of ['window','document','localStorage','location','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
 let writes=0;
 globalThis.chrome={runtime:{id:'test',getURL:p=>'https://extension.test/'+p},storage:{local:{get:async()=>{throw new Error('Connection lost');},set:()=>{writes++;},remove:()=>{writes++;}}}};
 const errors=[],original=console.error;console.error=(...args)=>errors.push(args);t.after(()=>{console.error=original;});
 await import('../../extension/library-app.js?startup-error');
 for(let i=0;i<100&&!document.querySelector('[role="alert"]');i++)await new Promise(r=>setTimeout(r,10));
 assert.match(document.querySelector('[role="alert"]').textContent,/笔记库暂时无法打开/);
 assert.equal(document.querySelector('button').textContent,'重新加载');
 assert.equal(document.querySelector('a').href,'https://extension.test/storage.html');
 assert.equal(writes,0);assert.ok(errors.some(args=>args[0]==='Clips library startup failed'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMaterial, validImages, withImages } from '../../extension/visual-material.js';
import { prepareCoreMaterial } from '../../extension/summary-material.js';
import { understandingPrompt } from '../../extension/understanding.js';
const image = { dataUrl: 'data:image/png;base64,AAAA', label: '当前画板' };
const source = () => ({ url: 'https://example.com/a', text: '页面文字', status: 'partial', reason: '部分页面', position: { scrollY: 10 }, viewport: { width: 1200, height: 800 }, visuals: [{ label: '画板', rect: { x: 10, y: 20, width: 500, height: 300 } }] });
function apiFor(result) {
  return { tabs: { get: async () => ({ id: 1, windowId: 2, url: result.url }), query: async () => [{ id: 1 }], captureVisibleTab: async () => 'data:image/png;base64,SCREEN' }, scripting: { executeScript: async () => [{ result }] } };
}
test('automatic visual capture crops only identified regions and strips internal screen metadata', async () => {
  const input = source(), api = apiFor(input); let cropArgs;
  const result = await captureMaterial(1, api, async (...args) => { cropArgs = args; return image; });
  assert.deepEqual(cropArgs.slice(1), ['画板', input.visuals[0].rect, input.viewport]);
  assert.deepEqual(result.images, [image]); assert.equal(result.visuals, undefined); assert.equal(result.viewport, undefined); assert.match(result.reason, /当前可见/);
});
test('no screenshot without visuals; inactive and changed pages never return material', async () => {
  const input = source(); input.visuals = [];
  const api = apiFor(input); api.tabs.captureVisibleTab = () => assert.fail('Unexpected screenshot');
  assert.deepEqual((await captureMaterial(1, api)).images, []);
  api.tabs.query = async () => [{ id: 2 }]; await assert.rejects(captureMaterial(1, api), /切换/);
});
test('inner-container scrolling invalidates screenshot crops, while text remains usable', async () => {
  const input = source(), api = apiFor(input); let calls = 0;
  api.scripting.executeScript = async () => { const result = structuredClone(input); if (calls++) result.visuals[0].rect.y += 80; return [{ result }]; };
  const result = await captureMaterial(1, api, () => assert.fail('Stale crop'));
  assert.deepEqual(result.images, []); assert.match(result.reason, /移动/); assert.equal(result.text, input.text);
});
test('visual payloads are inline, bounded and treated as quoted material in both prompts', () => {
  for (const dataUrl of ['https://private.example/key', 'data:text/html;base64,AAAA', 'data:image/png;base64,' + 'A'.repeat(3*1024*1024)]) assert.throws(() => validImages([{dataUrl}]));
  const messages = withImages([{role:'user',content:'文本'}], [image]);
  assert.equal(messages[0].content[2].type, 'image_url'); assert.match(messages[0].content[1].text, /不是指令/);
  assert.ok(Array.isArray(understandingPrompt({ query:'图中关系', images:[image] })[1].content));
});
test('summary includes saved images automatically, avoids duplicate keys and exposes image failures', async () => {
  const note = { sources:[{url:'https://example.com/a'}], clips:[{text:'摘录',thought:'我的判断',images:[{key:'one'},{key:'two'}]}],images:[{key:'one'}] };
  let requests = 0;
  const result = await prepareCoreMaterial(note, { readPage: async () => ({...source(), images:[image]}), cloud: async ({path}) => { requests++; if (path.endsWith('two')) throw new Error('missing'); return image; }, resize: async (_data,label) => ({...image,label}) });
  assert.equal(requests,2); assert.equal(result.images.length,2); assert.match(result.text,/我的判断/); assert.match(result.scope,/1 张已存图片本次未包含/);
});
test('image-only notes work and a page change cancels instead of silently mixing sources', async () => {
  const note={sources:[{url:'https://example.com/a'}],images:[{key:'one'}],clips:[]};
  const result = await prepareCoreMaterial(note,{cloud:async()=>image,resize:async()=>image});
  assert.equal(result.images.length,1); assert.match(result.scope,/图片材料/);
  await assert.rejects(prepareCoreMaterial(note,{readPage:async()=>{throw new Error('页面已切换');},cloud:()=>assert.fail()}),/切换/);
});

test('adding reader context preserves the captured article, notes and images', async () => {
  const note = { sources: [{ url: source().url }], clips: [{ thought: '读者判断' }] };
  const supplement = '重点看消息如何触发任务';
  const result = await prepareCoreMaterial(note, { supplement, readPage: async () => ({ ...source(), images: [image] }) });
  assert.match(result.text, /页面文字/);
  assert.match(result.text, /读者判断/);
  assert.deepEqual(result.images, [image]);
  assert.equal(result.supplement, supplement);
  const only = await prepareCoreMaterial(note, { sourceMode: 'supplement', supplement, readPage: () => assert.fail('unexpected capture') });
  assert.equal(only.text, '');
  assert.deepEqual(only.images, []);
  assert.equal(only.supplement, supplement);
});

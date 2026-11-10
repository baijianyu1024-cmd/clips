import test from "node:test";
import assert from "node:assert/strict";

const local = {}, session = {}, listeners = {};
function storage(data) { return { setAccessLevel: async () => {}, get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])), set: async values => Object.assign(data, structuredClone(values)), remove: async key => { delete data[key]; } }; }
const event = name => ({ addListener: f => { listeners[name] = f; } });
let allowed = true;
globalThis.chrome = {
  storage: { local: storage(local), session: storage(session) },
  runtime: { id: "test-extension", getURL: p => "chrome-extension://test-extension/" + p, getPlatformInfo: async () => ({}), onInstalled: event("installed"), onMessage: event("message") },
  action: { onClicked: event("action") }, commands: { onCommand: event("command") }, contextMenus: { onClicked: event("context"), removeAll: f => f(), create: () => {} },
  permissions: { contains: async () => allowed },
  tabs: { query: async () => [{ id: 10, url: "https://example.test/", status: "complete" }] },
  scripting: { executeScript: async () => [{ result: { status: 200, data: { notes: [] } } }] },
};
await import("../../extension/background.js");
const own = { id: chrome.runtime.id, url: chrome.runtime.getURL("panel.html") };
const dispatch = message => new Promise(resolve => listeners.message(message, own, resolve));
test("websites and tab content cannot call privileged actions", () => {
  assert.equal(listeners.message({ type: "CONFIG_GET" }, { id: chrome.runtime.id, tab: { id: 1 }, url: "https://example.com" }, () => assert.fail()), false);
  assert.equal(listeners.message({ type: "CONFIG_GET" }, { id: "other", url: own.url }, () => assert.fail()), false);
});
test("key is session-only by default; config status never returns the key", async () => {
  const result = await dispatch({ type: "CONFIG_SAVE", input: { key: "FAKE_TEST_KEY_NOT_A_SECRET", model: "deepseek-flash", remember: false, baseUrl: "https://attacker.invalid" } });
  assert.equal(result.ok, true); assert.equal(session.apiKey, "FAKE_TEST_KEY_NOT_A_SECRET"); assert.equal(local.savedApiKey, undefined);
  assert.equal(local.aiConfig.baseUrl, "https://api.deepseek.com");
  const status = await dispatch({ type: "CONFIG_GET" }); assert.equal(status.data.configured, true); assert.equal(JSON.stringify(status).includes("FAKE_TEST"), false);
});
test("saving credentials requires the explicit DeepSeek origin grant", async () => {
  allowed = false; const result = await dispatch({ type: "CONFIG_SAVE", input: { key: "ANOTHER_FAKE_KEY", model: "deepseek-flash" } }); allowed = true;
  assert.equal(result.ok, false); assert.equal(session.apiKey, "FAKE_TEST_KEY_NOT_A_SECRET");
});
test("unconfigured library rejects requests without accessing a website", async () => {
  for (const request of [{ path: "https://evil.invalid", method: "POST" }, { path: "/api/notes", method: "DELETE" }, { path: "/unsupported", method: "GET" }]) assert.equal((await dispatch({ type: "CLOUD", request })).ok, false);
});
test("AI request uses only the chosen material and preserves original note target", async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response('data: {"choices":[{"delta":{"content":"这是测试摘要"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
  };
  local.activeNoteId = "B";
  const result = await dispatch({ type: "AI_GENERATE", input: { id: "job-A", noteId: "A", sourceUrl: "https://example.com/a", title: "A", text: "用户确认的材料", scope: "摘录" } });
  assert.equal(result.ok, true); assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  const body = JSON.parse(request.init.body); assert.equal(body.stream, true); assert.equal(body.messages.length, 2); assert.equal(body.messages.some(m => m.content.includes("FAKE_TEST_KEY")), false);
  assert.equal(local["unconfigured:aiJob:A"].record.text, "这是测试摘要"); assert.equal(local["unconfigured:aiJob:B"], undefined); assert.equal(local.activeNoteId, "B");
});
test("core generation keeps its destination and expected summary version across tab switches", async () => {
  let payload;
  globalThis.fetch = async (_url, init) => { payload = JSON.parse(init.body); return new Response('data: {"choices":[{"delta":{"content":"核心摘要测试"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); };
  local.activeNoteId = "another-note";
  const result = await dispatch({ type: "AI_GENERATE", input: { id: "core-job", noteId: "core-note", sourceUrl: "https://example.com/core", text: "正文与我的想法", scope: "正文 + 记录", purpose: "core", expectedCoreSummaryId: "previous-summary" } });
  assert.equal(result.ok, true); assert.equal(local["unconfigured:aiJob:core-note"].purpose, "core");
  assert.equal(local["unconfigured:aiJob:core-note"].expectedCoreSummaryId, "previous-summary");
  assert.match(payload.messages[0].content, /核心摘要/); assert.equal(local.activeNoteId, "another-note");
});
test("network, API, and interrupted jobs expose actionable errors without secrets", async () => {
  globalThis.fetch = async () => new Response('{"error":"secret-like upstream text"}', { status: 401 });
  const result = await dispatch({ type: "AI_GENERATE", input: { id: "job-error", noteId: "A", sourceUrl: "https://example.com/a", text: "材料", scope: "片段" } });
  assert.equal(result.ok, false); assert.match(result.error, /API Key 无效/); assert.equal(result.error.includes("secret-like"), false);
  local["unconfigured:aiJob:stale"] = { status: "running" };
  assert.equal((await dispatch({ type: "JOB_GET", noteId: "stale" })).data.status, "error");
});
test("remove key clears both persistence modes", async () => {
  await dispatch({ type: "CONFIG_SAVE", input: { key: "FAKE_TEST_KEY_NOT_A_SECRET", model: "deepseek-flash", remember: true } });
  assert.equal(local.savedApiKey, "FAKE_TEST_KEY_NOT_A_SECRET");
  await dispatch({ type: "CONFIG_CLEAR" }); assert.equal(local.savedApiKey, undefined); assert.equal(session.apiKey, undefined);
});
test("understanding requires only the reading question and never persists a note or AI job", async () => {
  session.apiKey = 'FAKE_UNDERSTANDING_TEST_KEY';
  const before = structuredClone(local);
  let body;
  globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: '这里指检索增强生成。' }, finish_reason: 'stop' }] }); };
  const result = await dispatch({ type: 'UNDERSTAND', input: { query: 'RAG', context: '检索并引用知识库', scope: '部分页面正文', mode: 'explain' } });
  assert.equal(result.ok, true); assert.match(result.data.text, /检索增强生成/); assert.equal(body.stream, false);
  assert.deepEqual(local, before); delete session.apiKey;
});
test('summary sends inline vision context through Flash without persisting captured images', async () => {
  session.apiKey = 'FAKE_VISION_TEST'; let body;
  globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return new Response('data: {"choices":[{"delta":{"content":"图中结构"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); };
  const result = await dispatch({type:'AI_GENERATE',input:{id:'visual-job',noteId:'visual-note',sourceUrl:'https://example.com/a',text:'说明图片',supplement:'关注图中依赖关系',scope:'当前图像',purpose:'core',images:[{dataUrl:'data:image/png;base64,AAAA',label:'画板'}]}});
  assert.equal(result.ok,true); assert.equal(body.model,'deepseek-flash'); assert.equal(body.messages[1].content[2].type,'image_url');
  const material = JSON.parse(body.messages[1].content[0].text);
  assert.equal(material.reader_supplement, '关注图中依赖关系');
  assert.equal(material.reading_material, '说明图片');
  assert.equal(JSON.stringify(local).includes('data:image'),false); delete session.apiKey;
});
test("Supadata settings are independent, permission gated and never expose the key", async () => {
  allowed = false;
  assert.equal((await dispatch({ type: "TRANSCRIPT_CONFIG_SAVE", input: { key: "FAKE_SUPADATA", remember: true } })).ok, false);
  allowed = true;
  assert.equal((await dispatch({ type: "TRANSCRIPT_CONFIG_SAVE", input: { key: "FAKE_SUPADATA", remember: false } })).ok, true);
  assert.equal(session.supadataKey, "FAKE_SUPADATA"); assert.equal(local.savedSupadataKey, undefined);
  const status = await dispatch({ type: "TRANSCRIPT_CONFIG" }); assert.equal(status.data.configured, true); assert.equal(JSON.stringify(status).includes("FAKE_SUPADATA"), false);
  await dispatch({ type: "TRANSCRIPT_CONFIG_SAVE", input: { remember: true } }); assert.equal(local.savedSupadataKey, "FAKE_SUPADATA");
});
test("subtitle retries reuse the successful pending result and never change the pinned note", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; local.activeNoteId = "B"; return Response.json({ lang: "en", content: [{ text: "Context", offset: 12000, duration: 3000 }] }); };
  const message = { type: "TRANSCRIPT_FETCH", videoId: "dQw4w9WgXcQ" };
  const first = await dispatch(message), second = await dispatch(message);
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(calls, 1); assert.equal(first.data.videoId, message.videoId); assert.equal(local.activeNoteId, "B");
  assert.equal(first.data.segments[0].start, 12);
  await dispatch({ type: "TRANSCRIPT_CONFIG_CLEAR" }); assert.equal(session.supadataKey, undefined); assert.equal(local.savedSupadataKey, undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { registerYoutubeEntry, injectYoutubeEntry } from "../../extension/youtube-entry.js";
const script = await readFile(new URL("../../extension/youtube-content.js", import.meta.url), "utf8");
function page() {
  const { document, window } = parseHTML('<html><body><div id="movie_player" class="html5-video-player"><video></video><button id="ytd-note-button">Note</button></div></body></html>');
  const shadows = [], attach = window.HTMLElement.prototype.attachShadow;
  window.HTMLElement.prototype.attachShadow = function(options) { const root = attach.call(this, options); shadows.push(root); return root; };
  const location = { pathname: "/watch", href: "https://www.youtube.com/watch?v=SHIYEDEMO01" }, calls = [], timers = new Map();
  let copied = "";
  let reply = async () => ({ ok: true, data: { id: "capture-id", status: "saved", title: "视频标题", time: 30, text: "字幕原话", url: location.href + "&t=30s" } });
  const context = vm.createContext({ document, location, chrome: { runtime: { id: "test", sendMessage: async message => { calls.push(message); return reply(message); } } }, crypto: globalThis.crypto, URL, setInterval: fn => { timers.set(timers.size + 1, fn); return timers.size; }, clearInterval: id => timers.delete(id), navigator: { clipboard: { writeText: async text => { copied = text; } } } });
  const tick = () => [...timers.values()].forEach(fn => fn());
  const click = (el, trusted = true) => el.onclick({ isTrusted: trusted, preventDefault() {}, stopPropagation() {} });
  vm.runInContext(script, context);
  return { document, context, shadows, calls, location, tick, click, copied: () => copied, reply: fn => reply = fn };
}
test("video overlay is unique, coexists with Digest, hides during ads and follows SPA player replacement", () => {
  const p = page(); assert.equal(p.document.querySelectorAll("#shiye-youtube-entry").length, 1);
  const button = p.shadows[0].querySelector(".entry"); assert.equal(button.style.right, "128px");
  vm.runInContext(script, p.context); assert.equal(p.document.querySelectorAll("#shiye-youtube-entry").length, 1);
  p.document.querySelector("#movie_player").classList.add("ad-showing"); p.tick(); assert.equal(p.document.querySelector("#shiye-youtube-entry").hidden, true);
  p.location.pathname = "/"; p.tick(); assert.equal(p.document.querySelector("#shiye-youtube-entry"), null);
  p.location.pathname = "/watch"; p.tick(); assert.equal(p.document.querySelectorAll("#shiye-youtube-entry").length, 1);
});
test("only trusted clicks save; toast reflects server success, copies quote and requests narrow panel action", async () => {
  const p = page(), root = p.shadows[1], button = p.shadows[0].querySelector(".entry");
  await p.click(button, false); assert.equal(p.calls.length, 0);
  await p.click(button); assert.equal(p.calls[0].type, "YOUTUBE_QUICK_QUOTE"); assert.match(p.calls[0].requestId, /^[a-f0-9-]{36}$/);
  assert.match(root.querySelector(".toast").textContent, /引用已保存.*0:30.*字幕原话.*复制引用.*复制时间链接/);
  await p.click(root.querySelector(".actions button")); assert.equal(p.calls[1].type, "YOUTUBE_EDIT_QUOTE"); assert.equal(p.calls[1].requestId, "capture-id");
});
test("saving does not show success for pending/error results, and stale results cannot appear on another video", async () => {
  const p = page(), root = p.shadows[1], button = p.shadows[0].querySelector(".entry"); p.reply(async () => ({ ok: true, data: { status: "needs-note", time: 10, title: "视频" } }));
  await p.click(button); assert.match(root.querySelector(".toast").textContent, /已暂存/); assert.doesNotMatch(root.querySelector(".toast").textContent, /引用已保存/);
  let resolve; p.reply(() => new Promise(r => resolve = r)); const task = p.click(button);
  p.location.href = "https://www.youtube.com/watch?v=OTHERDEMO01"; p.tick();
  resolve({ ok: true, data: { status: "saved", text: "上一段视频" } }); await task;
  assert.equal(root.querySelector(".toast").hidden, true);
});
test("automatic injection requires optional YouTube access; toolbar injection stays scoped to YouTube", async () => {
  let granted = false, registered = [], injected = [];
  globalThis.chrome = { permissions: { contains: async () => granted }, scripting: {
    getRegisteredContentScripts: async () => registered,
    registerContentScripts: async input => registered.push(...input), unregisterContentScripts: async () => registered = [],
    executeScript: async input => injected.push(input),
  } };
  await registerYoutubeEntry(); assert.equal(registered.length, 0);
  granted = true; await registerYoutubeEntry(); await registerYoutubeEntry(); assert.equal(registered.length, 1);
  assert.equal(registered[0].matches.some(x => x.includes("<all_urls>")), false);
  await injectYoutubeEntry({ id: 1, url: "https://example.com" }); assert.equal(injected.length, 0);
  await injectYoutubeEntry({ id: 2, url: "https://www.youtube.com/watch?v=SHIYEDEMO01" }); assert.equal(injected[0].target.tabId, 2);
  granted = false; await registerYoutubeEntry(); assert.equal(registered.length, 0);
});

test("toast sits at the viewport bottom right and moves into fullscreen without covering the entry", async () => {
  const p = page(), toast = p.document.querySelector("#shiye-youtube-toast");
  assert.equal(toast.parentNode, p.document.body); assert.equal(toast.style.position, "fixed");
  assert.match(p.shadows[1].querySelector("style").textContent, /bottom:20px/);
  assert.match(p.shadows[1].querySelector("style").textContent, /white-space:normal/);
  p.document.fullscreenElement = p.document.querySelector("#movie_player"); p.tick();
  assert.equal(toast.parentNode, p.document.fullscreenElement);
  p.location.pathname = "/"; p.tick(); assert.equal(toast.isConnected, false);
});

 test("Chinese-only quote cards and copy keep Chinese and timestamp without an empty original section", async () => {
   const p = page(); p.reply(async () => ({ ok: true, data: { id: "capture-id", status: "saved", title: "视频标题", time: 30, text: "", sourceLanguage: "de", translation: { text: "这是一段完整的中文引用。" }, url: p.location.href + "&t=30s" } }));
   await p.click(p.shadows[0].querySelector(".entry"));
   const root=p.shadows[1]; assert.match(root.querySelector(".toast").textContent,/中文.*完整的中文引用/); assert.doesNotMatch(root.querySelector(".toast").textContent,/原文/);
   const copy=[...root.querySelectorAll(".actions button")].find(b=>b.textContent==="复制引用"); await p.click(copy);
   assert.match(p.copied(), /完整的中文引用/); assert.match(p.copied(), /&t=30s/); assert.doesNotMatch(p.copied(), /undefined|null/);
 });

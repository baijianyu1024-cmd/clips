import { createLearningEngine } from "./learning-engine.js";
import { retainMaterial } from "./learning-capture.js";
import { getTarget, targetKey, assertTarget, scopedStorage, folderHandle } from './storage-target.js';
import { createFolderRepository } from './folder-store.js';
import { readPageContent } from "./page-content.js";
import { captureMaterial, validImages, withImages } from "./visual-material.js";
import { condenseSummary, summaryTooLong } from "./summary-policy.js";
import { explainReading } from "./understanding.js";
import { createQuoteTranslator } from "./quote-translation.js";
import { startReadingAssist, readingAssistStatus } from "./transcript-assistant.js";
import { transcriptConfig, saveTranscriptConfig, clearTranscriptConfig, getTranscript, seekYoutube, youtubePlayback, readYoutubePlayer } from "./transcript-service.js";
import { createQuickQuoteService, isYoutubePageSender } from "./quick-quote.js";
import { injectYoutubeEntry, registerYoutubeEntry } from "./youtube-entry.js";
import { youtubeId } from "./youtube.js";
import { MAX_INPUT, canonical, aiConfig, buildPrompt, summaryRecord } from "./core.js";
import { createQueueTitleSync } from './queue-title-sync.js';

// Settings and library actions remain extension-UI-only. YouTube has two narrow actions.
const queueTitles = createQueueTitleSync({ cloud: request => cloudRequest(request), tabs: () => chrome.tabs.query({}) });
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.runtime.onInstalled.addListener(details => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: "collect-selection", title: "用 Clips 记下这段", contexts: ["selection"] }));
  registerYoutubeEntry().catch(() => {});
  void cloudRequest({}).catch(() => {});
  if(details?.reason==='install') void getTarget().then(target=>{if(!target)return chrome.tabs.create({url:chrome.runtime.getURL('library.html')});}).catch(()=>{});
});
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId });
  injectYoutubeEntry(tab);
});
chrome.tabs.onUpdated?.addListener((_id, change, tab) => { if (change.status === "complete") injectYoutubeEntry(tab); if (change.status === "complete" || change.title) void queueTitles.refresh(); });
chrome.permissions.onAdded?.addListener(() => registerYoutubeEntry().catch(() => {}));
chrome.permissions.onRemoved?.addListener(() => registerYoutubeEntry().catch(() => {}));
registerYoutubeEntry().catch(() => {});
chrome.commands.onCommand.addListener(async command => {
  if (command !== "open-notes") return;
  const window = await chrome.windows.getLastFocused();
  await chrome.sidePanel.open({ windowId: window.id });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "collect-selection") return;
  chrome.sidePanel.open({ windowId: tab.windowId });
  chrome.storage.session.set({ pendingSelection: { text: (info.selectionText || "").slice(0, 20000), sourceUrl: info.pageUrl, sourceTitle: tab.title || "", tabId: tab.id, at: Date.now() } });
});

export async function cloudRequest(request, selected) {
  const target = selected || await getTarget();
  if (!target || target.mode !== 'local') throw new Error('请先选择本地资料库文件夹。');
  await assertTarget(target);
  if (target.mode === 'local') {
    const root = await folderHandle(target);
    const repo = createFolderRepository(root, target.id, task => navigator.locks.request('clips-library:' + target.id, task));
    const result = await repo.request(request);
    if ((!request.path || request.path === '/api/notes') && (!request.method || request.method === 'GET')) queueTitles.update(result.notes);
    return result;
  }
  throw new Error('请先选择本地资料库文件夹。');
}

async function capture(tabId, mode) {
  if (!Number.isInteger(tabId) || !["selection", "body", "position", "material"].includes(mode)) throw new Error("请先选择要记录的网页。");
  try {
    if (mode === "material") return await captureMaterial(tabId);
    const result = await chrome.scripting.executeScript({ target: { tabId }, func: readPageContent, args: [mode] });
    return result[0].result;
  } catch (error) { if (/切换/.test(error.message)) throw error; throw new Error("请回到文章标签页，点一次浏览器工具栏的 Clips 图标，授权读取这篇内容。浏览器设置页、PDF 阅读器和部分内嵌视频不支持读取。"); }
}

async function getConfig() {
  const saved = await chrome.storage.local.get(["aiConfig", "savedApiKey"]);
  const session = await chrome.storage.session.get("apiKey");
  return { config: saved.aiConfig || { provider: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }, key: session.apiKey || saved.savedApiKey || "", remember: !!saved.savedApiKey };
}
async function saveConfig(input) {
  const config = aiConfig({ ...input, provider: "DeepSeek", baseUrl: "https://api.deepseek.com" });
  const previous = await getConfig();
  const key = String(input.key || previous.key).trim();
  if (!key || key.length > 1000 || /[\r\n]/.test(key)) throw new Error("请填写有效的 DeepSeek API Key。");
  if (!await chrome.permissions.contains({ origins: [config.origin] })) throw new Error("请允许插件连接 DeepSeek 后再保存。");
  await chrome.storage.local.set({ aiConfig: config });
  await chrome.storage.session.set({ apiKey: key });
  if (input.remember) await chrome.storage.local.set({ savedApiKey: key });
  else await chrome.storage.local.remove("savedApiKey");
  return { configured: true };
}

const activeJobs = new Set();
async function generate(input, storage = chrome.storage.local) {
  const { config, key } = await getConfig();
  if (!key) throw new Error("先在设置中填写 DeepSeek API Key。");
  if (!await chrome.permissions.contains({ origins: ["https://api.deepseek.com/*"] })) throw new Error("请在设置中允许连接 DeepSeek。");
  if (!canonical(input.sourceUrl) || !input.noteId || !input.id) throw new Error("请先打开一篇笔记。");
  if (activeJobs.has(input.noteId)) throw new Error("这篇笔记的摘要正在生成，请稍候。");
  const images = validImages(input.images), model = images.length ? "deepseek-flash" : config.model;
  const messages = withImages(buildPrompt(String(input.text || ""), String(input.scope || "阅读片段").slice(0, 600), String(input.title || "").slice(0, 200), input.purpose === "core" ? "core" : "summary", String(input.supplement || "")), images);
  const job = { purpose: input.purpose === "core" ? "core" : "summary", expectedCoreSummaryId: input.expectedCoreSummaryId || null, id: input.id, noteId: input.noteId, sourceUrl: input.sourceUrl, scope: input.scope, title: input.title, provider: "DeepSeek", model, createdAt: new Date().toISOString(), status: "running", text: "" };
  const storageKey = "aiJob:" + job.noteId;
  activeJobs.add(job.noteId);
  // Keep this bounded job alive while streamed tokens arrive; results survive closing the panel.
  const heartbeat = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    await storage.set({ [storageKey]: job });
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: input.purpose === "core" ? 1000 : 1800, temperature: 0.2, thinking: { type: "disabled" } }),
      signal: AbortSignal.timeout(120000), redirect: "error",
    });
    if (!response.ok) {
      const known = { 400: "模型名称或请求不受支持，请检查设置。", 401: "API Key 无效，请到设置中更新。", 402: "DeepSeek 余额不足，请检查账户余额。", 403: "DeepSeek 拒绝了这个请求，请检查账户权限。", 429: "DeepSeek 请求过于频繁，请稍后重试。" };
      throw new Error(known[response.status] || `DeepSeek 暂时不可用（${response.status}），请稍后重试。`);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", text = "", lastSave = 0, finish = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
        const chunk = JSON.parse(data);
        if (chunk.error) throw new Error("DeepSeek 未能完成本次摘要，请重试。");
        const choice = chunk.choices?.[0];
        text += choice?.delta?.content || "";
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
      if (Date.now() - lastSave > 1000) { await storage.set({ [storageKey]: { ...job, text: text.slice(0, 40000) } }); lastSave = Date.now(); }
    }
    if (!finish) throw new Error("连接中断，摘要尚未完整生成。请重试。");
    let warning = finish === "length" ? "已达到输出上限，摘要可能不完整。" : "";
    if (job.purpose === "core" && (summaryTooLong(text) || finish === "length")) {
      await storage.set({ [storageKey]: { ...job, phase: "condensing", text } });
      const compact = await condenseSummary(text, { model, key, supplement: input.supplement, incomplete: finish === "length" });
      text = compact.text; warning = compact.warning;
    }
    const record = summaryRecord(job, text);
    await storage.set({ [storageKey]: { ...job, status: "ready", text: record.text, warning, record } });
    return { ready: true };
  } catch (e) {
    const error = ["TimeoutError", "AbortError"].includes(e.name) ? "生成超时，请稍后重试或减少材料长度。" : e instanceof TypeError ? "无法连接 DeepSeek，请检查网络后重试。" : e.message;
    await storage.set({ [storageKey]: { ...job, status: "error", error } });
    throw new Error(error);
  } finally { clearInterval(heartbeat); activeJobs.delete(job.noteId); }
}

const services = new Map();
function servicesFor(target) {
  const id = targetKey(target);
  if (services.has(id)) return services.get(id);
  const storage = scopedStorage(target), cloud = request => cloudRequest(request, target);
  const translateQuote = createQuoteTranslator({ storage, cloud, credentials: getConfig,
    allowed: () => chrome.permissions.contains({ origins: ['https://api.deepseek.com/*'] }),
    heartbeat: () => { const timer = setInterval(() => chrome.runtime.getPlatformInfo(), 20000); return () => clearInterval(timer); },
  });
  const quickQuotes = createQuickQuoteService({ translate: translateQuote, storage, cloud, readPlayer: async tab => {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readYoutubePlayer, args: [youtubeId(tab.url)] });
    return results[0]?.result || { available: false };
  }});
  const learning = createLearningEngine({ request: cloud, storage, credentials: getConfig, allowed: () => chrome.permissions.contains({ origins: ["https://api.deepseek.com/*"] }) });
  const value = { storage, cloud, translateQuote, quickQuotes, learning }; services.set(id, value); return value;
}
async function dispatch(message,onProgress) {
  const target = await getTarget();
  if (message.context !== undefined && message.context !== targetKey(target)) throw new Error('资料库已切换，请重新打开侧栏。草稿仍保留在原资料库。');
  const { storage, cloud, translateQuote, quickQuotes, learning } = servicesFor(target);
  if (message.type === "LEARNING") { const timer=setInterval(()=>chrome.runtime.getPlatformInfo(),20000); try { return await learning(message.action,message.input,onProgress); } finally { clearInterval(timer); } }
  if (message.type === "TRANSLATE_CLIP") return translateQuote(message.noteId, message.clipId);
  if (message.type === "YOUTUBE_ENTRY_INIT") {
    const [tab] = await chrome.tabs.query({ active: true, windowId: message.windowId });
    await injectYoutubeEntry(tab); return registerYoutubeEntry();
  }
  if (message.type === "QUICK_QUOTE_COMPLETE") return quickQuotes.complete(message.id, message.noteId);
  if (message.type === "QUICK_QUOTE_DISMISS") return quickQuotes.dismiss(message.id);
  if (message.type === "READING_ASSIST_START") return startReadingAssist(message.input, await getConfig(), cloud, storage);
  if (message.type === "READING_ASSIST_STATUS") return readingAssistStatus(message.noteId, message.snapshotId, storage);
  if (message.type === "TRANSCRIPT_CONFIG") return transcriptConfig();
  if (message.type === "TRANSCRIPT_CONFIG_SAVE") return saveTranscriptConfig(message.input);
  if (message.type === "TRANSCRIPT_CONFIG_CLEAR") return clearTranscriptConfig();
  if (message.type === "TRANSCRIPT_FETCH") return getTranscript(message.videoId);
  if (message.type === "YOUTUBE_PLAYBACK") return youtubePlayback(message.videoId, message.windowId);
  if (message.type === "YOUTUBE_SEEK") return seekYoutube(message.videoId, message.time, message.windowId);
  if (message.type === "CLOUD") return cloud(message.request);
  if (message.type === "CAPTURE") {
    const result = await capture(message.tabId, message.mode);
    if (["body","material"].includes(message.mode)) try { return await retainMaterial(result,{storage,request:cloud}); } catch { return {...result,reason:(result.reason||"")+" 本次原文未能留存，后续对话暂不能使用这份新材料。"}; }
    return result;
  }
  if (message.type === "CONFIG_GET") { const { config, key, remember } = await getConfig(); return { ...config, configured: !!key, remember }; }
  if (message.type === "CONFIG_SAVE") return saveConfig(message.input);
  if (message.type === "CONFIG_CLEAR") { await chrome.storage.local.remove("savedApiKey"); await chrome.storage.session.remove("apiKey"); return {}; }
  if (message.type === "UNDERSTAND") return explainReading(message.input || {}, { credentials: getConfig, allowed: () => chrome.permissions.contains({ origins: ["https://api.deepseek.com/*"] }), onProgress });
  if (message.type === "AI_GENERATE") return generate(message.input, storage);
  if (message.type === "JOB_GET") {
    const key = "aiJob:" + message.noteId, saved = (await storage.get(key))[key];
    if (saved?.status === "running" && !activeJobs.has(message.noteId)) { saved.status = "error"; saved.error = "上次生成被浏览器中断，材料仍在草稿中，可以重试。"; await storage.set({ [key]: saved }); }
    return saved || null;
  }
  if (message.type === "RESTORE") {
    const position = message.position;
    if (!canonical(position?.url)) throw new Error("没有可恢复的阅读位置。");
    const tabs = await chrome.tabs.query({}); const existing = tabs.find(t => canonical(t.url) === canonical(position.url));
    if (!existing) { await chrome.tabs.create({ url: position.url }); return { restored: false }; }
    await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true });
    try {
      await chrome.scripting.executeScript({ target: { tabId: existing.id }, func: p => {
        scrollTo({ top: p.ratio * Math.max(0, document.documentElement.scrollHeight - innerHeight), behavior: "smooth" });
        const video = document.querySelector("video"); if (video && p.videoTime !== null) video.currentTime = p.videoTime;
      }, args: [position] });
      return { restored: true };
    } catch { return { restored: false }; }
  }
  throw new Error("暂不支持这个操作。");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (["YOUTUBE_QUICK_QUOTE", "YOUTUBE_OPEN_PANEL", "YOUTUBE_EDIT_QUOTE"].includes(message.type) && isYoutubePageSender(sender, chrome.runtime.id)) {
    // Open while the original user gesture is still active; no generic page relay.
    const opened = message.type !== 'YOUTUBE_QUICK_QUOTE' ? chrome.sidePanel.open({ windowId: sender.tab.windowId }) : null;
    const task = getTarget().then(async target => {
      if (!target) throw new Error('先打开 Clips 侧栏，选择笔记资料库。');
      const { quickQuotes, storage } = servicesFor(target);
      return message.type === "YOUTUBE_QUICK_QUOTE" ? quickQuotes.capture(sender.tab, message.requestId) : (() => {
      if (message.type !== "YOUTUBE_EDIT_QUOTE") return opened;
      return Promise.all([opened, quickQuotes.editTarget(message.requestId, youtubeId(sender.tab.url))]).then(async ([, target]) => {
        await storage.set({ pendingRecordEdit: target }); return { requested: true };
      });
    })();
    });
    Promise.resolve(task).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || "引用失败，请重试。" }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || !['panel.html', 'library.html', 'learning.html', 'storage.html'].some(page => sender.url?.split('?')[0].split('#')[0] === chrome.runtime.getURL(page))) return false;
  dispatch(message).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || "操作失败，请重试。", status: error.status }));
  return true;
});

chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='clips-ai-stream')return;
 const sender=port.sender;
 const native=sender?.id===chrome.runtime.id&&['panel.html','library.html','learning.html','storage.html'].some(page=>sender.url?.split('?')[0].split('#')[0]===chrome.runtime.getURL(page));
 if(!native){port.disconnect();return;}
 let disconnected=false,started=false;
 port.onDisconnect.addListener(()=>{disconnected=true;});
 const emit=value=>{if(!disconnected)try{port.postMessage(value);}catch{disconnected=true;}};
 port.onMessage.addListener(message=>{
  if(started)return;started=true;
  (async()=>{
   if(!['LEARNING','UNDERSTAND'].includes(message.type)||message.type==='LEARNING'&&message.action!=='ask')throw new Error('不支持的对话请求。');
   if(typeof message.context!=='string')throw new Error('资料库标识缺失，请重新打开。');
   return dispatch(message,data=>emit({type:'progress',data}));
  })().then(data=>emit({type:'result',ok:true,data})).catch(e=>emit({type:'result',ok:false,error:e.message,status:e.status}));
 });
});

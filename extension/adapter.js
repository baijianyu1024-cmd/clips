import {streamRequest} from './stream-request.js';
import { getTarget, targetKey, scopedStorage } from './storage-target.js';
import { youtubeUrl } from "./youtube.js";
import { validateTag } from "./note-tags.js";
export const native = !!globalThis.chrome?.runtime?.id;
let targetPromise;
const currentTarget = () => targetPromise ||= (native ? getTarget() : Promise.resolve(null));
const send = async message => {
  message = { ...message, context: targetKey(await currentTarget()) };
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw Object.assign(new Error(result?.error || "插件连接中断，请关闭后重新打开侧栏。"), { status: result?.status });
  return result.data;
};
export const demoPages = [
  { id: 1, url: "https://example.com/reading/learning", title: "让阅读留下来：从摘录到自己的理解", text: "阅读的价值，不只在于看过多少，也在于下一次遇到问题时，能否重新用上。\n\n摘录是一种停顿。它让我们意识到：这里有一句话值得再想一想。但把一句话复制到笔记里，并不意味着它已经成为自己的知识。\n\n试着在摘录下面补充一句：这为什么让我停下来？它和我以前的想法有什么关系？这个小小的动作，把作者的观点和自己的经验连接起来。\n\n很多文章不需要一次读完。把阅读的停顿也记录下来，下次回来时，先看看当时的疑问，再继续往下读。\n\n回顾的目标也不是重复。我们可以保留当时的判断，再补上今天的新理解，让变化本身成为笔记的一部分。" },
  { id: 2, url: "https://example.com/reading/memory", title: "记忆不是仓库，而是一次次重新连接", text: "一条孤立的记录很容易被遗忘，而一个有上下文的想法更容易被唤起。\n\n与其追求一次整理出完美结构，不如留下具体的来源、当时的问题和下一步可以尝试的事。\n\n当我们再次遇到类似情境时，旧笔记成为新的起点。新理解可以加在旧理解后面，不必抹掉当时的犹豫。" },
];
export const demoTranscript = { videoId: "SHIYEDEMO01", language: "en", segments: [
  { start: 0, duration: 12, text: "Reading is a conversation with an idea, not a race to the last page." },
  { start: 12, duration: 16, text: "When something surprises you, pause and write down why it matters to your own work." },
  { start: 28, duration: 18, text: "A useful note keeps the original context and your own interpretation together." },
  { start: 46, duration: 20, text: "You do not need to finish a video in one sitting. Leave a question for the next time you return." },
  { start: 66, duration: 16, text: "Reviewing is an opportunity to notice how your understanding has changed." },
] };
demoPages.push({ id: 3, url: youtubeUrl(demoTranscript.videoId), title: "YouTube 示例 · 让阅读成为自己的理解", text: "这是虚构的视频与字幕，用于演示交互。不会访问 YouTube 或 Supadata。\n\n在右侧手动开始笔记，再点击读取字幕。可以选中字幕或摘录整句，补上自己的想法。\n\n切换到其他示例页面，当前笔记仍会保留。" });
const prefix = "shiye-extension-demo:";
const demoRead = key => { try { return JSON.parse(localStorage.getItem(prefix + key) || "null"); } catch { return null; } };
const demoWrite = (key, value) => localStorage.setItem(prefix + key, JSON.stringify(value));
function demoCloud({ path = "/api/notes", method = "GET", body }) {
  if (path === "/api/notes" && method === "POST" && body?.action === "create_tag") return demoCloud({ path: "/api/tags", method, body: { ...body, action: "create" } });
  if (path === "/api/tags") {
    const names = new Map([...(demoRead("tags") || []), ...(demoRead("notes") || []).flatMap(n => n.tags || [])].map(name => [name.toLowerCase(), name]));
    const revision = demoRead("tagRevision") || 0;
    if (method === "POST") {
      const name = validateTag(body.name);
      if (body.revision !== revision || names.has(name.toLowerCase())) throw Object.assign(new Error("标签已更新，请重试。"), { status: 409 });
      names.set(name.toLowerCase(), name); demoWrite("tags", [...names.values()]); demoWrite("tagRevision", revision + 1);
      return { tags: [...names.values()].map(name => ({ name })), revision: revision + 1, created: name };
    }
    return { tags: [...names.values()].map(name => ({ name })), revision };
  }
  if (path.startsWith("/api/transcripts")) {
    if (method === "GET") { const id = new URL(path, location.origin).searchParams.get("id"); return { snapshot: demoRead("transcript:" + id), assist: demoRead("assist:" + id) || { overview: null, translations: {} } }; }
    const all = demoRead("notes") || [], note = all.find(n => n.id === body.noteId);
    if (!note) throw new Error("找不到演示笔记。");
    const snapshot = { ...body.transcript, id: "a".repeat(64), segmentCount: body.transcript.segments.length, createdAt: new Date().toISOString() };
    const { segments, ...meta } = snapshot;
    note.transcripts = [meta]; note.revision++; demoWrite("notes", all); demoWrite("transcript:" + snapshot.id, snapshot);
    return { note, snapshot };
  }
  const notes = demoRead("notes") || [];
  if (method === "GET") return { notes, tagState: demoCloud({ path: "/api/tags" }) };
  const old = notes.find(n => n.id === body.id);
  if (method === "POST") {
    if (old) return { note: old };
    const now = new Date().toISOString();
    const note = { ...body.fields, id: body.id, createdAt: now, updatedAt: now, revision: 1, nextReviewAt: null, starred: false, archived: false, deletedAt: null, reviews: [] };
    demoWrite("notes", [note, ...notes]); return { note };
  }
  if (!old) throw new Error("找不到这条演示笔记。");
  if (old.revision !== body.revision) throw Object.assign(new Error("笔记有更新，请重试。"), { status: 409 });
  const note = structuredClone(old);
  if (body.action === "tag") {
    const catalog = demoCloud({ path: "/api/tags" }).tags;
    const tag = catalog.find(t => t.name.toLowerCase() === body.tag.toLowerCase());
    if (body.selected && !tag) throw new Error("这个标签已更名或不存在，请重新打开标签列表。");
    const rest = (note.tags || []).filter(t => t.toLowerCase() !== body.tag.toLowerCase());
    if (body.selected && rest.length >= 15) throw new Error("每篇笔记最多添加 15 个标签。");
    note.tags = body.selected ? [...rest, tag.name] : rest;
  }
  if (body.action === "add_clip" && !note.clips.some(c => c.id === body.clip.id)) { note.clips.push(body.clip); if (!note.sources.some(s => s.url === body.clip.sourceUrl)) note.sources.push({ url: body.clip.sourceUrl, label: body.clip.sourceTitle }); }
  if (body.action === "edit_record") {if(body.record.id==='legacy'){note.summary=body.record.text;note.thought=body.record.thought;note.legacyRecordImages=body.record.images;}else note.clips = note.clips.map(c => c.id === body.record.id ? { ...c, ...body.record, ...(c.text!==body.record.text?{anchor:undefined,transcriptAnchor:undefined,translation:undefined}:{}) } : c);}
  if(body.action==='edit_metadata')Object.assign(note,body.metadata);
  if(body.action==='set_core_summary'){if((note.coreSummary?.id||null)!==body.expectedCoreSummaryId)throw Object.assign(new Error('摘要已更新'),{status:409});if(note.coreSummary)note.coreSummaryHistory=[...(note.coreSummaryHistory||[]),note.coreSummary].slice(-20);note.coreSummary=body.coreSummary;}
  if(body.action==='edit_ai_summary')note.aiSummaries=note.aiSummaries.map(a=>a.id===body.aiSummaryId?{...a,text:body.text}:a);
  if(body.action==='edit_review')note.reviews=note.reviews.map(r=>r.id===body.reviewId?{...r,text:body.text}:r);
  if(body.action==='review'&&!note.reviews.some(r=>r.id===body.reviewId))note.reviews.push({id:body.reviewId,text:body.text,createdAt:new Date().toISOString(),nextAt:null});
  if(body.action==='edit_image_record'){const image=note.images.find(i=>i.key===body.imageKey);if(image){note.images=note.images.filter(i=>i.key!==image.key);note.clips.push({...body.record,sourceUrl:note.sources[0]?.url||'',sourceTitle:note.title,videoTime:null,createdAt:image.createdAt||note.createdAt});}}
  if(body.action==='star')note.starred=!note.starred;
  if (body.action === "add_ai_summary" && !note.aiSummaries.some(a => a.id === body.aiSummary.id)) note.aiSummaries.push(body.aiSummary);
  if (body.action === "position") note.readingPosition = body.position;
  if (body.action === "status") note.status = body.status;
  if (body.action === "start_reading" && note.status === "inbox") { note.status = "reading"; note.nextReviewAt = null; if (body.title) note.title = body.title; }
  note.updatedAt = new Date().toISOString(); note.revision++;
  demoWrite("notes", notes.map(n => n.id === note.id ? note : n)); return { note };
}
export const adapter = native ? {
  target: currentTarget,
  read: async key => (await scopedStorage(await currentTarget()).get(key))[key] ?? null,
  write: async (key, value) => scopedStorage(await currentTarget()).set({ [key]: value }),
  remove: async key => scopedStorage(await currentTarget()).remove(key),
  cloud: request => send({ type: "CLOUD", request }),
  youtubeEntry: async () => send({ type: "YOUTUBE_ENTRY_INIT", windowId: (await chrome.windows.getCurrent()).id }),
  translateClip: (noteId, clipId) => send({ type: "TRANSLATE_CLIP", noteId, clipId }),
  completeQuickQuote: (id, noteId) => send({ type: "QUICK_QUOTE_COMPLETE", id, noteId }),
  dismissQuickQuote: id => send({ type: "QUICK_QUOTE_DISMISS", id }),
  page: async () => { const { id: windowId } = await chrome.windows.getCurrent(); const [tab] = await chrome.tabs.query({ active: true, windowId }); return tab ? { id: tab.id, url: tab.pendingUrl || tab.url || "", title: tab.status === "loading" ? "页面正在加载…" : tab.title || "当前页面", status: tab.status } : { url: "", title: "没有打开的网页" }; },
  capture: (tabId, mode) => send({ type: "CAPTURE", tabId, mode }),
  open: async url => {
    const tabs = await chrome.tabs.query({}); const existing = tabs.find(t => t.url === url);
    if (existing) { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
    else await chrome.tabs.create({ url });
  },
  assistStart: input => send({ type: "READING_ASSIST_START", input }),
  assistStatus: (noteId, snapshotId) => send({ type: "READING_ASSIST_STATUS", noteId, snapshotId }),
  transcriptConfig: () => send({ type: "TRANSCRIPT_CONFIG" }),
  saveTranscriptConfig: input => send({ type: "TRANSCRIPT_CONFIG_SAVE", input }),
  clearTranscriptConfig: () => send({ type: "TRANSCRIPT_CONFIG_CLEAR" }),
  allowTranscript: () => chrome.permissions.request({ origins: ["https://api.supadata.ai/*"] }),
  transcript: videoId => send({ type: "TRANSCRIPT_FETCH", videoId }),
  playback: async videoId => send({ type: "YOUTUBE_PLAYBACK", videoId, windowId: (await chrome.windows.getCurrent()).id }),
  seek: async (videoId, time) => send({ type: "YOUTUBE_SEEK", videoId, time, windowId: (await chrome.windows.getCurrent()).id }),
  allowYoutube: () => chrome.permissions.request({ origins: ["https://www.youtube.com/*", "https://youtube.com/*", "https://m.youtube.com/*"] }),
  restore: position => send({ type: "RESTORE", position }),
  config: () => send({ type: "CONFIG_GET" }),
  saveConfig: input => send({ type: "CONFIG_SAVE", input }),
  allowAI: () => chrome.permissions.request({ origins: ["https://api.deepseek.com/*"] }),
  clearKey: () => send({ type: "CONFIG_CLEAR" }),
  understand: async (input,onProgress) => streamRequest({type:"UNDERSTAND",input,context:targetKey(await currentTarget())},onProgress),
  generate: input => send({ type: "AI_GENERATE", input }),
  job: noteId => send({ type: "JOB_GET", noteId }),
  pending: async () => (await chrome.storage.session.get("pendingSelection")).pendingSelection || null,
  clearPending: () => chrome.storage.session.remove("pendingSelection"),
  subscribe: handler => {
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.clipsStorageTarget) handler('storage-target'); });
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && Object.entries(changes).some(([k,v]) => k.endsWith("pendingRecordEdit") && v.newValue)) handler("record-edit"); if (area === "local" && Object.keys(changes).some(k=>k.endsWith("youtubeQuickQuotes"))) handler("quick-quotes"); });
    chrome.tabs.onActivated.addListener(() => handler("page"));
    chrome.tabs.onUpdated.addListener((id, change, tab) => { if (tab.active && (change.url || change.title || change.status === "complete")) handler("page"); });
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.pendingSelection) handler("selection"); if (area === "local" && Object.keys(changes).some(k => k.includes("aiJob:"))) handler("ai"); if (area === "local" && Object.keys(changes).some(k => k.includes("ytAssistJob:"))) handler("transcript-ai"); });
  },
} : {
  read: async key => demoRead(key), write: async (key, value) => demoWrite(key, value), remove: async key => localStorage.removeItem(prefix + key),
  cloud: async request => demoCloud(request),
  page: async () => demoPages[demoRead("pageIndex") || 0],
  capture: async (_id, mode) => { const page = demoPages[demoRead("pageIndex") || 0]; return { ...page, status: "readable", reason: "示例正文 · 不读取真实网页", text: mode === "selection" ? (demoRead("pendingSelection")?.text || "") : ["body", "material"].includes(mode) ? page.text : "", position: { url: page.url, scrollY: 360, ratio: 0.42, videoTime: null, updatedAt: new Date().toISOString() } }; },
  open: async url => { const i = demoPages.findIndex(p => p.url === url); if (i >= 0) { demoWrite("pageIndex", i); window.parent.postMessage({ type: "shiye-demo-page", index: i }, location.origin); } },
  restore: async position => { const i = demoPages.findIndex(p => p.url === position.url); demoWrite("pageIndex", i < 0 ? 0 : i); window.parent.postMessage({ type: "shiye-demo-page", index: i < 0 ? 0 : i }, location.origin); return { restored: true }; },
  assistStart: async input => {
    const snapshot = demoRead("transcript:" + input.snapshotId);
    if (snapshot?.videoId !== demoTranscript.videoId) throw new Error("演示仅使用示例字幕。");
    const assist = demoRead("assist:" + input.snapshotId) || { overview: null, translations: {} };
    if (input.kind === "overview" && !assist.overview) assist.overview = { id: crypto.randomUUID(), model: "示例内容 · 未调用 AI", createdAt: new Date().toISOString(), summary: "本示例围绕阅读、记录与回顾：停下来辨认触动自己的内容，把原始上下文与个人理解一起留下，再在回顾中观察认识的变化。", chapters: [{ from: 0, title: "阅读是一场对话", summary: "带着自己的问题阅读，在惊讶的地方停下来。" }, { from: 2, title: "把原文与理解放在一起", summary: "为摘录保留上下文，也给下次继续阅读留下问题。" }, { from: 4, title: "回顾认识的变化", summary: "再次阅读，观察自己的理解如何发生变化。" }], quotes: [{ from: 2, to: 2 }] };
    if (input.kind === "translation" || input.kind === "overview") for (const i of input.kind === "overview" ? [2] : input.indices) assist.translations[i] = { text: ["阅读是与一个想法对话，而不是赶着读到最后一页。", "当某处内容让你惊讶时，停下来，写下它为什么与你自己的工作有关。", "一条有用的笔记，会把原始上下文和你自己的解释放在一起。", "你不必一次看完整段视频。留下一个问题，等下次回来接着思考。", "回顾是一个机会，让你发现自己的理解发生了怎样的变化。"][i], model: "示例内容 · 未调用 AI", createdAt: new Date().toISOString() };
    demoWrite("assist:" + input.snapshotId, assist); return { started: true };
  },
  assistStatus: async () => ({ id: "demo", status: "ready" }),
  transcriptConfig: async () => ({ configured: false, remember: false }),
  saveTranscriptConfig: async () => { throw new Error("演示页不接收密钥。"); },
  clearTranscriptConfig: async () => {}, allowTranscript: async () => false,
  transcript: async videoId => { if (videoId !== demoTranscript.videoId) throw new Error("演示仅使用示例字幕。"); return structuredClone(demoTranscript); },
  playback: async () => ({ available: false, reason: "demo" }),
  allowYoutube: async () => false,
  seek: async () => ({ demo: true }),
  config: async () => ({ provider: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", configured: false }),
  saveConfig: async () => { throw new Error("请安装插件后在本机设置 Key。演示页不接收密钥。"); },
  allowAI: async () => false, clearKey: async () => {},
  understand: async () => { throw new Error("交互演示不调用 AI。安装插件并填写 DeepSeek Key 后即可使用。"); },
  generate: async () => { throw new Error("交互演示不调用 AI。安装插件并填写 Key 后即可生成。"); },
  job: async noteId => demoRead("aiJob:" + noteId),
  pending: async () => demoRead("pendingSelection"), clearPending: async () => localStorage.removeItem(prefix + "pendingSelection"),
  subscribe: handler => window.addEventListener("storage", e => { if (e.key === prefix + "pageIndex") handler("page"); if (e.key === prefix + "pendingSelection") handler("selection"); }),
};

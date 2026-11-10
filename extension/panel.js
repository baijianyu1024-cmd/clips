import { saveContext, renderSaveContext, createSaveContextPrompt, confirmSaveContext, rememberWritingPage, isReadingPage } from "./save-context.js";
import { createNoteTags } from "./note-tags.js";
import { saveCoreDraft } from "./summary-save.js";
import { createReadingTools } from "./reading-tools.js";
import { prepareCoreMaterial } from "./summary-material.js";
import { renderMarkdown, markdownHelpHTML } from "./markdown.js";
import { quoteView } from "./quote-context.js";
import { needsChineseTranslation } from "./quote-translation.js";
import { createRecordEditor } from "./record-editor.js";
import { transferImages, stageImages, draftImageStore, blobDataUrl, uploadDraftImages, sameDiscovery } from "./image-drafts.js";
import { youtubeId, youtubeUrl } from "./youtube.js";
import { createTranscriptPanel } from "./transcript-panel.js";
import { canonical, findNote, matches, startPageNote, timeLabel } from "./core.js";
import { adapter, native } from "./adapter.js";
import { installMarkdownEditors, isMarkdownFocused } from './markdown-editor.js';
import { createMetadataEditor } from './note-fields.js';

const $ = selector => document.querySelector(selector);
$("#markdown-help").innerHTML = markdownHelpHTML;
installMarkdownEditors();
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "此页面暂不支持记录"; } };
const stamp = date => new Date(date).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
let storageTarget = null, targetChanged = false;
let imageRender = 0;
let savedImageObserver = null, savedImageScope = null;
const savedImageCache = new Map();
const previewURLs = new Map();
let notes = [], page = { url: "", title: "正在识别页面…" }, activeId = null, draft = {}, connected = false, busy = false, aiTarget = null, persistQueue = Promise.resolve(), pageSequence = 0;
let aiPreparation = 0, aiPreparing = false;
const contextPrompt = createSaveContextPrompt($("#save-context-dialog"));
const active = () => notes.find(n => n.id === activeId && !n.deletedAt && !n.archived);
const usablePage = () => isReadingPage(page);
const upsert = note => { notes = [note, ...notes.filter(n => n.id !== note.id)]; pendingWrite("cachedNotes", notes); };
const noteTags = createNoteTags({ root: $("#note-tags"), cloud: request => adapter.cloud(request), active, onSaved: note => { upsert(note); renderActive(); } });
const recordEditor = createRecordEditor({ adapter, native, active, upsert, rerender: () => { renderActive(); renderEntries(); }, notice });
const metadataEditor=createMetadataEditor({adapter,onSaved:note=>{upsert(note);render();notice('笔记信息已保存。');}});
const transcripts = createTranscriptPanel({ active, upsert, notice, addOverview: async (noteId, clip) => {
  if (!(await authorizeRecord(noteId, { quote: clip })).allowed) return;
  await mutate(noteId, "add_clip", { clip }); renderActive(); renderEntries();
  notice("Overview 已添加为一条随读记录，可在笔记详情中继续修改。");
}, quote: async quote => {
  if (draft.quote) throw new Error("先保存或移除当前摘录，再添加字幕。");
  draft.quote = quote; keepDraft(); await persistQueue; renderQuote();
  document.querySelector("#composer").scrollIntoView({ behavior: "smooth", block: "center" });
  notice("字幕已加入草稿，补上自己的想法后保存。");
} });
const readingTools = createReadingTools({ adapter, getPage: () => page, getNotes: () => notes, getActive: active, saveThought: saveUnderstandingThought, settings: showSettings });
async function saveUnderstandingThought(d) {
  const source=d.material.page;
  const record={quote:{sourceUrl:source.url,sourceTitle:source.title},contexts:[source]};
  const approval=await authorizeRecord(d.noteId,record);if(!approval.allowed)return false;
  for(let i=d.images.length;i<d.material.images.length;i++) {
    const image=d.material.images[i];
    const saved=await adapter.cloud({path:'/api/media',method:'POST',body:{base64:image.dataUrl.split(',')[1],type:image.dataUrl.slice(5,image.dataUrl.indexOf(';')),name:image.label.slice(0,200)}});
    d.images.push(saved.image);
  }
  if(!(await authorizeRecord(d.noteId,record,approval.signature)).allowed)return false;
  const questions=d.material.turns?.length ? d.material.turns.map((turn,index)=>`${index+1}. ${turn.question}`).join('\n') : d.material.question;
  const question=questions?`我的问题：${questions.length>6000?questions.slice(0,5980)+'\n（问题节选）':questions}\n\n`:'';
  const room=20000-question.length;
  const excerpt=d.material.source.length>room?d.material.source.slice(0,room-8)+'\n（原文节选）':d.material.source;
  const clip={id:d.id,text:question+excerpt,thought:d.thought,sourceUrl:source.url,sourceTitle:source.title,videoTime:null,images:d.images,createdAt:new Date().toISOString()};
  const note=await mutate(d.noteId,'add_clip',{clip});
  if(!sameDiscovery(note.clips.find(c=>c.id===d.id)||{},clip))throw new Error('这条想法已有另一个保存版本，请在随读记录中核对并编辑。');
  renderActive();renderEntries();return true;
}
async function renderQuickQuotes() {
  const el = $("#quick-quotes"); if (!el || !native) return;
  const captures = (await adapter.read("youtubeQuickQuotes") || []).filter(q => q.status !== "saved");
  el.hidden = !captures.length;
  el.innerHTML = captures.map(q => `<article><strong>视频快捷引用 · ${timeLabel(q.time)}</strong><p>${escape(q.title)}</p>${q.clip?.text ? `<blockquote>${escape(q.clip.text)}</blockquote>` : ""}<p class="hint">${escape(q.error || "时间点已留在本机，选择这篇视频笔记后保存。")}</p><div><button class="quiet" data-action="quick-save" data-id="${escape(q.id)}">${q.noteId ? "重试保存引用" : "开始／继续这篇笔记并保存"}</button><button class="quiet" data-action="quick-dismiss" data-id="${escape(q.id)}">取消引用</button></div></article>`).join("");
}
async function saveQuickQuote(id) {
  const item = (await adapter.read("youtubeQuickQuotes") || []).find(q => q.id === id);
  if (!item) return;
  let noteId = item.noteId;
  if (!noteId) {
    const note = await startPageNote(adapter, { url: youtubeUrl(item.videoId), title: item.title });
    upsert(note); await selectNote(note.id); noteId = note.id;
  } else if (activeId !== noteId) { await refreshNotes(); await selectNote(noteId); }
  const result = await adapter.completeQuickQuote(id, noteId);
  await renderQuickQuotes(); await refreshNotes();
  if (result.status !== "saved") throw new Error(result.error || "请先读取视频字幕，再重试保存引用。");
  notice(result.warning || "引用已保存到随读记录，可以继续补充想法和图片。", !!result.warning);
}
function notice(message, error = false) {
  const openDialogs = [...document.querySelectorAll("dialog[open]")];
  const dialog = openDialogs.at(-1);
  let el = $("#notice");
  if (dialog) { el = dialog.querySelector(".dialog-notice"); if (!el) { el = document.createElement("div"); el.className = "notice dialog-notice"; el.setAttribute("role", "status"); dialog.querySelector(".dialog-head").after(el); } }
  el.hidden = !message; el.classList.toggle("error", error); el.replaceChildren(document.createTextNode(message));
}
function pendingWrite(key, value) {
  const saved = structuredClone(value);
  persistQueue = persistQueue.catch(() => {}).then(() => adapter.write(key, saved));
  persistQueue.catch(() => notice("本机存储空间不足，草稿尚未保存。请复制当前输入。", true));
  return persistQueue;
}
function keepDraft() {
  if (!activeId) return;
  const id = activeId;
  draft = { ...draft, thought: $("#thought").value, id: draft.id || crypto.randomUUID(), updatedAt: Date.now() };
  $("#draft-status").textContent = "正在留存草稿…";
  pendingWrite("draft:" + id, draft).then(() => { if (activeId === id) $("#draft-status").textContent = "草稿已留在本机"; }).catch(() => {});
}
async function selectNote(id) {
  if (activeId) { keepDraft(); await persistQueue; }
  activeId = id; await adapter.write("activeNoteId", id);
  draft = (await adapter.read("draft:" + id)) || {};
  $("#thought").value = draft.thought || "";
  await restoreImageDraft(); render();
}
async function refreshPage() {
  const seq = ++pageSequence, current = await adapter.page();
  if (seq !== pageSequence) return;
  page = current;
  readingTools.pageChanged();
  // This path intentionally cannot pin, create, or discard a note.
  renderPage(); renderActive();
}
async function refreshNotes() {
  try { const result = await adapter.cloud({}); notes = result.notes; if (result.tagState) noteTags.sync(result); await adapter.write("cachedNotes", notes); connected = true; render(); }
  catch (e) { connected = false; renderConnection(); throw e; }
}
function renderConnection() {
  if (!native) { $("#connection").innerHTML = '<span>演示笔记 · 仅当前浏览器</span>'; return; }
  const local = storageTarget?.mode === 'local';
  const label = local ? '本地 · ' + storageTarget.name : '选择笔记资料库';
  $("#connection").innerHTML = `<span class="${connected ? 'connected' : ''}">${connected ? '●' : '○'} ${escape(label)}</span><button data-action="storage">${storageTarget ? '资料库设置' : '选择文件夹'}</button>${storageTarget ? '<button data-action="refresh">重新连接</button>' : ''}`;
}
async function openLibrary(noteId = '') {
  const url = chrome.runtime.getURL('library.html');
  return adapter.open(url + (noteId ? '?note=' + encodeURIComponent(noteId) : ''));
}

function renderPage() {
  const existing = findNote(notes, page.url), isCurrent = active()?.status !== "inbox" && (existing?.id === activeId || (active() && matches(active(), page.url)));
  $("#page-card").innerHTML = `<div class="eyebrow">当前网页</div><h2>${escape(page.title)}</h2><div class="domain">${escape(host(page.url))}</div>${usablePage() ? `<button class="page-action" data-action="start" ${isCurrent ? "disabled" : ""}><span>${isCurrent ? "正在这篇笔记中记录" : existing?.status === "inbox" ? "开始阅读这篇待读内容" : existing ? "继续这篇笔记" : "为这篇开始笔记"}</span><span>${isCurrent ? "✓" : "↗"}</span></button>` : `<div class="domain">打开文章或视频，点击工具栏的 Clips 图标开始。</div>`}`;
}
function renderActive() {
  const note = active();
  $("#composer").hidden = !note;
  noteTags.render();
  renderRecordContext();
  if (!note) {
    $("#active-note").innerHTML = `<div class="empty"><h2>尚未开始笔记</h2><p>开始当前网页的笔记，或选择已有笔记。</p><button class="primary" data-action="start" ${usablePage() ? "" : "disabled"}>开始这篇笔记 ＋</button></div>`;
    return;
  }
  $("#active-note").innerHTML = `<div class="note-heading"><h1>${escape(note.title || "未命名笔记")}</h1></div><div class="note-info-actions"><button class="quiet" data-action="edit-metadata">编辑信息</button><button class="quiet" data-action="star" aria-pressed="${!!note.starred}">${note.starred?"★ 已星标":"☆ 星标"}</button></div><p class="note-publication">${escape(({article:"文章",video:"视频",podcast:"播客",idea:"灵感",other:"其他"})[note.kind]||"其他")} · 内容发布时间：${escape(note.published||"未填写")}${note.timestamp?" · "+escape(note.timestamp):""}</p><div class="note-meta"><span>${note.status === "read" ? "已读完" : note.status === "inbox" ? "待阅读" : "正在读"} · ${note.clips.length} 条记录</span><button class="reading-status-button" data-action="status">${note.status === "read" ? "↶ 继续阅读" : "✓ 标记读完"}</button></div>${note.status === "read" ? `<button class="review-ready" data-action="review"><span>打开这篇笔记<small>查看全部记录</small></span><span>↗</span></button>` : ""}`;
}
const viewQuote = clip => quoteView(clip, active()?.transcripts?.find(t => t.id === clip?.transcriptAnchor?.snapshotId)?.language);
function renderRecordContext() {
  const warn = renderSaveContext($("#record-context"), $("#save-target"), active(), page, draft);
  $('[data-action="save"]').textContent = warn ? "确认保存…" : "保存记录";
}
function markWritingPage(source = page) {
  if (!draft.thought?.trim() && !draft.quote && !draft.attachments?.length) draft.contexts = [];
  draft = rememberWritingPage(draft, source);
}
async function authorizeRecord(id, record, approved = "") {
  return confirmSaveContext({
    approved, prompt: contextPrompt, switchPage: showChooser,
    snapshot: async () => {
      const current = await adapter.page();
      if (activeId !== id || !active()) throw new Error("记录目标已切换，请回到原笔记继续保存。草稿仍在本机。");
      page = current; pageSequence++; renderPage(); renderRecordContext();
      return saveContext(active(), current, record);
    },
  });
}
function renderQuote() {
  renderRecordContext();
  const quote = draft.quote, note = active();
  $("#pending-quote").innerHTML = quote ? `<div class="quote-draft"><button data-action="remove-quote" aria-label="移除这段摘录">×</button>${viewQuote(quote).original ? `<div class="text markdown-body">${renderMarkdown(viewQuote(quote).original)}</div>` : ""}${viewQuote(quote).pending ? `<p class="hint">中文译文待补齐，保存后可补译。</p>` : ""}${viewQuote(quote).translation ? `<div class="entry-translation"><small>中文 · AI 译文</small><div class="text markdown-body">${renderMarkdown(quote.translation.text)}</div></div>` : ""}<small>${escape(quote.sourceTitle || host(quote.sourceUrl))}${quote.videoTime !== null && quote.videoTime !== undefined ? " · " + timeLabel(quote.videoTime) : ""}</small>${note && !matches(note, quote.sourceUrl) ? `<small class="warning">来自另一篇网页；保存时会加入当前笔记并关联这个来源。</small>` : ""}</div>` : "";
  $("#draft-status").textContent = draft.attachments?.length ? `${draft.attachments.length} 张图片随本条记录保存` : draft.thought || draft.quote ? "草稿已留在本机" : "保存到当前笔记";
}
function renderEntries() {
  recordEditor.detach(); const note=active(); savedImageObserver?.disconnect();
  if(savedImageScope!==note?.id){savedImageCache.clear();savedImageScope=note?.id;}
  $("#manual-summary").hidden=!note;
  if(!note){$("#entries").innerHTML="";$("#manual-summary").innerHTML="";return;}
  const edit=(kind,id='new',label='编辑')=>`<button class="quiet" data-action="edit-content" data-kind="${kind}" data-id="${escape(id)}">${label}</button>`;
  const extra=(kind,id,title,text,thought='',images=[],at='')=>`<div class="entry"><div class="entry-head"><span>${escape(title)}${at?' · '+stamp(at):''}</span>${edit(kind,id)}</div>${text?`<div class="text markdown-body">${renderMarkdown(text)}</div>`:''}${thought?`<div class="text markdown-body">${renderMarkdown(thought)}</div>`:''}${savedImageMarkup({id:kind+':'+id,images})}<div data-record-editor="${escape(kind+':'+id)}"></div></div>`;
  const summary = note.coreSummary;
  const hasSummary = !!(summary?.text?.trim() || summary?.images?.length);
  $("#manual-summary").innerHTML = `<article class="entry core-summary-card"><header class="entry-head"><h2>核心摘要</h2><div class="core-summary-actions">${edit('core','new',hasSummary?'编辑':'自己写')}<button class="quiet" data-action="ai">${hasSummary?'重新生成':'AI 生成'}</button></div></header>${summary?.text?`<div class="text markdown-body">${renderMarkdown(summary.text)}</div>`:''}${savedImageMarkup({id:'core:new',images:summary?.images||[]})}${hasSummary?'':'<p class="hint core-summary-empty">还没有核心摘要</p>'}<div data-record-editor="core:new"></div></article>`;
  const entries=[...note.clips.map(c=>({...c,type:'clip'})),...note.aiSummaries.map(a=>({...a,type:'ai'}))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $("#entries").innerHTML=`${note.summary||note.thought||note.legacyRecordImages?.length?extra('legacy','legacy','以前留下的',note.summary,note.thought,note.legacyRecordImages||[]):''}${entries.length?`<div class="entries-heading"><span>随读记录</span><span>${entries.length} 条</span></div>`:''}${entries.map(e=>e.type==='ai'?extra('ai',e.id,'AI 辅助摘要',e.text,'',[],e.createdAt):`<div class="entry"><div class="entry-head"><time>${stamp(e.createdAt)}</time><button class="quiet" data-action="edit-record" data-id="${escape(e.id)}">编辑</button></div>${viewQuote(e).original?`<blockquote><div class="markdown-body">${renderMarkdown(viewQuote(e).original)}</div></blockquote>`:''}${viewQuote(e).pending?'<p class="hint">中文译文待补齐</p>':''}${viewQuote(e).translation?`<div class="entry-translation"><small>中文 · AI 译文</small><div class="text markdown-body">${renderMarkdown(viewQuote(e).translation)}</div></div>`:''}${native&&e.transcriptAnchor&&e.translation?.scope!=='quote'&&needsChineseTranslation(e.text,note.transcripts?.find(t=>t.id===e.transcriptAnchor?.snapshotId)?.language)?`<button class="quiet" data-action="translate-record" data-id="${escape(e.id)}">${e.translation?'结合上下文重译':'补译中文'}</button>`:''}${e.thought?`<div class="text markdown-body">${renderMarkdown(e.thought)}</div>`:''}${savedImageMarkup(e)}<a href="${escape(youtubeId(e.sourceUrl)&&e.videoTime!==null?youtubeUrl(youtubeId(e.sourceUrl),e.videoTime):e.sourceUrl)}" target="_blank" rel="noopener">${escape(e.sourceTitle||host(e.sourceUrl))}${Number.isFinite(e.videoTime)?' · '+timeLabel(e.videoTime):''} ↗</a><div data-record-editor="${escape(e.id)}"></div></div>`).join('')}${(note.images||[]).map(image=>extra('image',image.key,'截图记录','','',[image],image.createdAt)).join('')}<div class="entries-heading"><span>后来的理解</span>${note.status==='read'?edit('new-review','new','＋ 补充'):''}</div><div class="entry"><div data-record-editor="new-review:new"></div></div>${(note.reviews||[]).map(r=>extra('review',r.id,'补充理解',r.text,'',[],r.createdAt)).join('')}`;
  recordEditor.mount(); renderSavedImageThumbnails();
}
function imageRecord(id){const n=active();if(!n)return null;if(id==='core:new')return n.coreSummary;if(id==='legacy:legacy')return {images:n.legacyRecordImages||[]};if(id.startsWith('image:'))return {images:n.images.filter(i=>i.key===id.slice(6))};return n.clips.find(c=>c.id===id);}
function savedImageMarkup(clip) {
  const images = clip.images || [];
  if (!images.length) return "";
  return `<div class="saved-images" role="group" aria-label="记录中的 ${images.length} 张图片">${images.slice(0, 3).map((img, index) => `<button type="button" class="saved-image-thumb" data-action="view-record-images" data-id="${escape(clip.id)}" data-image-index="${index}" data-image-key="${escape(img.key)}" aria-label="放大图片：${escape(img.name)}" title="${escape(img.name)}"><span class="saved-image-placeholder" aria-hidden="true">▧</span></button>`).join("")}${images.length > 3 ? `<button type="button" class="saved-image-more" data-action="view-record-images" data-id="${escape(clip.id)}" data-image-index="3" aria-label="查看其余 ${images.length - 3} 张图片">+${images.length - 3}</button>` : ""}</div>`;
}
async function savedImageURL(key) {
  if (key.startsWith("demo/")) {
    const [, noteId, id] = key.split("/");
    const blob = await draftImageStore.get(noteId, id);
    return blob ? blobDataUrl(blob) : "";
  }
  return native ? (await adapter.cloud({ path: `/api/media?key=${encodeURIComponent(key)}` })).dataUrl : "";
}
function renderSavedImageThumbnails() {
  const scope = activeId;
  const load = async button => {
    const key = button.dataset.imageKey;
    try {
      let url = savedImageCache.get(key);
      if (!url) url = await savedImageURL(key);
      if (!button.isConnected || activeId !== scope) return;
      if (!url) throw new Error("unavailable");
      // Keep only a small in-memory cache; refreshes do not re-download visible images.
      if (url.length <= 1000000) {
        savedImageCache.delete(key); savedImageCache.set(key, url);
        while (savedImageCache.size > 12) savedImageCache.delete(savedImageCache.keys().next().value);
      }
      const img = document.createElement("img"); img.alt = ""; img.decoding = "async";
      img.onload = () => { if (button.isConnected) button.replaceChildren(img); };
      img.onerror = () => { savedImageCache.delete(key); button.querySelector("span").textContent = "查看"; };
      img.src = url;
    } catch {
      if (button.isConnected && activeId === scope) { button.querySelector("span").textContent = "查看"; button.title = "预览暂不可用，点击重试查看原图"; }
    }
  };
  const buttons = [...document.querySelectorAll("#entries [data-image-key], #manual-summary [data-image-key]")];
  if (typeof IntersectionObserver === "undefined") { buttons.forEach(button => void load(button)); return; }
  savedImageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { savedImageObserver.unobserve(entry.target); void load(entry.target); }
  }, { rootMargin: "120px" });
  buttons.forEach(button => savedImageObserver.observe(button));
}
function render() { renderConnection(); renderPage(); renderActive(); renderQuote(); void renderImages(); renderEntries(); transcripts.render(); }
async function mutate(noteId, action, extra) {
  // Read the latest revision and retry only additive/status operations. Never replace note content.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await adapter.cloud({})).notes.find(n => n.id === noteId);
    if (!current) throw new Error("这条笔记已不存在，请检查笔记库。");
    try { const result = await adapter.cloud({ method: "PATCH", body: { id: noteId, revision: current.revision, action, ...extra } }); upsert(result.note); connected = true; return result.note; }
    catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
  }
}
async function start() {
  await refreshPage();
  const target = { ...page };
  if (!usablePage()) throw new Error("请先打开一篇文章或视频。");
  await refreshNotes();
  const wasQueued = findNote(notes, target.url)?.status === "inbox";
  const note = await startPageNote(adapter, target);
  upsert(note); await refreshNotes();
  await selectNote(note.id); notice(wasQueued ? "已从待阅读移到正在读，继续在这篇笔记中记录。" : "正在记录这篇笔记。切换网页不会新建笔记。");
}
async function collect() {
  if (!active()) throw new Error("先开始或选择一篇笔记，再留下摘录。");
  if (draft.quote?.transcriptAnchor) throw new Error("先保存或移除字幕摘录，再添加网页摘录。");
  const pending = await adapter.pending();
  const captured = pending ? { text: pending.text, url: pending.sourceUrl, title: pending.sourceTitle, position: { videoTime: null } } : await adapter.capture(page.id, "selection");
  if (!captured.text.trim()) throw new Error("先在网页中选中文字，再点这里。也可以右键选择「用 Clips 记下这段」。");
  if (draft.quote && canonical(draft.quote.sourceUrl) !== canonical(captured.url)) throw new Error("先保存或移除草稿中的摘录，再添加另一个来源。");
  const text = draft.quote ? draft.quote.text + "\n\n" + captured.text : captured.text;
  if (text.length > 20000) throw new Error("一次摘录最多 20,000 字，请先保存当前摘录。");
  draft.quote = { text, sourceUrl: canonical(captured.url), sourceTitle: (captured.title || "").slice(0, 200), videoTime: captured.position.videoTime };
  keepDraft(); await persistQueue; await adapter.clearPending(); renderQuote(); notice("摘录已加入草稿，可以补一句自己的理解。");
}
async function restoreImageDraft() {
  // Preserve a 0.8 upload that succeeded before its old standalone save failed.
  if (draft.pendingImage) {
    draft.attachments = [...(draft.attachments || []), { id: crypto.randomUUID(), name: draft.pendingImage.name, image: draft.pendingImage }];
    delete draft.pendingImage; keepDraft(); await persistQueue;
  }
}
async function renderImages() {
  const version = ++imageRender, id = activeId, attachments = draft.attachments || [], box = $("#draft-images");
  for (const [key, url] of previewURLs) if (!attachments.some(item => key === id + ":" + item.id)) { URL.revokeObjectURL(url); previewURLs.delete(key); }
  box.hidden = !attachments.length;
  box.innerHTML = attachments.map(item => `<div class="draft-image"><button class="draft-image-preview" data-action="preview-image" data-id="${escape(item.id)}" aria-label="预览图片：${escape(item.name)}"><span>正在打开图片…</span></button><button class="draft-image-remove" data-action="remove-image" data-id="${escape(item.id)}" aria-label="移除图片：${escape(item.name)}">×</button><small>${escape(item.name)}</small></div>`).join("");
  await Promise.all(attachments.map(async item => {
    try {
      const key = id + ":" + item.id;
      let url = previewURLs.get(key);
      if (!url) { const blob = await draftImageStore.get(id, item.id); if (version !== imageRender) return; if (blob) { url = URL.createObjectURL(blob); previewURLs.set(key, url); } }
      if (version !== imageRender) return;
      const target = box.querySelector(`[data-id="${item.id}"]`);
      if (target) target.innerHTML = url ? `<img src="${url}" alt="${escape(item.name)}">` : `<span>${item.image ? "图片已上传 · 点击预览" : "图片未找到，请重新添加"}</span>`;
    } catch { if (version === imageRender) notice("图片草稿暂时无法打开，请重试。", true); }
  }));
}
async function addImages(files, pastedText = "", selection = null) {
  const note = active(); if (!note) throw new Error("先开始或选择一篇笔记，再粘贴图片。");
  const writingPage = { ...page };
  const previous = draft.attachments || [];
  const added = await stageImages(note.id, files, previous);
  markWritingPage(writingPage);
  draft.attachments = [...previous, ...added];
  let textOverflow = false;
  if (pastedText) {
    const input = $("#thought"), start = selection?.start ?? input.value.length, end = selection?.end ?? input.value.length;
    if (input.value.length - (end - start) + pastedText.length <= 20000) input.setRangeText(pastedText, start, end, "end");
    else textOverflow = true;
  }
  keepDraft(); await persistQueue; renderQuote(); await renderImages();
  notice(textOverflow ? "图片已附加，但粘贴文字超过 20,000 字，请分条记录。" : `${added.length} 张图片已加入草稿。可以继续写想法，点「保存发现」一起保存。`, textOverflow);
}
async function removeImage(id) {
  const item = draft.attachments?.find(item => item.id === id); if (!item) return;
  draft.attachments = draft.attachments.filter(item => item.id !== id);
  keepDraft(); await persistQueue;
  await draftImageStore.remove(activeId, id).catch(() => {});
  renderQuote(); await renderImages();
}
async function saveDiscovery() {
  const note = active(); if (!note) return;
  keepDraft(); await persistQueue;
  if (!draft.thought?.trim() && !draft.quote?.text && !draft.attachments?.length) throw new Error("写下一点想法、摘录文字，或粘贴一张截图吧。");
  const captured = structuredClone(draft), id = note.id;
  const approval = await authorizeRecord(id, captured);
  if (!approval.allowed) return;
  const source = captured.quote || { sourceUrl: note.sources[0]?.url || "", sourceTitle: note.title, videoTime: null };
  const attachments = captured.attachments || [];
  $("#draft-status").textContent = attachments.length ? "正在保存图片与文字…" : "正在保存…";
  const images = await uploadDraftImages(id, attachments, async (file, item) => {
    if (!native) return { key: `demo/${id}/${item.id}`, name: item.name, createdAt: new Date().toISOString() };
    const dataUrl = await blobDataUrl(file);
    return (await adapter.cloud({ path: "/api/media", method: "POST", body: { base64: dataUrl.split(",")[1], type: item.type, name: item.name } })).image;
  }, async () => { draft.attachments = attachments; keepDraft(); await persistQueue; });
  const clip = { id: captured.id, text: captured.quote?.text || "", thought: captured.thought || "", sourceUrl: source.sourceUrl, sourceTitle: source.sourceTitle, videoTime: source.videoTime ?? null, sourceLanguage: captured.quote?.sourceLanguage, transcriptAnchor: captured.quote?.transcriptAnchor, translation: captured.quote?.translation, images, createdAt: new Date().toISOString() };
  // Image uploads may take time; a page switch invalidates the earlier decision.
  if (!(await authorizeRecord(id, captured, approval.signature)).allowed) return;
  const result = await mutate(id, "add_clip", { clip });
  const saved = result.clips.find(c => c.id === captured.id);
  if (!saved || !sameDiscovery(saved, clip)) {
    draft.id = crypto.randomUUID(); keepDraft(); await persistQueue; renderEntries();
    throw new Error("上一次保存其实已成功。本次修改仍在草稿中，再点保存会添加为一条新发现。");
  }
  await adapter.remove("draft:" + id);
  // Demo images remain in this origin's local database as its only saved copy.
  if (native) await Promise.all(attachments.map(item => draftImageStore.remove(id, item.id).catch(() => {})));
  if (id === activeId) { draft = {}; $("#thought").value = ""; }
  render(); notice(native ? "这条发现已保存到笔记库，图片和文字在同一条记录中。" : "图文记录已保存在本机演示中，未上传到笔记库。");
}
async function viewImages(items, isDraft = false) {
  const body = $("#image-viewer-body"), viewer = $("#image-viewer"); body.textContent = "正在打开图片…"; viewer.showModal();
  const urls = []; let closed = false;
  viewer.addEventListener("close", () => { closed = true; for (const url of urls) URL.revokeObjectURL(url); body.replaceChildren(); }, { once: true });
  try {
    for (const item of items) {
      let url = isDraft ? previewURLs.get(activeId + ":" + item.id) : "";
      const image = isDraft ? item.image : item;
      if (!url && image?.key?.startsWith("demo/")) { const [,noteId,id] = image.key.split("/"); const blob = await draftImageStore.get(noteId, id); if (blob) { url = URL.createObjectURL(blob); urls.push(url); } }
      if (!url && image && native) url = (await adapter.cloud({ path: `/api/media?key=${encodeURIComponent(image.key)}` })).dataUrl;
      if (closed) { for (const objectUrl of urls) URL.revokeObjectURL(objectUrl); return; }
      if (!url) throw new Error("图片暂时无法打开，请到笔记库查看，或重新添加图片。");
      const img = document.createElement("img"); img.src = url; img.alt = item.name; img.loading = "lazy";
      if (body.textContent === "正在打开图片…") body.replaceChildren(); body.append(img);
    }
  } catch(e) { if (!closed) { const message = document.createElement("p"); message.textContent = e.message; body.append(message); } }
}
async function showChooser() {
  await refreshNotes();
  const available = notes.filter(n => !n.deletedAt && !n.archived).sort((a, b) => (a.status === "reading" ? -1 : 0) - (b.status === "reading" ? -1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
  $("#note-options").innerHTML = available.length ? available.map(n => `<button class="note-option" data-action="select-note" data-id="${escape(n.id)}">${escape(n.title || "未命名笔记")}<small>${n.status === "read" ? "已读完" : n.status === "reading" ? "正在读" : "待读"} · ${n.clips.length} 条发现${activeId === n.id ? " · 当前笔记" : ""}</small></button>`).join("") : `<p class="hint">还没有笔记。回到文章，手动开始第一篇。</p>`;
  $("#chooser").showModal();
}
async function showSettings() {
  const config = await adapter.config(), captions = await adapter.transcriptConfig();
  $("#supadata-key").value = ""; $("#supadata-key").placeholder = captions.configured ? "已配置；留空保留当前 Key" : "仅在此处填写";
  $("#supadata-remember").checked = captions.remember; $("#supadata-state").textContent = captions.configured ? "已配置 Key" : "尚未配置 Key";
  if (!native) { $("#supadata-key").disabled = true; $("[data-action='save-supadata']").disabled = true; $("#supadata-state").textContent = "演示页不接收密钥，仅使用示例字幕。"; }
  $("#model").value = config.model; $("#api-key").value = ""; $("#api-key").placeholder = config.configured ? "已配置；留空保留当前 Key" : "仅在此处填写";
  $("#remember").checked = config.remember;
  $("#key-state").textContent = config.configured ? "已配置 Key" : "尚未配置 Key";
  if (!native) { $("#settings-hint").textContent = "安装插件后在本机填写 DeepSeek Key。此演示页不接收密钥，也不调用 AI。"; $("#api-key").disabled = true; $("[data-action='save-settings']").disabled = true; }
  $("#settings").showModal();
}
async function showAI() {
  aiPreparation++; aiPreparing = false;
  await refreshNotes();
  const note = active(); if (!note) throw new Error("先开始一篇笔记，再使用 AI 摘要。");
  aiTarget = { id: note.id, title: note.title, url: note.sources[0]?.url, coreSummaryId: note.coreSummary?.id || null };
  await persistQueue;
  const [saved, previous] = await Promise.all([
    adapter.read("summaryDraft:" + note.id),
    adapter.read("aiMaterial:" + note.id),
  ]);
  // A 0.10.2 manual draft was a replacement for all automatically collected material.
  const legacy = !saved && previous?.manual;
  $("#ai-source").value = saved?.sourceMode || (legacy ? "supplement" : "page");
  $("#ai-supplement").value = saved?.supplement ?? (legacy ? previous.text : "");
  if (legacy) keepSummaryDraft();
  $("#ai-target").textContent = note.title;
  renderSourceHint();
  $("#ai-used").open = false;
  renderUsedMaterial(previous?.requestId ? previous : null);
  await renderJob();
  $("#ai-dialog").showModal();
}
function renderSourceHint() {
  const sourceMode = $("#ai-source").value;
  $("#ai-optional").textContent = sourceMode === "supplement" ? "必填" : "选填";
  const hints = {
    page: "生成时，Clips 会将可读取的原文、图片和随读记录连同你的补充交给 DeepSeek。",
    records: "生成时，Clips 会将这篇笔记的随读记录、已存图片和你的补充交给 DeepSeek。",
    supplement: "生成时，Clips 只会将上方的补充信息交给 DeepSeek。",
  };
  $("#ai-source-hint").textContent = hints[sourceMode];
}
function keepSummaryDraft() {
  if (!aiTarget) return;
  pendingWrite("summaryDraft:" + aiTarget.id, { sourceMode: $("#ai-source").value, supplement: $("#ai-supplement").value });
}
function renderUsedMaterial(material) {
  $("#ai-used").hidden = !material;
  $("#ai-used").dataset.requestId = material?.requestId || "";
  $("#ai-scope").textContent = material?.scope || "";
  for (const [selector, value] of [["#ai-used-reading", material?.text], ["#ai-used-extra", material?.supplement]]) {
    $(selector).hidden = !value;
    $(selector + " pre").textContent = value || "";
  }
  $("#ai-images").innerHTML = (material?.images || []).map(image => `<img src="${escape(image.dataUrl)}" alt="${escape(image.label)}">`).join("");
}

async function renderJob() {
  if (!aiTarget) return;
  const id = aiTarget.id, job = await adapter.job(id); if (id !== aiTarget?.id) return;
  const generateButton = $("[data-action='generate']");
  generateButton.disabled = aiPreparing || job?.status === "running";
  generateButton.textContent = job?.status === "ready" || aiTarget.coreSummaryId ? "重新生成" : "生成摘要";
  $("#ai-used").hidden = !job || $("#ai-used").dataset.requestId !== job.id;
  if (!job) { $("#ai-result").innerHTML = ""; return; }
  if (job.status === "running") $("#ai-result").innerHTML = `<h3 class="spin-label">${job.phase === "condensing" ? "正在精简摘要" : "正在生成"} · 可以关闭这个窗口继续记录</h3><div class="stream">${escape(job.text)}</div>`;
  else if (job.status === "error") $("#ai-result").innerHTML = `<p class="hint">${escape(job.error)}</p>`;
  else if (job.status === "ready") {
    if ($("#ai-result").dataset.job === job.id && $("#ai-output")) return;
    const edited = await adapter.read("aiOutput:" + job.id);
    if (id !== aiTarget?.id) return;
    $("#ai-result").innerHTML = `<h3>${job.purpose === "core" ? "核心摘要草稿" : "此前的 AI 辅助摘要"} · ${escape(job.provider)}</h3><p class="hint">${job.warning ? escape(job.warning) : "可直接修改草稿，再保存到这篇笔记。"}</p><textarea id="ai-output" rows="9" maxlength="40000" aria-label="AI 摘要结果">${escape(edited ?? job.text)}</textarea>${markdownHelpHTML}<button class="primary" data-action="save-ai">${job.purpose === "core" ? "确认保存为核心摘要" : "保留为 AI 辅助记录"} ✓</button>`;
    $("#ai-result").dataset.job = job.id;
  }
}
async function generate() {
  if (!native) throw new Error("这是交互演示。安装插件并在 AI 设置中填写 Key 后，即可真正生成摘要。");
  if (!(await adapter.config()).configured) { await showSettings(); return; }
  const target = { ...aiTarget };
  const note = notes.find(n => n.id === target.id);
  if (!note) throw new Error("请重新打开这篇笔记。");
  const sourceMode = $("#ai-source").value;
  const supplement = $("#ai-supplement").value.trim();
  const preparation = ++aiPreparation;
  const stillOpen = () => preparation === aiPreparation && target.id === aiTarget?.id && $("#ai-dialog").open;
  aiPreparing = true;
  $("[data-action='generate']").disabled = true;
  $("#ai-result").innerHTML = '<h3 class="spin-label">正在准备阅读材料</h3>';
  try {
    const material = await prepareCoreMaterial(note, {
      cloud: adapter.cloud, sourceMode, supplement,
      readPage: matches(note, page.url) ? async () => {
        const source = await readingTools.read({ refresh: true });
        if (!matches(note, source.url)) throw new Error("页面已切换，请重新生成。");
        return source;
      } : null,
    });
    if (!stillOpen()) return;
    const requestId = crypto.randomUUID();
    const { images, ...snapshot } = material;
    // Persist the exact text for this request, without saving captured screenshots.
    await pendingWrite("aiMaterial:" + note.id, { ...snapshot, requestId });
    if (!stillOpen()) return;
    renderUsedMaterial({ ...material, requestId });
    const input = { ...material, id: requestId, noteId: note.id, title: target.title, purpose: "core", expectedCoreSummaryId: target.coreSummaryId };
    $("#ai-result").innerHTML = '<h3 class="spin-label">正在生成摘要</h3>';
    adapter.generate(input).then(() => {
      if (stillOpen()) notice("摘要草稿已生成。");
    }).catch(error => {
      if (stillOpen()) notice(error.message, true);
    }).finally(() => {
      if (preparation === aiPreparation) aiPreparing = false;
      if (stillOpen()) renderJob().catch(error => notice(error.message, true));
    });
  } catch (error) {
    if (preparation === aiPreparation) aiPreparing = false;
    if (stillOpen()) await renderJob();
    throw error;
  }
}
function showSummaryConflict(note) {
  $("#ai-conflict")?.remove();
  const section = document.createElement("section"); section.id = "ai-conflict"; section.className = "summary-conflict";
  section.dataset.expectedId = note.coreSummary?.id || "";
  section.dataset.noteId = note.id;
  section.innerHTML = `<h3>当前已保存的摘要</h3><div class="markdown-body">${renderMarkdown(note.coreSummary?.text || "当前没有摘要正文。")}</div>${note.coreSummary?.images?.length ? `<p class="hint">另有 ${note.coreSummary.images.length} 张图片，更新正文时会保留。</p>` : ""}<p class="hint">上方是你的草稿。确认更新后，当前摘要会保留在历史版本中。</p><button class="primary" data-action="replace-ai">用这份草稿更新摘要</button>`;
  $("#ai-result").append(section);
  $("[data-action='save-ai']").hidden = true;
}
async function replaceAI() {
  const section = $("#ai-conflict"), id = aiTarget?.id;
  if (!section || section.dataset.noteId !== id) return;
  const job = await adapter.job(id);
  if (!job?.record || job.id !== $("#ai-result").dataset.job) throw new Error("摘要草稿已变化，请重新打开后核对。");
  await adapter.write("aiJob:" + id, { ...job, expectedCoreSummaryId: section.dataset.expectedId || null, record: { ...job.record, id: crypto.randomUUID() } });
  return saveAI();
}
async function saveAI() {
  const id = aiTarget.id, job = await adapter.job(id);
  if (!job?.record) throw new Error("摘要还未生成完成。");
  const text = $("#ai-output").value.trim(); if (!text) throw new Error("摘要内容为空。");
  await pendingWrite("aiOutput:" + job.id, text);
  let result;
  try {
    result = job.purpose === "core" ? await saveCoreDraft(adapter.cloud, job, text) : await mutate(id, "add_ai_summary", { aiSummary: { ...job.record, text } });
    if (job.purpose === "core") upsert(result);
  } catch (error) {
    if (error.currentNote && aiTarget?.id === id) { upsert(error.currentNote); showSummaryConflict(error.currentNote); }
    throw error;
  }
  if (job.purpose !== "core" && result.aiSummaries.find(a => a.id === job.record.id)?.text !== text) {
    await adapter.write("aiJob:" + id, { ...job, record: { ...job.record, id: crypto.randomUUID() } });
    throw new Error("上次摘要已保存。当前编辑仍保留，再点保存会作为一份补充摘要。");
  }
  await adapter.remove("aiJob:" + id); await adapter.remove("aiMaterial:" + id); await adapter.remove("aiOutput:" + job.id);
  $("#ai-dialog").close(); render(); notice(job.purpose === "core" ? "核心摘要已保存。" : "AI 辅助记录已保存。");
  if (job.purpose === "core" && activeId === id) $("#manual-summary").scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}
let pendingEditTask = null;
async function consumeRecordEdit() {
  if (busy) return;
  if (pendingEditTask) return pendingEditTask;
  pendingEditTask = (async () => {
    const target = await adapter.read("pendingRecordEdit"); if (!target) return;
    await refreshNotes(); if (activeId !== target.noteId) await selectNote(target.noteId);
    if (!active()) throw new Error("请先恢复这篇笔记，再编辑记录。");
    await recordEditor.open(active(), target.clipId);
    if ((await adapter.read("pendingRecordEdit"))?.requestId === target.requestId) await adapter.remove("pendingRecordEdit");
  })().finally(() => { pendingEditTask = null; });
  return pendingEditTask;
}
async function execute(action, button) {
  if (action === "translate-record") {
    button.disabled = true; button.textContent = "结合上下文翻译中…";
    try { const result = await adapter.translateClip(activeId, button.dataset.id); upsert(result.note); renderEntries(); notice(result.translation ? "中文译文已补齐，原文、想法和图片都已保留。" : "这段内容已是中文，无需翻译。"); }
    finally { button.disabled = false; button.textContent = "补译中文"; }
    return;
  }
  if (action === "edit-metadata") return metadataEditor.open(active());
  if (action === "star") {await mutate(activeId,"star",{});renderActive();return;}
  if (action === "edit-content") return recordEditor.open(active(),button.dataset.id,button.dataset.kind);
  if (action === "edit-record") return recordEditor.open(active(), button.dataset.id);
  if (action === "quick-save") return saveQuickQuote(button.dataset.id);
  if (action === "quick-dismiss") { await adapter.dismissQuickQuote(button.dataset.id); await renderQuickQuotes(); return; }
  if (await transcripts.action(action, button)) return;
  if (action === "clear-supadata") { await adapter.clearTranscriptConfig(); $("#supadata-key").value = ""; $("#supadata-state").textContent = "Key 已移除"; return; }
  if (action === "start") return start();
  if (action === "storage" || action === "connect") return adapter.open(chrome.runtime.getURL("library.html?settings=1"));
  if (action === "library") return native ? openLibrary() : undefined;
  if (action === "review" && active()) { if (!native) return notice("演示笔记只保存在此浏览器中。安装插件后，这个入口会打开笔记库里对应的笔记。"); return openLibrary(activeId); }
  if (action === "refresh") { await refreshNotes(); notice("笔记库已更新。"); return; }
  if (action === "choose") return showChooser();
  if (action === "select-note") { const chosen = notes.find(n => n.id === button.dataset.id); if (chosen?.status === "inbox") { await mutate(chosen.id, "start_reading", {}); await refreshNotes(); } await selectNote(button.dataset.id); $("#chooser").close(); return; }
  if (action === "save") return saveDiscovery();
  if (action === "clip") return collect();
  if (action === "remove-quote") { delete draft.quote; keepDraft(); renderQuote(); return; }
  if (action === "return-source") { const url = active()?.sources[0]?.url; if (url) await adapter.open(url); await refreshPage(); return; }
  if (action === "status") { const note = active(); await mutate(note.id, "status", { status: note.status === "read" ? "reading" : "read" }); render(); notice(note.status === "read" ? "继续阅读这篇笔记。" : "已标记读完，可以随时回到笔记库查看。"); return; }
  if (action === "image") { $("#image-file").click(); return; }
  if (action === "remove-image") return removeImage(button.dataset.id);
  if (action === "preview-image") { const item = draft.attachments?.find(item => item.id === button.dataset.id); if (item) return viewImages([item], true); return; }
  if (action === "view-record-images") { const clip = imageRecord(button.dataset.id); if (clip?.images?.length) {
    const index = Math.max(0, Math.min(clip.images.length - 1, Number(button.dataset.imageIndex) || 0));
    return viewImages([...clip.images.slice(index), ...clip.images.slice(0, index)]);
  } return; }
  if (action === "settings") return showSettings();
  if (action === "clear-key") { await adapter.clearKey(); $("#api-key").value = ""; $("#key-state").textContent = "Key 已移除"; return; }
  if (action === "ai") return showAI();
  if (action === "generate") return generate();
  if (action === "save-ai") return saveAI();
  if (action === "replace-ai") return replaceAI();
}
async function run(task) {
  if (busy) return;
  const writing = isMarkdownFocused($("#thought"));
  busy = true; $("#thought").disabled = true;
  try { await task(); } catch (e) { notice(e.message || "操作失败，请重试。", true); }
  finally { busy = false; if (targetChanged) { keepDraft(); persistQueue.finally(() => location.reload()); } $("#thought").disabled = false; if (writing && !document.querySelector("dialog[open]")) $("#thought").focus({ preventScroll: true }); if (native) void consumeRecordEdit().catch(e => notice(e.message, true)); }
}
document.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const action = button.dataset.action;
  if (action === "close-dialog") { button.closest("dialog").close(); if (button.closest("dialog").id === "settings") $("#api-key").value = ""; return; }
  if (busy) return;
  if (action === "yt-connect" || action === "yt-enable-entry") {
    const permission = adapter.allowYoutube();
    run(async () => {
      if (!await permission) throw new Error("未开启 YouTube 连接。仍可阅读字幕；也可以在视频页点工具栏Clips图标，临时连接当前页面。");
      await adapter.youtubeEntry();
      await transcripts.reconnect();
      notice("YouTube 快捷入口已开启。视频右上角点「记一笔」即可引用当前片段。");
    }); return;
  }
  // permissions.request must run directly inside the user's click gesture.
  if (action === "save-supadata") {
    if (!native) return;
    const permission = adapter.allowTranscript();
    run(async () => {
      if (!await permission) throw new Error("未获准连接 Supadata，设置没有保存。");
      await adapter.saveTranscriptConfig({ key: $("#supadata-key").value, remember: $("#supadata-remember").checked });
      $("#supadata-key").value = ""; $("#supadata-state").textContent = "已配置 Key"; notice("Supadata 已配置，可以读取 YouTube 字幕。");
    }); return;
  }
  if (action === "save-settings") {
    if (!native) return;
    const permission = adapter.allowAI();
    run(async () => {
      if (!await permission) throw new Error("未获准连接 DeepSeek，设置没有保存。");
      await adapter.saveConfig({ model: $("#model").value, key: $("#api-key").value, remember: $("#remember").checked });
      $("#api-key").value = ""; $("#settings").close(); notice("DeepSeek 已配置，打开 AI 摘要即可使用。");
    });
    return;
  }
  run(() => execute(action, button));
});
$("#thought").addEventListener("input", () => { markWritingPage(); keepDraft(); renderRecordContext(); });
$("#ai-supplement").addEventListener("input", keepSummaryDraft);
$("#ai-source").addEventListener("change", () => { renderSourceHint(); keepSummaryDraft(); });
$("#ai-result").addEventListener("input", event => {
  if (event.target.id === "ai-output" && $("#ai-result").dataset.job) pendingWrite("aiOutput:" + $("#ai-result").dataset.job, event.target.value);
});
$("#image-file").addEventListener("change", () => {
  const files = [...$("#image-file").files]; $("#image-file").value = "";
  if (files.length) run(() => addImages(files));
});
$("#composer").addEventListener("paste", event => {
  const files = transferImages(event.clipboardData); if (!files.length) return;
  event.preventDefault();
  if (busy) { notice("正在处理上一条操作，请稍后再粘贴图片。", true); return; }
  const input = $("#thought"), selection = event.target === input ? { start: input.selectionStart, end: input.selectionEnd } : null;
  const text = event.clipboardData.getData("text/plain");
  run(() => addImages(files, text, selection));
});
$("#composer").addEventListener("dragover", event => { if ([...event.dataTransfer.types].includes("Files")) { event.preventDefault(); $("#composer").classList.add("image-dragover"); } });
$("#composer").addEventListener("dragleave", event => { if (!$("#composer").contains(event.relatedTarget)) $("#composer").classList.remove("image-dragover"); });
$("#composer").addEventListener("drop", event => {
  $("#composer").classList.remove("image-dragover");
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  if (busy) { notice("正在处理上一条操作，请稍后再拖入图片。", true); return; }
  run(() => addImages([...event.dataTransfer.files]));
});
$("#thought").addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(saveDiscovery); } });
$("#settings").addEventListener("close", () => { $("#api-key").value = ""; $("#supadata-key").value = ""; });
adapter.subscribe(type => {
  if (type === 'storage-target') { targetChanged = true; if (!busy) { keepDraft(); persistQueue.finally(() => location.reload()); } return; }
  if (type === "record-edit") consumeRecordEdit().catch(e => notice(e.message, true));
  if (type === "quick-quotes") { renderQuickQuotes().catch(e => notice(e.message, true)); refreshNotes().catch(e => notice(e.message, true)); }
  if (type === "page") refreshPage().catch(e => notice(e.message, true));
  if (type === "selection") notice("选中文字已暂存。点「摘下选中文字」把它加入当前笔记草稿。");
  if (type === "transcript-ai") transcripts.refresh().catch(e => notice(e.message, true));
  if (type === "ai") renderJob().catch(e => notice(e.message, true));
});
async function init() {
  $("#demo-label").hidden = native;
  if (native) storageTarget = await adapter.target();
  notes = await adapter.read("cachedNotes") || [];
  activeId = await adapter.read("activeNoteId");
  draft = activeId ? await adapter.read("draft:" + activeId) || {} : {};
  $("#thought").value = draft.thought || "";
  await refreshPage();
  if (!native || storageTarget) { try { await refreshNotes(); } catch (e) { notice(e.message, true); } } else renderConnection();
  if (await adapter.pending()) notice("有一段右键暂存的摘录。开始笔记后，点「摘下选中文字」加入草稿。");
  await restoreImageDraft(); render();
  await renderQuickQuotes();
  if (native) { adapter.youtubeEntry().catch(() => {}); await consumeRecordEdit(); }
}
init().catch(e => notice(e.message, true));

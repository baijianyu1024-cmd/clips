import { sentenceQuote, quoteRangeKey, quoteView } from "./quote-context.js";
import { needsChineseTranslation } from "./quote-translation.js";
import { youtubeId, youtubeUrl } from "./youtube.js";

export const QUICK_QUOTES = "youtubeQuickQuotes";
export function isYoutubePageSender(sender, extensionId) {
  let url; try { url = new URL(sender.url); } catch { return false; }
  return url.protocol === "https:" && ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) && url.pathname === "/watch" && sender.id === extensionId && Number.isInteger(sender.tab?.id) && sender.frameId === 0 && !!youtubeId(sender.url) && youtubeId(sender.url) === youtubeId(sender.tab.url);
}
export const contextQuote = sentenceQuote;

// Serialized writes, persisted clip IDs and exact destinations make retries safe.
export function createQuickQuoteService({ storage, cloud, readPlayer, translate }) {
  let queue = Promise.resolve();
  const serial = task => { const job = queue.catch(() => {}).then(task); queue = job; return job; };
  const list = async () => (await storage.get(QUICK_QUOTES))[QUICK_QUOTES] || [];
  async function put(item) {
    const all = await list(), pending = all.filter(x => x.id !== item.id && x.status !== "saved");
    const saved = all.filter(x => x.id !== item.id && x.status === "saved").slice(-19);
    await storage.set({ [QUICK_QUOTES]: [...saved, ...pending, item] });
  }
  const publicResult = item => ({ id: item.id, videoId: item.videoId, status: item.status, time: item.time, title: item.title, text: quoteView(item.clip).original, sourceLanguage: item.clip?.sourceLanguage || "", excerptBoundary: item.clip?.excerptBoundary, translation: item.clip?.translation || null, translationPending: !!item.requiresTranslation && item.clip?.translation?.scope !== "quote", url: youtubeUrl(item.videoId, item.time), warning: item.warning || "", error: item.error || "" });
  async function save(item, noteId) {
    try {
      let note = (await cloud({})).notes.find(n => n.id === noteId && !n.deletedAt && !n.archived);
      if (!note || !note.sources.some(s => youtubeId(s.url) === item.videoId)) throw new Error("请先在侧栏开始这篇视频笔记，再保存引用。");
      item.noteId = note.id;
      if (!item.clip) {
        const meta = note.transcripts?.find(t => t.videoId === item.videoId);
        if (!meta) { item.status = "needs-transcript"; item.error = "先打开侧栏，读取这篇视频的字幕，再保存引用。"; await put(item); return publicResult(item); }
        const data = await cloud({ path: `/api/transcripts?note=${note.id}&id=${meta.id}` });
        if (data.snapshot?.videoId !== item.videoId) throw new Error("字幕与当前视频不匹配，请重新打开字幕。");
        const quote = contextQuote(data.snapshot, item.time);
        const qt = quote && data.assist?.quoteTranslations?.[quoteRangeKey(quote.transcriptAnchor)];
        if (qt) quote.translation = { text: qt.text, model: qt.model, language: "zh-CN", scope: "quote" };
        if (!quote) throw new Error("当前时间点没有对应字幕，请在有字幕的位置重试。");
        item.requiresTranslation = needsChineseTranslation(quote.text, data.snapshot.language);
        item.clip = { id: item.id, ...quote, thought: "", sourceUrl: youtubeUrl(item.videoId), sourceTitle: item.title, createdAt: item.createdAt };
      }
      item.status = "saving"; item.error = ""; await put(item);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) note = (await cloud({})).notes.find(n => n.id === noteId && !n.deletedAt && !n.archived);
        if (!note) throw new Error("这篇笔记已移除，请到笔记库恢复后重试。");
        try { await cloud({ method: "PATCH", body: { id: noteId, revision: note.revision, action: "add_clip", clip: item.clip } }); break; }
        catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
      }
      item.status = "saved"; await put(item); return publicResult(item);
    } catch (e) { item.status = "error"; item.error = e.message || "保存失败，引用仍保留在本机。"; await put(item); return publicResult(item); }
  }
  async function finish(result) {
    const item = (await list()).find(x => x.id === result.id);
    if (!translate || result.status !== "saved" || !item?.requiresTranslation || item.clip?.translation?.scope === "quote") return result;
    try {
      const translated = await translate(item.noteId, item.id);
      return await serial(async () => { const current = (await list()).find(x => x.id === item.id); if (!current) return result; current.clip = translated.note.clips.find(c => c.id === item.id); current.warning = ""; await put(current); return publicResult(current); });
    } catch (e) {
      return await serial(async () => { const current = (await list()).find(x => x.id === item.id); if (!current) return result; current.warning = "原文已保存，中文译文待补齐。" + (e.message || "请重试。"); await put(current); return publicResult(current); });
    }
  }
  return {
    capture: (tab, requestId) => serial(async () => {
      if (!/^[a-f0-9-]{36}$/.test(requestId || "")) throw new Error("引用请求无效。");
      const existing = (await list()).find(x => x.id === requestId);
      if (existing) {
        if (existing.videoId !== youtubeId(tab.url)) throw new Error("视频已切换，请重新记一笔。");
        return existing.status === "saved" || !existing.noteId ? publicResult(existing) : save(existing, existing.noteId);
      }
      if ((await list()).filter(x => x.status !== "saved").length >= 20) throw new Error("有较多待保存引用，请先到侧栏处理。");
      const context = await readPlayer(tab);
      if (!context.available) throw new Error(context.reason === "ad" ? "广告结束后再记一笔。" : "请等待视频就绪后再记一笔。");
      const item = { id: requestId, videoId: youtubeId(tab.url), title: String(tab.title || "YouTube 视频").replace(/^\(\d+\)\s*/, "").replace(/\s*- YouTube$/, "").slice(0, 200), time: context.time, createdAt: new Date().toISOString(), status: "needs-note" };
      // Persist before network work. Never overwrite the existing composer draft.
      await put(item);
      try {
        const pinned = (await storage.get("activeNoteId")).activeNoteId;
        const note = (await cloud({})).notes.find(n => n.id === pinned && !n.deletedAt && !n.archived && n.sources.some(s => youtubeId(s.url) === item.videoId));
        return note ? save(item, note.id) : publicResult(item);
      } catch (e) { item.status = "error"; item.error = e.message; await put(item); return publicResult(item); }
    }).then(finish),
    complete: (id, noteId) => serial(async () => { const item = (await list()).find(x => x.id === id); if (!item) throw new Error("找不到这条待存引用。"); return item.status === "saved" ? publicResult(item) : save(item, item.noteId || noteId); }).then(finish),
    editTarget: async (id, videoId) => {
      const item = (await list()).find(x => x.id === id && x.videoId === videoId && x.status === "saved" && x.noteId);
      if (!item) throw new Error("请到侧栏的随读记录中点击编辑。");
      return { noteId: item.noteId, clipId: item.id, requestId: crypto.randomUUID() };
    },
    dismiss: id => serial(async () => { await storage.set({ [QUICK_QUOTES]: (await list()).filter(x => x.id !== id) }); }),
  };
}

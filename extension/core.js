import { SUMMARY_GUIDANCE } from "./summary-policy.js";
import { youtubeId, youtubeUrl } from "./youtube.js";
import { normalizeSourceUrl, sourceUrlKey } from "./link-metadata.js";
export const SITE = "";
export const MAX_INPUT = 40000;
export const emptyState = () => ({ activeNoteId: null, drafts: {}, aiDrafts: {}, pendingCreates: {} });
export const canonical = normalizeSourceUrl;
export const matches = (note, url) => !!sourceUrlKey(url) && note.sources.some(s => sourceUrlKey(s.url) === sourceUrlKey(url));
export const findNote = (notes, url) => notes.filter(n => !n.deletedAt && !n.archived && matches(n, url)).sort((a, b) => Number(a.status === "inbox") - Number(b.status === "inbox") || (a.createdAt || "").localeCompare(b.createdAt || "") || a.id.localeCompare(b.id))[0];
// Only called by an explicit Start action, never by tab navigation.
export async function startPageNote(adapter, page) {
  const url = canonical(page.url);
  if (!url) throw new Error("请先打开一篇文章或视频。");
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = findNote((await adapter.cloud({})).notes, url);
    if (existing) {
      try { return (await adapter.cloud({ method: "PATCH", body: { id: existing.id, revision: existing.revision, action: "start_reading", sourceUrl: url, title: (page.title || "").slice(0, 200) } })).note; }
      catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
    } else {
      const key = "create:" + url, id = await adapter.read(key) || crypto.randomUUID();
      await adapter.write(key, id);
      const note = (await adapter.cloud({ method: "POST", body: { id, fields: createFields(page) } })).note;
      await adapter.remove(key);
      if (note.deletedAt || note.archived) continue;
      return note;
    }
  }
  throw new Error("笔记刚刚有更新，请再点一次开始阅读。");
}
// Browsing metadata is never allowed to change the pinned note or create a record.
export function navigate(state, page) { return { ...state, page }; }
export function pin(state, noteId) { return { ...state, activeNoteId: noteId }; }
export function setDraft(state, noteId, draft) { return { ...state, drafts: { ...state.drafts, [noteId]: draft } }; }
export function createFields(page) {
  if (!canonical(page.url)) throw new Error("请在普通文章或视频网页中开始笔记。");
  return { title: (page.title || new URL(page.url).hostname).slice(0, 200), summary: "", thought: "", sources: [{ url: canonical(page.url), label: (page.title || "").slice(0, 100) }], kind: /youtube\.com|youtu\.be|bilibili\.com/.test(new URL(page.url).hostname) ? "video" : "article", tags: [], timestamp: "", published: "", images: [], status: "reading", clips: [], aiSummaries: [], readingPosition: null };
}
export function aiConfig(input) {
  const url = new URL(input.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Base URL 需要是 HTTPS 地址，且不包含账号、参数或密钥。");
  const baseUrl = url.href.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(baseUrl)) throw new Error("请填写 Base URL，末尾不要包含 /chat/completions。");
  const model = String(input.model || "").trim();
  if (!model || model.length > 200) throw new Error("请填写服务商提供的模型名称。");
  return { baseUrl, model, provider: String(input.provider || url.hostname).slice(0, 100), origin: url.origin + "/*" };
}
export function coreMaterial(note, captured = null, supplement = "") {
  const records = [
    note.summary && `此前的摘录与要点：\n${note.summary}`,
    note.thought && `我的想法：\n${note.thought}`,
    ...(note.clips || []).map((c, i) => `记录 ${i + 1}（来源：${c.sourceTitle || c.sourceUrl || "未注明"}）：\n${c.text ? `原文摘录：\n${c.text}\n` : ""}${c.translation?.text ? `摘录译文：\n${c.translation.text}\n` : ""}${c.thought ? `我的想法：\n${c.thought}` : ""}`),
    ...(note.reviews || []).filter(r => r.text?.trim()).map((r, i) => `后来的理解 ${i + 1}：\n${r.text}`),
  ].filter(Boolean).join("\n\n");
  const body = captured?.text?.trim() || "";
  const images = captured?.images || [];
  if (!body && !records && !images.length) {
    if (supplement.trim()) return { text: "", scope: "仅使用我的补充", images: [], sourceUrl: captured?.url || note.sources[0]?.url, purpose: "core" };
    throw new Error("暂无可整理的材料。可以填写「我的补充」，或回到原文后重试。");
  }
  const notesLimit = body ? 16000 : 39000;
  const notePart = records.slice(0, notesLimit) || "（尚无随读记录）";
  const prefix = "【文章可读正文】\n", divider = "\n\n【我的记录：摘录、想法与后来的理解】\n";
  const bodyLimit = MAX_INPUT - prefix.length - divider.length - notePart.length;
  const bodyPart = body ? body.slice(0, bodyLimit) : images.length ? "（本次仅有图片材料与下方记录，不能当作全文摘要）" : "（未读取正文；只能整理下方记录，不能当作全文摘要）";
  const limited = captured?.status === "partial" || !!captured?.truncated || body.length > bodyLimit || records.length > notesLimit;
  const base = body ? `${records ? "网页可读正文 + 随读记录" : "网页可读正文（尚无随读记录）"}${limited ? "（仅部分内容或材料有截断）" : "（请确认正文完整性）"}` : images.length ? "图片材料 + 随读记录，未读取正文" : `仅随读记录，未读取正文${limited ? "（记录有截断）" : ""}`;
  const scope = base + (images.length ? ` · ${images.length} 张图片／画板` : "") + (captured?.reason ? ` · ${captured.reason}` : "");
  return { text: prefix + bodyPart + divider + notePart, scope, images, sourceUrl: captured?.url || note.sources[0]?.url, purpose: "core" };
}
export function buildPrompt(text, scope, title, purpose = "summary", supplement = "") {
  if (!text.trim() && !supplement.trim()) throw new Error("请先提供阅读材料或填写「我的补充」。");
  if (supplement.length > MAX_INPUT) throw new Error("我的补充最多 40,000 字。");
  if (text.length > MAX_INPUT) throw new Error("本次内容最多 40,000 字，请选取其中一部分。");
  return [{ role: "system", content: SUMMARY_GUIDANCE }, { role: "user", content: JSON.stringify({ title, scope, reading_material: text, ...(supplement.trim() ? { reader_supplement: supplement.trim() } : {}) }) }];
}
export function summaryRecord(job, text) {
  if (!text.trim()) throw new Error("服务没有返回摘要正文，请重试或更换模型。");
  return { id: job.id, text: text.slice(0, 40000), provider: job.provider, model: job.model, scope: job.scope, sourceUrl: job.sourceUrl, createdAt: job.createdAt };
}
export function timeLabel(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }

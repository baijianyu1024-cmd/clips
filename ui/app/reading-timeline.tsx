"use client";
import {request, draftStorage, MediaImage} from "./client-runtime";
import Markdown, { MarkdownHelp, MarkdownTextarea } from "./markdown";

import { useEffect, useRef, useState } from "react";
import { Check, Clock3, ImagePlus, Loader2, Pencil, Plus, X } from "lucide-react";
import { quoteView } from "@/extension/quote-context.js";
import { youtubeId, youtubeUrl } from "@/extension/youtube.js";
import { imageSchema, type Note } from "./model";
import "./note-content.css";

type Image = Note["images"][number];
type Entry = { id: string; at?: string; type: "legacy" } | { id: string; at?: string; type: "clip"; clip: Note["clips"][number] } | { id: string; at?: string; type: "image"; image: Image };
type Draft = { target: string; id: string; text: string; thought: string; images: Image[]; revision: number; sourceUrl: string; sourceTitle: string };
const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const stamp = (value: string) => new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const sameImages = (a: Image[], b: Image[]) => a.map(i => i.key).join() === b.map(i => i.key).join();

export default function ReadingTimeline({ note, onUpdate, onPreview, onAnchor, editTarget, onClose }: { note: Note; onUpdate: (note: Note) => void; onPreview: (key: string) => void; onAnchor: (clip: Note["clips"][number]) => void; editTarget?: string; onClose?: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const draftKey = `shiye-reading-draft:${note.id}`;
  const readOnly = !!(note.deletedAt || note.archived || note.status === "inbox");
  function fresh(target = "new"): Draft {
    const clip = note.clips.find(c => c.id === target);
    const image = note.images.find(i => `image:${i.key}` === target);
    return { target, id: crypto.randomUUID(), text: target === "legacy" ? note.summary : clip?.text || "", thought: target === "legacy" ? note.thought : clip?.thought || "", images: target === "legacy" ? note.legacyRecordImages || [] : image ? [image] : clip?.images || [], revision: note.revision, sourceUrl: note.sources[0]?.url || "", sourceTitle: note.sources[0]?.label || note.title };
  }
  useEffect(() => {
    try {
      const stored = JSON.parse(draftStorage.getItem(draftKey) || "null");
      let restored: Draft | null = null;
      if (stored && typeof stored.target === "string" && typeof stored.id === "string" && typeof stored.text === "string" && typeof stored.thought === "string" && typeof stored.sourceUrl === "string" && typeof stored.sourceTitle === "string" && Number.isInteger(stored.revision)) restored = { ...stored, images: imageSchema.array().max(30).parse(stored.images || []) };
      // Recover uploads left pending by the earlier, separate screenshot entry.
      const pendingKey = `shiye-reading-image:${note.id}`;
      const pending = JSON.parse(draftStorage.getItem(pendingKey) || "null");
      if (pending) {
        const image = imageSchema.parse(pending);
        restored ||= fresh();
        if (!restored.images.some(i => i.key === image.key)) restored.images.push(image);
        draftStorage.setItem(draftKey, JSON.stringify(restored));
        draftStorage.removeItem(pendingKey);
      }
      if (!restored && editTarget) restored = fresh(editTarget);
      if (restored) { draftRef.current = restored; setDraft(restored); setExpanded(true); }
    } catch { setStorageError(true); }
    if (editTarget && !draftRef.current) { const initial = fresh(editTarget); draftRef.current = initial; setDraft(initial); setExpanded(true); }
    return () => uploadController.current?.abort();
  }, [draftKey]);
  function keep(next: Draft) {
    draftRef.current = next; setDraft(next);
    try { draftStorage.setItem(draftKey, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }
  function clear() { draftRef.current = null; setDraft(null); setExpanded(false); setConflict(false); setError(""); try { draftStorage.removeItem(draftKey); } catch { setStorageError(true); } onClose?.(); }
  function edit(target: string) {
    if (readOnly || busy) return;
    if (draft && draft.target !== target) { setExpanded(true); setError("还有一份未保存的修改，请先保存或放弃，再修改另一条记录。"); return; }
    if (!draft) keep(fresh(target));
    setExpanded(true); setError("");
  }
  async function latest() {
    const r = await request("/api/notes", { cache: "no-store" });
    if (!r.ok) throw new Error("暂时连接不到笔记库，请稍后重试。");
    const n = ((await r.json()) as { notes: Note[] }).notes.find(n => n.id === note.id);
    if (!n) throw new Error("找不到这篇笔记。");
    return n;
  }
  async function change(payload: object, revision?: number): Promise<Note> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const n = revision === undefined ? await latest() : note;
      const r = await request("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, revision: revision ?? n.revision, ...payload }) });
      const data = await r.json() as { note: Note; error?: string };
      if (r.ok) { onUpdate(data.note); return data.note; }
      if (r.status === 409) {
        if (revision === undefined && attempt < 2) continue;
        onUpdate(await latest()); setConflict(true);
        throw new Error("这篇笔记刚有更新，草稿仍在。请对照当前内容后再保存。");
      }
      throw new Error(data.error || "保存没有完成，请重试。");
    }
    throw new Error("笔记正在更新，请稍后重试。草稿仍在。");
  }
  async function save() {
    if (!draft || lock.current || readOnly || conflict || !(draft.text.trim() || draft.thought.trim() || draft.images.length)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const isImage = draft.target.startsWith("image:");
      if (draft.target === "new" || isImage) {
        const record = { id: draft.id, text: draft.text, thought: draft.thought, images: draft.images };
        const saved = isImage
          ? await change({ action: "edit_image_record", imageKey: draft.target.slice(6), record }, draft.revision)
          : await change({ action: "add_clip", clip: { ...record, sourceUrl: draft.sourceUrl, sourceTitle: draft.sourceTitle, createdAt: new Date().toISOString(), videoTime: null } });
        const recorded = saved.clips.find(c => c.id === draft.id);
        if (recorded?.text !== draft.text.trim() || recorded?.thought !== draft.thought.trim() || !sameImages(recorded?.images || [], draft.images)) {
          keep({ ...draft, target: draft.id, revision: saved.revision }); setConflict(true);
          throw new Error("上次记录已经保存，之后的修改仍在草稿中。请对照后再次保存。");
        }
      } else await change({ action: "edit_record", record: { id: draft.target, text: draft.text, thought: draft.thought, images: draft.images } }, draft.revision);
      clear();
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function upload(files: File[]) {
    if (readOnly || lock.current || !files.length || !draftRef.current) return;
    if (draftRef.current.images.length + files.length > 30) { setError("一条记录最多放 30 张图片。"); return; }
    const controller = new AbortController(); uploadController.current = controller;
    lock.current = true; setBusy(true); setError("");
    try {
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8 MB。");
        const form = new FormData(); form.append("file", file);
        const r = await request("/api/media", { method: "POST", body: form, signal: controller.signal });
        const data = await r.json() as { image: unknown; error?: string };
        if (!r.ok) throw new Error(data.error || "图片上传失败，请重试。");
        if (!controller.signal.aborted && draftRef.current) keep({ ...draftRef.current, images: [...draftRef.current.images, imageSchema.parse(data.image)] });
      }
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { uploadController.current = null; lock.current = false; if (!controller.signal.aborted) setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  function gallery(images: Image[], editable = false) {
    return images.length > 0 && <div className="record-images">{images.map(img => <div key={img.key}><button type="button" className="reading-event-image" aria-label={`放大图片：${img.name}`} onClick={() => onPreview(img.key)}><MediaImage loading="lazy" src={`/api/media?key=${encodeURIComponent(img.key)}`} alt={img.name}/></button>{editable && <button type="button" className="core-image-remove" disabled={busy} aria-label={`移除记录图片：${img.name}`} onClick={() => draft && keep({ ...draft, images: draft.images.filter(i => i.key !== img.key) })}><X size={14}/></button>}</div>)}</div>;
  }
  const viewQuote = (clip: Note["clips"][number]) => quoteView(clip, note.transcripts?.find(t => t.id === clip.transcriptAnchor?.snapshotId)?.language);
  function content(entry: Entry) {
    const text = entry.type === "legacy" ? note.summary : entry.type === "clip" ? viewQuote(entry.clip).original : "";
    const thought = entry.type === "legacy" ? note.thought : entry.type === "clip" ? entry.clip.thought : "";
    const images = entry.type === "legacy" ? note.legacyRecordImages || [] : entry.type === "clip" ? entry.clip.images || [] : [entry.image];
    return <>{text && <blockquote className="prose"><Markdown>{text}</Markdown></blockquote>}{entry.type === "clip" && viewQuote(entry.clip).pending && <p className="reading-log-empty">中文译文待补齐，可在插件中点击「补译中文」。</p>}{entry.type === "clip" && viewQuote(entry.clip).translation && entry.clip.translation && <div className="clip-translation"><span className="clip-label">AI 译文 · {entry.clip.translation.model}</span><Markdown className="prose">{entry.clip.translation.text}</Markdown></div>}{thought && <>{text && <span className="clip-label">我的想法</span>}<Markdown className="prose clip-thought">{thought}</Markdown></>}{gallery(images)}{entry.type === "clip" && <div className="clip-origin">{entry.clip.sourceUrl && <a href={youtubeId(entry.clip.sourceUrl) && entry.clip.videoTime !== null ? youtubeUrl(youtubeId(entry.clip.sourceUrl), entry.clip.videoTime) : entry.clip.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.clip.sourceTitle || domain(entry.clip.sourceUrl)}{entry.clip.videoTime !== null && ` · ${Math.floor(entry.clip.videoTime / 60)}:${String(Math.floor(entry.clip.videoTime % 60)).padStart(2, "0")}`} ↗</a>}{(entry.clip.anchor || entry.clip.transcriptAnchor) && <button className="clip-anchor-link" onClick={() => onAnchor(entry.clip)}>{entry.clip.transcriptAnchor ? "查看字幕上下文" : "回到这段原文 ↗"}</button>}</div>}</>;
  }
  function editor(target: string, entry?: Entry) {
    if (!expanded || !draft || draft.target !== target || readOnly) return null;
    const translatedOnly = entry?.type === "clip" && viewQuote(entry.clip).language === "other";
    return <form className="reading-inline-editor" onPaste={e => { const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); void upload(files); } }} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)); } }} onSubmit={e => { e.preventDefault(); void save(); }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}>
      {translatedOnly ? <div className="clip-translation"><span className="clip-label">中文引用 · AI 译文</span><Markdown className="prose">{entry?.type === "clip" ? viewQuote(entry.clip).translation || "中文译文待补齐" : ""}</Markdown></div> : <label><span>原文摘录 <small>选填</small></span><MarkdownTextarea aria-label="原文摘录内容" rows={3} maxLength={target === "legacy" ? 40000 : 20000} value={draft.text} disabled={busy} onChange={e => keep({ ...draft, text: e.target.value })} placeholder="留下有触动的那句话…"/></label>}
      <label><span>我的想法 <small>文字、图片都可以</small></span><MarkdownTextarea aria-label="我的想法内容" rows={3} maxLength={target === "legacy" ? 40000 : 20000} value={draft.thought} disabled={busy} onChange={e => keep({ ...draft, thought: e.target.value })} placeholder="添加想法…"/></label>
      <MarkdownHelp/>{gallery(draft.images, true)}
      <button type="button" className="image-upload record-image-upload" disabled={busy || draft.images.length >= 30} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 size={15} className="spin"/> : <ImagePlus size={15}/>}添加图片<span>也可粘贴或拖入 · 单张不超过 8 MB</span></button>
      <input ref={fileRef} type="file" aria-label="添加记录图片" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={e => void upload(Array.from(e.target.files || []))}/>
      {!translatedOnly && note.clips.some(c => c.id === target && (c.anchor || c.transcriptAnchor)) && <small>改动摘录文字后，将移除原文位置与对应译文。</small>}
      {conflict && <div className="field-error">笔记有更新，草稿仍然保留。{entry && <details className="edit-comparison"><summary>查看当前保存的记录</summary>{content(entry)}</details>}<button type="button" className="text-button" onClick={() => { keep({ ...draft, revision: note.revision }); setConflict(false); setError(""); }}>已对照，继续保存这份草稿</button></div>}
      <div className="reading-editor-actions"><small>{storageError ? "暂存失败，请先保存" : "已自动暂存"}</small><button type="button" className="text-button" disabled={busy} onClick={() => { setExpanded(false); onClose?.(); }}>收起</button><button type="button" className="text-button" disabled={busy} onClick={() => { if (window.confirm("放弃这条记录未保存的修改？")) clear(); }}>放弃修改</button><button className="primary compact" disabled={busy || conflict || !(draft.text.trim() || draft.thought.trim() || draft.images.length)}>{busy ? <Loader2 size={14} className="spin"/> : <Check size={14}/>}保存记录</button></div>
    </form>;
  }
  const entries: Entry[] = [
    ...(note.summary || note.thought || note.legacyRecordImages?.length ? [{ id: "legacy", at: note.createdAt, type: "legacy" as const }] : []),
    ...note.clips.map(clip => ({ id: clip.id, at: clip.undated ? undefined : clip.createdAt, type: "clip" as const, clip })),
    ...note.images.map(image => ({ id: `image:${image.key}`, at: image.createdAt, type: "image" as const, image })),
  ];
  entries.sort((a, b) => a.at && b.at ? Date.parse(a.at) - Date.parse(b.at) : a.at ? -1 : b.at ? 1 : 0);
  if (editTarget) return <section className="library-inline-editor" aria-label="编辑记录">{error && <p className="field-error" role="alert">{error}</p>}{draft && draft.target !== editTarget && <p className="field-error">这篇笔记有未保存的草稿，请先处理这份草稿。</p>}{draft && editor(draft.target, entries.find(e => e.id === draft.target))}</section>;
  return <section className="reading-log" aria-label="随读记录">
    <div className="section-heading"><h3>随读记录</h3><span>按记录时间 · 从早到晚</span></div>
    {!readOnly && <div className="reading-tools"><button className="text-button" disabled={busy} onClick={() => edit(draft?.target || "new")}><Plus size={14}/>{draft ? "继续编辑" : "记一笔"}</button></div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {editor("new")}
    {draft && draft.target !== "new" && !entries.some(e => e.id === draft.target) && editor(draft.target)}
    {note.timestamp && <div className="timestamp"><Clock3 size={14}/>关键时间点 <strong>{note.timestamp}</strong></div>}
    <ol className="reading-timeline">{entries.map(e => {
      const editing = expanded && draft?.target === e.id && !readOnly;
      return <li className="reading-event" key={e.id}><span className="reading-event-dot" aria-hidden="true"/>
        <div className="reading-event-meta">{e.at ? <time dateTime={e.at}>{stamp(e.at)}</time> : <span>时间未记录</span>}<span>{e.type === "legacy" ? "此前留下的记录" : e.type === "image" ? "截图" : e.clip.text ? viewQuote(e.clip).language === "other" ? "中文引用" : "原文摘录" : "记录"}</span>{!readOnly && !editing && <button className="text-button record-edit" disabled={busy} aria-label={`修改记录：${e.at ? stamp(e.at) : "截图"}`} onClick={() => edit(e.id)}><Pencil size={12}/>修改</button>}</div>
        {editing ? editor(e.id, e) : content(e)}
      </li>;
    })}</ol>
    {!entries.length && !expanded && <div className="reading-log-empty">还没有随读记录。读到有启发的地方，可以留下文字、图片，或把它们放在一起。</div>}
  </section>;
}

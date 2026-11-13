"use client";
import {request, draftStorage, MediaImage} from "./client-runtime";
import Markdown, { MarkdownHelp, MarkdownTextarea } from "./markdown";

import { useEffect, useRef, useState } from "react";
import { Check, FileText, ImagePlus, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { imageSchema, type CoreSummary, type Note } from "./model";
import "./note-content.css";

type Draft = { id: string; text: string; images: CoreSummary["images"]; baseId: string | null };
const imageUrl = (key: string) => `/api/media?key=${encodeURIComponent(key)}`;
export default function CoreSummarySection({ note, onUpdate, onPreview, editorOnly, onClose }: { note: Note; onUpdate: (note: Note) => void; onPreview: (key: string) => void; editorOnly?: boolean; onClose?: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const lock = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const key = `shiye-core-summary:${note.id}`;
  const current = note.coreSummary;
  const readOnly = !!(note.deletedAt || note.archived || note.status === "inbox");
  const showEditor = editing && !readOnly;
  const conflict = !!draft && draft.baseId !== (current?.id || null);
  useEffect(() => {
    try {
      const stored = JSON.parse(draftStorage.getItem(key) || "null");
      const uuid = /^[\da-f-]{36}$/i;
      if (stored && typeof stored.text === "string" && uuid.test(stored.id) && (stored.baseId === null || uuid.test(stored.baseId))) {
        const images = imageSchema.array().max(30).parse(stored.images ?? (stored.baseId === (current?.id || null) ? current?.images || [] : []));
        const restored = { ...stored, images }; draftRef.current = restored; setDraft(restored); setEditing(true);
      }
    } catch { setStorageError(true); }
    if (editorOnly) edit();
    return () => { uploadController.current?.abort(); };
  }, [key]);
  function keep(next: Draft) {
    draftRef.current = next; setDraft(next);
    try { draftStorage.setItem(key, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }
  function edit() {
    if (!draftRef.current) keep({ id: crypto.randomUUID(), text: current?.text || "", images: current?.images || [], baseId: current?.id || null });
    setEditing(true); setError("");
  }
  async function upload(files: File[]) {
    if (readOnly || lock.current || uploadController.current || !files.length) return;
    edit();
    if ((draftRef.current?.images.length || 0) + files.length > 30) { setError("核心摘要最多放 30 张图片。"); return; }
    const controller = new AbortController(); uploadController.current = controller; setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8 MB。");
        const form = new FormData(); form.append("file", file);
        const res = await request("/api/media", { method: "POST", body: form, signal: controller.signal });
        const data = await res.json() as { error?: string; image: unknown };
        if (!res.ok) throw new Error(data.error || "图片上传失败，请重试。");
        if (!controller.signal.aborted && draftRef.current) keep({ ...draftRef.current, images: [...draftRef.current.images, imageSchema.parse(data.image)] });
      }
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (!controller.signal.aborted) setUploading(false); uploadController.current = null; if (fileRef.current) fileRef.current.value = ""; }
  }
  async function save() {
    if (!draft || !(draft.text.trim() || draft.images.length) || readOnly || lock.current || uploading || conflict) return;
    lock.current = true; setSaving(true); setError("");
    try {
      const summary: CoreSummary = { id: draft.id, text: draft.text.trim(), images: draft.images, origin: current?.origin || "manual", scope: current?.scope || "手动撰写", provider: current?.provider || "", model: current?.model || "", sourceUrl: current?.sourceUrl, createdAt: new Date().toISOString(), edited: !!current };
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await request("/api/notes", { cache: "no-store" });
        if (!response.ok) throw new Error("暂时连接不到笔记库，草稿仍会保留。");
        const latest = ((await response.json()) as { notes: Note[] }).notes.find(n => n.id === note.id);
        if (!latest) throw new Error("找不到这篇笔记，草稿仍会保留。");
        const res = await request("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, revision: latest.revision, action: "set_core_summary", expectedCoreSummaryId: draft.baseId, coreSummary: summary }) });
        const result = await res.json() as { note: Note; error?: string };
        if (!res.ok) {
          onUpdate(latest);
          if (res.status === 409 && (latest.coreSummary?.id || null) === draft.baseId && attempt < 2) continue;
          throw new Error(result.error || "摘要没有保存成功，请重试。草稿仍会保留。");
        }
        onUpdate(result.note);
        if (result.note.coreSummary?.id !== summary.id || result.note.coreSummary.text !== summary.text || JSON.stringify(result.note.coreSummary.images) !== JSON.stringify(summary.images)) {
          keep({ ...draft, id: crypto.randomUUID() });
          throw new Error("上次保存已完成，但摘要后来有了新版本。当前草稿仍保留，请先对照当前保存的摘要。");
        }
        draftRef.current = null; setDraft(null); setEditing(false);
        try { draftStorage.removeItem(key); } catch { setStorageError(true); }
        onClose?.(); break;
      }
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setSaving(false); }
  }
  function gallery(images: CoreSummary["images"]) {
    return images.length > 0 && <div className="core-summary-images">{images.map(img => <button type="button" key={img.key} aria-label={`放大图片：${img.name}`} onClick={() => onPreview(img.key)}><MediaImage loading="lazy" src={imageUrl(img.key)} alt={img.name}/></button>)}</div>;
  }
  return <section className="core-summary" aria-label="核心摘要">
    <header><h3>核心摘要</h3>{!readOnly && <div>{!editing && <button className="text-button" onClick={edit} disabled={saving || uploading}><Pencil size={13}/>{draft ? "继续修改" : current ? "修改" : "自己写"}</button>}<button className="text-button" aria-expanded={showAI} onClick={() => setShowAI(!showAI)}><Sparkles size={13}/>{current ? "AI 重新整理" : "用 AI 生成"}</button></div>}</header>
    {!showEditor && current ? <><Markdown className="core-summary-text prose">{current.text}</Markdown>{gallery(current.images)}<div className="core-summary-meta"><span>{current.origin === "ai" ? `AI 辅助 · ${current.provider}` : "手动撰写"}{current.origin === "ai" && current.edited ? " · 已手动修改" : ""}</span><time>{new Date(current.createdAt).toLocaleDateString("zh-CN")} 更新</time>{current.scope !== "手动撰写" && <span>{current.scope}</span>}</div></> : !showEditor && <div className="core-summary-empty"><p>暂无摘要</p></div>}
    {showAI && <div className="core-ai-help"><p>在原文页打开 Clips，点击「核心摘要」。可读取的文字、图片和随读记录用于生成，确认保存后同步到这里。</p>{note.sources.length > 0 && <a href={note.sources[0].url} target="_blank" rel="noopener noreferrer">打开原文 ↗</a>}</div>}
    {showEditor && <form className="core-summary-editor" onSubmit={e => { e.preventDefault(); void save(); }} onPaste={e => { const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); void upload(files); } }} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)); } }}>
      <MarkdownTextarea id={`core-summary-${note.id}`} aria-label="核心摘要内容" rows={6} maxLength={40000} value={draft?.text || ""} disabled={saving} placeholder="添加核心摘要…" onChange={e => draft && keep({ ...draft, text: e.target.value })} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}/>
      <MarkdownHelp/>{!!draft?.images.length && <div className="core-image-drafts">{draft.images.map(img => <div key={img.key}><button type="button" className="core-image-preview" aria-label={`放大图片：${img.name}`} onClick={() => onPreview(img.key)}><MediaImage src={imageUrl(img.key)} alt={img.name}/></button><button type="button" className="core-image-remove" disabled={saving || uploading} aria-label={`移除摘要图片：${img.name}`} onClick={() => keep({ ...draft, images: draft.images.filter(i => i.key !== img.key) })}><X size={14}/></button></div>)}</div>}
      <button type="button" className="image-upload core-image-upload" onClick={() => fileRef.current?.click()} disabled={saving || uploading || (draft?.images.length || 0) >= 30}>{uploading ? <Loader2 className="spin" size={16}/> : <ImagePlus size={16}/>} {uploading ? "正在上传图片…" : "添加图片"}<span>也可粘贴或拖入 · 单张不超过 8 MB</span></button>
      <input ref={fileRef} type="file" aria-label="添加摘要图片" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={e => void upload(Array.from(e.target.files || []))}/>
      {conflict && <div className="field-error">摘要有了新版本，草稿仍在。{current && <details className="edit-comparison"><summary>查看当前保存的摘要</summary><Markdown className="prose">{current.text}</Markdown>{gallery(current.images)}</details>}<button type="button" className="text-button" onClick={() => { if (draft) keep({ ...draft, id: crypto.randomUUID(), baseId: current?.id || null }); setError(""); }}>我已对照，继续保存这份草稿</button></div>}
      <div className="core-edit-actions"><small>{storageError ? "暂存失败，请先保存" : "已自动暂存"}</small><button type="button" className="text-button" disabled={saving || uploading} onClick={() => { setEditing(false); onClose?.(); }}>收起</button><button className="primary compact" disabled={saving || uploading || !(draft?.text.trim() || draft?.images.length) || conflict}>{saving ? <Loader2 size={14} className="spin"/> : <Check size={14}/>}保存摘要</button></div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>}
    {note.coreSummaryHistory.length > 0 && <details className="core-summary-history"><summary>之前的摘要 · {note.coreSummaryHistory.length} 个版本</summary>{[...note.coreSummaryHistory].reverse().map(s => <details key={s.id}><summary>{new Date(s.createdAt).toLocaleString("zh-CN")} · {s.origin === "ai" ? "AI 辅助" : "手动撰写"}</summary><Markdown className="prose">{s.text}</Markdown>{gallery(s.images)}</details>)}</details>}
  </section>;
}

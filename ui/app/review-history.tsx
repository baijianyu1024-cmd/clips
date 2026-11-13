"use client";
import {request, draftStorage} from "./client-runtime";
import Markdown, { MarkdownHelp, MarkdownTextarea } from "./markdown";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import type { Note } from "./model";

type Draft = { id: string; text: string; revision: number };
export default function ReviewHistory({ note, onUpdate, editId, onClose }: { note: Note; onUpdate: (note: Note) => void; editId?: string; onClose?: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const lock = useRef(false);
  const key = `shiye-review-edit:${note.id}`;
  const readOnly = !!(note.deletedAt || note.archived || note.status === "inbox");
  useEffect(() => {
    try {
      const stored = JSON.parse(draftStorage.getItem(key) || "null");
      if (stored && typeof stored.id === "string" && typeof stored.text === "string" && Number.isInteger(stored.revision)) { setDraft(stored); setEditing(true); }
      else if (editId) { setDraft({ id: editId, text: note.reviews.find(r => r.id === editId)?.text || "", revision: note.revision }); setEditing(true); }
    } catch { setStorageError(true); if (editId) { setDraft({ id: editId, text: note.reviews.find(r => r.id === editId)?.text || "", revision: note.revision }); setEditing(true); } }
  }, [key]);
  function keep(next: Draft) { setDraft(next); try { draftStorage.setItem(key, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); } }
  function clear() { setDraft(null); setEditing(false); setConflict(false); setError(""); try { draftStorage.removeItem(key); } catch { setStorageError(true); } onClose?.(); }
  function edit(id: string) {
    if (draft && draft.id !== id) { setEditing(true); setError("请先保存或放弃正在修改的理解，再编辑另一条。"); return; }
    if (!draft) keep({ id, text: note.reviews.find(r => r.id === id)?.text || "", revision: note.revision });
    setEditing(true); setError("");
  }
  async function save() {
    if (!draft || lock.current || conflict || readOnly) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const r = await request("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, revision: draft.revision, action: "edit_review", reviewId: draft.id, text: draft.text }) });
      const result = await r.json() as { note: Note; error?: string };
      if (r.ok) { onUpdate(result.note); clear(); return; }
      if (r.status === 409) {
        const response = await request("/api/notes", { cache: "no-store" });
        if (!response.ok) throw new Error("暂时无法读取最新笔记，草稿仍在。");
        const latest = ((await response.json()) as { notes: Note[] }).notes.find(n => n.id === note.id);
        if (!latest) throw new Error("找不到这篇笔记，草稿仍在。");
        onUpdate(latest);
        if (latest.reviews.find(review => review.id === draft.id)?.text === draft.text.trim()) { clear(); return; }
        setConflict(true);
      }
      throw new Error(result.error || "没有保存成功，草稿仍在。");
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!note.reviews.length) return null;
  return <section className="review-history" aria-label="后来的理解"><div className="section-heading"><h3>后来的理解</h3><span>{note.reviews.length} 条补充</span></div>
    {error && <p className="field-error" role="alert">{error}</p>}{editId && draft && draft.id !== editId && <p className="field-error">这篇笔记有未保存的理解，请先处理这份草稿。</p>}
    {note.reviews.filter(r => !editId || r.id === (draft?.id || editId)).map(r => <div className="timeline-entry" key={r.id}><div className="timeline-dot"/><div className="review-entry-meta"><time>{new Date(r.createdAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}</time>{!readOnly && !(editing && draft?.id === r.id) && <button className="text-button" disabled={busy} aria-label={`修改理解：${r.text.slice(0, 30)}`} onClick={() => edit(r.id)}><Pencil size={12}/>{draft?.id === r.id ? "继续修改" : "修改"}</button>}</div>
      {editing && draft?.id === r.id && !readOnly ? <form className="review-inline-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
        <MarkdownTextarea aria-label="后来的理解内容" rows={4} maxLength={40000} value={draft.text} disabled={busy} onChange={e => keep({ ...draft, text: e.target.value })} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}/>
        <MarkdownHelp/>{conflict && <div className="field-error"><details className="edit-comparison"><summary>查看当前保存的理解</summary><Markdown className="prose">{r.text || "暂无补充"}</Markdown></details><button type="button" className="text-button" onClick={() => { keep({ ...draft, revision: note.revision }); setConflict(false); setError(""); }}>已对照，继续保存这份草稿</button></div>}
        <div className="reading-editor-actions"><small>{storageError ? "本机无法保留草稿，请先保存" : "已自动暂存"}</small><button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(false); onClose?.(); }}>收起</button><button type="button" className="text-button" disabled={busy} onClick={() => { if (window.confirm("放弃这条理解未保存的修改？")) clear(); }}>放弃修改</button><button className="primary compact" disabled={busy || conflict}>{busy ? <Loader2 size={14} className="spin"/> : <Check size={14}/>}保存理解</button></div>
      </form> : <Markdown className="prose">{r.text || "回看了自己的记录，暂时没有新的补充。"}</Markdown>}
    </div>)}
  </section>;
}

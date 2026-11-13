"use client";
import {draftStorage} from "./client-runtime";
import { MarkdownHelp, MarkdownTextarea } from "./markdown";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { type Note } from "./model";


type SaveReview = (text: string, days: number, reviewId: string) => Promise<Note>;
type Draft = { text: string; id: string };
const freshDraft = (): Draft => ({ text: "", id: crypto.randomUUID() });


export function ReflectionForm({ note, busy, onSave, requested, onClose }: { note: Note; busy: boolean; onSave: SaveReview; requested: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState(requested);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const key = `shiye-reflection-${note.id}`;
  const legacyKey = `shiye-review-${note.id}`;
  useEffect(() => {
    let restored = freshDraft();
    try {
      const raw = draftStorage.getItem(key);
      const stored = raw ? JSON.parse(raw) : null;
      if (stored && typeof stored.text === "string" && /^[\da-f-]{36}$/i.test(stored.id)) restored = { text: stored.text, id: stored.id };
      else restored.text = sessionStorage.getItem(legacyKey) || "";
    } catch { setStorageError(true); }
    setDraft(restored);
    if (restored.text) setExpanded(true);
  }, [key, legacyKey]);
  useEffect(() => {
    if (requested) {
      setExpanded(true);
      const timer = setTimeout(() => { input.current?.scrollIntoView({ block: "center" }); input.current?.focus({ preventScroll: true }); }, 0);
      return () => clearTimeout(timer);
    }
  }, [requested]);
  function update(next: Draft) {
    setDraft(next);
    try { draftStorage.setItem(key, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }
  async function save() {
    if (!draft?.text.trim() || busy || submitting.current) return;
    submitting.current = true; setSaving(true); setError("");
    try {
      const saved = await onSave(draft.text, 0, draft.id);
      const review = saved.reviews.find(r => r.id === draft.id);
      // A lost response may have saved an earlier version of this draft.
      if (!review || review.text !== draft.text.trim()) {
        update({ ...draft, id: crypto.randomUUID() });
        throw new Error("上次补充已保存。当前修改仍保留，再点保存会作为一条新的补充。");
      }
      setDraft(freshDraft());
      try { draftStorage.removeItem(key); sessionStorage.removeItem(legacyKey); } catch { setStorageError(true); }
      setExpanded(false); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <div className="reflection-form">
    <button type="button" className="reflection-toggle" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (expanded) onClose(); }}><Plus size={17}/><span>补充理解</span><ChevronDown size={15} className={expanded ? "rotated" : ""}/></button>
    {expanded && <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className="sr-only" htmlFor={`reflection-${note.id}`}>新的理解</label>
      <MarkdownTextarea id={`reflection-${note.id}`} ref={input} value={draft?.text || ""} disabled={!draft || busy || saving} maxLength={40000} rows={4} placeholder="添加新的理解…" onChange={e => draft && update({ ...draft, text: e.target.value })} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}/>
      <MarkdownHelp/><div className="reflection-footer"><small className={storageError ? "reflection-storage-error" : "reflection-draft"}>{storageError ? "暂存失败，请先保存" : draft?.text ? "已自动暂存" : ""}</small><button className="primary compact" disabled={!draft?.text.trim() || busy || saving}>{saving ? <Loader2 className="spin" size={15}/> : <Check size={15}/>}保存补充</button></div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>}
  </div>;
}

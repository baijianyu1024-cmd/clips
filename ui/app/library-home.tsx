"use client";
import {request, draftStorage, MediaImage} from "./client-runtime";
import RecordFeed from "./library-record-feed";
import Markdown, { MarkdownHelp, MarkdownTextarea } from "./markdown";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, Plus, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { kinds, type Note } from "./model";
import { libraryRecords, matchesRecord, recordFilters, recordHasContent, type RecordFilter, type LibraryRecord } from "./library-records";
import ReadingTimeline from "./reading-timeline";
import LibraryShelf from "./library-shelf";
import { DeskHeader } from "./sidebar";
import CoreSummarySection from "./core-summary";
import ReviewHistory from "./review-history";
import "./library-home.css";

export type RecordReturn = { key: string; limit: number; offset: number; filter: RecordFilter };
type LibraryMode = "records" | "notes";
type LibraryView = { mode: LibraryMode; filter: RecordFilter };

function initialView(returnTo: RecordReturn | null): LibraryView {
  if (returnTo) return { mode: "records", filter: returnTo.filter };
  const tab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
  let mode: LibraryMode = "notes", filter: RecordFilter = "all";
  try {
    const saved = JSON.parse(draftStorage.getItem("clips-library-view") || "null");
    if (saved?.mode === "records") mode = "records";
    if (Object.hasOwn(recordFilters, saved?.filter)) filter = saved.filter;
    else if (saved?.only === true) filter = "thought";
  } catch { /* The library is usable when local preferences are unavailable. */ }
  return { mode: tab === "records" || tab === "notes" ? tab : mode, filter };
}

type Props = {
  recordNotes: Note[]; recordReturnRef: React.RefObject<RecordReturn | null>;
  notes: Note[]; library: Note[]; query: string; onQuery: (v: string) => void;
  navigation: ReactNode; onRefresh: () => void;
  kind: string; onKind: (v: string) => void; tag: string;
  status: "all" | "reading" | "read"; onStatus: (v: "all" | "reading" | "read") => void; starred: boolean; onStarred: () => void;
  onOpen: (n: Note) => void; onEdit: (n: Note) => void; onUpdate: (n: Note) => void; onCreate: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>; onDeleteNote: (n: Note) => void;
};
const imageUrl = (key: string) => `/api/media?key=${encodeURIComponent(key)}`;
export default function LibraryHome(p: Props) {
  const [{ mode, filter }, setView] = useState(() => initialView(p.recordReturnRef.current));
  const [editing, setEditing] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const sourceNotes = mode === "records" ? p.recordNotes : p.notes;
  const rows = useMemo(() => libraryRecords(sourceNotes), [sourceNotes]);
  const matching = useMemo(() => mode === "records" ? rows.filter(r => recordHasContent(r, filter) && matchesRecord(r, p.query)) : [], [mode, rows, filter, p.query]);
  const pageKey = JSON.stringify([p.query, p.kind, p.tag, p.status, p.starred, mode, filter]);
  const [page, setPage] = useState(() => ({ key: pageKey, limit: p.recordReturnRef.current?.limit ?? 60 }));
  const limit = page.limit;
  if (page.key !== pageKey) setPage({ key: pageKey, limit: 60 });

  function findRecord(key: string) {
    return Array.from(documentRef.current?.querySelectorAll<HTMLElement>("[data-record-key]") || [])
      .find(el => el.dataset.recordKey === key);
  }
  useLayoutEffect(() => {
    const target = p.recordReturnRef.current;
    if (!target || mode !== "records" || limit < target.limit) return;
    const row = findRecord(target.key);
    p.recordReturnRef.current = null;
    if (row) {
      window.scrollBy(0, row.getBoundingClientRect().top - target.offset);
      row.querySelector<HTMLElement>(".library-source")?.focus({ preventScroll: true });
    }
  }, [mode, limit, p.recordReturnRef]);

  function choose(next: LibraryMode, nextFilter = filter) {
    if (next === mode && nextFilter === filter) return;
    setView({ mode: next, filter: nextFilter });
    setEditing(null);
    try { draftStorage.setItem("clips-library-view", JSON.stringify({ mode: next, filter: nextFilter, only: nextFilter === "thought" })); } catch {}
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== next) {
      url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url);
    }
  }
  function openFromFeed(row: LibraryRecord) {
    const element = findRecord(row.key);
    if (element) p.recordReturnRef.current = { key: row.key, limit, offset: element.getBoundingClientRect().top, filter };
    window.scrollTo(0, 0);
    p.onOpen(row.note);
  }
  const filtered = Boolean(p.query || p.kind || p.tag || p.status !== "all" || p.starred || (mode === "records" && filter !== "all"));
  const readingCount = p.notes.filter(n => n.status === "reading").length;
  return <section className="library-home library-desk" aria-label="笔记库">
    <DeskHeader title={p.tag ? `# ${p.tag}` : "笔记库"} navigation={p.navigation} onRefresh={p.onRefresh} onCreate={p.onCreate}
      count={mode === "notes" ? `${p.notes.length} 篇` : `${matching.length} 条记录`}/>
    <div className="library-toolbar">
      <div className="library-tabs" role="group" aria-label="笔记库视图">
        <button aria-pressed={mode === "notes"} onClick={() => choose("notes")}>按篇笔记</button>
        <button aria-pressed={mode === "records"} onClick={() => choose("records")}>全部记录</button>
      </div>
      <div className="library-tools">
        <label className="library-search">
          <Search size={15}/>
          <input ref={p.searchRef} type="search" aria-label="搜索笔记和记录" placeholder="搜索文章、想法、摘录…" value={p.query} onChange={e => p.onQuery(e.target.value)}/>
          {p.query && <button type="button" aria-label="清除搜索" onClick={() => { p.onQuery(""); p.searchRef.current?.focus(); }}><X size={13}/></button>}
        </label>
        <ShelfFilters kind={p.kind} onKind={p.onKind} status={p.status} onStatus={p.onStatus} starred={p.starred} onStarred={p.onStarred}/>
      </div>
    </div>
    {mode === "records" && <div className="record-filters" role="group" aria-label="记录内容">
      {(Object.keys(recordFilters) as RecordFilter[]).map(value =>
        <button key={value} type="button" aria-pressed={filter === value}
          onClick={() => choose("records", value)}>{recordFilters[value]}</button>)}
    </div>}
    <div ref={documentRef} className="library-document">
      {mode === "records" ? <RecordFeed records={matching.slice(0, limit)} onOpen={openFromFeed}
        onUpdate={p.onUpdate} editing={editing} onEdit={setEditing} onPreview={setLightbox}
        renderEditor={r => <RecordEditor record={r} onUpdate={p.onUpdate} onClose={() => setEditing(null)} onPreview={setLightbox}/>}/> : <LibraryShelf notes={p.notes} records={rows} limit={limit} onOpen={p.onOpen} onEdit={p.onEdit} onDelete={p.onDeleteNote}/>}
      {(mode === "records" ? !matching.length : !p.notes.length) && <div className="library-empty">
        <p>{filtered ? (mode === "records" ? "没有符合条件的记录" : "没有符合条件的笔记") : p.library.length ? "还没有摘要、截图或想法" : "暂无笔记"}</p>
        {!filtered && <button className="secondary compact" onClick={p.onCreate}><Plus size={14}/>新建笔记</button>}
      </div>}
      {(mode === "records" ? matching.length > limit : readingCount > limit || p.notes.length - readingCount > limit) && <button className="secondary compact library-more" onClick={() => setPage({ key: pageKey, limit: limit + 60 })}>加载更多</button>}
    </div>
    {lightbox && <ImagePreview image={lightbox} onClose={() => setLightbox(null)}/>}
  </section>;
}

function ShelfFilters(p: Pick<Props, "kind" | "onKind" | "status" | "onStatus" | "starred" | "onStarred">) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const active = Boolean(p.kind || p.status !== "all" || p.starred);
  return <details ref={ref} className="library-filter-menu" data-active={active}
    onToggle={e => setOpen(e.currentTarget.open)}
    onKeyDown={e => { if (e.key === "Escape" && ref.current?.open) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } }}>
    <summary><SlidersHorizontal size={14}/>筛选<ChevronDown size={12}/></summary>
    <div>
      <label>来源<select aria-label="来源类型" value={p.kind} onChange={e => p.onKind(e.target.value)}>
        <option value="">所有来源</option>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></label>
      <label>阅读状态<select aria-label="阅读状态筛选" value={p.status} onChange={e => p.onStatus(e.target.value as Props["status"])}>
        <option value="all">全部</option><option value="reading">正在读</option><option value="read">已读完</option>
      </select></label>
      <label><input type="checkbox" checked={p.starred} onChange={p.onStarred}/><Star size={13}/>仅星标</label>
      {active && <button type="button" className="reset-shelf-filters" onClick={() => {
        p.onKind(""); p.onStatus("all"); if (p.starred) p.onStarred();
      }}>重置筛选</button>}
    </div>
  </details>;
}

function RecordEditor({ record: r, onUpdate, onClose, onPreview }: { record: LibraryRecord; onUpdate: (n: Note) => void; onClose: () => void; onPreview: (key: string) => void }) {
  return <div className="library-inline-editor">{r.type === "core" ? <CoreSummarySection note={r.note} onUpdate={onUpdate} onPreview={onPreview} editorOnly onClose={onClose}/> : r.type === "review" ? <ReviewHistory note={r.note} onUpdate={onUpdate} editId={r.id} onClose={onClose}/> : r.type === "ai" ? <AISummaryEditor record={r} onUpdate={onUpdate} onClose={onClose}/> : <ReadingTimeline note={r.note} onUpdate={onUpdate} onPreview={onPreview} onAnchor={() => {}} editTarget={r.id} onClose={onClose}/>}</div>;
}

function AISummaryEditor({ record: r, onUpdate, onClose }: { record: LibraryRecord; onUpdate: (n: Note) => void; onClose: () => void }) {
  const key = `clips-ai-edit:${r.note.id}:${r.id}`;
  const [draft, setDraft] = useState({ text: r.text, revision: r.note.revision });
  const [error, setError] = useState(""); const [conflict, setConflict] = useState(false); const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => { try { const saved = JSON.parse(draftStorage.getItem(key) || "null"); if (saved && typeof saved.text === "string" && Number.isInteger(saved.revision)) setDraft(saved); } catch {} }, [key]);
  function keep(next: typeof draft) { setDraft(next); try { draftStorage.setItem(key, JSON.stringify(next)); } catch { setError("暂存失败，请先保存。"); } }
  async function save() { if (lock.current || conflict || !draft.text.trim()) return; lock.current = true; setBusy(true); setError(""); try {
    const res = await request("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.note.id, revision: draft.revision, action: "edit_ai_summary", aiSummaryId: r.id, text: draft.text }) });
    const data = await res.json() as { note: Note; error?: string }; if (!res.ok) { if (res.status === 409) { const response = await request("/api/notes", { cache: "no-store" }); if (response.ok) { const latest = ((await response.json()) as { notes: Note[] }).notes.find((n: Note) => n.id === r.note.id); if (latest) onUpdate(latest); } setConflict(true); } throw new Error(data.error || "保存失败，草稿仍在。"); }
    onUpdate(data.note); try { draftStorage.removeItem(key); } catch {} onClose();
  } catch(e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); } }
  return <form onSubmit={e => { e.preventDefault(); void save(); }}><label>AI 摘要<MarkdownTextarea aria-label="AI 摘要内容" rows={6} maxLength={40000} value={draft.text} disabled={busy} onChange={e => keep({ ...draft, text: e.target.value })}/></label><MarkdownHelp/>{error && <p className="field-error" role="alert">{error}</p>}{conflict && <div><Markdown className="library-copy">{r.text}</Markdown><button type="button" className="text-button" onClick={() => { keep({ ...draft, revision: r.note.revision }); setConflict(false); setError(""); }}>已对照最新内容，继续保存</button></div>}<div className="library-editor-actions"><button type="button" className="text-button" disabled={busy} onClick={onClose}>收起</button><button className="primary compact" disabled={busy || conflict || !draft.text.trim()}>{busy ? <Loader2 size={14} className="spin"/> : <Check size={14}/>}保存摘要</button></div></form>;
}

function ImagePreview({ image, onClose }: { image: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal lightbox" aria-label="图片预览" onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-header"><h2>图片预览</h2><button className="icon-button" onClick={onClose} aria-label="关闭图片预览"><X size={18}/></button></div><MediaImage src={imageUrl(image)} alt="笔记中的图片"/></dialog>;
}

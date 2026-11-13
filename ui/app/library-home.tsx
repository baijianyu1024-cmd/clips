"use client";
import {request, draftStorage, MediaImage} from "./client-runtime";
import Markdown, { MarkdownHelp, MarkdownTextarea } from "./markdown";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, Plus, Search, Star, Tags, X } from "lucide-react";
import { kinds, titleOf, type Note } from "./model";
import { libraryRecords, matchesRecord, type LibraryRecord } from "./library-records";
import ReadingTimeline from "./reading-timeline";
import CoreSummarySection from "./core-summary";
import ReviewHistory from "./review-history";
import "./library-home.css";

type Props = {
  notes: Note[]; library: Note[]; query: string; onQuery: (v: string) => void;
  onTags: () => void;
  kind: string; onKind: (v: string) => void; tag: string; onClearTag: () => void;
  status: string; onStatus: (v: "all" | "reading" | "read") => void; starred: boolean; onStarred: () => void;
  onOpen: (n: Note) => void; onUpdate: (n: Note) => void; onCreate: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
};
const imageUrl = (key: string) => `/api/media?key=${encodeURIComponent(key)}`;
const day = (at?: string) => at ? new Date(at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }) : "时间未记录";
const time = (at?: string) => at ? new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

export default function LibraryHome(p: Props) {
  const [mode, setMode] = useState<"records" | "notes">("records");
  const [only, setOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const [editing, setEditing] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const rows = useMemo(() => libraryRecords(p.notes), [p.notes]);
  const total = useMemo(() => libraryRecords(p.library).length, [p.library]);
  const matching = useMemo(() => rows.filter(r => matchesRecord(r, p.query, mode === "records" && only)), [rows, p.query, only, mode]);

  useEffect(() => { try { const saved = JSON.parse(draftStorage.getItem("clips-library-view") || "null"); if (saved?.mode === "notes") setMode("notes"); setOnly(saved?.only === true); } catch {} }, []);
  useEffect(() => { setLimit(60); }, [p.query, p.kind, p.tag, p.status, p.starred, only, mode]);
  function choose(next: typeof mode, thoughts = only) { setMode(next); setOnly(thoughts); try { draftStorage.setItem("clips-library-view", JSON.stringify({ mode: next, only: thoughts })); } catch {} }
  const clearFilters = () => { p.onQuery(""); p.onKind(""); p.onClearTag(); p.onStatus("all"); if (p.starred) p.onStarred(); choose(mode, false); };
  const filtered = !!(p.query || p.kind || p.tag || p.status !== "all" || p.starred || (mode === "records" && only));
  const matchingIds = new Set(matching.map(r => r.note.id));
  const overviewNotes = filtered ? (mode === "records" && only ? p.notes.filter(n => matchingIds.has(n.id)) : p.notes) : p.library;
  const reading = overviewNotes.filter(n => n.status === "reading").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = new Map<string, LibraryRecord[]>();
  for (const r of matching.slice(0, limit)) { const label = day(r.at); groups.set(label, [...(groups.get(label) || []), r]); }
  return <section className="library-home" aria-label="笔记库">
    <div className="library-heading"><h1>笔记库</h1><div className="library-overview">{filtered && <span className="library-scope">当前筛选</span>}<span><b>{overviewNotes.length}</b> 篇笔记</span><span><b>{filtered ? matching.length : total}</b> 条记录</span><span><b>{reading.length}</b> 篇正在读</span></div><button className="primary compact library-add" onClick={p.onCreate}><Plus size={14}/>添加笔记</button></div>
    {reading.length > 0 && <div className="library-continue"><span>继续阅读</span>{reading.slice(0, 3).map(n => <button key={n.id} onClick={() => p.onOpen(n)} title={titleOf(n)}><span>{titleOf(n)}</span><ArrowUpRight size={12}/></button>)}{reading.length > 3 && <button onClick={() => { p.onStatus("reading"); choose("notes"); }}>全部 {reading.length} 篇</button>}</div>}
    <div className="library-toolbar"><div className="library-tabs" role="group" aria-label="笔记库视图"><button aria-pressed={mode === "records"} onClick={() => choose("records")}>全部记录</button><button aria-pressed={mode === "notes"} onClick={() => choose("notes")}>按篇笔记</button></div><div className="library-tools"><label className="library-search"><Search size={14}/><input ref={p.searchRef} aria-label="搜索笔记和记录" placeholder="搜索记录、标题…" value={p.query} onChange={e => p.onQuery(e.target.value)}/>{p.query && <button aria-label="清除搜索" onClick={() => p.onQuery("")}><X size={12}/></button>}</label>{mode === "records" && <label className="library-only"><input type="checkbox" checked={only} onChange={e => choose(mode, e.target.checked)}/>只看我的想法</label>}<button className="library-tags-button" onClick={p.onTags} aria-label="标签管理与筛选" aria-pressed={!!p.tag}><Tags size={14}/>标签</button><details className="library-filter-menu"><summary>筛选{p.kind || p.status !== "all" || p.starred ? " ·" : ""}</summary><div><label>来源<select aria-label="来源类型" value={p.kind} onChange={e => p.onKind(e.target.value)}><option value="">所有来源</option>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>阅读状态<select aria-label="阅读状态筛选" value={p.status} onChange={e => p.onStatus(e.target.value as "all" | "reading" | "read")}><option value="all">全部</option><option value="reading">正在读</option><option value="read">已读完</option></select></label><label><input type="checkbox" checked={p.starred} onChange={p.onStarred}/><Star size={13}/>仅星标</label></div></details></div></div>
    {filtered && <div className="library-filter-result"><span>{mode === "records" ? `${matching.length} 条记录` : `${p.notes.length} 篇笔记`}</span>{p.tag && <button className="library-tag-chip" aria-label="清除标签筛选" onClick={p.onClearTag}><span># {p.tag}</span><X size={12}/></button>}<button onClick={clearFilters}>清除筛选</button></div>}
    <div className="library-document">
      {mode === "records" ? [...groups].map(([date, entries]) => <section className="library-day" key={date}><h2>{date}</h2>{entries.map(r => <article className="library-record" key={r.key} data-record-key={r.key}><div className="library-record-meta">{r.at && <time dateTime={r.at}>{time(r.at)}</time>}<button className="library-source" onClick={() => p.onOpen(r.note)}>{titleOf(r.note)}<ArrowUpRight size={12}/></button><span>{r.label}{r.images.length > 0 && ` · ${r.images.length} 张`}</span><span className="content-published">内容发布时间：{r.note.published || "未填写"}</span>{editing !== r.key && <button className="library-edit" onClick={() => setEditing(r.key)}>编辑</button>}</div>{editing === r.key ? <RecordEditor record={r} onUpdate={p.onUpdate} onClose={() => setEditing(null)} onPreview={setLightbox}/> : <RecordContent record={r} onPreview={setLightbox}/>}</article>)}</section>) : p.notes.slice(0, limit).map(n => { const candidates = rows.filter(r => r.note.id === n.id); const preview = candidates.find(r => r.type === "core") || candidates[0]; return <article className="library-note" key={n.id}><div className="library-record-meta"><span>{kinds[n.kind]} · {n.status === "reading" ? "正在读" : "已读完"} · {candidates.length} 条记录</span>{n.starred && <Star size={12}/>}<span className="content-published">内容发布时间：{n.published || "未填写"}</span><time dateTime={n.updatedAt}>更新于 {day(n.updatedAt)}</time></div><button className="library-note-title" onClick={() => p.onOpen(n)}>{titleOf(n)}<ArrowUpRight size={14}/></button>{preview ? <RecordContent record={preview} onPreview={setLightbox} preview/> : <p className="library-placeholder">尚未留下记录</p>}</article>; })}
      {(mode === "records" ? !matching.length : !p.notes.length) && <div className="library-empty"><p>{filtered ? "没有符合条件的记录" : p.library.length ? "还没有摘要、截图或想法" : "暂无笔记"}</p>{filtered ? <button className="secondary compact" onClick={clearFilters}>清除筛选</button> : <button className="secondary compact" onClick={p.onCreate}><Plus size={14}/>添加笔记</button>}</div>}
      {(mode === "records" ? matching.length : p.notes.length) > limit && <button className="secondary compact library-more" onClick={() => setLimit(n => n + 60)}>加载更多</button>}
    </div>
    {lightbox && <ImagePreview image={lightbox} onClose={() => setLightbox(null)}/>}
  </section>;
}

function RecordContent({ record: r, onPreview, preview = false }: { record: LibraryRecord; onPreview: (key: string) => void; preview?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = content.current;
    if (!el || expanded) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("load", measure, true);
    return () => { observer.disconnect(); el.removeEventListener("load", measure, true); };
  }, [r.text, r.thought, r.translation, expanded, preview]);
  const source = <>{r.text && <Markdown className="library-copy">{r.text}</Markdown>}{r.translation && <div className="library-translation"><small>中文译文</small><Markdown className="library-copy">{r.translation}</Markdown></div>}{r.pending && <p className="library-placeholder">中文译文待补齐</p>}</>;
  return <><div ref={content} className={!expanded || preview ? "library-clamped" : ""}>{r.thought ? <Markdown className="library-copy">{r.thought}</Markdown> : source}</div>{long && !preview && <button className="library-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "展开全文"}</button>}{r.thought && (r.text || r.translation || r.pending) && !preview && <details className="library-quote"><summary>关联摘录</summary><blockquote>{source}</blockquote></details>}{r.images.length > 0 && <div className="library-images">{r.images.slice(0, preview ? 3 : r.images.length).map(img => <button key={img.key} onClick={() => onPreview(img.key)} aria-label={`放大图片：${img.name}`}><MediaImage src={imageUrl(img.key)} alt={img.name} loading="lazy"/><span>放大</span></button>)}{preview && r.images.length > 3 && <span className="library-placeholder">共 {r.images.length} 张</span>}</div>}</>;
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

"use client";
import {request, MediaImage, pageURL, isLocalLibrary, openStorage} from "./client-runtime";
import Markdown, { MarkdownHelp, MarkdownTextarea } from "./markdown";
import { markdownText } from "@/extension/markdown.js";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, MessagesSquare, ExternalLink, FileText, ImagePlus, Inbox, Layers3, Link2, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Settings2, Sparkles, Star, Trash2, Video, X, Archive, Headphones } from "lucide-react";
import Sidebar from "./sidebar";
import LibraryHome from "./library-home";
import TranscriptReader from "./transcript-reader";
import SourceReader from "./source-reader";
import CoreSummarySection from "./core-summary";
import ReadingTimeline from "./reading-timeline";
import ReviewHistory from "./review-history";
import ReadingQueue from "./reading-queue";
import { ReflectionForm } from "./reflection-form";
import "./library.css";
import { linkKey } from "@/lib/links";
import { quoteView } from "@/extension/quote-context.js";
import { blankFields, noteSchema, fieldsSchema, imageSchema, metadataSchema, kinds, titleOf, toMarkdown, type Fields, type Kind, type Note } from "./model";
import TagPicker from "./tag-picker";
import TagManager from "./tag-manager";
import { tagKey, uniqueTags, type TagState, type TagMutation } from "./tag-model";

type View = "all" | "inbox" | "archive" | "trash";
type ReadingFilter = "all" | "reading" | "read";
type EditorState = { note?: Note; status?: "read" | "reading" | "inbox" } | null;
const fmt = (value: string) => new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
const longDate = (value: string) => new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
const imageUrl = (key: string) => `/api/media?key=${encodeURIComponent(key)}`;
const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const icons = { article: FileText, video: Video, podcast: Headphones, idea: Sparkles, other: BookOpen };
const viewNames = { all: "笔记库", inbox: "待阅读", archive: "已归档", trash: "回收站" };

function notePreview(note: Note) {
  const clip = note.clips.at(-1);
  const quote = clip ? quoteView(clip, note.transcripts?.find(t => t.id === clip.transcriptAnchor?.snapshotId)?.language) : null;
  return note.coreSummary?.text || note.thought || note.summary || clip?.thought || quote?.translation || quote?.original || (quote?.pending ? "中文翻译待补充" : "") || (note.images.length ? `${note.images.length} 张截图，打开看看。` : "暂无记录");
}

async function api(payload?: object, method = "GET") {
  const response = await request("/api/notes", { method, headers: payload ? { "Content-Type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined, cache: "no-store" });
  let data: { error?: string; notes: Note[]; note: Note; added: number; skipped: number; tagState: TagState };
  try { data = await response.json() as typeof data; } catch { throw new Error("暂时无法连接，请稍后重试。输入的内容仍会保留。"); }
  if (!response.ok) throw Object.assign(new Error(data.error || "操作没有完成，请重试。"), { status: response.status });
  return data;
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function Notebook() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [dataDialog, setDataDialog] = useState(false);
  const [tagManager, setTagManager] = useState(false);
  const [tagState, setTagState] = useState<TagState>({ tags: [], revision: 0 });
  const [tagChange, setTagChange] = useState<TagMutation | null>(null);
  const [busy, setBusy] = useState(false);
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>("all");
  const [starOnly, setStarOnly] = useState(false);
  const [writeNote, setWriteNote] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try { const data = await api(); setTagState(data.tagState); setNotes(current => data.notes.map(note => current.find(n => n.id === note.id && n.revision > note.revision) || note)); setError(""); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (['all','inbox','archive','trash'].includes(params.get('view')||'')) setView(params.get('view') as View);
    if (params.has('tag')) setTag(params.get('tag')||'');
    if (params.has('new')) setEditor({});
    if (params.get('manage')==='tags') setTagManager(true);
    if (params.get('manage')==='data') setDataDialog(true);
    const id = params.get("note");
    if (id && /^[\da-f-]{36}$/i.test(id)) {
      setSelection(id); setMobileDetail(true);
      if (params.get("view") === "review" || params.get("write") === "1") setWriteNote(id);
    }
  }, []);
  useEffect(() => {
    const sync = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", sync); document.addEventListener("visibilitychange", sync);
    const timer = setInterval(sync, 15000);
    return () => { window.removeEventListener("focus", sync); document.removeEventListener("visibilitychange", sync); clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 4000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); setEditor({}); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [view]);
  const active = notes.filter(n => !n.deletedAt && !n.archived);
  const library = active.filter(n => n.status !== "inbox");
  const hasFilters = !!(query || tag || kind || (view === "all" && (readingFilter !== "all" || starOnly)));
  const tags = useMemo(() => uniqueTags([...tagState.tags.map(t => t.name), ...notes.filter(n => !n.deletedAt).flatMap(n => n.tags)]), [notes, tagState]);
  const availableTags = tags;
  const filtered = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return notes.filter(n => {
      if (view === "trash" ? !n.deletedAt : !!n.deletedAt) return false;
      if (view === "archive" ? !n.archived : view !== "trash" && n.archived) return false;
      if (view === "inbox" && n.status !== "inbox") return false;
      if (view === "all" && n.status === "inbox") return false;
      if (view === "all" && readingFilter !== "all" && n.status !== readingFilter) return false;
      if (view === "all" && starOnly && !n.starred) return false;
      if (tag && !n.tags.some(t => tagKey(t) === tagKey(tag))) return false;
      if (kind && n.kind !== kind) return false;
      const searchable = [n.title, n.coreSummary?.text || "", n.summary, n.thought, n.tags.join(" "), ...n.sources.map(s => s.url + " " + s.label), ...n.reviews.map(r => r.text), ...n.clips.map(c => c.text + " " + (c.translation?.text || "") + " " + c.thought), ...n.aiSummaries.map(a => a.text), ...[...n.images, ...(n.coreSummary?.images || []), ...(n.legacyRecordImages || []), ...n.clips.flatMap(c => c.images || [])].map(i => i.name)].join(" ").toLocaleLowerCase();
      return words.every(word => searchable.includes(word));
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, query, tag, kind, view, readingFilter, starOnly]);
  const selected = (view === "all" ? notes.find(n => n.id === selection && !n.deletedAt && !n.archived) : filtered.find(n => n.id === selection)) || filtered[0];
  const switchView = (next: View) => { setView(next); setQuery(""); setTag(""); setKind(""); setSelection(null); setMobileDetail(false); setReadingFilter("all"); setStarOnly(false); setWriteNote(null); };
  const upsert = useCallback((note: Note) => setNotes(current => {
    if (current.some(n => n.id === note.id && n.revision > note.revision)) return current;
    return [note, ...current.filter(n => n.id !== note.id)];
  }), []);
  function applyTagChange(result: TagMutation) {
    setTagState(result);
    result.notes.forEach(upsert);
    if (result.renamed) setTag(current => tagKey(current) === tagKey(result.renamed!.from) ? result.renamed!.to : current);
    if (editor) {
      setTagChange(result);
      if (result.created) setTagManager(false);
    }
    setToast(result.renamed ? "标签已更名，关联笔记已更新" : "标签已创建");
  }
  function filterTag(value: string) {
    setView("all"); setTag(value); setQuery(""); setKind(""); setReadingFilter("all"); setStarOnly(false); setMobileDetail(false); setTagManager(false);
  }
  async function startReading(note: Note) {
    if (busy || !note.sources[0]) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setBusy(true); setError("");
    try {
      let started: Note | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const currentNotes = (await api()).notes;
        const current = currentNotes.find(n => n.id === note.id && !n.deletedAt && !n.archived) || currentNotes.find(n => !n.deletedAt && !n.archived && n.sources.some(s => linkKey(s.url) === linkKey(note.sources[0].url)));
        if (!current) throw new Error("这条链接已被移除，请刷新列表后重试。");
        try { started = (await api({ id: current.id, revision: current.revision, action: "start_reading" }, "PATCH")).note; break; }
        catch (e) { if ((e as { status?: number }).status !== 409 || attempt === 2) throw e; }
      }
      if (!started) throw new Error("暂时无法开始阅读，链接仍保留在待阅读中。");
      upsert(started); await refresh(); setView("all"); setReadingFilter("all"); setStarOnly(false); setSelection(started.id); setQuery(""); setTag(""); setKind(""); setMobileDetail(true);
      if (popup) popup.location.href = note.sources[0].url;
      setToast(popup ? "已开始阅读，原网页已打开；可以用插件随读记录。" : "已开始阅读，请点击笔记中的来源链接打开原文。" );
    } catch (e) { popup?.close(); setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function mutate(note: Note, action: string, extra: object = {}) {
    setBusy(true);
    try {
      const data = await api({ id: note.id, revision: note.revision, action, ...extra }, "PATCH");
      upsert(data.note); await refresh(); setError("");
      const messages: Record<string, string> = { star: data.note.starred ? "已加入星标" : "已取消星标", archive: data.note.archived ? "已归档，可随时恢复" : "已移回笔记", trash: "已移除笔记，可随时恢复", restore: "已恢复笔记", review: "已保存新的理解", status: "已继续阅读", read: data.note.status === "read" ? "已标记读完" : "已放回待阅读" };
      setToast(messages[action] || "已保存");
      return data.note as Note;
    } catch (e) { setError((e as Error).message); throw e; }
    finally { setBusy(false); }
  }
  async function saveReview(note: Note, text: string, days: number, reviewId: string) {
    setBusy(true);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = (await api()).notes.find(n => n.id === note.id);
        if (!latest) throw new Error("找不到这篇笔记，草稿仍会保留。");
        try {
          const data = await api({ id: note.id, revision: latest.revision, action: "review", text, days, reviewId }, "PATCH");
          upsert(data.note); setError(""); setToast("已保存新的理解"); return data.note;
        } catch (e) { if ((e as { status?: number }).status !== 409 || attempt === 2) throw e; }
      }
      throw new Error("暂时无法保存，请稍后重试。草稿仍会保留。");
    } finally { setBusy(false); }
  }
  const act = (note: Note, action: string) => { void mutate(note, action === "continue_reading" ? "status" : action, action === "continue_reading" ? { status: "reading" } : {}).catch(() => {}); };
  const nav = (value: View, Icon: typeof BookOpen, count?: number) => <button aria-label={viewNames[value]} title={viewNames[value]} className={`nav-item ${view === value ? "active" : ""}`} onClick={() => switchView(value)}><Icon size={18}/><span>{viewNames[value]}</span>{!!count && <span className="nav-count">{count}</span>}</button>;

  return <div className="app-shell">
    <Sidebar notes={notes} tags={tags} view={view} tag={tag} onNavigate={switchView} onTag={filterTag} onNew={()=>setEditor({})} onTags={()=>setTagManager(true)} onData={()=>setDataDialog(true)}/>
    <main className={`workspace ${view === "all" ? "library-workspace" : ""} ${mobileDetail ? "mobile-show-detail" : ""}`}>
      <header className="topbar"><div className="breadcrumb">我的空间 <span>/</span> {viewNames[view]}</div><div className="top-actions"><button className="icon-button" title="刷新笔记" aria-label="刷新笔记" onClick={refresh}><RotateCcw size={17}/></button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={refresh}>刷新列表</button><button className="icon-button" aria-label="关闭提示" onClick={() => setError("")}><X size={16}/></button></div>}
      {view === "all" ? loading ? <div className="loading"><Loader2 className="spin" size={24}/><p>正在打开笔记…</p></div> : mobileDetail && selected ? <div className="library-note-detail"><NoteDetail key={selected.id} note={selected} onUpdate={upsert} onStart={() => void startReading(selected)} busy={busy} initialWrite={writeNote === selected.id} onEdit={() => setEditor({ note: selected })} onAction={action => act(selected, action)} onReview={(text, days, id) => saveReview(selected, text, days, id)} onBack={() => { setMobileDetail(false); setWriteNote(null); }} onTag={value => { setTag(value); setReadingFilter("all"); setStarOnly(false); setMobileDetail(false); }}/></div> : <LibraryHome onTags={() => setTagManager(true)} notes={filtered} library={library} query={query} onQuery={setQuery} kind={kind} onKind={setKind} tag={tag} onClearTag={() => setTag("")} status={readingFilter} onStatus={setReadingFilter} starred={starOnly} onStarred={() => setStarOnly(v => !v)} onOpen={n => { setSelection(n.id); setMobileDetail(true); }} onUpdate={upsert} onCreate={() => setEditor({})} searchRef={searchRef}/> : <>
      <div className="page-heading"><div><h1>{tag || viewNames[view]} <span>{filtered.length}</span></h1></div><button className="mobile-new primary" onClick={() => setEditor({})}><Plus size={18}/>添加笔记</button></div>
      <div className="filterbar"><label className="search"><Search size={17}/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题、要点、想法…" aria-label="搜索笔记"/><kbd>⌘ K</kbd>{query && <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery("")}><X size={14}/></button>}</label><select aria-label="来源类型" value={kind} onChange={e => setKind(e.target.value)}><option value="">所有来源</option>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{tag && <button className="filter-tag" onClick={() => setTag("")}># {tag}<X size={13}/></button>}</div>

      {view === "inbox" ? <ReadingQueue notes={filtered} loading={loading} busy={busy} onChange={upsert} onRefresh={refresh} onStart={note => void startReading(note)} onRemove={note => act(note, "trash")}/> : loading ? <div className="loading"><Loader2 className="spin" size={24}/><p>正在打开你的笔记…</p></div> : !filtered.length ? <div className="empty-stage"><BookOpen size={26} className="empty-icon"/><h2>{hasFilters ? "没有匹配的笔记" : view === "trash" ? "回收站是空的" : view === "archive" ? "暂无归档笔记" : "暂无笔记"}</h2><p>{hasFilters ? "试试其他阅读状态，或清除筛选查看全部。" : ""}</p>{hasFilters ? <button className="secondary" onClick={() => { setQuery(""); setTag(""); setKind(""); setReadingFilter("all"); setStarOnly(false); }}>清除筛选</button> : null}</div> : <div className="notes-workbench">
        <section className="notes-list" aria-label="笔记列表"><div className="list-caption"><span>按最近更新排列</span><span>{filtered.length} 条</span></div>{filtered.map(n => { const Icon = icons[n.kind]; return <button className={`note-card ${selected?.id === n.id ? "selected" : ""}`} key={n.id} onClick={() => { setSelection(n.id); setMobileDetail(true); }}><div className="card-meta"><span><Icon size={14}/>{kinds[n.kind]}{n.sources[0] && <b>· {domain(n.sources[0].url)}</b>}</span>{n.starred && <Star size={13} className="star-filled"/>}</div><h2>{titleOf(n)}</h2><p>{markdownText(notePreview(n))}</p><div className="card-bottom"><div>{n.status === "reading" && <span className="pill reading-pill">正在读</span>}{n.status === "inbox" && <span className="pill inbox-pill">待阅读</span>}{n.status === "read" && <span className="pill read-pill">已读完</span>}{n.tags.slice(0, 2).map(t => <span className="small-tag" key={t}>#{t}</span>)}</div><time>{fmt(n.updatedAt)}</time></div></button>; })}</section>
        {selected && <NoteDetail key={selected.id} note={selected} onUpdate={upsert} onStart={() => void startReading(selected)} busy={busy} initialWrite={writeNote === selected.id} onEdit={() => setEditor({ note: selected })} onAction={action => act(selected, action)} onReview={(text, days, id) => saveReview(selected, text, days, id)} onBack={() => setMobileDetail(false)} onTag={value => { setTag(value); setView("all"); setReadingFilter("all"); setStarOnly(false); setMobileDetail(false); }}/>}
      </div>}
      </>}

    </main>
    {editor && <Editor state={editor} availableTags={availableTags} tagChange={tagChange} onManageTags={() => setTagManager(true)} onClose={() => setEditor(null)} onSave={note => { upsert(note); void refresh(); setEditor(null); setView(note.status === "inbox" ? "inbox" : "all"); setReadingFilter("all"); setStarOnly(false); setQuery(""); setTag(""); setKind(""); setSelection(note.id); setMobileDetail(true); setToast("笔记已保存"); }}/>}
    {dataDialog && <DataDialog notes={notes} onClose={() => setDataDialog(false)} onRefresh={refresh} notify={setToast}/>}
    {tagManager && <TagManager initial={tagState} selected={tag} onClose={() => setTagManager(false)} onFilter={editor ? undefined : filterTag} onChange={applyTagChange}/>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}

function NoteDetail({ note, onUpdate, onStart, busy, initialWrite, onEdit, onAction, onReview, onBack, onTag }: { note: Note; onUpdate: (note: Note) => void; onStart: () => void; busy: boolean; initialWrite: boolean; onEdit: () => void; onAction: (action: string) => void; onReview: (text: string, days: number, reviewId: string) => Promise<Note>; onBack: () => void; onTag: (tag: string) => void }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ snapshotId: string; from?: number; to?: number } | null>(null);
  const [writeRequested, setWriteRequested] = useState(initialWrite);
  const [reader, setReader] = useState<{ url?: string; snapshotId?: string; blockId?: string } | null>(null);
  const Icon = icons[note.kind];
  return <article className="note-detail"><div className="detail-toolbar"><button className="text-button back-button" onClick={onBack}><ArrowLeft size={16}/>列表</button><span className="detail-kind"><Icon size={15}/>{kinds[note.kind]}<span>·</span>记录于 {longDate(note.createdAt)}</span><div className="detail-actions">{note.status === "read" && !note.deletedAt && !note.archived && <button className="text-button add-understanding" onClick={() => { setWriteRequested(true); document.getElementById(`reflection-section-${note.id}`)?.scrollIntoView({ behavior: "auto", block: "start" }); }}><Plus size={14}/>补充理解</button>}{note.deletedAt ? <button className="secondary compact" disabled={busy} onClick={() => onAction("restore")}><RotateCcw size={15}/>恢复</button> : <><button className={`icon-button ${note.starred ? "star-filled" : ""}`} disabled={busy} onClick={() => onAction("star")} aria-label={note.starred ? "取消星标" : "添加星标"}><Star size={18}/></button><button className="icon-button" onClick={onEdit} aria-label="编辑基础信息" title="编辑基础信息" disabled={note.archived}><Pencil size={17}/></button><details className="more-menu"><summary className="icon-button" aria-label="更多操作"><MoreHorizontal size={20}/></summary><div>{note.sources.length > 0 && <button onClick={e => { e.currentTarget.closest("details")?.removeAttribute("open"); setReader({}); }}><BookOpen size={15}/>原文副本（实验）</button>}<button disabled={busy || note.archived} onClick={() => onAction(note.status === "read" ? "continue_reading" : "read")}><CheckCheck size={15}/>{note.status !== "read" ? "标记读完" : "继续阅读"}</button><button disabled={busy} onClick={() => onAction("archive")}><Archive size={15}/>{note.archived ? "取消归档" : "归档笔记"}</button><button className="danger" disabled={busy} onClick={() => onAction("trash")}><Trash2 size={15}/>移除笔记</button></div></details></>}</div></div>
    <div className="detail-content"><h2 className="note-title">{titleOf(note)}</h2><div className="detail-tags">{note.status === "reading" && <span className="pill reading-pill">正在读</span>}{note.status === "inbox" && <span className="pill inbox-pill">待阅读</span>}{note.status === "read" && <span className="pill read-pill">已读完</span>}{note.tags.map(t => <button className="tag" onClick={() => onTag(t)} key={t}># {t}</button>)}</div>
      <dl className="detail-publication"><dt>内容发布时间</dt><dd>{note.published || "未填写"}</dd>{!note.published && !note.deletedAt && !note.archived && <dd><button className="text-button" onClick={onEdit}>补充</button></dd>}</dl>
      {note.sources.length > 0 && <div className="source-list">{note.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"><Link2 size={15}/><span>{s.label || domain(s.url)}<small>{s.url}</small></span><ExternalLink size={13}/></a>)}</div>}
      {note.status === "inbox" && !note.deletedAt && !note.archived && <button className="primary" disabled={busy || !note.sources.length} onClick={onStart}>开始阅读<ArrowRight size={15}/></button>}

      {note.learningOrigin && <section className="detail-section"><header><h3>对话来源</h3><a href={pageURL('/learn?chat='+note.learningOrigin.chatId)}>返回对话 ↗</a></header><p>{note.learningOrigin.questions.join('；')}</p><details><summary>{note.learningOrigin.materials.length} 段参考材料</summary>{note.learningOrigin.materials.map(m=><article key={m.id} style={{borderBottom:'1px solid #dfe3dc',padding:'16px 0'}}><a href={pageURL('/?note='+m.noteId)}>[{m.number}] {m.title} ↗</a><p style={{fontSize:12,color:'#727971'}}>{m.coverage}</p><Markdown>{m.text}</Markdown>{m.imageKey&&<MediaImage src={imageUrl(m.imageKey)} alt={m.title} style={{maxWidth:'100%',maxHeight:300,objectFit:'contain'}}/>}</article>)}</details></section>}
      <CoreSummarySection note={note} onUpdate={onUpdate} onPreview={key => setLightbox(imageUrl(key))}/>
      {!!note.transcripts?.length && <section className="saved-transcripts" aria-label="已保存的视频字幕"><div><span>视频字幕</span><span>保留原始上下文</span></div>{note.transcripts.map(t => <button key={t.id} onClick={() => setTranscript({ snapshotId: t.id })}><span>{t.title || "YouTube 视频"}</span><small>{t.language} · 查看字幕 ↗</small></button>)}</section>}
      <ReadingTimeline note={note} onUpdate={onUpdate} onPreview={key => setLightbox(imageUrl(key))} onAnchor={clip => { if (clip.transcriptAnchor) { setTranscript(clip.transcriptAnchor); return; } if (clip.anchor) setReader({ url: clip.sourceUrl, snapshotId: clip.anchor.snapshotId, blockId: clip.anchor.blockId }); }}/>
      {note.aiSummaries.length > 0 && <details className="ai-reading-history"><summary>阅读时的 AI 辅助记录 · {note.aiSummaries.length}</summary><section className="ai-section">{note.aiSummaries.map(a => <details key={a.id}><summary>{a.scope} · {a.provider}<small>{fmt(a.createdAt)}</small></summary><Markdown className="prose">{a.text}</Markdown><a href={a.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源 ↗</a></details>)}</section></details>}
      {note.status !== "read" && !note.deletedAt && <button className="secondary read-done" disabled={busy} onClick={() => onAction("read")}><CheckCheck size={17}/>标记读完</button>}
      <ReviewHistory note={note} onUpdate={onUpdate}/>
      {note.status === "read" && !note.deletedAt && !note.archived && <section id={`reflection-section-${note.id}`} className="inline-reflection"><ReflectionForm key={note.id} note={note} busy={busy} onSave={onReview} requested={writeRequested} onClose={() => setWriteRequested(false)}/></section>}
    </div>
    {transcript && <TranscriptReader key={transcript.snapshotId + ":" + transcript.from} note={note} onUpdate={onUpdate} {...transcript} onClose={() => setTranscript(null)}/>}
    {reader && <SourceReader note={note} initialUrl={reader.url} initialSnapshotId={reader.snapshotId} initialBlockId={reader.blockId} onClose={() => setReader(null)} onUpdate={onUpdate}/>}
    {lightbox && <Modal title="图片预览" onClose={() => setLightbox(null)} className="lightbox"><MediaImage src={lightbox} alt="笔记中的图片"/></Modal>}
  </article>;
}

function Modal({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLElement>(".title-input, .metadata-title")?.focus(); }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div>{children}</dialog>;
}

type NewRecord = { id: string; text: string; thought: string; images: Fields["images"]; createdAt: string };
const emptyRecord = (): NewRecord => ({ id: crypto.randomUUID(), text: "", thought: "", images: [], createdAt: new Date().toISOString() });
const hasRecordContent = (r: NewRecord) => !!(r.text.trim() || r.thought.trim() || r.images.length);

function Editor({ state, availableTags, tagChange, onManageTags, onClose, onSave }: { state: NonNullable<EditorState>; availableTags: string[]; tagChange: TagMutation | null; onManageTags: () => void; onClose: () => void; onSave: (note: Note) => void }) {
  const [records, setRecords] = useState<NewRecord[]>(() => [emptyRecord()]);
  const pendingFocus = useRef<string | null>(null);
  const imageTarget = useRef<string | null>(null);
  const operationLock = useRef(false);
  const [baseNote, setBaseNote] = useState(state.note);
  const [conflict, setConflict] = useState(false);
  const [fields, setFields] = useState<Fields>(() => state.note ? fieldsSchema.parse(state.note) : { ...blankFields, status: state.status || "read" });
  const lastTagChange = useRef(tagChange);
  const [sources, setSources] = useState(state.note?.sources.length ? state.note.sources : [{ url: "", label: "" }]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const id = useRef(crypto.randomUUID());
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const update = <K extends keyof Fields>(key: K, value: Fields[K]) => { setFields(prev => ({ ...prev, [key]: value })); setDirty(true); };
  useEffect(() => {
    if (!tagChange || lastTagChange.current === tagChange) return;
    lastTagChange.current = tagChange;
    if (tagChange.renamed) {
      const { from, to } = tagChange.renamed;
      setFields(prev => ({ ...prev, tags: uniqueTags(prev.tags.map(t => tagKey(t) === tagKey(from) ? to : t)) }));
      setBaseNote(prev => {
        const updated = tagChange.notes.find(n => n.id === prev?.id);
        return prev && updated && updated.revision === prev.revision + 1 ? updated : prev;
      });
    }
    if (tagChange.created) {
      setFields(prev => prev.tags.length < 15 ? { ...prev, tags: uniqueTags([...prev.tags, tagChange.created!]) } : prev);
      setDirty(true);
    }
  }, [tagChange]);
  function close() { if (operationLock.current) return; if (!dirty || window.confirm("还没有保存这次修改，确定关闭吗？")) onClose(); }
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function changeRecord(id: string, patch: Partial<NewRecord>) {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r)); setDirty(true);
  }
  function addRecord() {
    const next = emptyRecord(); pendingFocus.current = next.id;
    setRecords(prev => [...prev, next]); setDirty(true);
  }
  async function upload(recordId: string, files: File[]) {
    if (operationLock.current || !files.length || state.note) return;
    const target = records.find(r => r.id === recordId);
    if (!target) return;
    if (target.images.length + files.length > 30) { setError("每条想法最多放 30 张图片。"); return; }
    operationLock.current = true; imageTarget.current = recordId; setUploading(true); setError("");
    try {
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8 MB。");
        const form = new FormData(); form.append("file", file);
        const response = await request("/api/media", { method: "POST", body: form });
        const data = await response.json() as { error?: string; image: unknown };
        if (!response.ok) throw new Error(data.error || "图片上传失败，请重试。");
        const image = imageSchema.parse(data.image);
        setRecords(prev => prev.map(r => r.id === recordId ? { ...r, images: [...r.images, image] } : r)); setDirty(true);
      }
    } catch (e) { setError((e as Error).message); }
    finally { operationLock.current = false; setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (operationLock.current) return;
    operationLock.current = true; setSaving(true); setError("");
    try {
      const cleanSources = sources.filter(s => s.url.trim()).map(s => ({ ...s, url: s.url.trim() }));
      const clips = records.filter(hasRecordContent).map(r => ({ ...r, sourceUrl: cleanSources[0]?.url || "", sourceTitle: cleanSources[0]?.label || fields.title, videoTime: null }));
      const parsed = fieldsSchema.safeParse({ ...fields, ...(!baseNote ? { summary: "", thought: "", images: [], clips } : {}), sources: cleanSources });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const payload = baseNote ? { id: baseNote.id, revision: baseNote.revision, action: "edit_metadata", metadata: metadataSchema.parse(parsed.data) } : { id: id.current, fields: parsed.data };
      const data = await api(payload, baseNote ? "PATCH" : "POST"); onSave(data.note);
    } catch (e) { setError((e as Error).message); if ((e as {status?: number}).status === 409) setConflict(true); }
    finally { operationLock.current = false; setSaving(false); }
  }
  return <Modal title={state.note ? "编辑基础信息" : "添加笔记"} onClose={close} className={`editor-modal${state.note ? " metadata-modal" : " create-note-modal"}`}><form ref={formRef} onSubmit={save} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); formRef.current?.requestSubmit(); } }}>
    <div className="editor-body">{state.note ? <>
      <label className="metadata-field"><span>标题</span><textarea className="metadata-title" aria-label="笔记标题" rows={3} maxLength={200} value={fields.title} onChange={e => update("title", e.target.value)} placeholder="笔记标题"/></label>
      <div className="metadata-grid"><label className="metadata-field"><span>内容类型</span><select aria-label="内容类型" value={fields.kind} onChange={e => update("kind", e.target.value as Kind)}>{Object.entries(kinds).map(([k, label]) => <option value={k} key={k}>{label}</option>)}</select></label><label className="metadata-field"><span>阅读状态</span><select aria-label="阅读状态" value={fields.status} onChange={e => update("status", e.target.value as Fields["status"])}><option value="read">已读完</option><option value="reading">正在读</option><option value="inbox">待阅读</option></select></label></div>
      <div className="metadata-source-heading">来源链接</div>
    </> : <>
<div className="editor-top"><div className="kind-picker">{Object.entries(kinds).map(([k, label]) => { const Icon = icons[k as Kind]; return <button type="button" className={fields.kind === k ? "selected" : ""} key={k} onClick={() => update("kind", k as Kind)}><Icon size={15}/>{label}</button>; })}</div><select aria-label="阅读状态" value={fields.status} onChange={e => update("status", e.target.value as Fields["status"])}><option value="read">已阅读</option><option value="reading">正在读</option><option value="inbox">待阅读</option></select></div>
    <input className="title-input" aria-label="笔记标题" placeholder="笔记标题" maxLength={200} value={fields.title} onChange={e => update("title", e.target.value)} autoFocus/>
    </>}
    <div className="source-fields">{sources.map((s, i) => <div className="source-field" key={i}><Link2 size={16}/><input aria-label={`来源链接 ${i + 1}`} placeholder="粘贴文章或视频链接（可稍后补充）" value={s.url} onChange={e => { setSources(prev => prev.map((v, j) => j === i ? { ...v, url: e.target.value } : v)); setDirty(true); }}/>{sources.length > 1 && <button type="button" className="icon-button" aria-label={`移除来源 ${i + 1}`} onClick={() => { setSources(prev => prev.filter((_, j) => j !== i)); setDirty(true); }}><X size={14}/></button>}</div>)}{sources.length < 10 && <button type="button" className="text-button add-source" onClick={() => setSources(prev => [...prev, { url: "", label: "" }])}><Plus size={13}/>再加一个来源</button>}</div>
    {!state.note && <section className="new-note-records" aria-label="记录想法"><div className="new-records-heading"><h3>记录想法</h3><span>每条都可以放文字和图片</span></div>
      {records.map((record, index) => <fieldset className="new-record" key={record.id} disabled={saving || uploading} aria-label={`想法 ${index + 1}`} onPaste={e => { const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); e.stopPropagation(); void upload(record.id, files); } }} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void upload(record.id, Array.from(e.dataTransfer.files)); } }}>
        <legend>想法 {index + 1}</legend>{records.length > 1 && <button type="button" className="text-button remove-new-record" aria-label={`移除想法 ${index + 1}`} onClick={() => { if (!hasRecordContent(record) || window.confirm("移除这条还未保存的想法？")) { setRecords(prev => prev.filter(r => r.id !== record.id)); setDirty(true); } }}><X size={13}/>移除</button>}
        <label className="editor-field"><span>原文摘录 <small>选填</small></span><MarkdownTextarea aria-label={`想法 ${index + 1} 的原文摘录`} rows={2} maxLength={20000} placeholder="添加原文摘录…" value={record.text} onChange={e => changeRecord(record.id, { text: e.target.value })}/></label>
        <label className="editor-field personal-field"><span>我的想法</span><MarkdownTextarea ref={el => { if (el && pendingFocus.current === record.id) { pendingFocus.current = null; el.focus(); } }} aria-label={`想法 ${index + 1} 的内容`} rows={3} maxLength={20000} placeholder="添加想法…" value={record.thought} onChange={e => changeRecord(record.id, { thought: e.target.value })}/></label>
        {record.images.length > 0 && <div className="editor-images">{record.images.map(img => <div key={img.key}><MediaImage src={imageUrl(img.key)} alt={img.name}/><button type="button" aria-label={`移除想法 ${index + 1} 的图片 ${img.name}`} onClick={() => changeRecord(record.id, { images: record.images.filter(i => i.key !== img.key) })}><X size={13}/></button></div>)}</div>}
        <button type="button" className="image-upload" onClick={() => { imageTarget.current = record.id; fileRef.current?.click(); }} disabled={record.images.length >= 30}>{uploading && imageTarget.current === record.id ? <Loader2 className="spin" size={16}/> : <ImagePlus size={16}/>}添加图片<span>也可粘贴或拖入 · 单张不超过 8 MB</span></button>
      </fieldset>)}
      <MarkdownHelp/><button type="button" className="secondary add-record" disabled={saving || uploading || records.length >= 500} onClick={addRecord}><Plus size={16}/>添加更多想法</button>
      <input ref={fileRef} type="file" aria-label="添加想法图片" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={e => { if (imageTarget.current) void upload(imageTarget.current, Array.from(e.target.files || [])); }}/>
    </section>}
    <div className="editor-metadata"><TagPicker value={fields.tags} available={availableTags} onManage={onManageTags} onChange={value => update("tags", value)}/><label><span>内容发布时间</span><input value={fields.published} maxLength={30} placeholder="如：2026.10 或 2026.10.30" onChange={e => update("published", e.target.value)}/></label>{["video", "podcast"].includes(fields.kind) && <label><span>关键时间点</span><input value={fields.timestamp} maxLength={30} placeholder="如：36:10" onChange={e => update("timestamp", e.target.value)}/></label>}</div>
    {error && <div className="field-error" role="alert">{error}{conflict && <><p>请先复制需要保留的输入，再载入最新版本。</p><button type="button" className="secondary compact" onClick={async () => { if (!window.confirm("载入最新版本会替换当前未保存的输入。确定继续吗？")) return; try { const latest = (await api()).notes.find(n => n.id === baseNote?.id); if (!latest) throw new Error("找不到最新笔记。"); setBaseNote(latest); setFields(fieldsSchema.parse(latest)); setSources(latest.sources.length ? latest.sources : [{url: "", label: ""}]); setConflict(false); setError(""); setDirty(false); } catch(e) { setError((e as Error).message); } }}>载入最新版本</button></>}</div>}</div>
    <div className="editor-footer"><span/><div><button type="button" className="secondary" onClick={close} disabled={saving || uploading}>取消</button><button className="primary" disabled={saving || uploading}>{saving ? <Loader2 className="spin" size={16}/> : <Check size={16}/>}{state.note ? "保存基础信息" : "保存笔记"} <kbd>⌘ ↵</kbd></button></div></div>
  </form></Modal>;
}

function DataDialog({ notes, onClose, onRefresh, notify }: { notes: Note[]; onClose: () => void; onRefresh: () => Promise<void>; notify: (message: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const date = new Date().toISOString().slice(0, 10);
  return <Modal title="导入与导出" onClose={() => { if (!busy) onClose(); }} className="data-modal"><div className="export-option"><div><h3>JSON 备份</h3><p>包含全部 {notes.length} 条笔记及已移除的内容，可重新导入当前空间。{isLocalLibrary()?"图片仍引用当前资料库，跨电脑请使用完整文件夹备份。":"图片以云端引用保留；原文副本请在阅读窗口单独导出。"}</p></div><button className="secondary" onClick={() => download(`Clips备份-${date}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), notes }, null, 2), "application/json")}><ArrowDownToLine size={16}/>导出备份</button></div><div className="export-option"><div><h3>Markdown</h3><p>导出正文、来源和回顾。{isLocalLibrary()?"图片使用资料库中的相对路径。":"图片链接需登录当前空间访问。"}</p></div><button className="secondary" onClick={() => download(`Clips笔记-${date}.md`, toMarkdown(notes.filter(n => !n.deletedAt)), "text/markdown;charset=utf-8")}><ArrowDownToLine size={16}/>导出文字</button></div><div className="export-option"><div><h3>导入Clips备份</h3><p>导入 JSON 备份，已有笔记会跳过。最多 1,000 条 / 2 MB。</p></div><button className="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="spin" size={16}/> : <Plus size={16}/>}选择备份</button><input ref={input} hidden type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setBusy(true); setError(""); try { if (file.size > 2_000_000) throw new Error("文件大于 2 MB，请分批导入。"); const backup = JSON.parse(await file.text()); if (backup.version !== 1 || !Array.isArray(backup.notes) || backup.notes.length > 1000) throw new Error("备份格式无效。"); backup.notes = noteSchema.array().max(1000).parse(backup.notes); const result = await api({ action: "import", backup }, "POST"); await onRefresh(); notify(`已导入 ${result.added} 条，跳过 ${result.skipped} 条已有笔记`); } catch (err) { setError(err instanceof SyntaxError ? "这不是有效的 JSON 备份文件。" : (err as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ""; } }}/></div>{error && <p className="field-error" role="alert">{error}</p>}{isLocalLibrary()&&<div className="export-option"><div><h3>完整资料库</h3><p>备份笔记、图片、字幕和对话。</p></div><button className="secondary" onClick={openStorage}>文件夹与备份</button><a href={pageURL("/?view=trash")}>已删除笔记</a></div>}<p className="data-note"><CircleHelp size={16}/>图片文件可在笔记中打开后另存。备份文件不会复制图片本身。</p></Modal>;
}

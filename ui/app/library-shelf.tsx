"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { draftStorage } from "./client-runtime";
import { kinds, type Note } from "./model";
import type { LibraryRecord } from "./library-records";
import { formatPublicationMonth } from "./publication-month";
import "./library-desk-shelf.css";

type ShelfProps = {
  notes: Note[];
  records: LibraryRecord[];
  limit: number;
  onOpen: (note: Note) => void;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
};

const sections = [
  { status: "reading", title: "继续阅读", label: "正在读" },
  { status: "read", title: "已读完", label: "已读完" },
] as const;

function shelfTitle(note: Note) {
  if (note.title.trim()) return note.title;
  const source = note.sources[0];
  if (source?.label) return source.label;
  if (source?.url) {
    try { return new URL(source.url).hostname; } catch {}
  }
  return "未命名笔记";
}

function activityLabel(date: string) {
  const at = new Date(date);
  const now = new Date();
  if (Number.isNaN(at.getTime())) return "";
  if (at.toDateString() === now.toDateString()) {
    return "今天 " + at.toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit", hour12: false});
  }
  return at.toLocaleDateString("zh-CN", {year: at.getFullYear() === now.getFullYear() ? undefined : "numeric", month: "short", day: "numeric"});
}

function ShelfCard({ note, onOpen, status, stamp, stampLabel, lastRead = false }: {
  note: Note; onOpen: (note: Note) => void; status: string; stamp: string; stampLabel: string; lastRead?: boolean;
}) {
  const title = shelfTitle(note);
  const tags = note.tags.join(" / ");
  const published = formatPublicationMonth(note.published);
  const date = activityLabel(stamp);
  return <button type="button" className="shelf-card" aria-label={`打开《${title}》`} onClick={() => onOpen(note)}>
    <span className="shelf-card-top"><span>{kinds[note.kind]}</span>{published && <span className="shelf-published" title={`发布于 ${published}`}><span className="shelf-publication-prefix">发布于 </span>{published}</span>}</span>
    <strong className="shelf-title" title={title}>{title}</strong>
    <span className="shelf-footer">{tags && <span className="shelf-tags" title={tags}>{tags}</span>}
      <span className="shelf-status" data-last-read={lastRead}>{status}</span>
      {date && <time dateTime={stamp} title={stamp} className="shelf-stamp">{stampLabel} {date}</time>}
    </span>
  </button>;
}

export function StoredShelf({ notes, deleted, onOpen, onRestore, busy }: {
  notes: Note[]; deleted: boolean; onOpen: (note: Note) => void; onRestore: (note: Note) => void; busy: boolean;
}) {
  return <section className="library-shelf" aria-label={deleted ? "已删除笔记" : "已归档笔记"}>
    <div className="shelf-grid">{notes.map(note => <article className="shelf-item" key={note.id}>
      <ShelfCard note={note} onOpen={onOpen} status={deleted ? "已删除" : "已归档"}
        stamp={deleted ? note.deletedAt || note.updatedAt : note.updatedAt} stampLabel={deleted ? "删除" : "更新"}/>
      <button className="shelf-more shelf-restore" type="button" disabled={busy} onClick={() => onRestore(note)}
        aria-label={`${deleted ? "恢复" : "取消归档"}《${shelfTitle(note)}》`}>{deleted ? "恢复" : "取消归档"}</button>
    </article>)}</div>
  </section>;
}

export default function LibraryShelf({ notes, records, limit, onOpen, onEdit, onDelete }: ShelfProps) {
  const latestRecord = useMemo(() => {
    // libraryRecords orders dated entries newest first. An undated entry isn't a reading timestamp.
    const byNote = new Map<string, string>();
    for (const row of records) {
      if (row.at && !byNote.has(row.note.id)) byNote.set(row.note.id, row.at);
    }
    return byNote;
  }, [records]);
  const [lastReadId, setLastReadId] = useState<string | null>(null);
  useEffect(() => {
    function readLastOpened() {
      try { setLastReadId(draftStorage.getItem("clips-library-last-reading")); } catch {}
    }
    readLastOpened();
    window.addEventListener("storage", readLastOpened);
    return () => window.removeEventListener("storage", readLastOpened);
  }, []);
  const [menuId, setMenuId] = useState<string | null>(null);
  const activeCard = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menuId) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !activeCard.current?.contains(event.target)) setMenuId(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuId]);
  function closeActions() {
    activeCard.current?.querySelector<HTMLButtonElement>(".shelf-more")?.focus();
    setMenuId(null);
  }

  return <div className="library-shelf">{sections.map(section => {
    const entries = notes.filter(note => note.status === section.status);
    if (!entries.length) return null;
    if (section.status === "reading") {
      const lastIndex = entries.findIndex(note => note.id === lastReadId);
      if (lastIndex > 0) entries.unshift(...entries.splice(lastIndex, 1));
    }
    return <section className="shelf-section" key={section.status} aria-label={section.title}>
      <header className="shelf-header"><h2>{section.title}</h2><span>{entries.length} 篇</span></header>
      <div className="shelf-grid">{entries.slice(0, limit).map(note => {
        const title = shelfTitle(note);
        const latest = latestRecord.get(note.id);
        const stamp = latest || note.createdAt;
        const lastRead = section.status === "reading" && note.id === lastReadId;
        const active = menuId === note.id;
        return <article key={note.id} ref={active ? activeCard : undefined} className="shelf-item" data-menu-open={active}
          onBlur={event => { if (active && !event.currentTarget.contains(event.relatedTarget)) setMenuId(null); }}
          onKeyDown={event => { if (event.key === "Escape" && active) closeActions(); }}>
          <ShelfCard note={note} onOpen={onOpen} status={lastRead ? "上次阅读" : section.label}
            stamp={stamp} stampLabel={latest ? "记录" : "收藏"} lastRead={lastRead}/>
          <button type="button" className="shelf-more" aria-expanded={active}
            aria-controls={active ? `shelf-actions-${note.id}` : undefined}
            aria-label={`《${title}》更多操作`} onClick={() => setMenuId(active ? null : note.id)}>
            <MoreHorizontal size={16} aria-hidden="true"/>
          </button>
          {active && <div id={`shelf-actions-${note.id}`} className="shelf-actions" role="group" aria-label={`《${title}》快捷操作`}>
            <button type="button" className="shelf-edit" onClick={() => { closeActions(); onEdit(note); }}>编辑基础信息</button>
            <button type="button" className="shelf-delete" onClick={() => { closeActions(); onDelete(note); }}>删除</button>
          </div>}
        </article>;
      })}</div>
    </section>;
  })}</div>;
}

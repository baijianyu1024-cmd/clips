"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { kinds, type Note } from "./model";
import type { LibraryRecord } from "./library-records";
import { formatPublicationMonth } from "./publication-month";

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

export default function LibraryShelf({ notes, records, limit, onOpen, onEdit, onDelete }: ShelfProps) {
  const latestRecord = useMemo(() => {
    // libraryRecords orders dated entries newest first. An undated entry isn't a reading timestamp.
    const byNote = new Map<string, string>();
    for (const row of records) {
      if (row.at && !byNote.has(row.note.id)) byNote.set(row.note.id, row.at);
    }
    return byNote;
  }, [records]);
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

  return <div className="library-shelf">{sections.map(section => {
    const entries = notes.filter(note => note.status === section.status);
    if (!entries.length) return null;
    return <section className="shelf-section" key={section.status} aria-label={section.title}>
      <header className="shelf-header"><h2>{section.title}</h2><span>{entries.length} 篇</span></header>
      <div className="shelf-grid">{entries.slice(0, limit).map(note => {
        const title = shelfTitle(note);
        const tags = note.tags.join(" / ");
        const published = formatPublicationMonth(note.published);
        const latest = latestRecord.get(note.id);
        const stamp = latest || note.createdAt;
        const date = activityLabel(stamp);
        const active = menuId === note.id;
        return <article key={note.id} ref={active ? activeCard : undefined} className="shelf-item" data-menu-open={active}
          onBlur={event => { if (active && !event.currentTarget.contains(event.relatedTarget)) setMenuId(null); }}
          onKeyDown={event => { if (event.key === "Escape" && active) { setMenuId(null); event.currentTarget.querySelector<HTMLButtonElement>(".shelf-more")?.focus(); } }}>
          <button type="button" className="shelf-card" aria-label={`打开《${title}》`} onClick={() => onOpen(note)}>
            <span className="shelf-card-top"><span>{kinds[note.kind]}</span>{published && <span className="shelf-published" title={`发布于 ${published}`}>发布于 {published}</span>}</span>
            <strong className="shelf-title" title={title}>{title}</strong>
            <span className="shelf-footer">{tags && <span className="shelf-tags" title={tags}>{tags}</span>}
              <span className="shelf-status">{section.label}</span>
              {date && <time dateTime={stamp} title={stamp} className="shelf-stamp">{latest ? "记录" : "收藏"} {date}</time>}
            </span>
          </button>
          <div className="shelf-actions" role="group" aria-label={`《${title}》快捷操作`}>
            <button type="button" className="shelf-more" aria-expanded={active} aria-label={`《${title}》更多操作`} onClick={() => setMenuId(active ? null : note.id)}>⋯</button>
            <button type="button" className="shelf-edit" aria-label={`编辑《${title}》的基础信息`} onClick={() => { setMenuId(null); onEdit(note); }}>编辑</button>
            <button type="button" className="shelf-delete" aria-label={`删除《${title}》`} onClick={() => { setMenuId(null); onDelete(note); }}>删除</button>
          </div>
        </article>;
      })}</div>
    </section>;
  })}</div>;
}

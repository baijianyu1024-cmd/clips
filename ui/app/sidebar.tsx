"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArrowDownToLine, BookOpen, FolderOpen, Inbox, Layers3, MessagesSquare, PanelLeftOpen, Plus, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import { MediaImage, isLocalLibrary, openStorage, pageURL } from "./client-runtime";
import type { Note } from "./model";
import { tagKey } from "./tag-model";
import "./desk-shell.css";

type Collection = "all" | "inbox" | "archive" | "trash";
type SidebarProps = {
  notes: Note[];
  tags: string[];
  view: Collection | "learn";
  tag?: string;
  onNavigate?: (view: Collection) => void;
  onTag?: (tag: string) => void;
  onTags?: () => void;
  onData?: () => void;
};

export default function Sidebar({ notes, tags, view, tag = "", onNavigate, onTag, onTags, onData }: SidebarProps) {
  const local = isLocalLibrary();
  const settingsLabel = local ? "阅读设置" : "浏览器插件";
  const current = view === "all" && tag ? "tag" : view;
  const activeNotes = notes.filter(note => !note.deletedAt && !note.archived);
  const inboxCount = activeNotes.filter(note => note.status === "inbox").length;
  const go = (path: string) => window.location.assign(pageURL(path));
  function collectionButton(value: Collection, label: string, Icon: LucideIcon, count?: number) {
    const selected = current === value;
    return <button aria-label={label} title={label} aria-current={selected ? "page" : undefined}
      className={selected ? "nav-item active" : "nav-item"} onClick={() => onNavigate ? onNavigate(value) : go(`/?view=${value}`)}>
      <Icon size={18}/><span>{label}</span>{!!count && <span className="nav-count">{count}</span>}
    </button>;
  }
  return <aside className="sidebar">
    <a className="brand" href={pageURL("/")} aria-label="Clips首页">
      <MediaImage src={pageURL("/favicon.svg")} alt=""/><span>Clips</span>
    </a>
    <nav aria-label="笔记导航">
      {collectionButton("all", "笔记库", BookOpen, activeNotes.length - inboxCount)}
      {collectionButton("inbox", "待阅读", Inbox, inboxCount)}
      <a className={current === "learn" ? "nav-item active" : "nav-item"} href={pageURL("/learn")} title="对话"
        aria-current={current === "learn" ? "page" : undefined}><MessagesSquare size={18}/><span>对话</span></a>
    </nav>
    <div className="topics">
      <div className="sidebar-label">标签 <button className="manage-tags-link" aria-label="管理标签"
        onClick={() => onTags ? onTags() : go("/?manage=tags")}>管理</button></div>
      {tags.length ? tags.map(name => {
        const selected = current === "tag" && tagKey(tag) === tagKey(name);
        return <button key={name} title={name} aria-current={selected ? "page" : undefined}
          className={selected ? "topic selected" : "topic"} onClick={() => onTag ? onTag(name) : go(`/?tag=${encodeURIComponent(name)}`)}>
          <span>#</span>{name}
        </button>;
      }) : <p className="topic-hint">暂无标签</p>}
    </div>
    <div className="sidebar-bottom">
      <a className="nav-item" href={pageURL("/extension-bridge")} title={settingsLabel}><Layers3 size={17}/><span>{settingsLabel}</span></a>
      {collectionButton("archive", "已归档", Archive)}
      {collectionButton("trash", "已删除", Trash2)}
      <button className="nav-item" title="导入与导出" aria-label="导入与导出" onClick={() => onData ? onData() : go("/?manage=data")}>
        <ArrowDownToLine size={17}/><span>导入与导出</span>
      </button>
      {local && <button className="nav-item" title="资料库与备份" aria-label="资料库与备份" onClick={openStorage}>
        <FolderOpen size={17}/><span>资料库与备份</span>
      </button>}
      <div className="personal"><span className="avatar">{local ? "C" : "K"}</span>
        <div>我的笔记<small>{local ? "本地文件夹" : "仅自己可见"}</small></div><span className="status-dot" title="私人笔记空间"/>
      </div>
    </div>
  </aside>;
}

export function MobileNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    dialog?.showModal();
    const wide = window.matchMedia("(min-width: 651px)");
    const onResize = () => { if (wide.matches) dialog?.close(); };
    wide.addEventListener("change", onResize);
    return () => wide.removeEventListener("change", onResize);
  }, [open]);
  return <>
    <button type="button" className="desk-nav-toggle" aria-label="资料库导航" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}><PanelLeftOpen size={18}/></button>
    {open && <dialog ref={ref} className="desk-navigation" aria-label="资料库导航" onClose={() => setOpen(false)}
      onClick={e => { if (e.target === e.currentTarget || (e.target instanceof Element && e.target.closest("button,a"))) ref.current?.close(); }}>
      {children}
    </dialog>}
  </>;
}

export function DeskHeader({ title, navigation, count, onRefresh, onCreate }: {
  title: string; navigation: ReactNode; count?: string; onRefresh?: () => void; onCreate?: () => void;
}) {
  return <header className="library-heading">
    <div className="library-heading-title">
      <MobileNavigation>{navigation}</MobileNavigation>
      <h1 title={title}>{title}</h1>
      {count && <span className="library-overview" aria-live="polite">{count}</span>}
    </div>
    <div className="library-heading-actions">
      {onRefresh && <button type="button" className="icon-button desk-refresh" title="刷新笔记" aria-label="刷新笔记" onClick={onRefresh}><RotateCcw size={15}/></button>}
      {onCreate && <button type="button" className="primary compact library-add" onClick={onCreate}><Plus size={15}/>新建笔记</button>}
    </div>
  </header>;
}

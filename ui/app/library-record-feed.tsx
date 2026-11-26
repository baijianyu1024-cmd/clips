"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { renderRecordPreview } from "@/extension/markdown.js";
import { MediaImage } from "./client-runtime";
import DeleteRecord from "./delete-record";
import type { LibraryRecord } from "./library-records";
import Markdown from "./markdown";
import { titleOf, type Note } from "./model";
import { formatPublicationMonth } from "./publication-month";
import "./library-record-feed.css";

type FeedProps = {
  records: LibraryRecord[];
  onOpen: (record: LibraryRecord) => void;
  onUpdate: (note: Note) => void;
  editing: string | null;
  onEdit: (key: string | null) => void;
  renderEditor: (record: LibraryRecord) => ReactNode;
  onPreview: (key: string) => void;
};

const fullDate = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" });
const clockTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export default function RecordFeed({ records, onOpen, onUpdate, editing, onEdit, renderEditor, onPreview }: FeedProps) {
  const days = new Map<string, { date: Date | null; records: LibraryRecord[] }>();
  for (const record of records) {
    const at = Date.parse(record.at || "");
    const date = Number.isFinite(at) ? new Date(at) : null;
    const label = date ? fullDate.format(date) : "时间未记录";
    const group = days.get(label);
    if (group) group.records.push(record);
    else days.set(label, { date, records: [record] });
  }

  return <div className="record-feed">
    {Array.from(days, ([label, group]) => <section className="record-day" key={label} aria-label={label}>
      <h2 className="record-day-heading">{label}</h2>
      <div className="record-day-entries">
        {group.records.map(record => {
          const title = titleOf(record.note);
          const published = formatPublicationMonth(record.note.published);
          const isEditing = editing === record.key;
          return <article className="library-record" key={record.key} data-record-key={record.key}>
            <header className="record-heading">
              <span className="record-kind">{record.label}</span>
              {group.date && record.at && <time dateTime={record.at}>{clockTime.format(new Date(record.at))}</time>}
              <div className="record-actions">
                {!isEditing && <button className="library-edit" type="button" onClick={() => onEdit(record.key)}>编辑</button>}
                <DeleteRecord note={record.note} kind={record.type} id={record.id} onUpdate={onUpdate}
                  onDeleted={() => { if (isEditing) onEdit(null); }}/>
              </div>
            </header>
            {isEditing ? renderEditor(record) : <RecordContent record={record} onPreview={onPreview}/>}
            <footer className="record-origin">
              <button type="button" className="library-source" title={title} aria-label={`打开笔记：${title}`} onClick={() => onOpen(record)}>
                <BookOpen size={14} aria-hidden="true"/><span>{title}</span>
              </button>
              {published && <span className="content-published">发布于 {published}</span>}
            </footer>
          </article>;
        })}
      </div>
    </section>)}
  </div>;
}

function RecordContent({ record, onPreview }: Pick<FeedProps, "onPreview"> & { record: LibraryRecord }) {
  const hasThought = Boolean(record.thought.trim());
  const original = record.disclosureOriginal || record.text;
  const hasSource = Boolean(original || record.translation || record.pending);
  const source = <>
    {original && <Markdown className="library-copy">{original}</Markdown>}
    {record.translation && <div className="record-translation">
      <small>中文译文</small><Markdown className="library-copy">{record.translation}</Markdown>
    </div>}
    {record.pending && <p className="library-placeholder">中文译文待补齐</p>}
  </>;
  return <>
    {(hasThought || hasSource) && <ExpandableText text={hasThought ? record.thought : original}
      translation={hasThought ? undefined : record.translation} pending={!hasThought && record.pending}/>}
    {hasThought && hasSource && <details className="record-quotation">
      <summary><ChevronDown size={14} aria-hidden="true"/>关联原文</summary>
      <blockquote>{source}</blockquote>
    </details>}
    {record.images?.length > 0 && <div className="record-thumbnails">
      {record.images.map(image => <button type="button" key={image.key} onClick={() => onPreview(image.key)}
        title={image.name} aria-label={`放大图片：${image.name}`}>
        <MediaImage src={`/api/media?key=${encodeURIComponent(image.key)}`} loading="lazy" alt={image.name}/>
      </button>)}
    </div>}
  </>;
}

type Preview = ReturnType<typeof renderRecordPreview>;

function PreviewBody({ part, expanded }: { part: Preview; expanded: boolean }) {
  const html = expanded ? part.html : part.previewHtml;
  const markup = useMemo(() => ({ __html: html }), [html]);
  return <div className="markdown-body library-copy" data-clamp={part.clampParagraph && !expanded}
    dangerouslySetInnerHTML={markup}/>;
}

function ExpandableText({ text, translation, pending }: { text: string; translation?: string; pending?: boolean }) {
  const main = useMemo(() => text ? renderRecordPreview(text) : null, [text]);
  const translated = useMemo(() => translation ? renderRecordPreview(translation) : null, [translation]);
  const hasHiddenBlocks = main?.html !== main?.previewHtml || translated?.html !== translated?.previewHtml;
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [clipped, setClipped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const paragraphs = Array.from(el.querySelectorAll<HTMLElement>('[data-clamp="true"] > p:last-child'));
    const measure = () => setClipped(paragraphs.some(p => p.scrollHeight > p.clientHeight + 1));
    measure();
    if (!paragraphs.length) return;
    const observer = new ResizeObserver(measure);
    paragraphs.forEach(p => observer.observe(p));
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [expanded, main, translated]);
  return <>
    <div ref={ref} id={id} className="record-text" data-expanded={expanded}
      onFocusCapture={event => {
        const p = event.target.closest('[data-clamp="true"] > p:last-child');
        if (p && event.target.getBoundingClientRect().bottom > p.getBoundingClientRect().bottom + 1) setExpanded(true);
      }}>
      {main && <PreviewBody part={main} expanded={expanded}/>}
      {translated && <div className="record-translation">
        <small>中文译文</small><PreviewBody part={translated} expanded={expanded}/>
      </div>}
      {pending && <p className="library-placeholder">中文译文待补齐</p>}
    </div>
    {(hasHiddenBlocks || clipped || expanded) && <button type="button" className="library-expand"
      aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? "收起" : "展开全部"}<ChevronDown size={13} aria-hidden="true"/>
    </button>}
  </>;
}

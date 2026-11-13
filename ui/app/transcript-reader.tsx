"use client";
import {request} from "./client-runtime";
import Markdown from "./markdown";
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Search, X } from "lucide-react";
import type { TranscriptAssist } from "@/lib/transcript-assist-model";
import { transcriptText, overviewClip } from "@/extension/youtube.js";
import type { Note } from "./model";
import type { Transcript } from "@/lib/transcript-model";
import { youtubeUrl } from "@/extension/youtube.js";
import "./transcript-reader.css";
const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export default function TranscriptReader({ note, snapshotId, from, to, onClose, onUpdate }: { note: Note; onUpdate: (note: Note) => void; snapshotId: string; from?: number; to?: number; onClose: () => void }) {
  const noteId = note.id;
  const [adding, setAdding] = useState(false), [saveMessage, setSaveMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<Transcript | null>(null), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [page, setPage] = useState(Math.floor((from ?? 0) / 80));
  const [assist, setAssist] = useState<TranscriptAssist>({ overview: null, translations: {}, quoteTranslations: {} });
  const [tab, setTab] = useState("transcript"), [mode, setMode] = useState("original");
  const [focus, setFocus] = useState<{ from: number; to: number } | null>(from === undefined ? null : { from, to: to ?? from });
  const [retry, setRetry] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    request(`/api/transcripts?note=${noteId}&id=${snapshotId}`, { cache: "no-store", signal: controller.signal }).then(async r => { const data = await r.json() as { snapshot: Transcript; assist?: TranscriptAssist; error?: string }; if (!r.ok) throw new Error(data.error || "无法打开字幕，请重试。"); setSnapshot(data.snapshot); setAssist(data.assist || { overview: null, translations: {}, quoteTranslations: {} }); if (from === undefined && data.assist?.overview) setTab("overview"); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [noteId, snapshotId, retry]);
  useEffect(() => { if (snapshot && focus && !query) dialog.current?.querySelector(`[data-segment="${focus.from}"]`)?.scrollIntoView({ block: "center" }); }, [snapshot, focus, query, page, tab]);
  const matches = (snapshot?.segments || []).map((s, i) => ({ ...s, i })).filter(s => `${mode !== "zh" ? s.text : ""} ${mode !== "original" ? assist.translations[s.i]?.text || "" : ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pages = Math.ceil(matches.length / 80);
  async function addOverview() {
    if (!snapshot || !assist.overview || adding) return;
    setAdding(true); setSaveMessage("");
    const clip = overviewClip(assist.overview, snapshot);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await request("/api/notes", { cache: "no-store" });
        const latest = await response.json() as { notes: Note[]; error?: string };
        if (!response.ok) throw new Error(latest.error || "无法读取笔记，请重试。");
        const current = (latest.notes as Note[]).find(n => n.id === noteId);
        if (!current) throw new Error("找不到这篇笔记。");
        const saved = await request("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: noteId, revision: current.revision, action: "add_clip", clip }) });
        const data = await saved.json() as { note: Note; error?: string };
        if (saved.status === 409 && attempt < 2) continue;
        if (!saved.ok) throw new Error(data.error || "保存失败，请重试。");
        onUpdate(data.note); setSaveMessage("已添加为一条随读记录，可在笔记详情中继续修改。"); break;
      }
    } catch (e) { setSaveMessage((e as Error).message); }
    finally { setAdding(false); }
  }
  function download() {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify({ ...snapshot, assist }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `youtube-${snapshot.videoId}-transcript.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <dialog ref={dialog} className="modal transcript-reader" onCancel={onClose} aria-label="视频字幕上下文">
    <header><div><small>原始字幕 · 已保存的副本</small><h2>{snapshot?.title || "视频字幕"}</h2></div><button className="icon-button" aria-label="关闭字幕" onClick={onClose}><X size={20}/></button></header>
    {error ? <div className="transcript-error" role="alert">{error}<button className="secondary" onClick={() => setRetry(v => v + 1)}>重试打开</button></div> : !snapshot ? <p className="transcript-loading">正在打开字幕副本…</p> : <>
      <div className="reader-view-tabs" role="tablist" aria-label="视频阅读内容"><button role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>Overview · 概览</button><button role="tab" aria-selected={tab === "transcript"} onClick={() => setTab("transcript")}>字幕</button></div>
      {tab === "overview" ? <div className="reader-overview">{assist.overview ? <><small>AI 概览 · {assist.overview.model} · 基于全部已保存字幕</small><Markdown className="prose">{assist.overview.summary}</Markdown><button className="secondary compact" disabled={adding || note.archived || !!note.deletedAt || note.clips.some(c => c.id === assist.overview!.id)} onClick={() => void addOverview()} title="把上面的概览保存为一条可编辑的随读记录">{note.clips.some(c => c.id === assist.overview!.id) ? "✓ 已添加到笔记" : adding ? "正在保存…" : "＋ 添加到笔记"}</button>{saveMessage && <p className="hint" role="status">{saveMessage}</p>}<h3>章节导航</h3>{assist.overview.chapters.map(c => <a className="reader-chapter" key={c.from} href={youtubeUrl(snapshot.videoId, snapshot.segments[c.from].start)} target="_blank" rel="noopener noreferrer"><time>{stamp(snapshot.segments[c.from].start)}</time><div><strong>{c.title}</strong><p>{c.summary}</p></div><ExternalLink size={13}/></a>)}<h3>关键原话 · 双语</h3>{assist.overview.quotes.map((q,i) => <div className="reader-key-quote" key={i}><blockquote>{transcriptText(snapshot.segments,q.from,q.to)}</blockquote><div className="reader-translation"><small>中文 · AI 译文</small><p>{Array.from({length:q.to-q.from+1}, (_, offset) => assist.translations[q.from+offset]?.text || "中文译文待补齐，在插件中打开 Overview 会自动翻译。").join("\n")}</p></div><button className="text-button" onClick={() => { setTab("transcript"); setQuery(""); setPage(Math.floor(q.from / 80)); setFocus(q); }}>查看 {stamp(snapshot.segments[q.from].start)} 的字幕上下文</button></div>)}</> : <p className="hint">还没有视频概览。在 Chrome 插件中打开这篇视频的字幕，点击「生成 Overview」，即可同步到这里。你的核心摘要仍可在笔记详情中独立整理。</p>}</div> : <>
      <div className="reader-language-modes" aria-label="字幕显示方式">{[["original", "原文"], ["bilingual", "双语"], ["zh", "中文"]].map(([value,label]) => <button key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setQuery(""); setPage(0); }}>{label}</button>)}<small>{Object.keys(assist.translations).length} / {snapshot.segmentCount} 段已翻译 · AI 译文</small></div>
      <div className="transcript-reader-tools"><label><Search size={16}/><input type="search" aria-label="搜索字幕内容" placeholder="在字幕中搜索…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></label><span>{snapshot.language} · {snapshot.segmentCount} 段</span><button className="text-button" onClick={download}><Download size={14}/>导出阅读资料</button><a className="text-button" href={youtubeUrl(snapshot.videoId)} target="_blank" rel="noopener noreferrer">视频<ExternalLink size={13}/></a></div>
      {focus && <div className="transcript-anchor-notice">已标出这条摘录所在的字幕。<button className="text-button" onClick={() => { setQuery(""); setPage(Math.floor(focus.from / 80)); }}>回到摘录位置</button></div>}
      <ol className="transcript-reader-lines">{matches.slice(page * 80, page * 80 + 80).map(s => <li key={s.i} data-segment={s.i} className={focus && s.i >= focus.from && s.i <= focus.to ? "quoted" : ""}><a href={youtubeUrl(snapshot.videoId, s.start)} target="_blank" rel="noopener noreferrer" title={`在视频中打开 ${stamp(s.start)}`}>{stamp(s.start)}<ExternalLink size={11}/></a><div>{mode !== "zh" && <p>{s.text}</p>}{mode !== "original" && <p className="reader-translation">{assist.translations[s.i]?.text || "此段尚未翻译，可在插件中翻译并保存。"}</p>}</div></li>)}{!matches.length && <li className="transcript-no-match">没有找到匹配的字幕。</li>}</ol>
      <footer><small>原生字幕可能含有识别误差 · 保存于 {new Date(snapshot.createdAt).toLocaleDateString("zh-CN")}</small><div><button className="text-button" disabled={!page} onClick={() => setPage(v => v - 1)}>上一页</button><span>{matches.length ? page + 1 : 0} / {pages}</span><button className="text-button" disabled={page + 1 >= pages} onClick={() => setPage(v => v + 1)}>下一页</button></div></footer></> }
    </>}
  </dialog>;
}

"use client";
import {request as fetchRequest} from "./client-runtime";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Check, Link2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { titleOf, type Note } from "./model";
import { sourceUrl } from "@/lib/links";
import { needsLinkTitle, titleUrlKey } from '@/extension/link-metadata.js';
import { browserQueueTitles } from './queue-titles';
import "./reading-queue.css";

async function request(payload: object) {
  const response = await fetchRequest("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { note: Note; existing?: boolean; error?: string };
  if (!response.ok) throw new Error(data.error || "暂时无法保存，链接仍在输入框中。");
  return data;
}
export default function ReadingQueue({ notes, loading, busy, onChange, onRefresh, onStart, onRemove }: {
  notes: Note[]; loading: boolean; busy: boolean; onChange: (note: Note) => void; onRefresh: () => Promise<void>; onStart: (note: Note) => void; onRemove: (note: Note) => void;
}) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const attempted = useRef(new Set<string>()), pendingSave = useRef({ url: "", id: "" });
  const inFlight = useRef(new Set<string>()), latest = useRef(notes);
  latest.current = notes;
  async function resolve(note: Note, browser?: { url: string; title: string }, browserOnly = false) {
    if (inFlight.current.has(note.id)) return;
    inFlight.current.add(note.id);
    attempted.current.add(note.id);
    setResolving(current => new Set(current).add(note.id));
    setFailed(current => { const next = new Set(current); next.delete(note.id); return next; });
    try {
      browser ||= (await browserQueueTitles([note.sources[0].url]))[0];
      const result = await request({ action: "resolve_title", id: note.id, browser, browserOnly }); onChange(result.note);
    }
    catch { setFailed(current => new Set(current).add(note.id)); }
    finally { inFlight.current.delete(note.id); setResolving(current => { const next = new Set(current); next.delete(note.id); return next; }); }
  }
  useEffect(() => {
    // Upgrade old failures once, not on every visit. Never rename custom titles.
    let slots = 3 - inFlight.current.size;
    for (const note of notes) if (slots > 0 && needsLinkTitle(note) && (note.linkTitleStatus === 'pending' || (note.linkTitleVersion || 0) < 2) && !attempted.current.has(note.id)) { slots--; void resolve(note); }
  }, [notes, resolving.size]);
  useEffect(() => {
    let stopped = false, checking = false;
    async function refreshBrowserTitles() {
      if (stopped || checking || document.visibilityState === 'hidden') return;
      const missing = latest.current.filter(needsLinkTitle).filter(n => !inFlight.current.has(n.id));
      if (!missing.length) return;
      checking = true;
      try {
        for (let i = 0; i < missing.length && !stopped; i += 100) {
          const titles = await browserQueueTitles(missing.slice(i, i + 100).map(n => n.sources[0].url));
          for (const item of titles) {
            if (stopped) break;
            const note = latest.current.find(n => needsLinkTitle(n) && titleUrlKey(n.sources[0].url) === titleUrlKey(item.url));
            if (note) await resolve(note, item, true);
          }
        }
      } finally { checking = false; }
    }
    const timer = setInterval(() => void refreshBrowserTitles(), 15000);
    window.addEventListener('focus', refreshBrowserTitles);
    document.addEventListener('visibilitychange', refreshBrowserTitles);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', refreshBrowserTitles); document.removeEventListener('visibilitychange', refreshBrowserTitles); };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const normalized = sourceUrl(url);
    if (!normalized) { setError("粘贴一个完整的 http:// 或 https:// 链接就好。"); return; }
    setSaving(true); setError(""); setMessage("");
    if (pendingSave.current.url !== normalized) pendingSave.current = { url: normalized, id: crypto.randomUUID() };
    try {
      const result = await request({ action: "save_link", id: pendingSave.current.id, url: normalized });
      onChange(result.note); setUrl(""); pendingSave.current = { url: "", id: "" };
      setMessage(result.existing ? result.note.status === "inbox" ? "这条链接已经在待阅读中，无需重复添加。" : "这篇内容已有阅读笔记，没有重复加入待阅读。可以在「笔记库」中继续。" : "已加入待阅读" );
      await onRefresh();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  return <section className="reading-queue" aria-label="待阅读链接清单">
    <form className="queue-capture" onSubmit={save}>
      <label htmlFor="queue-link">添加链接</label>
      <div className="queue-input-row"><Link2 size={19}/><input id="queue-link" aria-label="待阅读链接" value={url} onChange={e => setUrl(e.target.value)} disabled={saving} maxLength={2000} placeholder="粘贴文章、文档或视频链接…" autoComplete="off" inputMode="url"/><button className="primary" disabled={saving || !url.trim()}>{saving ? <Loader2 size={16} className="spin"/> : <Check size={16}/>}存到待阅读</button></div>
      <p>只需一个链接，标题自动获取。点「开始阅读」后移入正在读。</p>
      {error && <div role="alert" className="field-error">{error}</div>}{message && <div role="status" className="queue-message">{message}</div>}
    </form>
    <div className="queue-list-heading"><span>待阅读</span><small>{notes.length} 条链接</small></div>
    {loading ? <p className="queue-empty">正在加载…</p> : !notes.length ? <div className="queue-empty"><BookOpen size={29}/><h2>暂无待阅读链接</h2><p>粘贴文章、文档或视频链接即可添加。</p></div> : <div className="queue-list">{notes.map(note => {
      const waiting = resolving.has(note.id), unavailable = needsLinkTitle(note) && (failed.has(note.id) || note.linkTitleStatus === "unavailable");
      return <article className="queue-item" key={note.id}>
        <div className="queue-item-icon"><BookOpen size={21}/></div>
        <div className="queue-item-body"><h2>{titleOf(note)}</h2><p className="queue-url">{note.sources[0]?.url || "这条旧笔记尚未添加链接"}</p>
          <div className="queue-meta"><time>{new Date(note.createdAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} 收藏</time>{waiting ? <span><Loader2 size={12} className="spin"/>正在获取标题</span> : unavailable ? <><span title="部分页面需要登录或验证。已安装新版 Clips 时，打开原链接后会自动补全标题。">链接已保存，标题待补全</span><button onClick={() => void resolve(note)}><RotateCcw size={12}/>重试标题</button></> : null}</div>
          {(note.summary || note.thought || note.clips.length > 0) && <small className="queue-existing-content">已有记录会随这条链接一起保留</small>}
        </div>
        <div className="queue-item-actions"><button className="secondary" disabled={busy || !note.sources.length} onClick={() => onStart(note)}>开始阅读<ArrowUpRight size={15}/></button><button className="icon-button" disabled={busy} onClick={() => onRemove(note)} aria-label={`移除待阅读：${titleOf(note)}`} title="移到回收站"><Trash2 size={16}/></button></div>
      </article>;
    })}</div>}
    <p className="queue-footnote">在插件中手动开始同一篇内容，也会从这里移出。切换网页不会自动开始笔记。</p>
  </section>;
}

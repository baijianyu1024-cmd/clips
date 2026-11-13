"use client";
import {request, draftStorage, MediaImage} from "./client-runtime";
import Markdown, { MarkdownHelp, MarkdownTextarea } from "./markdown";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, BookOpen, Check, FileText, ImageOff, Link2, Loader2, MessageSquarePlus, RefreshCw, Upload, X } from "lucide-react";
import type { Note } from "./model";
import { canonicalSource, snapshotText, type Article, type Block, type Snapshot } from "@/lib/reader/model";
import { isFeishuDocument } from "@/lib/reader/source";
import { importOriginalFile } from "@/lib/reader/import";
import "./source-reader.css";

type Saved = Pick<Snapshot, "id" | "noteId" | "sourceUrl" | "title" | "createdAt" | "method"> & { blockCount: number };
type Quote = { blockId: string; start: number; end: number; text: string };
type Props = { note: Note; initialUrl?: string; initialSnapshotId?: string; initialBlockId?: string; onClose: () => void; onUpdate: (note: Note) => void };
async function api<T>(path: string, payload?: object) {
  const response = await request(path, { method: payload ? "POST" : "GET", cache: "no-store", headers: payload ? { "Content-Type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
  let data; try { data = await response.json(); } catch { throw new Error("暂时无法连接原文模块，请稍后重试。笔记仍可正常使用。"); }
  if (!response.ok) throw new Error((data as { error?: string })?.error || "操作没有完成，请重试。");
  return data as T;
}
const formatDate = (date: string) => new Date(date).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const host = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

export default function SourceReader({ note, initialUrl, initialSnapshotId, initialBlockId, onClose, onUpdate }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), articleRef = useRef<HTMLElement>(null), seq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(() => initialUrl || note.sources[0]?.url ? canonicalSource(initialUrl || note.sources[0].url) : "");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [preview, setPreview] = useState<Article | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualTitle, setManualTitle] = useState(note.title);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [thought, setThought] = useState("");
  const [highlight, setHighlight] = useState("");
  const [clipId, setClipId] = useState(() => crypto.randomUUID());
  const saveId = useRef(crypto.randomUUID());
  const content = preview || snapshot;
  const dirtyPreview = !!preview;
  const draftKey = snapshot ? `shiye-reader-draft:${note.id}:${snapshot.id}` : "";
  const feishu = isFeishuDocument(url);

  async function load(id: string) {
    const revision = ++seq.current;
    const data = await api<{ snapshot: Snapshot }>(`/api/reader?id=${encodeURIComponent(id)}`);
    if (revision !== seq.current) return;
    setSnapshot(data.snapshot); setPreview(null); setManual(false); setUrl(canonicalSource(data.snapshot.sourceUrl)); setHighlight("");
  }
  useEffect(() => {
    dialog.current?.showModal(); let cancelled = false;
    setBusy("正在找回原文副本…");
    api<{ snapshots: Saved[] }>(`/api/reader?noteId=${note.id}`).then(async data => {
      if (cancelled) return; setSaved(data.snapshots);
      const chosen = initialSnapshotId || data.snapshots.find(s => canonicalSource(s.sourceUrl) === canonicalSource(initialUrl || note.sources[0]?.url || "https://invalid.example"))?.id;
      if (chosen) await load(chosen);
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setBusy(""); });
    return () => { cancelled = true; seq.current++; };
  }, [note.id, initialSnapshotId, initialUrl]);
  useEffect(() => {
    if (!draftKey) { setThought(""); setQuote(null); return; }
    try {
      const value = JSON.parse(draftStorage.getItem(draftKey) || "null");
      setThought(value?.thought || ""); setQuote(value?.quote || null); setClipId(value?.clipId || crypto.randomUUID());
    } catch { setThought(""); setQuote(null); }
  }, [draftKey]);
  useEffect(() => {
    if (snapshot && initialBlockId && initialSnapshotId === snapshot.id) jump(initialBlockId);
  }, [snapshot?.id]);
  function writeDraft(nextQuote: Quote | null, nextThought: string, nextId = clipId) {
    if (!draftKey) return;
    try { draftStorage.setItem(draftKey, JSON.stringify({ quote: nextQuote, thought: nextThought, clipId: nextId })); }
    catch { setError("草稿暂时无法保存在本机，请先复制你的想法。"); }
  }
  function close() {
    if (busy) return;
    if ((dirtyPreview || (manual && manualText.trim())) && !window.confirm("这份正文还没有保存，关闭后需要重新解析或粘贴。关闭吗？")) return;
    onClose();
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return; setBusy(label); setError(""); setMessage("");
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function parse() {
    if (feishu) { setManual(true); setError(""); return; }
    await run("正在读取文章…", async () => {
      const data = await api<{ article: Article }>("/api/reader", { action: "preview", noteId: note.id, url });
      setPreview(data.article); setManual(false); saveId.current = crypto.randomUUID(); setMessage("先检查正文是否完整，再保存这份副本。");
    });
  }
  async function importFile(file: File) {
    if (preview && !window.confirm("导入文件会替换尚未保存的预览，继续吗？")) return;
    await run("正在读取正文文件…", async () => {
      if (file.size > 1000000) throw new Error("正文文件过大，请控制在 1 MB 以内。");
      const article = importOriginalFile(await file.text(), file.name, url, note.title);
      setPreview(article); setManual(false); setManualText(""); saveId.current = crypto.randomUUID();
      setMessage("文件已读入预览，尚未保存。请检查正文和来源后确认。");
    });
  }
  async function saveCopy() {
    if (!preview) return;
    await run("正在保存正文和配图…", async () => {
      const result = await api<{ snapshot: Snapshot }>("/api/reader", { action: "save", id: saveId.current, noteId: note.id, article: preview });
      setSnapshot(result.snapshot); setPreview(null); setHighlight("");
      const list = await api<{ snapshots: Saved[] }>(`/api/reader?noteId=${note.id}`); setSaved(list.snapshots);
      setMessage("原文副本已保存。以后回顾直接从笔记库读取，无需重新访问原网站。");
    });
  }
  function jump(id: string) {
    setHighlight(id);
    articleRef.current?.querySelector(`[data-block="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function chooseQuote(q: Quote) {
    if (!snapshot || preview || note.archived || note.deletedAt) return;
    if (q.text.length > 20000) { setError("一次最多摘录 20,000 字，请缩小选择范围。"); return; }
    if (quote && thought.trim() && (quote.blockId !== q.blockId || quote.start !== q.start || quote.end !== q.end)) {
      setError("先保存当前摘录下的想法，或点击「清空摘录」，再选择另一段。"); return;
    }
    const id = crypto.randomUUID(); setClipId(id); setQuote(q); setHighlight(q.blockId); writeDraft(q, thought, id); setError("");
    if (window.matchMedia("(max-width: 700px)").matches) requestAnimationFrame(() => dialog.current?.querySelector(".reader-composer")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function captureSelection() {
    if (!snapshot || preview) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0), container = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
    const blockElement = container?.closest("[data-text-block]");
    if (!blockElement || !articleRef.current?.contains(blockElement) || !blockElement.contains(range.endContainer)) return;
    const block = snapshot.blocks.find(b => b.id === blockElement.getAttribute("data-text-block")); if (!block) return;
    const before = range.cloneRange(); before.selectNodeContents(blockElement); before.setEnd(range.startContainer, range.startOffset);
    let start = before.toString().length, end = start + range.toString().length;
    while (start < end && /\s/.test(block.text[start])) start++;
    while (end > start && /\s/.test(block.text[end - 1])) end--;
    if (end > start) chooseQuote({ blockId: block.id, start, end, text: block.text.slice(start, end) });
  }
  async function saveThought() {
    if (!snapshot || !quote) return;
    const target = snapshot, captured = quote, text = thought.trim(), id = clipId;
    await run("正在保存这条想法…", async () => {
      const clip = { id, text: captured.text, thought: text, sourceUrl: target.sourceUrl, sourceTitle: target.title.slice(0, 200), createdAt: new Date().toISOString(), videoTime: null, anchor: { snapshotId: target.id, blockId: captured.blockId, start: captured.start, end: captured.end } };
      let result: Note | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { notes } = await api<{ notes: Note[] }>("/api/notes");
        const current = notes.find(n => n.id === note.id); if (!current) throw new Error("找不到这篇笔记。");
        const response = await request("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, revision: current.revision, action: "add_clip", clip }) });
        const data = await response.json() as { note: Note; error: string };
        if (response.ok) { result = data.note; break; }
        if (response.status !== 409 || attempt === 2) throw new Error(data.error || "保存没有完成，草稿已保留。");
      }
      if (!result) throw new Error("保存没有完成，草稿已保留。");
      onUpdate(result);
      if (result.clips.find(c => c.id === id)?.thought !== text) {
        const nextId = crypto.randomUUID(); setClipId(nextId); writeDraft(captured, text, nextId);
        throw new Error("上次保存已成功。你之后的修改仍在草稿中，再点保存会新增一条。");
      }
      setQuote(null); setThought(""); setClipId(crypto.randomUUID()); draftStorage.removeItem(draftKey); setMessage("已保存。点击右侧笔记，可以回到对应原文。");
    });
  }
  function highlightedText(block: Block) {
    if (preview) return block.text;
    const marks = note.clips.filter(c => c.anchor && c.anchor.snapshotId === snapshot?.id && c.anchor.blockId === block.id).map(c => [c.anchor!.start, c.anchor!.end]);
    if (quote?.blockId === block.id) marks.push([quote.start, quote.end]);
    const bounds = [...new Set([0, block.text.length, ...marks.flat()])].filter(n => n >= 0 && n <= block.text.length).sort((a, b) => a - b);
    return bounds.slice(0, -1).map((start, i) => {
      const end = bounds[i + 1], text = block.text.slice(start, end);
      return marks.some(([a, b]) => a <= start && b >= end) ? <mark key={start}>{text}</mark> : <span key={start}>{text}</span>;
    });
  }
  const related = snapshot ? note.clips.filter(c => c.anchor?.snapshotId === snapshot.id) : [];
  const otherClips = note.clips.filter(c => !c.anchor && content && canonicalSource(c.sourceUrl) === canonicalSource(content.sourceUrl));
  const versions = saved.filter(s => canonicalSource(s.sourceUrl) === canonicalSource(url || "https://invalid.example"));

  return <dialog ref={dialog} className="source-reader" aria-label="原文阅读" onCancel={e => { e.preventDefault(); close(); }}>
    <header className="reader-top"><div><BookOpen size={20}/><span>原文副本<small>实验功能</small></span></div><button className="icon-button" onClick={close} disabled={!!busy} aria-label="关闭原文阅读"><X size={20}/></button></header>
    <div className="reader-controls"><label><Link2 size={14}/><select aria-label="选择原文来源" value={url} disabled={!!busy} onChange={e => { const value = e.target.value; if (preview && !window.confirm("切换来源会放弃未保存的预览，继续吗？")) return; setUrl(value); setPreview(null); setSnapshot(null); setManual(false); setError(""); const found = saved.find(s => canonicalSource(s.sourceUrl) === canonicalSource(value)); if (found) void run("正在打开副本…", () => load(found.id)); }}>
      {[...new Map([...note.sources.map(s => [canonicalSource(s.url), s.label || s.url] as const), ...saved.map(s => [canonicalSource(s.sourceUrl), s.title] as const)]).entries()].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label><a href={url} target="_blank" rel="noopener noreferrer">原网站<ArrowUpRight size={13}/></a>{versions.length > 1 && <select aria-label="副本版本" value={snapshot?.id || ""} disabled={!!busy} onChange={e => void run("正在打开副本…", () => load(e.target.value))}>{preview && <option value="">正在预览</option>}{versions.map(s => <option key={s.id} value={s.id}>{formatDate(s.createdAt)}</option>)}</select>}{!feishu && <button className="secondary compact" disabled={!!busy || !url} onClick={parse}><RefreshCw size={13}/>{snapshot ? "重新解析" : "解析链接"}</button>}<button className="secondary compact" disabled={!!busy || !url} onClick={() => fileInput.current?.click()}><Upload size={13}/>导入正文文件</button><button className="text-button" disabled={!!busy} onClick={() => { setManual(!manual); setError(""); }}>{feishu ? "粘贴飞书正文" : "粘贴正文"}</button></div>
    <input ref={fileInput} type="file" hidden accept=".txt,.md,.json" aria-label="选择正文文件" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importFile(file); }}/>
    {(error || message || busy) && <div className={`reader-notice ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{busy ? <><Loader2 size={14} className="spin"/>{busy}</> : error || message}</div>}
    {manual && <form className="reader-manual" onSubmit={e => { e.preventDefault(); void run("正在整理正文…", async () => { const result = await api<{ article: Article }>("/api/reader", { action: "manual", noteId: note.id, url, title: manualTitle, text: manualText }); setPreview(result.article); setManual(false); saveId.current = crypto.randomUUID(); }); }}>{feishu && <p className="reader-import-help">先在飞书中复制正文，再粘贴到下方。复制被文档权限限制时，请联系文档所有者；在浏览器登录飞书不会自动给Clips授权。</p>}<label>文章标题<input aria-label="原文标题" maxLength={300} value={manualTitle} onChange={e => setManualTitle(e.target.value)}/></label><label>粘贴正文<textarea aria-label="粘贴原文内容" rows={5} maxLength={180000} value={manualText} onChange={e => setManualText(e.target.value)} placeholder="从你已打开的文章复制正文。空行会保留为段落。"/></label><div><small>手动副本会明确标注来源方式。</small><button className="primary compact" disabled={!!busy || !manualText.trim()}>预览正文</button></div></form>}
    {!content ? <div className="reader-empty"><div className="reader-pages"><FileText size={42}/></div><h2>{feishu ? "暂不支持自动解析飞书文档" : "尚未保存原文副本"}</h2>{feishu ? <><p>Clips尚未连接你的飞书账号，暂不能直接解析这类链接。<br/>复制正文或导入文件后，就可以在这里阅读、划线和写想法。</p><div className="reader-import-actions"><a className="secondary" href={url} target="_blank" rel="noopener noreferrer">打开飞书文档<ArrowUpRight size={14}/></a><button className="primary" disabled={!!busy} onClick={() => { setManual(true); setError(""); }}>粘贴飞书正文</button></div><button className="text-button" disabled={!!busy} onClick={() => fileInput.current?.click()}><Upload size={14}/>导入正文文件</button><small>支持 .txt、.md 或Clips正文文件（.json）<br/>在你的浏览器登录飞书，不等于已向Clips授权</small></> : <><p>保存一份正文副本，回顾时就能把当时的想法<br/>放回上下文里读一遍。</p><button className="primary" disabled={!!busy || !url} onClick={parse}>解析这篇文章<ArrowUpRight size={16}/></button><small>网页文章可尝试解析 · 在线文档可粘贴或导入正文 · 不调用 AI</small></>}</div> : <>
      {preview && <div className="reader-preview-bar"><div><strong>这是一份预览，还未保存</strong><small>检查正文后确认；原有副本和笔记会继续保留。</small></div><button className="primary compact" disabled={!!busy} onClick={saveCopy}><Check size={15}/>保存原文副本</button>{snapshot && <button className="quiet-reader" disabled={!!busy} onClick={() => setPreview(null)}>返回已保存副本</button>}</div>}
      <div className="reader-layout"><article ref={articleRef} className="reader-paper" onMouseUp={captureSelection} onKeyUp={captureSelection}><div className="reader-origin">{host(content.sourceUrl)}<span>{preview ? "待保存" : `副本保存于 ${formatDate(snapshot!.createdAt)}`}</span></div><h1>{content.title}</h1>{(content.byline || content.published) && <div className="reader-byline">{content.byline}{content.published && ` · ${content.published}`}</div>}<details className="reader-quality"><summary>{content.method === "manual" ? "手动粘贴的正文副本" : content.method === "import" ? "从文件导入的正文副本" : "提取后的正文副本"} · 查看说明</summary>{content.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>
        {content.blocks.map(block => <section key={block.id} data-block={block.id} className={`reader-block block-${block.type} ${highlight === block.id ? "focused" : ""}`}>
          {block.type === "image" ? <figure>{!preview && block.imageKey ? <MediaImage src={`/api/reader/image?id=${snapshot!.id}&block=${block.id}`} alt={block.text || "原文配图"} loading="lazy"/> : <div className="reader-image-placeholder"><ImageOff size={20}/><span>{!block.imageUrl ? "文字副本未包含这张配图，请到原网站查看" : preview ? "配图会在保存时尝试一并留存" : "这张配图未能保存"}</span>{block.text && <small>{block.text}</small>}</div>}{block.imageUrl && <figcaption>{block.text || "原文配图"}</figcaption>}</figure> : <>
            {block.type === "heading" ? <h2 data-text-block={block.id}>{highlightedText(block)}</h2> : block.type === "code" ? <pre data-text-block={block.id}>{highlightedText(block)}</pre> : <p data-text-block={block.id}>{highlightedText(block)}</p>}
            {!preview && !note.deletedAt && !note.archived && <button className="reader-margin-note" title="记下这段" aria-label={`记下第 ${Number(block.id.slice(2)) + 1} 段`} onClick={() => chooseQuote({ blockId: block.id, start: 0, end: block.text.length, text: block.text })}><MessageSquarePlus size={15}/></button>}
          </>}
        </section>)}<div className="reader-end">— 读到这里，再想一想 —</div>{!preview && <button className="text-button" onClick={() => { const blob = new Blob([snapshotText(snapshot!)], { type: "text/markdown;charset=utf-8" }), href = URL.createObjectURL(blob), a = document.createElement("a"); a.href = href; a.download = `${content.title.slice(0, 60).replace(/[\\/:*?"<>|]/g, "-")}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 10000); }}><ArrowDownToLine size={14}/>导出这份正文</button>}</article>
        <aside className="reader-thoughts"><div className="reader-rail-title"><span>读到这里，我想到</span><small>{related.length} 条关联笔记</small></div>{preview ? <p className="reader-rail-hint">保存这份副本后，可以划选原文写想法，并保留对应的位置。</p> : <><p className="reader-rail-hint">划选同一段中的文字，或点击段落旁的记笔记图标。点下面的笔记，可以回到原文。</p>{quote && <form className="reader-composer" onSubmit={e => { e.preventDefault(); void saveThought(); }}><div className="reader-composer-top">正在回应原文<button type="button" className="text-button" disabled={!!busy} onClick={() => { if (thought.trim() && !window.confirm("清空这段尚未保存的想法吗？")) return; setQuote(null); setThought(""); writeDraft(null, ""); }}>清空摘录</button></div><blockquote>{quote.text}</blockquote><MarkdownTextarea aria-label="关于这段原文的想法" rows={4} maxLength={20000} value={thought} disabled={!!busy} onChange={e => { setThought(e.target.value); writeDraft(quote, e.target.value); }} placeholder="这段话让我想到…"/><MarkdownHelp/><div><small>已自动暂存</small><button className="primary compact" disabled={!!busy}><Check size={14}/>保存想法</button></div></form>}
          {related.map(c => <div className={`reader-linked-note ${highlight === c.anchor!.blockId ? "active" : ""}`} key={c.id}><button className="text-button" onClick={() => jump(c.anchor!.blockId)}>↖ 对应原文 · 第 {Number(c.anchor!.blockId.slice(2)) + 1} 段</button><blockquote><Markdown>{c.text}</Markdown></blockquote>{c.thought && <Markdown>{c.thought}</Markdown>}<time>{formatDate(c.createdAt)}</time></div>)}
          {!!otherClips.length && <div className="reader-old-notes"><h3>此前留下的摘录</h3>{otherClips.map(c => { const matching = snapshot?.blocks.filter(b => b.type !== "image" && c.text && b.text.includes(c.text)); const match = matching?.length === 1 ? matching[0] : undefined; return <div key={c.id}><blockquote><Markdown>{c.text}</Markdown></blockquote><Markdown>{c.thought}</Markdown>{match ? <button className="text-button" onClick={() => jump(match.id)}>在这份正文中找到这段 ↖</button> : <small>暂未找到唯一对应段落</small>}</div>; })}</div>}
          {(note.summary || note.thought) && <details className="reader-old-notes"><summary>原来的要点与想法</summary><Markdown>{note.summary}</Markdown><Markdown>{note.thought}</Markdown></details>}
        </>}</aside>
      </div></>}
    <footer className="reader-footer"><span>原文模块独立保存 · 解析失败不会修改笔记</span><button className="text-button" disabled={!!busy} onClick={close}><ArrowLeft size={13}/>回到笔记</button></footer>
  </dialog>;
}

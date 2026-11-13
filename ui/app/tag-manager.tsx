"use client";
import {request} from "./client-runtime";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { tagKey, type TagMutation, type TagState } from "./tag-model";
import "./tag-manager.css";

type Props = { initial: TagState; selected: string; onClose: () => void; onFilter?: (name: string) => void; onChange: (result: TagMutation) => void };
export default function TagManager({ initial, selected, onClose, onFilter, onChange }: Props) {
  const ref = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [state, setState] = useState(initial);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [renamed, setRenamed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { setState(initial); }, [initial]);
  async function save(action: "create" | "rename") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await request("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, name: action === "create" ? name : renamed, from: editing, revision: state.revision }) });
      const result = await response.json() as TagMutation & { error?: string };
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) {
          const refresh = await request("/api/tags", { cache: "no-store" });
          if (refresh.ok) setState(await refresh.json());
        }
        throw new Error(result.error || "标签保存失败，请重试。");
      }
      setState(result); onChange(result); setName(""); setEditing(null);
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  const shown = state.tags.filter(t => tagKey(t.name).includes(tagKey(query)));
  return <dialog ref={ref} className="modal tag-manager" aria-label="标签管理" onCancel={e => { e.preventDefault(); if (!lock.current) onClose(); }}>
    <header className="modal-header"><h2>标签管理 <span>{state.tags.length}</span></h2><button type="button" className="icon-button" aria-label="关闭标签管理" disabled={busy} onClick={onClose}><X size={18}/></button></header>
    <div className="tag-manager-body">
      <label className="tag-manager-search"><Search size={15}/><input aria-label="搜索标签" placeholder="搜索标签" value={query} onChange={e => setQuery(e.target.value)}/></label>
      {onFilter && <button type="button" className="tag-manager-all" aria-pressed={!selected} onClick={() => onFilter("")}>全部笔记{!selected && <Check size={14}/>}</button>}
      <div className="tag-manager-list">
        {shown.map(tag => <div className="tag-manager-row" key={tag.name}>
          {editing === tag.name ? <form className="tag-rename-form" onSubmit={e => { e.preventDefault(); void save("rename"); }}>
            <input aria-label={`重命名标签 ${tag.name}`} value={renamed} maxLength={30} onChange={e => setRenamed(e.target.value)} disabled={busy} autoFocus/>
            <button className="icon-button" aria-label="保存标签名称" disabled={busy || !renamed.trim() || renamed.trim() === tag.name}><Check size={16}/></button>
            <button type="button" className="icon-button" aria-label="取消重命名" disabled={busy} onClick={() => { setEditing(null); setError(""); }}><X size={16}/></button>
            <small>同步更新 {tag.usageCount} 篇关联笔记的标签</small>
          </form> : <>
            {onFilter ? <button type="button" className="tag-manager-name" aria-label={`筛选标签 ${tag.name}`} aria-pressed={tagKey(selected) === tagKey(tag.name)} onClick={() => onFilter(tag.name)}><span>#</span><b>{tag.name}</b>{tagKey(selected) === tagKey(tag.name) && <Check size={14}/>}</button> : <div className="tag-manager-name"><span>#</span><b>{tag.name}</b></div>}
            <span className="tag-manager-count">{tag.count} 篇在笔记库</span>
            <button type="button" className="icon-button" aria-label={`重命名标签 ${tag.name}`} disabled={busy} onClick={() => { setEditing(tag.name); setRenamed(tag.name); setError(""); }}><Pencil size={14}/></button>
          </>}
        </div>)}
        {!shown.length && <p className="tag-manager-empty">{query ? "没有匹配的标签" : "暂无标签"}</p>}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
    <form className="tag-manager-create" onSubmit={e => { e.preventDefault(); void save("create"); }}>
      <input aria-label="新标签名称" placeholder="新标签名称" maxLength={30} value={name} onChange={e => setName(e.target.value)} disabled={busy}/>
      <button className="primary compact" disabled={busy || !name.trim()}>{busy ? <Loader2 size={14} className="spin"/> : <Plus size={14}/>}新建标签</button>
    </form>
  </dialog>;
}

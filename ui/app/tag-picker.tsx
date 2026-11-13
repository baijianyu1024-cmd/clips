"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

import "./tag-picker.css";

const tagKey = (tag: string) => tag.trim().toLocaleLowerCase();

type Props = {
  value: string[];
  available: string[];
  onManage: () => void;
  onChange: (tags: string[]) => void;
};

export default function TagPicker({ value, available, onManage, onChange }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, onQueryChange] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const normalized = tagKey(query);
  const known = [...new Map([...available, ...value].map(tag => [tagKey(tag), tag])).values()];
  const matches = known.filter(tag => tagKey(tag).includes(normalized));
  const count = matches.length;
  const activeIndex = Math.min(active, Math.max(0, count - 1));

  useEffect(() => {
    if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(index: number) {
    const tag = matches[index];
    if (!tag) return;
    if (value.some(item => tagKey(item) === tagKey(tag))) onChange(value.filter(item => tagKey(item) !== tagKey(tag)));
    else {
      if (value.length >= 15) { setError("每篇笔记最多添加 15 个标签。"); return; }
      onChange([...value, tag]);
    }
    onQueryChange(""); setError(""); setActive(0); input.current?.focus();
  }

  return <div className="tag-picker-field" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }}>
    <div className="tag-picker-heading"><label htmlFor={id}>主题标签</label><button type="button" onClick={() => { setOpen(false); onQueryChange(""); onManage(); }}>管理标签</button></div>
    <div className={`tag-picker-control${open ? " is-open" : ""}`} onClick={e => {
      if (e.target === e.currentTarget) { input.current?.focus(); setOpen(true); }
    }}>
      {value.map(tag => <span className="tag-picker-chip" key={tag}>
        <span>{tag}</span><button type="button" aria-label={`移除标签 ${tag}`} onClick={() => {
          onChange(value.filter(item => item !== tag)); setError("");
        }}><X size={12}/></button>
      </span>)}
      <input ref={input} id={id} className="tag-picker-input" role="combobox" aria-autocomplete="list"
        aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && count ? `${id}-option-${activeIndex}` : undefined}
        aria-describedby={error ? `${id}-error` : undefined} aria-invalid={!!error}
        autoComplete="off" maxLength={400} value={query} placeholder={value.length ? "继续添加" : "搜索并选择标签"}
        onFocus={() => { setOpen(true); setActive(0); }}
        onChange={e => { onQueryChange(e.target.value); setActive(0); setOpen(true); setError(""); }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault(); setOpen(true);
            setActive(!open ? 0 : (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + Math.max(1, count)) % Math.max(1, count));
          }
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault(); e.stopPropagation();
            if (open && count) choose(activeIndex); else setOpen(true);
          }
        }}/>
      <button type="button" className="tag-picker-toggle" aria-label={open ? "收起标签选项" : "展开标签选项"}
        onMouseDown={e => e.preventDefault()} onClick={() => {
          if (open) setOpen(false); else { input.current?.focus(); setOpen(true); }
        }}><ChevronDown size={16}/></button>
      {open && <div ref={list} id={`${id}-options`} className="tag-picker-options" role="listbox" aria-label="可选标签" aria-multiselectable="true">
        {matches.map((tag, index) => {
          const selected = value.some(item => tagKey(item) === tagKey(tag));
          return <div key={tag} id={`${id}-option-${index}`} role="option" aria-selected={selected}
            data-active={activeIndex === index} className="tag-picker-option"
            onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
            <span>{tag}</span>{selected && <Check size={14}/>}</div>;
        })}
        {!count && <div className="tag-picker-empty">{query ? "没有匹配的标签" : "暂无标签"}，可在「管理标签」中新建</div>}
      </div>}
    </div>
    {error && <p className="tag-picker-error" id={`${id}-error`} role="alert">{error}</p>}
  </div>;
}

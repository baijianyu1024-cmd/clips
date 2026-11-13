import { forwardRef, useEffect, useMemo, useRef, type TextareaHTMLAttributes } from 'react';
import { renderMarkdown, markdownHelpHTML } from '@/extension/markdown.js';
import { installMarkdownEditors } from '@/extension/markdown-editor.js';
import '@/extension/markdown.css';

export default function Markdown({ children, className = '' }: { children: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(children), [children]);
  return <div className={`markdown-body ${className}`} dangerouslySetInnerHTML={{ __html: html }}/>;
}

export function MarkdownHelp() {
  return <div dangerouslySetInnerHTML={{ __html: markdownHelpHTML }}/>;
}

export const MarkdownTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function MarkdownTextarea(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!root.current) return; const editor = installMarkdownEditors(root.current); return () => editor.destroy(); }, []);
  return <div className="markdown-input" ref={root}><textarea {...props} ref={ref}/></div>;
});

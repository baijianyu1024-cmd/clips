'use client';
import { useRef, useState } from 'react';
import { request, draftStorage } from './client-runtime';
import type { Note } from './model';
import { recordTarget, deletionMessage } from '@/extension/record-actions.js';

export default function DeleteRecord({ note, kind, id, onUpdate, onDeleted }: { note: Note; kind: string; id: string; onUpdate: (note: Note) => void; onDeleted?: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  if (note.deletedAt || note.archived || note.status === 'inbox') return null;
  async function remove() {
    if (lock.current) return;
    const target = recordTarget(kind, id);
    if (!window.confirm(deletionMessage(note, target))) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await request('/api/notes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: note.id, revision: note.revision, action: 'remove_content', target }) });
      const result = await response.json() as {note: Note; error?: string};
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await request('/api/notes', { cache: 'no-store' });
          if (latest.ok) { const current = (await latest.json() as {notes: Note[]}).notes.find((n: Note) => n.id === note.id); if (current) onUpdate(current); }
        }
        throw new Error(result.error || '未能删除，请刷新后重试。');
      }
      // Clear only edits belonging to the removed record, leaving new drafts alone.
      const key = kind === 'review' ? `shiye-review-edit:${note.id}` : `shiye-reading-draft:${note.id}`;
      try {
        const draft = JSON.parse(draftStorage.getItem(key) || 'null');
        const targetId = kind === 'image' ? `image:${target.id}` : target.id;
        if (draft && (kind === 'review' ? draft.id === target.id : ['clip', 'legacy', 'image'].includes(kind) && draft.target === targetId)) draftStorage.removeItem(key);
      } catch { /* A stale local draft must not undo a completed deletion. */ }
      onUpdate(result.note); onDeleted?.();
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <span className="delete-record-control"><button type="button" className="text-button danger" disabled={busy} onClick={() => void remove()} aria-label={`删除${kind === 'review' ? '补充理解' : '记录'}`}>{busy ? '删除中…' : '删除'}</button>{error && <span className="field-error" role="alert">{error}</span>}</span>;
}

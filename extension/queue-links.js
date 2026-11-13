import { sourceUrlKey } from './link-metadata.js';

// Only saved notes establish reading state. Page visits and titles are not evidence.
export function queueDuplicates(notes) {
  const live = notes.filter(n => !n.deletedAt && !n.archived);
  const queue = live.filter(n => n.status === 'inbox').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id));
  const covered = new Set(live.filter(n => n.status !== 'inbox').flatMap(n => (n.sources || []).map(s => sourceUrlKey(s.url))).filter(Boolean));
  const duplicates = [];
  for (const note of queue) {
    const keys = (note.sources || []).map(s => sourceUrlKey(s.url));
    // Do not retire a multi-source note when even one source is unresolved.
    if (keys.length && keys.every(key => key && covered.has(key))) duplicates.push(note);
    else keys.filter(Boolean).forEach(key => covered.add(key));
  }
  return duplicates;
}

// Soft deletion preserves all metadata, thoughts, images and snapshots for recovery.
export function retireQueueDuplicates(notes, now = new Date().toISOString()) {
  const ids = new Set(queueDuplicates(notes).map(n => n.id));
  return notes.map(n => ids.has(n.id) ? { ...n, deletedAt: now, updatedAt: now, revision: n.revision + 1 } : n);
}

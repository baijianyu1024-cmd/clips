import type { Note } from "./model";
import { quoteView } from "@/extension/quote-context.js";

export type LibraryRecord = {
  key: string; note: Note; id: string; type: "core" | "clip" | "legacy" | "image" | "review" | "ai";
  at?: string; label: string; thought: string; text: string; translation?: string; pending?: boolean;
  images: Note["images"];
};

/** One current summary and each saved record; summary revisions stay in note history. */
export function libraryRecords(notes: Note[]): LibraryRecord[] {
  const rows: LibraryRecord[] = [];
  for (const note of notes) {
    if (note.deletedAt || note.archived || note.status === "inbox") continue;
    const add = (row: Omit<LibraryRecord, "key" | "note">) => rows.push({ ...row, note, key: `${note.id}:${row.type}:${row.id}` });
    if (note.coreSummary) { const s = note.coreSummary; add({ type: "core", id: "core", at: s.createdAt, label: s.origin === "ai" ? "AI 核心摘要" : "核心摘要", text: s.text, thought: "", images: s.images }); }
    if (note.summary || note.thought || note.legacyRecordImages?.length) add({ type: "legacy", id: "legacy", at: note.createdAt, label: note.thought ? "随读想法" : note.summary ? "原文摘录" : "截图", text: note.summary, thought: note.thought, images: note.legacyRecordImages || [] });
    for (const clip of note.clips) {
      const quote = quoteView(clip, note.transcripts?.find(t => t.id === clip.transcriptAnchor?.snapshotId)?.language);
      add({ type: "clip", id: clip.id, at: clip.undated ? undefined : clip.createdAt, label: clip.thought ? "随读想法" : clip.text ? quote.language === "other" ? "中文引用" : "原文摘录" : "截图", thought: clip.thought, text: quote.original || "", translation: quote.translation || undefined, pending: quote.pending, images: clip.images || [] });
    }
    for (const image of note.images) add({ type: "image", id: `image:${image.key}`, at: image.createdAt, label: "截图", text: "", thought: "", images: [image] });
    for (const r of note.reviews) if (r.text.trim()) add({ type: "review", id: r.id, at: r.createdAt, label: "后来的理解", text: "", thought: r.text, images: [] });
    for (const s of note.aiSummaries) add({ type: "ai", id: s.id, at: s.createdAt, label: "AI 摘要", text: s.text, thought: "", images: [] });
  }
  return rows.sort((a, b) => (Date.parse(b.at || "") || 0) - (Date.parse(a.at || "") || 0) || a.key.localeCompare(b.key));
}

export function matchesRecord(row: LibraryRecord, query: string, onlyThoughts = false) {
  if (onlyThoughts && !row.thought.trim()) return false;
  const searchable = [row.note.title, row.note.tags.join(" "), ...row.note.sources.map(s => s.url + " " + s.label), row.label, row.thought, row.text, row.translation || "", ...row.images.map(i => i.name)].join(" ").toLocaleLowerCase();
  return query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).every(word => searchable.includes(word));
}

import { currentSegmentIndex } from "./youtube.js";

export function quoteRangeKey(a) { return `${a.from}:${a.to}${a.startOffset === undefined ? "" : `:${a.startOffset}:${a.endOffset}`}`; }
export function anchoredTranscriptText(segments, a) {
  if (!segments[a.from] || !segments[a.to] || a.to < a.from) return "";
  const start = a.startOffset ?? 0, end = a.endOffset ?? segments[a.to].text.length;
  if (start < 0 || start >= segments[a.from].text.length || end < 1 || end > segments[a.to].text.length || (a.from === a.to && end <= start)) return "";
  return segments.slice(a.from, a.to + 1).map((s, i) => s.text.slice(i === 0 ? start : 0, a.from + i === a.to ? end : undefined)).join("\n").trim();
}
export function quoteLanguage(text = "", hint = "") {
  const lang = hint.toLowerCase().split(/[-_]/)[0];
  if (["zh", "cmn", "yue", "chinese"].includes(lang)) return "zh";
  if (["en", "eng", "english"].includes(lang)) return "en";
  if (lang && !["und", "auto", "unknown"].includes(lang)) return "other";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(text)) return "other";
  const han = (text.match(/\p{Script=Han}/gu) || []).length, letters = (text.match(/\p{L}/gu) || []).length;
  return han / Math.max(letters, 1) >= .3 ? "zh" : "unknown";
}
export function quoteView(clip, hint = "") {
  const language = quoteLanguage(clip?.text || "", clip?.sourceLanguage || hint);
  const original = language === "other" ? "" : clip?.text || "";
  const translation = language === "zh" ? "" : clip?.translation?.text || "";
  return { original, translation, pending: language === "other" && !translation, language };
}

// Keep exact source offsets, including sentence boundaries inside a subtitle row.
// These are character positions, not inferred word-level timestamps.
export function sentenceQuote(snapshot, time) {
  const segments = snapshot.segments, index = currentSegmentIndex(segments, time), current = segments[index];
  if (!current || time > current.start + Math.max(current.duration, 3)) return null;
  let text = ""; const offsets = segments.map(s => { const at = text.length; text += s.text + " "; return at; });
  let locale; try { locale = Intl.getCanonicalLocales(snapshot.language || "en")[0]; } catch { locale = "en"; }
  const units = [];
  for (const part of new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text)) {
    const leading = part.segment.length - part.segment.trimStart().length, value = part.segment.trim(); if (!value) continue;
    const next = { start: part.index + leading, end: part.index + leading + value.length };
    const prev = units.at(-1);
    if (prev && /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|z\.B|bzw|d\.h)\.$/i.test(text.slice(prev.start, prev.end))) prev.end = next.end;
    else units.push(next);
  }
  const first = offsets[index], last = first + current.text.length;
  let lo = units.findIndex(u => u.end > first), hi = units.findIndex(u => u.end >= last);
  if (lo < 0 || hi < 0) return null;
  const rowAt = (position, end = false) => {
    let l = 0, r = offsets.length;
    while (l < r) { const m = (l + r) >>> 1; if (offsets[m] <= position - (end ? 1 : 0)) l = m + 1; else r = m; }
    return Math.max(0, l - 1);
  };
  const fits = (a, b) => {
    const from = rowAt(units[a].start), to = rowAt(units[b].end, true);
    return units[b].end - units[a].start <= 2200 && to - from < 60 && segments[to].start - segments[from].start <= 90 && !segments.slice(from + 1, to + 1).some((s, i) => s.start - (segments[from + i].start + segments[from + i].duration) > 4);
  };
  let boundary = "sentence";
  const endsSentence = u => /[.!?。！？…][\s"'”’»）)]*$/.test(text.slice(u.start, u.end));
  let start, end;
  if (fits(lo, hi) && endsSentence(units[hi])) {
    const value = text.slice(units[lo].start, units[hi].end);
    if (lo > 0 && /^(?:this|that|it|they|these|those|so|therefore|also|because|das|dies|also|denn|deshalb|这|那|因此|所以|其中|而|它)/i.test(value) && fits(lo - 1, hi)) lo--;
    const minChars = quoteLanguage(value, snapshot.language) === "zh" ? 70 : 180;
    while (units[hi].end - units[lo].start < minChars && hi - lo < 1 && hi + 1 < units.length && endsSentence(units[hi + 1]) && fits(lo, hi + 1)) hi++;
    start = units[lo].start; end = units[hi].end;
  } else {
    // No usable punctuation: stop at real pauses and keep a bounded local context.
    boundary = "context"; let from = index, to = index;
    while (from > 0 && index - from < 8 && time - segments[from - 1].start <= 20 && segments[from].start - (segments[from - 1].start + segments[from - 1].duration) <= 1.2) from--;
    while (to + 1 < segments.length && to - index < 12 && segments[to + 1].start - time <= 25 && segments[to + 1].start - (segments[to].start + segments[to].duration) <= 1.2) to++;
    while (offsets[to] + segments[to].text.length - offsets[from] > 6000 && (from < index || to > index)) { if (to > index) to--; else from++; }
    start = offsets[from]; end = offsets[to] + segments[to].text.length;
  }
  const from = rowAt(start), to = rowAt(end, true);
  const transcriptAnchor = { snapshotId: snapshot.id, from, to, startOffset: start - offsets[from], endOffset: end - offsets[to] };
  return { text: anchoredTranscriptText(segments, transcriptAnchor), videoTime: time, transcriptAnchor, sourceLanguage: snapshot.language || "und", excerptBoundary: boundary };
}

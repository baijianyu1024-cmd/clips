import test from "node:test";
import assert from "node:assert/strict";
import { sentenceQuote, anchoredTranscriptText, quoteRangeKey, quoteView } from "../../extension/quote-context.js";
import { quoteTranslationMessages } from "../../extension/quote-translation.js";
const snapshot = (lines, language = "en") => ({ id: "a".repeat(64), language, segments: lines.map((text, i) => ({ text, start: i * 3, duration: 3 })) });
test("quote boundaries inside caption rows retain complete sentences and exact original offsets", () => {
  const s = snapshot(["A previous topic ended. We can create", "a project and let the coordinator", "create threads for every task. For example, one for", "thumbnails and titles, one for outlines, and one for editing. The next", "topic is different."]);
  const q = sentenceQuote(s, 7);
  assert.match(q.text, /^We can create/); assert.match(q.text, /one for editing\.$/); assert.doesNotMatch(q.text, /previous topic|The next/);
  assert.equal(q.videoTime, 7); assert.equal(q.excerptBoundary, "sentence"); assert.ok(q.transcriptAnchor.startOffset > 0);
  assert.equal(anchoredTranscriptText(s.segments, q.transcriptAnchor), q.text);
  const p = JSON.parse(quoteTranslationMessages(s, q.transcriptAnchor)[1].content);
  assert.equal(p.quote, q.text); assert.match(p.before.at(-1).text, /previous topic/); assert.match(p.after[0].text, /The next/);
  assert.notEqual(quoteRangeKey(q.transcriptAnchor), `${q.transcriptAnchor.from}:${q.transcriptAnchor.to}`);
});
test("Chinese punctuation, English abbreviations and German sentence starts do not truncate thoughts", () => {
  const cn = sentenceQuote(snapshot(["旧话题结束了。我们先创建一个", "项目，再将任务分给不同的智能体。这样可以", "同时完成研究和写作。下个话题不同。"], "zh"), 4);
  assert.match(cn.text, /^我们/); assert.match(cn.text, /[。！？]$/); assert.doesNotMatch(cn.text, /旧话题/);
  const en = sentenceQuote(snapshot(["Earlier. Dr. Smith explains version 2.0", "and why it helps. More detail follows."], "en"), 3.2);
  assert.match(en.text, /Dr\. Smith/); assert.match(en.text, /2\.0/);
  const de = sentenceQuote(snapshot(["Altes Thema. Jetzt können wir ein", "Projekt starten. Das hilft uns,", "mehrere Aufgaben zu koordinieren. Neues Thema."], "de"), 3.5);
  assert.match(de.text, /^Jetzt/); assert.match(de.text, /koordinieren\./); assert.doesNotMatch(de.text, /^Altes/);
});
test("missing punctuation uses bounded context, stops at pauses, and keeps exact click time", () => {
  const s = snapshot(Array.from({ length: 120 }, (_, i) => `words from row ${i}`));
  s.segments.slice(61).forEach(row => row.start += 10);
  const q = sentenceQuote(s, 180.5);
  assert.equal(q.excerptBoundary, "context"); assert.equal(q.transcriptAnchor.to, 60); assert.ok(q.transcriptAnchor.from >= 53);
  assert.equal(q.videoTime, 180.5); assert.ok(q.text.length <= 6000); assert.equal(sentenceQuote(s, -1), null); assert.equal(sentenceQuote(s, 1000), null);
  assert.equal(sentenceQuote(s, 0).transcriptAnchor.from, 0);
});
test("offsets reject missing or out-of-range data and distinguish translations of different sentences in one row", () => {
  const s = snapshot(["First sentence. Second sentence."]);
  const a = { from: 0, to: 0, startOffset: 0, endOffset: 15 }, b = { ...a, startOffset: 16, endOffset: 32 };
  assert.notEqual(quoteRangeKey(a), quoteRangeKey(b)); assert.equal(anchoredTranscriptText(s.segments, a), "First sentence.");
  assert.equal(anchoredTranscriptText(s.segments, { ...a, endOffset: 999 }), ""); assert.equal(anchoredTranscriptText(s.segments, { ...a, startOffset: 16 }), "");
});
test("English is bilingual, Chinese is original-only, other languages are Chinese-only including old records", () => {
  const clip = { text: "Original content", translation: { text: "中文译文" } };
  assert.deepEqual(quoteView({ ...clip, sourceLanguage: "en-US" }), { original: clip.text, translation: "中文译文", pending: false, language: "en" });
  assert.equal(quoteView({ ...clip, text: "中文内容", sourceLanguage: "zh-CN" }).translation, "");
  for (const hint of ["de", "ja", "fr", "es"]) { const v = quoteView(clip, hint); assert.equal(v.original, ""); assert.equal(v.translation, "中文译文"); }
  const pending = quoteView({ text: "Deutsches Original" }, "de"); assert.equal(pending.original, ""); assert.equal(pending.pending, true);
  assert.equal(quoteView(clip).original, clip.text); // Unknown Latin language never silently discards English.
});

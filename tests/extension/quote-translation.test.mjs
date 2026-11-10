import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteTranslator, needsChineseTranslation, quoteTranslationMessages } from "../../extension/quote-translation.js";
import { createQuickQuoteService } from "../../extension/quick-quote.js";
const clone = structuredClone;
function fixture() {
  const snapshot = { id: "a".repeat(64), videoId: "SHIYEDEMO01", language: "de", title: "Claude Code projects", segments: Array.from({ length: 40 }, (_, i) => ({ text: `Original ${i}`, start: i * 5, duration: 5 })) };
  const anchor = { snapshotId: snapshot.id, from: 12, to: 14 };
  let note = { id: "note", revision: 1, sources: [{ url: "https://www.youtube.com/watch?v=SHIYEDEMO01" }], transcripts: [{ id: snapshot.id, videoId: snapshot.videoId }], clips: [{ id: "clip", text: snapshot.segments.slice(12, 15).map(s => s.text).join("\n"), thought: "我自己的想法", images: [{ key: "private-image" }], sourceUrl: "https://www.youtube.com/watch?v=SHIYEDEMO01", transcriptAnchor: anchor }] };
  const data = {}, translations = {}, quoteTranslations = {}, calls = []; let ai = 0, failSave = false, losePatch = false, beforePatch = null, reply = null;
  const storage = { get: async k => ({ [k]: clone(data[k]) }), set: async v => Object.assign(data, clone(v)), remove: async k => delete data[k] };
  const cloud = async r => {
    calls.push(clone(r));
    if (r.method === "POST") {
      if (failSave) { failSave = false; throw Error("offline"); }
      const a = r.body.assist; quoteTranslations[`${a.from}:${a.to}`] ??= { text: a.text, model: a.model };
      return { assist: { translations: clone(translations), quoteTranslations: clone(quoteTranslations) } };
    }
    if (r.method === "PATCH") {
      if (beforePatch) { const fn = beforePatch; beforePatch = null; fn(note); throw Object.assign(Error("conflict"), { status: 409 }); }
      assert.equal(r.body.action, "set_clip_translation"); assert.equal(r.body.revision, note.revision);
      note.clips.find(c => c.id === r.body.clip.id).translation = clone(r.body.clip.translation); note.revision++;
      if (losePatch) { losePatch = false; throw Error("lost response"); }
      return { note: clone(note) };
    }
    if (r.path) return { snapshot: clone(snapshot), assist: { translations: clone(translations), quoteTranslations: clone(quoteTranslations) } };
    return { notes: [clone(note)] };
  };
  const translate = createQuoteTranslator({ storage, cloud, allowed: async () => true, credentials: async () => ({ key: "fixture-only", config: { model: "test-model" } }), request: async (_config, _key, messages) => {
    ai++; const p = JSON.parse(messages[1].content); assert.equal(JSON.stringify(p).includes("我自己的想法"), false); assert.equal(JSON.stringify(p).includes("private-image"), false);
    assert.equal(p.before.at(-1).index, 11); assert.equal(p.after[0].index, 15);
    assert.equal(p.quote, "Original 12\nOriginal 13\nOriginal 14"); return reply || { text: "中文 12，Claude Code，中文 14。" };
  } });
  return { snapshot, anchor, storage, cloud, translate, calls, data, translations, quoteTranslations, get note() { return note; }, get ai() { return ai; }, failSave: () => failSave = true, losePatch: () => losePatch = true, conflict: fn => beforePatch = fn, reply: v => reply = v };
}
test("language detection preserves Chinese but includes German, English, Japanese and Korean", () => {
  for (const [text, lang] of [["这段是 Claude Code 的介绍", ""], ["API", "zh-CN"], ["", "en"]]) assert.equal(needsChineseTranslation(text, lang), false);
  for (const [text, lang] of [["braucht alte Chats", "de"], ["A useful note", "en"], ["新しい機能", "ja"], ["새로운 기능", "ko"]]) assert.equal(needsChineseTranslation(text, lang), true);
});
test("translation context includes both sides, bounded to ten rows and sixty seconds, never personal notes", () => {
  const f = fixture(), p = JSON.parse(quoteTranslationMessages(f.snapshot, f.anchor)[1].content);
  assert.equal(p.before.length, 10); assert.equal(p.after.length, 10); assert.equal(p.quote, "Original 12\nOriginal 13\nOriginal 14");
  f.snapshot.segments.forEach((s, i) => s.start = i * 30);
  const bounded = JSON.parse(quoteTranslationMessages(f.snapshot, f.anchor, [12])[1].content); assert.equal(bounded.before.length, 2); assert.equal(bounded.after.length, 2);
});
test("missing translation is generated with context once, saved canonically and attached without changing original or personal content", async () => {
  const f = fixture(), original = clone(f.note.clips[0]);
  const [a, b] = await Promise.all([f.translate("note", "clip"), f.translate("note", "clip")]);
  assert.deepEqual(a, b); assert.equal(f.ai, 1); assert.match(a.translation.text, /中文 12，Claude Code，中文 14/);
  const { translation, ...saved } = a.note.clips[0]; assert.deepEqual(saved, original); assert.equal(Object.keys(f.data).length, 0);
  await f.translate("note", "clip"); assert.equal(f.ai, 1);
});
test("existing whole-quote translations are reused; Chinese needs no AI or note mutation", async () => {
  const f = fixture(); f.quoteTranslations["12:14"] = { text: "已有整段译文", model: "saved-model" };
  assert.equal((await f.translate("note", "clip")).translation.model, "saved-model"); assert.equal(f.ai, 0);
  const chinese = fixture(); chinese.snapshot.language = "zh"; await chinese.translate("note", "clip"); assert.equal(chinese.ai, 0); assert.equal(chinese.calls.some(c => c.method), false);
});
test("save failure checkpoints paid result; retry and lost PATCH response never regenerate or duplicate a record", async () => {
  const f = fixture(); f.failSave(); await assert.rejects(f.translate("note", "clip"), /offline/); assert.equal(f.ai, 1); assert.equal(f.note.clips[0].translation, undefined);
  assert.ok(Object.keys(f.data).length); f.losePatch(); await assert.rejects(f.translate("note", "clip"), /lost response/);
  const saved = await f.translate("note", "clip"); assert.ok(saved.translation); assert.equal(f.ai, 1); assert.equal(f.note.clips.length, 1);
});
test("concurrent thought and image edits survive revision retry; edited source quotes are never overwritten", async () => {
  const f = fixture(); f.conflict(n => { n.revision++; n.clips[0].thought = "后来补充"; n.clips[0].images.push({ key: "new-image" }); });
  const saved = await f.translate("note", "clip"); assert.equal(saved.note.clips[0].thought, "后来补充"); assert.equal(saved.note.clips[0].images.length, 2);
  const changed = fixture(); changed.conflict(n => { n.revision++; n.clips[0].text = "手动修改的原文"; });
  await assert.rejects(changed.translate("note", "clip"), /引用已在别处修改/); assert.equal(changed.note.clips[0].translation, undefined);
});
test("incomplete or non-Chinese model output cannot become a saved translation", async () => {
  for (const reply of [{ segments: [{ index: 12, text: "旧的逐行格式" }] }, { text: "Untranslated" }]) {
    const f = fixture(); f.reply(reply); await assert.rejects(f.translate("note", "clip"), /未完整返回/); assert.equal(f.calls.some(c => c.method), false);
  }
});
test("quick quote first saves the original and retries translation on the same quote ID", async () => {
  const f = fixture(); await f.storage.set({ activeNoteId: "note" }); let attempts = 0;
  // Use a minimal clip write to exercise the public capture contract independently of the translation PATCH.
  const cloud = async r => { if (r.method === "PATCH") { f.note.clips.push(clone(r.body.clip)); return { note: clone(f.note) }; } return f.cloud(r); };
  const service = createQuickQuoteService({ storage: f.storage, cloud, readPlayer: async () => ({ available: true, time: 65 }), translate: async (_note, id) => {
    const clip = f.note.clips.find(c => c.id === id); assert.ok(clip); attempts++; if (attempts === 1) throw Error("模型暂时不可用"); clip.translation = { scope: "quote", text: "带上下文的中文", language: "zh-CN", model: "fixture" }; return { note: clone(f.note) };
  } });
  const tab = { url: f.note.sources[0].url, title: "Video" }, id = "11111111-1111-4111-8111-111111111111";
  const first = await service.capture(tab, id); assert.equal(first.status, "saved"); assert.equal(first.translationPending, true); assert.match(first.warning, /原文已保存/);
  const second = await service.capture(tab, id); assert.equal(second.translationPending, false); assert.equal(second.translation.text, "带上下文的中文"); assert.equal(f.note.clips.filter(c => c.id === id).length, 1);
});

test("line translations cannot spill their next sentence into a quick quotation", async () => {
  const f = fixture(); for (let i=12;i<=14;i++) f.translations[i] = { text: "错误串入下一句", model: "old" };
  f.note.clips[0].translation = { text: "旧逐行译文", model: "old", language: "zh-CN" };
  const result = await f.translate("note", "clip"); assert.equal(f.ai,1); assert.equal(result.translation.scope,"quote"); assert.equal(result.translation.text.includes("下一句"),false);
});

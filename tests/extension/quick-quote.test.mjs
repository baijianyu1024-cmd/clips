import { anchoredTranscriptText } from "../../extension/quote-context.js";
import test from "node:test";
import assert from "node:assert/strict";
import { contextQuote, createQuickQuoteService, isYoutubePageSender, QUICK_QUOTES } from "../../extension/quick-quote.js";
import { youtubeUrl, transcriptRangeContainsTime } from "../../extension/youtube.js";
const videoId = "SHIYEDEMO01", id = "11111111-1111-4111-8111-111111111111";
const snapshot = { id: "a".repeat(64), videoId, segments: Array.from({ length: 20 }, (_, i) => ({ start: i * 2, duration: 2, text: `字幕 ${i}` })) };
const tab = { id: 8, windowId: 1, url: youtubeUrl(videoId), title: "(3) 测试视频 - YouTube" };
function fixture() {
  const data = { activeNoteId: "note-a", "draft:note-a": { thought: "正在写的想法", quote: { text: "旧摘录" } } };
  const storage = { get: async k => ({ [k]: structuredClone(data[k]) }), set: async obj => Object.assign(data, structuredClone(obj)) };
  let note = { id: "note-a", revision: 1, sources: [{ url: tab.url }], transcripts: [{ id: snapshot.id, videoId }], clips: [] }, patches = [], loseResponse = false, conflict = false, offline = false, reads = 0;
  const cloud = async request => {
    if (offline) throw Error("笔记库未连接");
    if (request.path?.startsWith("/api/transcripts")) { reads++; return { snapshot }; }
    if (request.method === "PATCH") {
      patches.push(request.body);
      if (conflict) { conflict = false; throw Object.assign(Error("conflict"), { status: 409 }); }
      if (!note.clips.some(c => c.id === request.body.clip.id)) note.clips.push(structuredClone(request.body.clip));
      if (loseResponse) { loseResponse = false; throw Error("连接中断"); }
      return { note };
    }
    return { notes: [note] };
  };
  const service = createQuickQuoteService({ storage, cloud, readPlayer: async () => ({ available: true, time: 12.5 }) });
  return { service, data, get note() { return note; }, get patches() { return patches; }, get reads() { return reads; }, lose: () => loseResponse = true, conflict: () => conflict = true, offline: value => offline = value };
}
test("quick quote preserves nearby words, the exact click timestamp and a valid transcript range", () => {
  const q = contextQuote(snapshot, 12.5);
  assert.equal(q.excerptBoundary, "context"); assert.equal(q.transcriptAnchor.snapshotId, snapshot.id);
  assert.equal(q.text, anchoredTranscriptText(snapshot.segments, q.transcriptAnchor));
  assert.equal(q.videoTime, 12.5); assert.equal(transcriptRangeContainsTime(snapshot.segments, 4, 10, q.videoTime), true);
  assert.equal(transcriptRangeContainsTime(snapshot.segments, 4, 10, 35), false);
  assert.equal(contextQuote(snapshot, -1), null); assert.equal(contextQuote(snapshot, 60), null);
  assert.equal(contextQuote(snapshot, 0).transcriptAnchor.from, 0); assert.equal(contextQuote(snapshot, 39).transcriptAnchor.to, 19);
});
test("only the top-level matching HTTPS YouTube content script can invoke page actions", () => {
  const sender = { id: "ext", frameId: 0, tab, url: tab.url };
  assert.equal(isYoutubePageSender(sender, "ext"), true);
  for (const override of [{ id: "other" }, { frameId: 1 }, { url: "https://youtube.com.evil.test/watch?v=" + videoId }, { url: "http://youtube.com/watch?v=" + videoId }, { url: youtubeUrl("OTHERDEMO01") }, { url: "https://youtu.be/" + videoId }, { tab: null }]) assert.equal(isYoutubePageSender({ ...sender, ...override }, "ext"), false);
});
test("one-click save reuses saved captions and does not change pinned notes or composer drafts", async () => {
  const f = fixture(), originalDraft = structuredClone(f.data["draft:note-a"]);
  const result = await f.service.capture(tab, id);
  assert.equal(result.status, "saved"); assert.equal(result.title, "测试视频"); assert.equal(result.url, tab.url + "&t=12s");
  assert.equal(f.note.clips.length, 1); assert.equal(f.note.clips[0].videoTime, 12.5);
  assert.equal(f.data.activeNoteId, "note-a"); assert.deepEqual(f.data["draft:note-a"], originalDraft);
  await f.service.capture(tab, id); assert.equal(f.patches.length, 1); assert.equal(f.reads, 1);
});
test("another pinned note requires explicit choice; navigation never creates or switches a note", async () => {
  const f = fixture(); f.data.activeNoteId = "another";
  assert.equal((await f.service.capture(tab, id)).status, "needs-note"); assert.equal(f.patches.length, 0); assert.equal(f.data.activeNoteId, "another");
  assert.equal((await f.service.complete(id, "note-a")).status, "saved"); assert.equal(f.note.clips.length, 1);
});
test("missing subtitles are explicit, with the captured timestamp retained for retry", async () => {
  const f = fixture(); f.note.transcripts = [];
  assert.equal((await f.service.capture(tab, id)).status, "needs-transcript"); assert.equal(f.patches.length, 0);
  assert.equal(f.data[QUICK_QUOTES][0].time, 12.5); f.note.transcripts = [{ id: snapshot.id, videoId }];
  assert.equal((await f.service.complete(id, "note-a")).status, "saved");
});
test("lost save responses retry the same clip in the original note, without fetching or duplicating", async () => {
  const f = fixture(); f.lose();
  assert.equal((await f.service.capture(tab, id)).status, "error"); assert.equal(f.note.clips.length, 1);
  f.data.activeNoteId = "another";
  assert.equal((await f.service.capture(tab, id)).status, "saved"); assert.equal(f.note.clips.length, 1); assert.equal(f.reads, 1);
  assert.ok(f.patches.every(p => p.id === "note-a" && p.clip.id === id));
});
test("revision conflicts retry safely; disconnected library retains capture for explicit recovery", async () => {
  const f = fixture(); f.conflict(); assert.equal((await f.service.capture(tab, id)).status, "saved"); assert.equal(f.patches.length, 2);
  const offline = fixture(); offline.offline(true); assert.equal((await offline.service.capture(tab, id)).status, "error");
  assert.equal(offline.data[QUICK_QUOTES][0].time, 12.5); offline.offline(false);
  assert.equal((await offline.service.complete(id, "note-a")).status, "saved");
});

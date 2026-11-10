import test from "node:test";
import assert from "node:assert/strict";
import { youtubeId, youtubeUrl, normalizeTranscript, fetchNativeTranscript } from "../../extension/youtube.js";
import { canonical, findNote } from "../../extension/core.js";
const id = "dQw4w9WgXcQ", body = { lang: "en", content: [{ text: "First sentence.", offset: 12000, duration: 3000 }, { text: "Next sentence.", offset: 15200, duration: 2400 }] };
test("YouTube variants resume one note, but other videos and deceptive hosts never match", () => {
  const url = youtubeUrl(id), variants = [url + "&t=20s&list=abc", `https://youtu.be/${id}?si=track`, `https://m.youtube.com/watch?v=${id}#test`];
  const note = { id: "pinned", status: "reading", sources: [{ url }] };
  for (const variant of variants) { assert.equal(canonical(variant), url); assert.equal(findNote([note], variant), note); }
  for (const bad of [`https://youtube.com.evil.test/watch?v=${id}`, `https://evil.test/youtube.com/watch?v=${id}`, `https://secret@youtube.com/watch?v=${id}`, "https://youtube.com/watch?v=short", `https://youtube.com/shorts/${id}`]) assert.equal(youtubeId(bad), "");
  assert.equal(findNote([note], youtubeUrl("SHIYEDEMO01")), undefined);
  assert.equal(youtubeUrl(id, 15.8), url + "&t=15s");
});
test("native request uses a fixed provider origin, omits cookies and converts milliseconds", async () => {
  const calls = [];
  const data = await fetchNativeTranscript(id, "FAKE_KEY", { fetch: async (url, init) => { calls.push({ url, init }); return Response.json(body); } });
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://api.supadata.ai"); assert.equal(url.searchParams.get("mode"), "native"); assert.equal(url.searchParams.get("text"), "false");
  assert.equal(url.searchParams.get("url"), youtubeUrl(id)); assert.equal(calls[0].init.credentials, "omit"); assert.equal(calls[0].init.redirect, "error");
  assert.equal(data.segments[0].start, 12); assert.equal(data.segments[1].duration, 2.4); assert.equal(JSON.stringify(data).includes("FAKE_KEY"), false);
});
test("async provider jobs are polled and converted without changing the video target", async () => {
  const urls = [], responses = [Response.json({ jobId: "job_123" }, { status: 202 }), Response.json({ status: "processing" }), Response.json({ ...body, status: "completed" })];
  const data = await fetchNativeTranscript(id, "FAKE", { pause: async () => {}, fetch: async url => { urls.push(url); return responses.shift(); } });
  assert.equal(data.videoId, id); assert.equal(urls.length, 3); assert.equal(urls[1], "https://api.supadata.ai/v1/transcript/job_123");
});
test("missing captions never start fallback transcription, and upstream secrets are not surfaced", async () => {
  for (const status of [206, 401, 402, 403, 404, 429, 500]) {
    let count = 0;
    await assert.rejects(fetchNativeTranscript(id, "FAKE", { fetch: async () => { count++; return new Response('{"error":"SECRET_UPSTREAM"}', { status }); } }), e => !e.message.includes("SECRET_UPSTREAM"));
    assert.equal(count, 1);
  }
});
test("bad timestamps, oversized captions, hostile job identifiers and unending jobs are rejected", async () => {
  for (const data of [{ content: [] }, { content: [{ text: "x", offset: -1, duration: 2 }] }, { content: [{ text: "x".repeat(20001), offset: 0, duration: 2 }] }]) assert.throws(() => normalizeTranscript(data, id));
  await assert.rejects(fetchNativeTranscript(id, "FAKE", { fetch: async () => Response.json({ jobId: "https://evil.test" }, { status: 202 }) }));
  let count = 0;
  await assert.rejects(fetchNativeTranscript(id, "FAKE", { pause: async () => {}, fetch: async () => count++ ? Response.json({ status: "processing" }) : Response.json({ jobId: "job" }, { status: 202 }) }));
  assert.equal(count, 41);
});

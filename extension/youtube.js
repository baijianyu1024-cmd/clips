// Supadata native-caption workflow inspired by youtube-digest (Zara Zhang, MIT).
// Pure helpers are shared with the web app; this file never accesses credentials.
export function youtubeId(raw) {
  try {
    const u = new URL(raw);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) return "";
    let id = "";
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname) && u.pathname === "/watch") id = u.searchParams.get("v") || "";
    if (u.hostname === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : "";
  } catch { return ""; }
}
/** @param {string} id @param {number | null} [time] */
export function youtubeUrl(id, time = null) {
  if (!/^[\w-]{11}$/.test(id)) return "";
  return `https://www.youtube.com/watch?v=${id}${Number.isFinite(time) && time >= 0 ? `&t=${Math.floor(time)}s` : ""}`;
}
export function transcriptText(segments, from, to) { return segments.slice(from, to + 1).map(s => s.text).join("\n"); }
export function transcriptRangeContainsTime(segments, from, to, time) {
  return Number.isFinite(time) && !!segments[from] && !!segments[to] && time >= segments[from].start && time <= segments[to].start + Math.max(segments[to].duration, 3);
}
export function normalizeTranscript(data, videoId) {
  if (!Array.isArray(data.content) || !data.content.length || data.content.length > 10000) throw new Error("这段视频没有可用的带时间字幕，仍可继续手动记录。");
  const segments = data.content.map(s => ({ text: typeof s.text === "string" ? s.text.trim() : "", start: s.offset / 1000, duration: s.duration / 1000 })).filter(s => s.text);
  if (!segments.length || segments.some(s => s.text.length > 20000 || !Number.isFinite(s.start) || s.start < 0 || s.start > 86400 || !Number.isFinite(s.duration) || s.duration < 0 || s.duration > 86400) || segments.reduce((n, s) => n + s.text.length, 0) > 300000) throw new Error("字幕格式或长度暂不支持，仍可继续手动记录。");
  segments.sort((a, b) => a.start - b.start);
  return { videoId, language: String(data.lang || "und").slice(0, 30), segments };
}
export async function fetchNativeTranscript(videoId, key, options = {}) {
  if (!youtubeUrl(videoId)) throw new Error("请选择一个 YouTube 视频。");
  const request = options.fetch || fetch;
  const signal = options.signal || AbortSignal.timeout(90000);
  const pause = options.pause || (ms => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    function abort() { clearTimeout(timer); reject(new Error("字幕读取超时，请稍后重试。")); }
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  }));
  async function get(url) {
    const response = await request(url, { headers: { "x-api-key": key }, signal, redirect: "error", credentials: "omit" });
    const messages = { 206: "这段视频没有原生字幕。不会启动 AI 转录，你仍可手动记录。", 401: "Supadata Key 无效，请在设置中更新。", 402: "Supadata 额度不足，请检查账户。", 403: "Supadata 暂时无法访问这段视频。", 404: "没有找到这段视频的字幕。", 429: "Supadata 请求过于频繁或额度不足，请稍后再试。" };
    if (!response.ok || response.status === 206) throw new Error(messages[response.status] || `字幕服务暂时不可用（${response.status}）。`);
    const reader = response.body.getReader(), parts = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4000000) throw new Error("字幕过大，暂时无法读取。"); parts.push(value); } } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("字幕服务返回了无法读取的内容，请重试。"); }
    return { status: response.status, data };
  }
  const url = new URL("https://api.supadata.ai/v1/transcript");
  url.searchParams.set("url", youtubeUrl(videoId)); url.searchParams.set("text", "false"); url.searchParams.set("mode", "native");
  // Do not request auto/generate: absent native captions must never trigger AI transcription.
  let result = await get(url.href);
  if (result.status === 202) {
    const jobId = result.data.jobId;
    if (typeof jobId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(jobId)) throw new Error("字幕任务未能建立，请稍后重试。");
    for (let i = 0; i < 40; i++) {
      await pause(1500);
      result = await get(`https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`);
      if (result.data.status === "failed" || result.data.error) throw new Error("字幕读取没有完成，仍可继续手动记录。");
      if (result.data.status === "completed" || Array.isArray(result.data.content)) break;
    }
  }
  return normalizeTranscript(result.data, videoId);
}

// Last subtitle starting at/before the playhead; gaps retain the preceding context.
export function currentSegmentIndex(segments, time) {
  if (!Number.isFinite(time) || !segments.length || time < segments[0].start) return -1;
  let lo = 0, hi = segments.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (segments[mid].start <= time) lo = mid + 1; else hi = mid; }
  return lo - 1;
}
export function overviewQuoteIndices(overview) {
  return [...new Set((overview?.quotes || []).flatMap(q => Array.from({ length: q.to - q.from + 1 }, (_, i) => q.from + i)))].sort((a, b) => a - b);
}
export function overviewClip(overview, snapshot) {
  return { id: overview.id, text: "", thought: "AI Overview\n\n" + overview.summary,
    sourceUrl: youtubeUrl(snapshot.videoId), sourceTitle: snapshot.title, videoTime: null, createdAt: new Date().toISOString() };
}

export function currentChapterIndex(chapters, segments, time) {
  if (!Number.isFinite(time)) return -1;
  let index = -1, start = -1;
  chapters.forEach((chapter, i) => { const t = segments[chapter.from]?.start; if (Number.isFinite(t) && t <= time && t >= start) { index = i; start = t; } });
  return index;
}

import { captionLanguage, fetchNativeTranscript, youtubeId, youtubeUrl } from "./youtube.js";
const origin = "https://api.supadata.ai/*";
async function credentials() {
  const session = await chrome.storage.session.get("supadataKey"), local = await chrome.storage.local.get("savedSupadataKey");
  return { key: session.supadataKey || local.savedSupadataKey || "", remember: !!local.savedSupadataKey };
}
export async function transcriptConfig() { const { key, remember } = await credentials(); return { configured: !!key, remember }; }
export async function saveTranscriptConfig(input) {
  const previous = await credentials(), key = String(input.key || previous.key).trim();
  if (!key || key.length > 1000 || /[\r\n]/.test(key)) throw new Error("请填写有效的 Supadata Key。");
  if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error("请允许连接 Supadata 后再保存。");
  await chrome.storage.session.set({ supadataKey: key });
  if (input.remember) await chrome.storage.local.set({ savedSupadataKey: key }); else await chrome.storage.local.remove("savedSupadataKey");
  return { configured: true };
}
export async function clearTranscriptConfig() { await chrome.storage.session.remove("supadataKey"); await chrome.storage.local.remove("savedSupadataKey"); return {}; }
const jobs = new Map();
// Runs in YouTube's MAIN world, returning only bounded language metadata. No
// credentials, storage, network requests or page-to-extension bridge are exposed.
export function readYoutubeCaptionInfo(videoId) {
  if (!["www.youtube.com", "youtube.com", "m.youtube.com"].includes(location.hostname) || new URL(location.href).searchParams.get("v") !== videoId) return {};
  const player = document.querySelector("#movie_player");
  let data; try { data = player?.getPlayerResponse?.(); } catch { return {}; }
  if (data?.videoDetails?.videoId !== videoId) return {};
  const valid = value => typeof value === "string" && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(value) ? value.toLowerCase() : "";
  const formats = (data.streamingData?.adaptiveFormats || []).slice(0, 500);
  const audio = formats.map(f => f.audioTrack).filter(Boolean);
  const original = audio.find(a => /\boriginal\b|原始|原声/i.test(String(a.displayName || "")));
  const audioLanguage = a => valid(String(a?.id || "").split(".")[0]);
  let language = audioLanguage(original);
  if (!language) {
    const unique = [...new Set(audio.map(audioLanguage).filter(Boolean))];
    if (unique.length === 1) language = unique[0];
  }
  const captions = data.captions?.playerCaptionsTracklistRenderer;
  const tracks = (captions?.captionTracks || []).slice(0, 200);
  // A single automatic-caption language is useful for videos without audio
  // metadata; multilingual/dubbed defaults are not proof of original language.
  if (!language && !audio.length) {
    const asr = [...new Set(tracks.filter(t => t.kind === "asr").map(t => valid(t.languageCode)).filter(Boolean))];
    if (asr.length === 1) language = asr[0];
  }
  return { originalLanguage: language, availableLanguages: [...new Set(tracks.map(t => valid(t.languageCode)).filter(Boolean))] };
}
async function captionInfo(videoId, windowId) {
  try {
    const current = await activeTab(windowId), tabs = await chrome.tabs.query({});
    const tab = youtubeId(current?.url) === videoId ? current : tabs.find(t => youtubeId(t.url) === videoId);
    if (!tab) return {};
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: readYoutubeCaptionInfo, args: [videoId] });
    return results[0]?.result || {};
  } catch { return {}; }
}
export async function getTranscript(videoId, options = {}) {
  if (!youtubeUrl(videoId)) throw new Error("请选择一个 YouTube 视频。");
  const explicit = !!options.language && options.language !== "auto";
  if (explicit && !captionLanguage(options.language)) throw new Error("字幕语言无效。");
  const info = explicit ? {} : await captionInfo(videoId, options.windowId);
  const language = captionLanguage(explicit ? options.language : info.originalLanguage) || "en";
  const cacheKey = `transcriptPending:v2:${videoId}:${explicit ? "selected" : "auto"}:${language}`, cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  // A successful fetch is retained until the cloud save succeeds, avoiding a second paid fetch.
  if (cached?.videoId === videoId && cached.selectionVersion === 1) return { ...cached, pendingKey: cacheKey };
  if (jobs.has(cacheKey)) return jobs.get(cacheKey);
  const job = (async () => {
    const { key } = await credentials();
    if (!key) throw new Error("先在阅读设置中填写 Supadata Key。");
    if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error("请在阅读设置中允许连接 Supadata。");
    const heartbeat = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
    try {
      const transcript = await fetchNativeTranscript(videoId, key, { language, explicit });
      await chrome.storage.local.set({ [cacheKey]: transcript });
      return { ...transcript, pendingKey: cacheKey };
    } catch (e) {
      if (["AbortError", "TimeoutError"].includes(e.name)) throw new Error("字幕读取超时，请稍后重试。你仍可继续手动记录。");
      if (e instanceof TypeError) throw new Error("无法连接 Supadata，请检查网络后重试。");
      throw e;
    } finally { clearInterval(heartbeat); jobs.delete(cacheKey); }
  })();
  jobs.set(cacheKey, job); return job;
}
// Runs in the selected tab's isolated world; never navigates the document.
export function readYoutubePlayer(id, seconds = null) {
  const url = new URL(location.href);
  if (!["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) || url.pathname !== "/watch" || url.searchParams.get("v") !== id) return { available: false, reason: "different-video" };
  const player = document.querySelector("video.html5-main-video") || document.querySelector("video");
  if (document.querySelector(".html5-video-player.ad-showing, .html5-video-player.ad-interrupting")) return { available: false, reason: "ad" };
  if (!player || player.readyState < 1 || !Number.isFinite(player.currentTime)) return { available: false, reason: "waiting" };
  if (Number.isFinite(seconds)) player.currentTime = Math.min(seconds, Number.isFinite(player.duration) ? player.duration : seconds);
  return { available: true, time: player.currentTime, paused: player.paused };
}
async function activeTab(windowId) {
  const [tab] = await chrome.tabs.query(Number.isInteger(windowId) && windowId >= 0 ? { active: true, windowId } : { active: true, lastFocusedWindow: true });
  return tab;
}
export async function seekYoutube(videoId, time, windowId) {
  if (!youtubeUrl(videoId) || !Number.isFinite(time) || time < 0 || time > 86400) throw new Error("视频位置无效。");
  const current = await activeTab(windowId), tabs = await chrome.tabs.query({});
  const tab = youtubeId(current?.url) === videoId ? current : tabs.find(t => youtubeId(t.url) === videoId);
  if (!tab) { const opened = await chrome.tabs.create({ url: youtubeUrl(videoId, time) }); return { restored: false, opened: true, tabId: opened.id }; }
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readYoutubePlayer, args: [videoId, time] });
    const state = results[0]?.result || { available: false, reason: "waiting" };
    if (!state.available) return { restored: false, ...state, tabId: tab.id };
    if (tab.id !== current?.id) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
    return { restored: true, ...state, tabId: tab.id };
  } catch {
    // Missing access must be visible. A timestamp navigation reloads the player
    // and loses continuous tracking, so it is never used for an existing tab.
    return { restored: false, available: false, reason: "page-access", tabId: tab.id };
  }
}
export async function youtubePlayback(videoId, windowId) {
  if (!youtubeUrl(videoId)) throw new Error("视频无效。");
  const tab = await activeTab(windowId);
  if (youtubeId(tab?.url) !== videoId) return { available: false, reason: "different-video" };
  try {
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readYoutubePlayer, args: [videoId] });
    return result[0]?.result || { available: false, reason: "waiting" };
  } catch { return { available: false, reason: "page-access" }; }
}

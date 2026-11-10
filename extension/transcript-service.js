import { fetchNativeTranscript, youtubeId, youtubeUrl } from "./youtube.js";
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
export async function getTranscript(videoId) {
  if (!youtubeUrl(videoId)) throw new Error("请选择一个 YouTube 视频。");
  const cacheKey = "transcriptPending:" + videoId, cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  // A successful fetch is retained until the cloud save succeeds, avoiding a second paid fetch.
  if (cached?.videoId === videoId) return cached;
  if (jobs.has(videoId)) return jobs.get(videoId);
  const job = (async () => {
    const { key } = await credentials();
    if (!key) throw new Error("先在阅读设置中填写 Supadata Key。");
    if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error("请在阅读设置中允许连接 Supadata。");
    const heartbeat = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
    try {
      const transcript = await fetchNativeTranscript(videoId, key);
      await chrome.storage.local.set({ [cacheKey]: transcript });
      return transcript;
    } catch (e) {
      if (["AbortError", "TimeoutError"].includes(e.name)) throw new Error("字幕读取超时，请稍后重试。你仍可继续手动记录。");
      if (e instanceof TypeError) throw new Error("无法连接 Supadata，请检查网络后重试。");
      throw e;
    } finally { clearInterval(heartbeat); jobs.delete(videoId); }
  })();
  jobs.set(videoId, job); return job;
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

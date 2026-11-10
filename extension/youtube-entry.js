export const YOUTUBE_ORIGINS = ["https://www.youtube.com/*", "https://youtube.com/*", "https://m.youtube.com/*"];
export async function injectYoutubeEntry(tab) {
  if (!tab?.id || !/^https:\/\/(www\.|m\.)?youtube\.com\//.test(tab.url || "")) return;
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["youtube-content.js"] }); } catch { /* The toolbar provides temporary access; no navigation or permission fallback. */ }
}
export async function registerYoutubeEntry() {
  const id = "shiye-youtube-entry";
  const granted = await chrome.permissions.contains({ origins: YOUTUBE_ORIGINS });
  const exists = (await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length;
  if (granted && !exists) await chrome.scripting.registerContentScripts([{ id, matches: YOUTUBE_ORIGINS, js: ["youtube-content.js"], runAt: "document_idle", persistAcrossSessions: true }]);
  if (!granted && exists) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  return { granted };
}

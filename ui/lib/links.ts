import { youtubeId, youtubeUrl } from "@/extension/youtube.js";
// Match URLs, never titles: distinct articles can have identical names.
export function linkKey(raw: string) {
  try {
    const url = new URL(raw.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    const video = youtubeId(raw); if (video) return youtubeUrl(video);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|scene$|spm_id_from$|vd_source$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return ""; }
}
export const linkKind = (url: string): "video" | "article" => /(^|\.)(youtube\.com|youtu\.be|bilibili\.com|b23\.tv)$/.test(new URL(url).hostname) ? "video" : "article";
export const fallbackTitle = (url: string) => new URL(url).hostname.replace(/^www\./, "");

import { sourceUrlKey, normalizeSourceUrl } from "@/extension/link-metadata.js";
// Shared by web and extension; never merge articles by their title.
export const linkKey = sourceUrlKey;
export const sourceUrl = normalizeSourceUrl;
export const linkKind = (url: string): "video" | "article" => /(^|\.)(youtube\.com|youtu\.be|bilibili\.com|b23\.tv)$/.test(new URL(url).hostname) ? "video" : "article";
export const fallbackTitle = (url: string) => new URL(url).hostname.replace(/^www\./, "");

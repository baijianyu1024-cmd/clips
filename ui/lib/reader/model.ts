import { z } from "zod";

export const webUrl = z.string().max(2000).refine(s => { try { return ["http:", "https:"].includes(new URL(s).protocol); } catch { return false; } }, "请输入完整的网页链接");
export const blockSchema = z.object({
  id: z.string().regex(/^b-\d+$/),
  type: z.enum(["paragraph", "heading", "quote", "list", "code", "image"]),
  text: z.string().max(20000),
  level: z.number().int().min(1).max(6).optional(),
  imageUrl: webUrl.optional(),
  imageKey: z.string().max(250).optional(),
});
export const articleSchema = z.object({
  title: z.string().trim().min(1).max(300), byline: z.string().max(300), published: z.string().max(100),
  sourceUrl: webUrl, resolvedUrl: webUrl, method: z.enum(["wechat", "readability", "manual", "import"]),
  blocks: z.array(blockSchema).min(1).max(1500),
  warnings: z.array(z.string().max(500)).max(20),
}).refine(a => a.blocks.reduce((sum, b) => sum + b.text.length, 0) <= 180000, "正文过长，请分段保存").refine(a => new Set(a.blocks.map(b => b.id)).size === a.blocks.length, "段落标识不能重复");
export type Article = z.infer<typeof articleSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Snapshot = Article & { id: string; noteId: string; createdAt: string };
export const anchorSchema = z.object({
  snapshotId: z.string().uuid(), blockId: z.string().regex(/^b-\d+$/), start: z.number().int().min(0), end: z.number().int().min(1),
}).refine(a => a.end > a.start, "请选择一段原文");
export function canonicalSource(raw: string) {
  const url = new URL(raw); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|scene$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
export function snapshotText(article: Article) {
  return [`# ${article.title}`, article.byline, `来源：${article.sourceUrl}`, ...article.blocks.map(b => b.type === "image" ? `[图片：${b.text || "原文配图"}]` : b.type === "heading" ? `## ${b.text}` : b.text)].filter(Boolean).join("\n\n");
}

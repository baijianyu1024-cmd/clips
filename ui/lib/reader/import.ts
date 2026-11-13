import { z } from "zod";
import { articleSchema, canonicalSource, type Article } from "./model";

export const originalFileSchema = z.object({ format: z.literal("shiye-original"), version: z.literal(1), article: articleSchema });

// Import is only a preview. Saving still uses the authenticated, source-bound API.
export function importOriginalFile(raw: string, name: string, sourceUrl: string, title: string): Article {
  raw = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (raw.length > 1000000) throw new Error("正文文件过大，请控制在 1 MB 以内。");
  if (/\.json$/i.test(name)) {
    let value; try { value = JSON.parse(raw); } catch { throw new Error("正文文件不是有效的 JSON，请选择Clips正文文件。"); }
    const result = originalFileSchema.safeParse(value);
    if (!result.success) throw new Error("这不是有效的Clips正文文件。普通文本请使用 .txt 或 .md 文件。");
    const a = result.data.article;
    if (canonicalSource(a.sourceUrl) !== canonicalSource(sourceUrl)) throw new Error("文件的来源链接与当前来源不一致。请先在笔记中添加并选择文件对应的来源，避免把正文放错位置。");
    return { ...a, method: "import", blocks: a.blocks.map(({ imageKey: _ignored, ...b }) => b), warnings: [...a.warnings.slice(0, 18), "由正文文件导入，请在保存前检查内容是否完整。"] };
  }
  if (!/\.(txt|md)$/i.test(name)) throw new Error("请选择 .txt、.md 或Clips正文文件（.json）。");
  if (raw.trim().length < 20) throw new Error("正文太短，请导入至少 20 字的内容。");
  if (raw.length > 180000) throw new Error("正文超过 18 万字，请分段导入。");
  const parts = raw.trim().split(/\n\s*\n/).filter(Boolean);
  const blocks = parts.map((text, i) => {
    const heading = /\.md$/i.test(name) && text.match(/^(#{1,6}) +([^\n]+)$/);
    return heading ? { id: `b-${i}`, type: "heading" as const, text: heading[2].trim(), level: heading[1].length } : { id: `b-${i}`, type: "paragraph" as const, text: text.trim() };
  });
  const result = articleSchema.safeParse({ title: title.trim().slice(0, 300) || name.replace(/\.(txt|md)$/i, ""), sourceUrl: canonicalSource(sourceUrl), resolvedUrl: sourceUrl, byline: "", published: "", method: "import", blocks, warnings: ["由本地文字文件导入，保留段落和文字；复杂排版、附件和图片不包含在这份副本中。"] });
  if (!result.success) throw new Error("正文段落过长或过多，请用空行分段后再导入。");
  return result.data;
}

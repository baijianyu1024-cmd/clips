import {isLocalLibrary} from "./client-runtime";
import { quoteView } from "@/extension/quote-context.js";
import { z } from "zod";
import { transcriptAnchorSchema, transcriptMetaSchema } from "@/lib/transcript-model";
import { anchorSchema } from "@/lib/reader/model";

export const kinds = { article: "文章", video: "视频", podcast: "播客", idea: "灵感", other: "其他" } as const;
export type Kind = keyof typeof kinds;
const dateString = z.string().datetime();
export const sourceSchema = z.object({
  url: z.string().max(2000).refine(value => {
    try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
  }, "请输入以 https:// 或 http:// 开头的来源链接"),
  label: z.string().trim().max(100),
});
export const imageSchema = z.object({ key: z.string().regex(/^[a-f0-9]{64}\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/), name: z.string().max(200), createdAt: dateString.optional() });
export const clipSchema = z.object({
  id: z.string().uuid(), text: z.string().trim().max(20000), thought: z.string().trim().max(20000),
  sourceUrl: z.union([sourceSchema.shape.url, z.literal("")]).default(""), sourceTitle: z.string().max(200), createdAt: dateString,
  videoTime: z.number().finite().min(0).nullable().default(null),
  translation: z.object({ scope: z.literal("quote").optional(), text: z.string().trim().min(1).max(20000), language: z.literal("zh-CN"), model: z.string().min(1).max(200) }).optional(),
  sourceLanguage: z.string().max(30).optional(), excerptBoundary: z.enum(["sentence", "context"]).optional(),
  anchor: anchorSchema.optional(), transcriptAnchor: transcriptAnchorSchema.optional(),
  images: z.array(imageSchema).max(30).optional(), undated: z.boolean().optional(),
}).refine(c => !!(c.text || c.thought || c.images?.length), "先写下一点发现吧");
export const aiSummarySchema = z.object({
  id: z.string().uuid(), text: z.string().trim().min(1).max(40000), provider: z.string().max(100),
  model: z.string().max(200), scope: z.string().max(100), sourceUrl: sourceSchema.shape.url, createdAt: dateString,
});
export const coreSummarySchema = z.object({
  id: z.string().uuid(), text: z.string().trim().max(40000), images: z.array(imageSchema).max(30).default([]),
  origin: z.enum(["manual", "ai"]), scope: z.string().max(160),
  provider: z.string().max(100).default(""), model: z.string().max(200).default(""),
  sourceUrl: sourceSchema.shape.url.optional(), createdAt: dateString,
  edited: z.boolean().default(false),
}).refine(s => !!(s.text || s.images.length), "写下一点摘要，或添加一张图片再保存。");
export type CoreSummary = z.infer<typeof coreSummarySchema>;
export const positionSchema = z.object({
  url: sourceSchema.shape.url, scrollY: z.number().finite().min(0), ratio: z.number().min(0).max(1),
  videoTime: z.number().finite().min(0).nullable(), updatedAt: dateString,
});
export const learningOriginSchema = z.object({
  chatId:z.string().uuid(), turnIds:z.array(z.string().uuid()).max(20), questions:z.array(z.string().max(4000)).max(20),createdAt:dateString,
  materials:z.array(z.object({id:z.string().regex(/^[a-f0-9]{64}$/),number:z.number().int().positive(),noteId:z.string().uuid(),title:z.string().max(300),kind:z.enum(['original','thought','summary','transcript','image','generated']),text:z.string().max(6000),url:z.union([sourceSchema.shape.url,z.literal('')]).optional(),location:z.string().max(500).optional(),coverage:z.string().max(12000).optional(),published:z.string().max(100).optional(),imageKey:z.string().regex(/^[a-f0-9]{64}\/(?:reader\/[a-f0-9-]{36}\/)?[a-f0-9-]{36}\.(png|jpg|webp|gif)$/).optional()})).max(240),
});
export const fieldsSchema = z.object({
  learningOrigin:learningOriginSchema.optional(),
  title: z.string().trim().max(200),
  summary: z.string().trim().max(40000),
  thought: z.string().trim().max(40000),
  sources: z.array(sourceSchema).max(10),
  kind: z.enum(["article", "video", "podcast", "idea", "other"]),
  tags: z.array(z.string().trim().min(1).max(30)).max(15),
  timestamp: z.string().trim().max(30),
  published: z.string().trim().max(30),
  images: z.array(imageSchema).max(30),
  status: z.enum(["inbox", "reading", "read"]),
  clips: z.array(clipSchema).max(500).default([]),
  aiSummaries: z.array(aiSummarySchema).max(100).default([]),
  readingPosition: positionSchema.nullable().default(null),
});
export const reviewSchema = z.object({ id: z.string().uuid(), text: z.string().trim().max(40000), createdAt: dateString, nextAt: dateString.nullable() });
export const metadataSchema = fieldsSchema.pick({ title: true, sources: true, kind: true, tags: true, timestamp: true, published: true, status: true });
export const noteSchema = fieldsSchema.extend({
  transcripts: z.array(transcriptMetaSchema).max(30).optional(),
  legacyRecordImages: z.array(imageSchema).max(30).optional(),
  coreSummary: coreSummarySchema.nullable().default(null),
  coreSummaryHistory: z.array(coreSummarySchema).max(20).default([]),
  linkTitleStatus: z.enum(["pending", "ready", "unavailable"]).optional(),
  linkTitleVersion: z.number().int().nonnegative().optional(),
  id: z.string().uuid(), createdAt: dateString, updatedAt: dateString, revision: z.number().int().positive(),
  nextReviewAt: dateString.nullable(), starred: z.boolean(), archived: z.boolean(), deletedAt: dateString.nullable(),
  reviews: z.array(reviewSchema).max(500),
}).refine(n => !!(n.thought || n.summary || n.title || n.sources.length || n.images.length || n.clips.length || n.legacyRecordImages?.length), "先记下一点内容，再保存吧");
export type Note = z.infer<typeof noteSchema>;
export type Fields = z.infer<typeof fieldsSchema>;
export const blankFields: Fields = { title: "", summary: "", thought: "", sources: [], kind: "article", tags: [], timestamp: "", published: "", images: [], status: "read", clips: [], aiSummaries: [], readingPosition: null };
export function titleOf(note: Pick<Fields, "title" | "thought" | "summary" | "sources">) {
  return note.title || (note.thought || note.summary).split("\n")[0].slice(0, 80) || note.sources[0]?.label || note.sources[0]?.url || "图片笔记";
}
export function inDays(days: number, now = new Date()) {
  const next = new Date(now); next.setDate(next.getDate() + days); return next.toISOString();
}
export function tagsFrom(text: string) { return [...new Set(text.split(/[,，#\n]/).map(t => t.trim()).filter(Boolean))]; }
export function isDue(note: Note, now = new Date()) {
  return note.status === "read" && !note.archived && !note.deletedAt && !!note.nextReviewAt && new Date(note.nextReviewAt) <= now;
}
export function toMarkdown(notes: Note[]) {
  const imageMarkdown = (img: z.infer<typeof imageSchema>) => `![${img.name.replace(/[\[\]]/g, "")}](${isLocalLibrary() ? "images/"+img.key : (typeof location !== "undefined" ? location.origin : "")+"/api/media?key="+encodeURIComponent(img.key)})`;
  return notes.map(n => [
    `# ${titleOf(n)}`, `记录于：${n.createdAt}\n来源类型：${kinds[n.kind]}`,
    n.published && `内容发布时间：${n.published}`, n.timestamp && `关键时间点：${n.timestamp}`,
    ...n.sources.map(s => `来源${s.label ? `（${s.label}）` : ""}：${s.url}`),
    n.tags.length && `标签：${n.tags.join("、")}`,
    n.coreSummary && `## 核心摘要\n\n${n.coreSummary.text}\n\n${n.coreSummary.images.map(imageMarkdown).join("\n\n")}\n\n整理方式：${n.coreSummary.origin === "ai" ? "AI 辅助" : "手动撰写"}${n.coreSummary.edited ? " · 已手动修改" : ""}\n材料范围：${n.coreSummary.scope}`, n.summary && `## 摘录与要点\n\n${n.summary}`,
    n.learningOrigin && `## 对话来源\n\n问题：${n.learningOrigin.questions.join("；")}\n\n对话：/learn?chat=${n.learningOrigin.chatId}\n\n${n.learningOrigin.materials.map(m=>`[${m.number}] ${m.title} · ${m.kind}\n${m.text}\n${m.url||""}`).join("\n\n")}`,
    n.thought && `## 我的想法\n\n${n.thought}`,
    ...(n.legacyRecordImages || []).map(imageMarkdown),
    ...n.clips.map(c => { const v = quoteView(c, n.transcripts?.find(t => t.id === c.transcriptAnchor?.snapshotId)?.language); return `## 随读记录 · ${c.undated ? "时间未记录" : c.createdAt}\n\n${v.original ? v.original.split("\n").map((l: string) => `> ${l}`).join("\n") + "\n\n" : ""}${v.translation ? "AI 译文（" + c.translation!.model + "）：\n" + v.translation + "\n\n" : ""}${c.thought}\n\n${(c.images || []).map(imageMarkdown).join("\n\n")}${c.sourceUrl ? `\n\n来源：${c.sourceUrl}` : ""}${c.videoTime === null ? "" : `\n视频位置：${Math.floor(c.videoTime / 60)}:${String(Math.floor(c.videoTime % 60)).padStart(2, "0")}`}`; }),
    ...n.aiSummaries.map(a => `## AI 摘要 · ${a.provider} / ${a.model}\n\n基于：${a.scope} · ${a.sourceUrl}\n\n${a.text}`),
    ...n.images.map(imageMarkdown),
    ...n.reviews.map(r => `## 回顾 · ${r.createdAt}\n\n${r.text || "重读了这条笔记。"}`),
  ].filter(Boolean).join("\n\n")).join("\n\n---\n\n");
}

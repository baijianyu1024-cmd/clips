import { z } from "zod";
export const transcriptId = z.string().regex(/^[a-f0-9]{64}$/);
export const transcriptAnchorSchema = z.object({ snapshotId: transcriptId, from: z.number().int().min(0).max(9999), to: z.number().int().min(0).max(9999), startOffset: z.number().int().min(0).max(20000).optional(), endOffset: z.number().int().min(1).max(20000).optional() }).refine(v => v.to >= v.from && ((v.startOffset === undefined && v.endOffset === undefined) || (v.startOffset !== undefined && v.endOffset !== undefined && (v.from !== v.to || v.endOffset > v.startOffset))));
export const transcriptInputSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/), title: z.string().trim().max(200), language: z.string().max(30),
  segments: z.array(z.object({ text: z.string().trim().min(1).max(20000), start: z.number().finite().min(0).max(86400), duration: z.number().finite().min(0).max(86400) })).min(1).max(10000),
}).refine(v => v.segments.reduce((n, s) => n + s.text.length, 0) <= 300000 && v.segments.every((s, i) => !i || s.start >= v.segments[i - 1].start), "字幕格式或长度暂不支持。");
export const transcriptMetaSchema = z.object({ id: transcriptId, videoId: z.string().regex(/^[\w-]{11}$/), title: z.string().max(200), language: z.string().max(30), segmentCount: z.number().int().min(1).max(10000), createdAt: z.string().datetime() });
export type TranscriptMeta = z.infer<typeof transcriptMetaSchema>;
export type Transcript = z.infer<typeof transcriptInputSchema> & TranscriptMeta;

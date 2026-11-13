import { z } from "zod";
const index = z.number().int().min(0).max(9999);
export const overviewContentSchema = z.object({
  summary: z.string().trim().min(1).max(8000),
  chapters: z.array(z.object({ from: index, title: z.string().trim().min(1).max(160), summary: z.string().trim().min(1).max(1200) })).min(1).max(400),
  quotes: z.array(z.object({ from: index, to: index }).refine(v => v.to >= v.from && v.to - v.from <= 10)).max(160),
});
export const overviewSchema = overviewContentSchema.extend({ id: z.string().uuid(), model: z.string().min(1).max(200), createdAt: z.string().datetime() });
export const translationSchema = z.object({ text: z.string().trim().min(1).max(20000), model: z.string().min(1).max(200), createdAt: z.string().datetime() });
export const transcriptAssistSchema = z.object({ overview: overviewSchema.nullable().default(null), translations: z.record(z.string().regex(/^\d{1,4}$/), translationSchema).default({}), quoteTranslations: z.record(z.string().regex(/^\d{1,4}:\d{1,4}(?::\d{1,5}:\d{1,5})?$/), translationSchema).default({}) });
export type TranscriptAssist = z.infer<typeof transcriptAssistSchema>;

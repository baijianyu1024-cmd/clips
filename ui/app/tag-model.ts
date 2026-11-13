import { z } from "zod";
import type { Note } from "./model";

export const tagKey = (name: string) => name.trim().toLowerCase();
export const tagNameSchema = z.string().trim().min(1, "请输入标签名称。").max(30, "标签名称最多 30 个字符。").regex(/^[^,，#\n\r]+$/, "标签名称不能包含逗号、# 或换行。");
export type TagInfo = { name: string; count: number; usageCount: number };
export type TagState = { tags: TagInfo[]; revision: number };
export type TagMutation = TagState & { notes: Note[]; renamed?: { from: string; to: string }; created?: string };
export function uniqueTags(names: string[]) {
  return [...new Map(names.filter(n => n.trim()).map(n => [tagKey(n), n.trim()])).values()].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

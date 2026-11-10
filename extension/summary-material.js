import { coreMaterial } from "./core.js";
import { MAX_IMAGES, imageForAI } from "./visual-material.js";

export async function prepareCoreMaterial(note, { readPage, cloud, resize = imageForAI, sourceMode = "page", supplement = "" }) {
  supplement = supplement.trim();
  if (sourceMode === "supplement") {
    if (!supplement) throw new Error("请先填写「我的补充」，或选择其他摘要来源。");
    return { text: "", scope: "仅使用我的补充", sourceUrl: note.sources[0]?.url, images: [], supplement };
  }
  let source = { text: "", images: [], url: note.sources[0]?.url, reason: "仅使用这篇笔记的已存记录。" };
  if (sourceMode === "page" && readPage) {
    try { source = await readPage(); }
    catch (error) {
      if (/切换/.test(error.message)) throw error;
      source.reason = `页面材料未获取：${error.message}`;
    }
  }
  source = { ...source, images: [...(source.images || [])] };
  const attachments = [
    ...(note.images || []).map(image => ({ ...image, context: "笔记中保存的图片" })),
    ...(note.clips || []).flatMap((clip, i) => (clip.images || []).map(image => ({ ...image, context: `随读记录 ${i + 1}：${[clip.text, clip.thought].filter(Boolean).join(" / ").slice(0, 450)}` }))),
  ].filter((image, i, all) => image.key && all.findIndex(other => other.key === image.key) === i);
  let missing = 0;
  for (const image of attachments) {
    if (source.images.length >= MAX_IMAGES || image.key.startsWith("demo/")) { missing++; continue; }
    try {
      const result = await cloud({ path: `/api/media?key=${encodeURIComponent(image.key)}` });
      source.images.push(await resize(result.dataUrl, image.context));
    } catch { missing++; }
  }
  if (missing) { source.status = "partial"; source.reason += ` ${missing} 张已存图片本次未包含。`; }
  const material = coreMaterial(note, source, supplement);
  if (supplement && material.text) material.scope = "含我的补充 · " + material.scope;
  return { ...material, supplement };
}

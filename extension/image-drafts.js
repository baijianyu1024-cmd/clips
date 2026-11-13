const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function transferImages(transfer) {
  const items = [...(transfer?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
  return items.length ? items : [...(transfer?.files || [])].filter(file => file.type.startsWith('image/'));
}
export function validateImageBatch(files, count = 0) {
  if (!files.length) throw new Error('请选择图片，或把截图粘贴到输入框。');
  if (count + files.length > 30) throw new Error('一条发现最多添加 30 张图片，请分次保存。');
  for (const file of files) {
    if (!TYPES.has(file.type)) throw new Error('支持 PNG、JPG、WebP 和 GIF 图片。');
    if (!file.size) throw new Error('图片是空的，请重新截图或选择图片。');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 8 MB。请缩小截图范围后再粘贴。');
  }
}
let database;
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const req = indexedDB.open('shiye-image-drafts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { database = null; reject(new Error('本机图片草稿暂时无法保存，请检查浏览器存储空间。')); };
  });
  return database;
}
async function transaction(mode, action) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('images', mode), request = action(tx.objectStore('images'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error('本机图片草稿保存失败，请检查浏览器存储空间。'));
  });
}
export const draftImageStore = {
  put: (noteId, id, blob) => transaction('readwrite', store => store.put(blob, `${noteId}:${id}`)),
  get: (noteId, id) => transaction('readonly', store => store.get(`${noteId}:${id}`)),
  remove: (noteId, id) => transaction('readwrite', store => store.delete(`${noteId}:${id}`)),
};
export async function stageImages(noteId, files, existing = [], store = draftImageStore) {
  validateImageBatch(files, existing.length);
  const added = [];
  try {
    for (const file of files) {
      const item = { id: crypto.randomUUID(), name: (file.name || '粘贴的截图.png').slice(0, 200), type: file.type, size: file.size };
      await store.put(noteId, item.id, file); added.push(item);
    }
    return added;
  } catch (error) { await Promise.all(added.map(item => store.remove(noteId, item.id).catch(() => {}))); throw error; }
}
export function blobDataUrl(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片，请重新添加。')); reader.readAsDataURL(blob); });
}
// Checkpoint every successful upload so a save retry never reuploads those images.
export async function uploadDraftImages(noteId, attachments, upload, checkpoint, store = draftImageStore) {
  const result = [];
  for (const item of attachments) {
    if (!item.image) {
      const file = await store.get(noteId, item.id);
      if (!file) throw new Error('有一张图片的本机草稿丢失，请移除后重新添加。文字仍保留在草稿中。');
      item.image = await upload(file, item);
      await checkpoint(item);
    }
    result.push(item.image);
  }
  return result;
}
export function sameDiscovery(saved, clip) {
  // Cloud normalizes surrounding whitespace; local files preserve the editor's Markdown.
  const normalized = value => String(value ?? '').trim();
  return normalized(saved.text) === normalized(clip.text) && normalized(saved.thought) === normalized(clip.thought) && saved.sourceUrl === clip.sourceUrl && JSON.stringify((saved.images || []).map(i => i.key)) === JSON.stringify((clip.images || []).map(i => i.key));
}

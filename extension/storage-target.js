// Browser storage holds connection handles and disposable UI state, never the local library.
const TARGET = 'clipsStorageTarget';
let database;
function handles() {
  return database ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('clips-folder-handles', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { database = null; reject(r.error); };
  });
}
export async function handleStore(id, value) {
  const db = await handles();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', value ? 'readwrite' : 'readonly');
    const req = value ? tx.objectStore('handles').put(value, id) : tx.objectStore('handles').get(id);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('无法记住文件夹授权。'));
  });
}
export const targetKey = target => target?.mode === 'local' ? `local:${target.id}:${target.connection || ''}` : 'unset';
export async function getTarget() {
  const saved = (await chrome.storage.local.get(TARGET))[TARGET];
  return saved?.mode === 'local' && /^[a-f0-9-]{36}$/.test(saved.id) ? saved : null;
}

export async function setTarget(target) {
  if (target?.mode !== 'local' || !/^[a-f0-9-]{36}$/.test(target.id)) throw new Error('资料库配置无效。');
  await chrome.storage.local.set({ [TARGET]: target });
}
export async function assertTarget(target) {
  if (!target || targetKey(target) !== targetKey(await getTarget())) throw new Error('资料库已切换，请重新打开此页面。草稿仍保留在原资料库。');
}
export function scopedStorage(target, base = chrome.storage.local) {
  const prefix = target?.mode === 'local' ? `library:${target.id}:` : 'unconfigured:';
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const result = await base.get(list.map(k => prefix + k));
      return Object.fromEntries(list.map(k => [k, result[prefix + k]]));
    },
    set(values) { return base.set(Object.fromEntries(Object.entries(values).map(([k,v]) => [prefix + k, v]))); },
    remove(keys) { return base.remove((Array.isArray(keys) ? keys : [keys]).map(k => prefix + k)); },
  };
}
export async function folderHandle(target) {
  const root = await handleStore(target.id);
  if (!root || await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('本地资料库尚未授权。请打开笔记库，重新授权文件夹；内容没有改存到浏览器中。');
  return root;
}

// Unsubmitted content stays on this device. Serialize writes so a late autosave
// cannot resurrect a preview after its note has been saved.
export function createDraftStore(storage) {
  const tails = new Map();
  const enqueue = (key, operation) => {
    const result = (tails.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    tails.set(key, result);
    void result.finally(() => { if (tails.get(key) === result) tails.delete(key); }).catch(() => {});
    return result;
  };
  return {
    load: key => enqueue(key, () => storage.read(key)),
    save(key, value) {
      const snapshot = structuredClone(value);
      return enqueue(key, () => storage.write(key, snapshot));
    },
    clear: key => enqueue(key, () => storage.remove(key)),
  };
}

export function browserDraftStorage(win) {
  const key = id => `clips:temporary:v1:${id}`;
  return {
    read: id => JSON.parse(win.localStorage.getItem(key(id)) || 'null'),
    write: (id, value) => win.localStorage.setItem(key(id), JSON.stringify(value)),
    remove: id => win.localStorage.removeItem(key(id)),
  };
}

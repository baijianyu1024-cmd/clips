const key = name => String(name).trim().toLowerCase();
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function validateTag(name) {
  const value = String(name || "").trim();
  if (!value) throw new Error("请输入标签名称。");
  if (value.length > 30) throw new Error("标签名称最多 30 个字符。");
  if (/[,，#\n\r]/.test(value)) throw new Error("标签名称不能包含逗号、# 或换行。");
  return value;
}

export async function createTag(cloud, name) {
  name = validateTag(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = (await cloud({})).tagState;
    if (!state || !Array.isArray(state.tags)) throw new Error("标签列表未返回，请刷新笔记库后重试。");
    const existing = state.tags.find(t => key(t.name) === key(name));
    if (existing) return existing.name;
    try {
      const result = await cloud({ method: "POST", body: { action: "create_tag", name, revision: state.revision } });
      return result.created || name;
    } catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
  }
}

export async function setNoteTag(cloud, noteId, name, selected) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await cloud({})).notes.find(n => n.id === noteId);
    if (!current || current.deletedAt || current.archived) throw new Error("这篇笔记已移除或归档，请先恢复。");
    if (current.tags.some(t => key(t) === key(name)) === selected) return current;
    try {
      return (await cloud({ method: "PATCH", body: { id: noteId, revision: current.revision, action: "tag", tag: name, selected } })).note;
    } catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
  }
}

export function createNoteTags({ root, cloud, active, onSaved }) {
  let noteId = null, opened = false, loading = false, saving = false, catalog = [], message = "", error = false, sequence = 0, loadError = "", catalogRevision = -1;
  root.innerHTML = `<div class="note-tags-row"><span class="note-tags-label">标签</span><div class="note-tag-chips"></div><button type="button" class="tag-toggle" data-tag-action="open" aria-expanded="false" aria-controls="tag-picker">＋ 标签</button></div>
    <div id="tag-picker" class="tag-picker" hidden><div class="tag-picker-head"><label for="tag-search">选择标签</label><button type="button" data-tag-action="close">完成</button></div><input id="tag-search" type="search" maxlength="30" placeholder="搜索或新建标签" autocomplete="off"><div class="tag-list-heading"><span>已有标签</span><span class="tag-total"></span></div><div class="tag-options" role="group" aria-label="可选标签"></div><p class="tag-feedback" role="status" aria-live="polite"></p><button type="button" class="tag-retry" data-tag-action="reload" hidden>重新加载标签</button></div>`;
  const input = root.querySelector("input"), picker = root.querySelector(".tag-picker"), options = root.querySelector(".tag-options"), feedback = root.querySelector(".tag-feedback");
  function renderOptions() {
    const note = active(), query = input.value.trim(), selected = note?.tags || [];
    const names = [...new Map([...catalog, ...selected.map(name => ({ name }))].map(t => [key(t.name), t])).values()];
    const matches = names.filter(t => key(t.name).includes(key(query)));
    root.querySelector(".tag-total").textContent = `${names.length}`;
    options.innerHTML = matches.map(t => `<button type="button" class="tag-option" data-tag-action="toggle" data-name="${escape(t.name)}" aria-pressed="${selected.some(name => key(name) === key(t.name))}" ${saving || loading ? "disabled" : ""}><span class="tag-check" aria-hidden="true">${selected.some(name => key(name) === key(t.name)) ? "✓" : ""}</span><span class="tag-name">${escape(t.name)}</span></button>`).join("");
    if (!loading && !loadError && query && !names.some(t => key(t.name) === key(query))) options.insertAdjacentHTML("beforeend", `<button type="button" class="tag-create" data-tag-action="create" ${saving ? "disabled" : ""}>＋ 新建「${escape(query)}」</button>`);
    if (!options.childElementCount) options.innerHTML = `<p class="tag-empty">${loading ? "正在加载标签…" : loadError ? "标签暂未加载成功。" : query ? "没有匹配的标签。" : "笔记库还没有标签，输入名称即可新建。"}</p>`;
    feedback.textContent = saving ? "正在保存…" : loading ? "正在刷新标签…" : loadError || message || "勾选后自动保存";
    feedback.classList.toggle("error", error || !!loadError);
    root.querySelector(".tag-retry").hidden = !loadError || loading;
    input.disabled = saving;
  }
  function render() {
    const note = active(); root.hidden = !note;
    if (noteId !== note?.id) { noteId = note?.id; opened = false; input.value = ""; message = ""; error = false; loadError = ""; sequence++; loading = false; }
    if (!note) return;
    root.querySelector(".note-tag-chips").innerHTML = (note.tags || []).map(name => `<button type="button" class="note-tag-chip" data-tag-action="open" title="修改标签：${escape(name)}">${escape(name)}</button>`).join("");
    root.querySelector(".tag-toggle").setAttribute("aria-expanded", String(opened));
    picker.hidden = !opened;
    if (opened) renderOptions();
  }
  function sync(result) {
    const state = result.tagState;
    if (!state || !Array.isArray(state.tags) || !Number.isInteger(state.revision)) throw new Error("标签列表未返回，请刷新笔记库后重试。");
    if (state.revision < catalogRevision) return;
    // Use the same catalog snapshot as the notebook, including unused tags and
    // tags assigned to other notes. An untagged active note is not an empty library.
    catalogRevision = state.revision;
    catalog = [...new Map([...(result.notes || []).filter(n => !n.deletedAt).flatMap(n => (n.tags || []).map(name => ({ name }))), ...state.tags].map(t => [key(t.name), t])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    if (opened) renderOptions();
  }
  async function open() {
    opened = true; loading = true; message = ""; error = false; loadError = "";
    render(); input.focus();
    const request = ++sequence;
    try { const result = await cloud({}); if (request === sequence) sync(result); }
    catch (e) { if (request === sequence) loadError = e.message || "标签加载失败，请重试。"; }
    finally { if (request === sequence) { loading = false; renderOptions(); } }
  }
  async function change(button) {
    if (saving || loading) return;
    const note = active(); if (!note) return;
    const target = note.id, query = input.value;
    let name = button.dataset.name, selected = !note.tags?.some(t => key(t) === key(name));
    saving = true; error = false; renderOptions();
    try {
      if (button.dataset.tagAction === "create") {
        if ((note.tags || []).length >= 15) throw new Error("每篇笔记最多添加 15 个标签。");
        name = await createTag(cloud, query); selected = true;
      }
      const updated = await setNoteTag(cloud, target, name, selected);
      if (selected && !catalog.some(t => key(t.name) === key(name))) catalog.push({ name });
      onSaved(updated);
      if (active()?.id === target) { message = "已保存"; if (button.dataset.tagAction === "create") input.value = ""; }
    } catch (e) { if (active()?.id === target) { message = e.message; error = true; } }
    finally { saving = false; render(); if (active()?.id === target && opened) input.focus(); }
  }
  root.addEventListener("click", event => {
    const button = event.target.closest("button[data-tag-action]"); if (!button) return;
    if (button.dataset.tagAction === "reload") void open();
    else if (button.dataset.tagAction === "open") { if (!opened) void open(); else input.focus(); }
    else if (button.dataset.tagAction === "close") { opened = false; sequence++; loading = false; render(); root.querySelector(".tag-toggle").focus(); }
    else void change(button);
  });
  input.addEventListener("input", () => { message = ""; error = false; renderOptions(); });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); opened = false; render(); root.querySelector(".tag-toggle").focus(); }
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); const create = options.querySelector('[data-tag-action="create"]'); if (create) void change(create); }
  });
  return { render, sync };
}

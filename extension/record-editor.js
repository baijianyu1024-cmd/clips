import { contentRecord, saveContentEdit } from './content-edit.js';
import { markdownHelpHTML } from "./markdown.js";
import { stageImages, draftImageStore, transferImages, uploadDraftImages, blobDataUrl } from "./image-drafts.js";

const editable = clip => JSON.stringify({ text: clip.text || "", thought: clip.thought || "", images: (clip.images || []).map(i => i.key) });
// Retry unrelated revision changes, but never overwrite a concurrently edited record.
export async function saveRecordEdit(cloud, noteId, baseline, record) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const note = (await cloud({})).notes.find(n => n.id === noteId && !n.deletedAt && !n.archived);
    const current = note?.clips.find(c => c.id === baseline.id);
    if (!current) throw new Error("这条记录已移除或归档，请先到笔记库恢复。");
    if (editable(current) === editable(record)) return note; // Lost response: already saved.
    if (editable(current) !== editable(baseline)) throw Object.assign(new Error("这条记录已在其他地方修改。草稿仍保留；请先核对最新记录，或载入最新内容重新编辑。"), { code: "RECORD_CONFLICT" });
    try { return (await cloud({ method: "PATCH", body: { id: noteId, revision: note.revision, action: "edit_record", record } })).note; }
    catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
  }
}

export function createRecordEditor({ adapter, native, active, upsert, rerender, notice }) {
  const root = document.createElement("section"); root.className = "record-editor";
  root.setAttribute("aria-label", "编辑随读记录");
  root.innerHTML = `<label>我的想法<textarea rows="4" maxlength="40000" placeholder="补充自己的理解，也可以直接粘贴截图…"></textarea></label><label class="record-text-label"><span>原文摘录</span><textarea class="record-text" rows="4" maxlength="40000" placeholder="编辑原文摘录…"></textarea></label><p class="record-anchor-hint hint" hidden>修改引用原文后，会解除原来的精确定位与译文；仅修改想法或图片会保留。</p>${markdownHelpHTML}<div class="record-edit-images"></div><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden><div class="record-edit-tools"><button type="button" class="quiet" data-edit="images">＋ 添加图片</button><small>支持粘贴或拖入</small></div><p class="record-edit-status" role="status"></p><button type="button" class="quiet record-reload" data-edit="reload" hidden>载入最新内容（放弃本次修改）</button><div class="record-edit-actions"><button type="button" class="quiet" data-edit="close">收起</button><button type="button" class="primary" data-edit="save">保存修改</button></div>`;
  const input = root.querySelector("textarea"), file = root.querySelector("input"), gallery = root.querySelector(".record-edit-images"), status = root.querySelector(".record-edit-status");
  const reload = root.querySelector(".record-reload"), textInput=root.querySelector(".record-text");
  let version=0, session = null, queue = Promise.resolve(), busy = false, renderId = 0;
  const urls = new Set();
  const key = s => s.kind === "clip" ? `record-edit:${s.noteId}:${s.baseline.id}` : `content-edit:${s.noteId}:${s.kind}:${s.target||"new"}`;
  const persist = () => {
    if (!session) return Promise.resolve();
    session.thought = input.value; session.text = textInput.value;
    const value = structuredClone(session), storageKey = key(value), seq=++version;status.textContent="正在暂存…";
    queue = queue.catch(() => {}).then(() => adapter.write(storageKey, value));
    queue.then(() => { if(session && key(session)===storageKey && seq===version)status.textContent="已自动暂存"; }).catch(() => { if(session && key(session)===storageKey && seq===version)status.textContent="暂存失败，请先保存"; }); return queue;
  };
  async function thumbnails() {
    const seq = ++renderId, s = session; gallery.replaceChildren();
    for (const url of urls) URL.revokeObjectURL(url); urls.clear();
    if (!s) return;
    for (const item of s.attachments) {
      const cell = document.createElement("div"), img = document.createElement("img"), remove = document.createElement("button");
      cell.className = "record-edit-image"; img.alt = item.name; remove.textContent = "×"; remove.type = "button"; remove.setAttribute("aria-label", "移除图片：" + item.name); remove.disabled = busy;
      remove.onclick = () => run(async () => { session.attachments = session.attachments.filter(x => x.id !== item.id); await persist(); await thumbnails(); });
      cell.append(img, remove); gallery.append(cell);
      try {
        let blob = await draftImageStore.get(key(s), item.id);
        if (!blob && item.image?.key?.startsWith("demo/")) { const [,scope,id] = item.image.key.split("/"); blob = await draftImageStore.get(scope, id); }
        let url = blob ? URL.createObjectURL(blob) : item.image && native ? (await adapter.cloud({ path: `/api/media?key=${encodeURIComponent(item.image.key)}` })).dataUrl : "";
        if (seq !== renderId) { if (url.startsWith("blob:")) URL.revokeObjectURL(url); return; }
        if (url.startsWith("blob:")) urls.add(url);
        if (url) img.src = url; else img.alt = item.name + "（暂时无法预览）";
      } catch { if (seq === renderId) img.alt = item.name + "（暂时无法预览）"; }
    }
  }
  async function run(task) {
    if (busy) return; busy = true;
    root.querySelectorAll("button,textarea,input").forEach(e => e.disabled = true);
    try { await task(); } catch (e) { status.textContent = e.message; status.classList.add("error"); if (e.code === "RECORD_CONFLICT") reload.hidden = false; }
    finally { busy = false; root.querySelectorAll("button,textarea,input").forEach(e => e.disabled = false); }
  }
  async function add(files, text = "", selection) {
    const s = session;
    const added = await stageImages(key(s), files, s.attachments);
    s.attachments.push(...added);
    if (text) { const field=selection?.field==='text'||!["clip","legacy","image"].includes(s.kind)?textInput:input; const start=selection?.start??field.value.length,end=selection?.end??field.value.length;if(field.value.length-(end-start)+text.length<=field.maxLength)field.setRangeText(text,start,end,"end"); }
    await persist(); await thumbnails(); status.textContent = "已自动暂存";
  }
  async function save() {
    const s = session; await persist(); status.textContent = "正在保存…"; status.classList.remove("error");
    const images = await uploadDraftImages(key(s), s.attachments, async (blob, item) => {
      if (!native) return { key: `demo/${key(s)}/${item.id}`, name: item.name, createdAt: new Date().toISOString() };
      return (await adapter.cloud({ path: "/api/media", method: "POST", body: { base64: (await blobDataUrl(blob)).split(",")[1], type: item.type, name: item.name } })).image;
    }, persist);
    const record = { id: s.kind === "clip" ? s.baseline.id : s.operationId, text: textInput.value.trim(), thought: input.value.trim(), images };
    const note = s.kind === "clip" ? await saveRecordEdit(adapter.cloud, s.noteId, s.baseline, record) : await saveContentEdit(adapter.cloud,s.noteId,s.kind,s.target,s.baseline,record);
    await adapter.remove(key(s));
    if (native) await Promise.all(s.attachments.map(i => draftImageStore.remove(key(s), i.id).catch(() => {})));
    session = null; root.remove(); renderId++; for (const url of urls) URL.revokeObjectURL(url); urls.clear();
    upsert(note); rerender(); notice("修改已保存。");
  }
  async function loadLatest() {
    const s=session,note=(await adapter.cloud({})).notes.find(n=>n.id===s.noteId&&!n.deletedAt&&!n.archived),record=note&&contentRecord(note,s.kind,s.target);
    if(!record)throw new Error('记录不存在，请刷新后核对。');
    await adapter.write(key(s)+':previous',structuredClone(s));
    session={...s,baseline:structuredClone(record),text:record.text||'',thought:record.thought||'',attachments:(record.images||[]).map(image=>({id:crypto.randomUUID(),name:image.name,image}))};
    input.value=session.thought;textInput.value=session.text;await persist();upsert(note);rerender();await thumbnails();reload.hidden=true;status.textContent='已载入最新内容，之前的草稿另存于本机。';
  }
  async function close() { await persist(); session = null; root.remove(); renderId++; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); rerender(); }
  root.addEventListener("click", e => { const action = e.target.closest("[data-edit]")?.dataset.edit; if (action === "images") file.click(); else if (action === "save") run(save); else if (action === "close") run(close); else if (action === "reload") run(loadLatest); });
  file.addEventListener("change", () => { const files = [...file.files]; file.value = ""; if (files.length) run(() => add(files)); });
  textInput.addEventListener("input",()=>{void persist();});
  input.addEventListener("input", () => { status.classList.remove("error"); void persist(); });
  root.addEventListener("paste", e => { const files = transferImages(e.clipboardData); if (!files.length || root.querySelector(".record-edit-tools").hidden) return; e.preventDefault(); const selection = [input,textInput].includes(e.target) ? { start: e.target.selectionStart, end: e.target.selectionEnd,field:e.target===textInput?"text":"thought" } : null; if (!busy) run(() => add(files, e.clipboardData.getData("text/plain"), selection)); });
  root.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); root.classList.add("image-dragover"); } });
  root.addEventListener("dragleave", e => { if (!root.contains(e.relatedTarget)) root.classList.remove("image-dragover"); });
  root.addEventListener("drop", e => { root.classList.remove("image-dragover"); if (!e.dataTransfer.files.length || root.querySelector(".record-edit-tools").hidden) return; e.preventDefault(); if (!busy) run(() => add([...e.dataTransfer.files])); });
  input.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(save); } });
  return {
    async open(note, clipId, kind="clip") {
      if (busy) throw new Error("正在保存修改，请稍后再打开另一条记录。");
      if (session) await persist();
      const clip = contentRecord(note,kind,clipId); if (!clip) throw new Error("找不到这条记录，请刷新后重试。");
      const fresh = { kind, target:clipId, operationId:crypto.randomUUID(), text:clip.text||"", noteId: note.id, baseline: structuredClone(clip), thought: clip.thought || "", attachments: (clip.images || []).map(image => ({ id: crypto.randomUUID(), name: image.name, image })) };
      const cached=await adapter.read(key(fresh));session = { ...fresh, ...cached };
      const mixed=["clip","legacy","image"].includes(kind), withImages=mixed||kind==="core";
      root.setAttribute('aria-label',kind==='core'?'编辑核心摘要':'编辑随读记录');
      input.closest("label").hidden=!mixed; root.querySelector(".record-text-label span").textContent=kind==="core"?"核心摘要":kind==="review"||kind==="new-review"?"后来的理解":kind==="ai"?"AI 摘要":"原文摘录";
      root.querySelector(".record-edit-tools").hidden=!withImages;root.querySelector(".record-anchor-hint").hidden=!(clip.transcriptAnchor||clip.anchor);
      textInput.maxLength=input.maxLength=kind==="clip"||kind==="image"?20000:40000;textInput.value=session.text??clip.text??"";
      input.value = session.thought; reload.hidden = editable(session.baseline) === editable(clip); status.classList.remove("error"); status.textContent = editable(session.baseline) !== editable(clip) ? "已恢复本机草稿；这条记录另有更新，保存前请核对。" : cached ? "已自动暂存" : "";
      rerender(); await thumbnails(); root.scrollIntoView?.({ behavior: "smooth", block: "center" }); (mixed ? input : textInput).focus({ preventScroll: true });
    },
    mount() {
      root.remove(); if (!session || active()?.id !== session.noteId) return;
      const slot = document.querySelector(`[data-record-editor="${session.kind === "clip" ? session.baseline.id : session.kind+":"+(session.target||"new")}"]`); if (slot) { slot.append(root); slot.closest(".entry").classList.add("editing"); }
    },
    detach() { root.remove(); },
  };
}

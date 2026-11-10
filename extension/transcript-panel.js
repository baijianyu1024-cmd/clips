import { renderMarkdown } from "./markdown.js";
import { adapter, native } from "./adapter.js";
import { youtubeId, youtubeUrl, transcriptText, currentSegmentIndex, currentChapterIndex, overviewQuoteIndices, overviewClip } from "./youtube.js";
import { timeLabel } from "./core.js";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function createTranscriptPanel({ active, upsert, notice, quote, addOverview }) {
  const root = document.querySelector("#youtube-reading");
  let targetNote = "", videoId = "", snapshot = null, query = "", page = 0, selected = null, tab = "transcript", mode = "original", assist = { overview: null, translations: {} }, job = null, terminalSeen = "";
  let following = true, currentIndex = -1, playbackState = { available: false, reason: "waiting" }, ticking = false, quoteAttempted = false, playbackEpoch = 0;
  function sources(note) { return [...new Map((note?.sources || []).filter(s => youtubeId(s.url)).map(s => [youtubeId(s.url), s])).entries()]; }
  function rows() { return snapshot.segments.map((s, i) => ({ ...s, i })).filter(s => `${mode !== "zh" ? s.text : ""} ${mode !== "original" ? assist.translations[s.i]?.text || "" : ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())); }
  function render() {
    const oldScroll = root.querySelector("#transcript-rows")?.scrollTop || 0;
    const note = active(), videos = sources(note); root.hidden = !videos.length;
    if (!videos.length) { targetNote = ""; snapshot = null; return; }
    if (targetNote !== note.id || !videos.some(([id]) => id === videoId)) { targetNote = note.id; videoId = videos[0][0]; reset(); }
    const saved = note.transcripts?.find(t => t.videoId === videoId);
    root.innerHTML = `<div class="transcript-heading"><h2>YouTube 阅读</h2><span>${snapshot ? esc(snapshot.language) + " · " + snapshot.segments.length + " 段" : saved ? "已存入笔记" : "原生字幕"}</span></div>${videos.length > 1 ? `<label class="hint">这篇笔记的视频来源<select id="transcript-video">${videos.map(([id, s]) => `<option value="${esc(id)}" ${id === videoId ? "selected" : ""}>${esc(s.label || id)}</option>`).join("")}</select></label>` : ""}${snapshot ? `<p class="hint">${native ? "字幕与阅读资料保存在笔记库。" : "交互示例 · 字幕、概览、译文均为示例内容。"}</p><div class="yt-tabs" role="tablist" aria-label="视频阅读内容"><button role="tab" aria-selected="${tab === "overview"}" data-action="yt-overview-tab">Overview · 概览</button><button role="tab" aria-selected="${tab === "transcript"}" data-action="yt-transcript-tab">字幕</button></div><div id="yt-connection" class="yt-connection"></div><div id="yt-job" class="hint" role="status"></div><div id="yt-overview" ${tab === "overview" ? "" : "hidden"}></div><div id="yt-transcript" ${tab === "transcript" ? "" : "hidden"}><div class="yt-modes" aria-label="字幕显示方式">${[["original", "原文"], ["bilingual", "双语"], ["zh", "中文"]].map(([value,label]) => `<button aria-pressed="${mode === value}" data-action="yt-mode" data-mode="${value}">${label}</button>`).join("")}</div><div class="transcript-controls"><input id="transcript-search" type="search" aria-label="搜索字幕" placeholder="搜索${mode === "original" ? "原文" : mode === "zh" ? "译文" : "原文或译文"}…" value="${esc(query)}"><button class="quiet" data-action="yt-selection">摘录选中文字</button></div><div id="yt-translate-actions"></div><div id="yt-follow" class="yt-follow"></div><div id="transcript-rows" class="transcript-rows" tabindex="0" aria-label="字幕列表"></div><div id="transcript-pagination" class="transcript-pagination"></div></div>` : `<p class="hint">${saved ? "打开已保存的字幕，不会再次调用 Supadata。" : "主动读取原生字幕，保存后可以随时回顾。"}</p><button class="page-action" data-action="yt-load">${saved ? "打开已保存字幕" : "读取并保存字幕"}<span>↗</span></button>`}`;
    if (snapshot) { renderOverview(); renderRows(); renderJob(); renderPlayback(); if (!following) root.querySelector("#transcript-rows").scrollTop = oldScroll; }
  }
  function reset() { playbackEpoch++; following = true; currentIndex = -1; quoteAttempted = false; playbackState = { available: false, reason: "waiting" }; snapshot = null; query = ""; page = 0; selected = null; tab = "transcript"; mode = "original"; assist = { overview: null, translations: {} }; job = null; terminalSeen = ""; }
  function renderOverview() {
    const overview = assist.overview, added = overview && active()?.clips.some(c => c.id === overview.id);
    const missingQuotes = overviewQuoteIndices(overview).some(i => !assist.translations[i]);
    root.querySelector("#yt-overview").innerHTML = overview ? `<p class="yt-ai-label">${native ? "AI 概览 · " : "示例概览 · "}${esc(overview.model)} · 基于全部已保存字幕</p><div class="text markdown-body yt-overview-summary">${renderMarkdown(overview.summary)}</div><button class="quiet yt-add-overview" data-action="yt-add-overview" ${added ? "disabled" : ""} title="把上面的概览保存为一条可编辑的随读记录">${added ? "✓ 已添加到笔记" : "＋ 添加到笔记"}</button><h3>章节导航</h3>${overview.chapters.map(c => `<button class="yt-chapter" data-action="yt-seek" data-index="${c.from}"><time>${timeLabel(snapshot.segments[c.from].start)}</time><span><strong>${esc(c.title)}<span class="yt-chapter-now" hidden>当前章节</span></strong><small>${esc(c.summary)}</small></span></button>`).join("")}<div class="yt-quotes-heading"><h3>关键原话 · 双语</h3>${missingQuotes ? `<button class="quiet" data-action="yt-generate" ${job?.status === "running" ? "disabled" : ""}>补齐中文译文</button>` : ""}</div>${overview.quotes.map(q => `<div class="yt-key-quote"><blockquote>${esc(transcriptText(snapshot.segments,q.from,q.to))}</blockquote>${`<p class="transcript-translated"><small>中文 · AI 译文</small>${Array.from({length:q.to-q.from+1},(_,i)=>esc(assist.translations[q.from+i]?.text || "中文译文待补齐")).join("<br>")}</p>`}<div><button class="quiet" data-action="yt-seek" data-index="${q.from}">${timeLabel(snapshot.segments[q.from].start)} ↗</button><button class="quiet" data-action="yt-quote" data-from="${q.from}" data-to="${q.to}">摘录这段</button></div></div>`).join("")}<p class="hint">概览帮助理解视频；你的核心摘要仍由你整理和确认。</p>` : `<div class="yt-overview-empty"><h3>先看全貌，再按兴趣深入</h3><p class="hint">生成中文概览、章节导航与关键原话。点击后将全部已保存字幕发送给 DeepSeek，长视频会分段处理。</p><button class="primary" data-action="yt-generate" ${job?.status === "running" ? "disabled" : ""}>${native ? "生成 Overview" : "查看示例 Overview"}</button><p class="hint">不会改动你的核心摘要或想法记录。</p></div>`;
  }
  function renderJob() {
    const el = root.querySelector("#yt-job"); if (!el) return;
    el.textContent = job?.status === "running" ? `${job.phase === "quotes" ? "正在翻译关键原话" : job.kind === "overview" ? "正在整理概览" : "正在翻译字幕"} · ${job.done}/${job.total}，可以继续记录。` : job?.status === "error" ? job.error : "";
    el.classList.toggle("error", job?.status === "error");
    for (const b of root.querySelectorAll('[data-action="yt-generate"], [data-action="yt-translate"]')) b.disabled = job?.status === "running";
  }
  function renderRows() {
    if (!snapshot) return;
    const matches = rows(); page = Math.min(page, Math.max(0, Math.ceil(matches.length / 60) - 1));
    const visible = matches.slice(page * 60, page * 60 + 60), missing = visible.filter(s => !assist.translations[s.i]);
    root.querySelector("#yt-translate-actions").innerHTML = mode === "original" ? "" : `<div class="yt-translate-actions"><span>${Object.keys(assist.translations).length} / ${snapshot.segments.length} 段已翻译</span>${missing.length ? `<button class="quiet" data-action="yt-translate" ${job?.status === "running" ? "disabled" : ""}>${native ? "翻译本页缺失段落" : "查看示例译文"}</button>` : ""}</div>${missing.length ? `<p class="hint">点击翻译后仅将本页缺失段落发送给 DeepSeek。译文自动保存，下次打开直接使用。</p>` : ""}`;
    root.querySelector("#transcript-rows").innerHTML = visible.map(s => `<div class="transcript-row${s.i === currentIndex ? " playing" : ""}" data-segment="${s.i}" ${s.i === currentIndex ? 'aria-current="true"' : ""}><button class="transcript-time" data-action="yt-seek" data-index="${s.i}" aria-label="跳到 ${timeLabel(s.start)}">${timeLabel(s.start)}</button><div class="transcript-copy"><span class="yt-line-now" ${s.i === currentIndex ? "" : "hidden"}>当前字幕</span>${mode !== "zh" ? `<p class="transcript-text" data-index="${s.i}">${esc(s.text)}</p>` : ""}${mode !== "original" ? `<p class="transcript-translated ${assist.translations[s.i] ? "" : "pending"}" data-index="${s.i}">${esc(assist.translations[s.i]?.text || "此段尚未翻译")}</p>` : ""}</div><button class="transcript-clip" data-action="yt-clip" data-index="${s.i}" aria-label="摘录 ${timeLabel(s.start)} 这句字幕">＋</button></div>`).join("") || `<p class="hint">没有匹配内容。中文搜索仅搜索已生成的译文，可清空搜索后先翻译。</p>`;
    root.querySelector("#transcript-pagination").innerHTML = `<button class="quiet" data-action="yt-prev" ${page === 0 ? "disabled" : ""}>上一页</button><span>${matches.length ? page + 1 : 0} / ${Math.ceil(matches.length / 60)} · ${matches.length} 段</span><button class="quiet" data-action="yt-next" ${(page + 1) * 60 >= matches.length ? "disabled" : ""}>下一页</button>`;
    selected = null; renderFollow(); if (following && tab === "transcript") scrollToPlayhead(true);
  }
  function renderPlayback() {
    const el = root.querySelector("#yt-connection"); if (!el) return;
    const reason = playbackState.reason;
    const text = !native ? "交互演示 · 不连接真实视频" : playbackState.available ? `${playbackState.paused ? "已暂停" : "正在播放"} · ${timeLabel(playbackState.time)}` : reason === "page-access" ? "尚未连接播放器，无法定位或跟随" : reason === "different-video" ? "回到这篇视频后继续跟随，当前笔记不变" : reason === "ad" ? "广告播放中 · 字幕跟随暂时等待" : "正在等待播放器就绪…";
    const html = `<span>${text}</span>${native && reason === "page-access" ? `<button class="quiet" data-action="yt-connect">连接 YouTube 播放器</button><small>允许 YouTube 页面访问后可持续跟随；也可回视频页点工具栏Clips图标，仅授权本次页面。</small>` : ""}`;
    if (el.innerHTML !== html) el.innerHTML = html;
    const chapter = playbackState.available ? currentChapterIndex(assist.overview?.chapters || [], snapshot.segments, playbackState.time) : -1;
    root.querySelectorAll(".yt-chapter").forEach((button, i) => {
      const playing = i === chapter; button.classList.toggle("playing", playing);
      if (playing) button.setAttribute("aria-current", "true"); else button.removeAttribute("aria-current");
      button.querySelector(".yt-chapter-now").hidden = !playing;
    });
    for (const row of root.querySelectorAll(".transcript-row")) {
      const playing = playbackState.available && Number(row.dataset.segment) === currentIndex;
      row.classList.toggle("playing", playing); row.querySelector(".yt-line-now").hidden = !playing;
      if (playing) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current");
    }
  }
  function renderFollow() {
    const el = root.querySelector("#yt-follow"); if (!el) return;
    const message = !playbackState.available ? "连接视频后，自动定位当前字幕" : following ? "跟随播放 · 自动切页" : "自由阅读 · 高亮继续，滚动已暂停";
    const html = `<span>${message}</span><button class="quiet" data-action="yt-follow" aria-pressed="${following}">${following ? "暂停跟随" : "跟随当前播放"}</button>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  function pauseFollow() { if (following) { following = false; renderFollow(); } }
  function scrollToPlayhead(force = false) {
    const container = root.querySelector("#transcript-rows"), row = container?.querySelector(`[data-segment="${currentIndex}"]`);
    if (!row || tab !== "transcript") return;
    const bounds = container.getBoundingClientRect(), item = row.getBoundingClientRect();
    if (!force && item.top >= bounds.top + 32 && item.bottom <= bounds.bottom - 32) return;
    const top = Math.max(0, container.scrollTop + item.top - bounds.top - (container.clientHeight - item.height) / 2);
    if (container.scrollTo) container.scrollTo({ top, behavior: force || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    else container.scrollTop = top;
  }
  function applyPlayback(state, force = false) {
    playbackState = state;
    const index = state.available ? currentSegmentIndex(snapshot.segments, state.time) : -1, changed = index !== currentIndex;
    currentIndex = index;
    if (following && !query && index >= 0 && Math.floor(index / 60) !== page) { page = Math.floor(index / 60); renderRows(); }
    renderPlayback(); renderFollow();
    if (following && !query && (changed || force)) scrollToPlayhead(force);
  }
  async function tick(force = false) {
    if (ticking || !snapshot || document.hidden) return;
    const id = targetNote, sid = snapshot.id, epoch = playbackEpoch;
    ticking = true;
    try {
      const state = await adapter.playback(snapshot.videoId);
      if (id !== targetNote || sid !== snapshot?.id || epoch !== playbackEpoch) return;
      applyPlayback(state, force);
    } catch { if (id === targetNote && sid === snapshot?.id && epoch === playbackEpoch) applyPlayback({ available: false, reason: "page-access" }); }
    finally { ticking = false; }
  }
  // Both Overview and subtitles share the actual clock. Poll only while visible.
  const timer = setInterval(() => void tick(), 350);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void tick(true); });
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  root.addEventListener("wheel", e => { if (e.target.closest("#transcript-rows")) pauseFollow(); }, { passive: true });
  root.addEventListener("touchstart", e => { if (e.target.closest("#transcript-rows")) pauseFollow(); }, { passive: true });
  root.addEventListener("pointerdown", e => { if (e.target.closest("#transcript-rows") && !e.target.closest("button")) pauseFollow(); });
  root.addEventListener("keydown", e => { if (e.target.closest("#transcript-rows") && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) pauseFollow(); });
  async function ensureQuoteTranslations() {
    if (quoteAttempted || !assist.overview || !overviewQuoteIndices(assist.overview).some(i => !assist.translations[i]) || job?.status === "running") return;
    quoteAttempted = true; terminalSeen = "";
    await adapter.assistStart({ kind: "overview", noteId: targetNote, snapshotId: snapshot.id });
    await refresh();
  }
  root.addEventListener("input", e => { if (e.target.id === "transcript-search") { pauseFollow(); query = e.target.value; page = 0; renderRows(); } });
  root.addEventListener("change", e => { if (e.target.id === "transcript-video") { videoId = e.target.value; reset(); render(); } });
  function captureSelection() {
    const selection = window.getSelection(); if (!snapshot || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0), original = [], translated = [];
    for (const el of root.querySelectorAll("#transcript-rows .transcript-text, #transcript-rows .transcript-translated:not(.pending)")) {
      if (!range.intersectsNode(el)) continue;
      const piece = document.createRange(); piece.selectNodeContents(el);
      if (el.contains(range.startContainer)) piece.setStart(range.startContainer, range.startOffset);
      if (el.contains(range.endContainer)) piece.setEnd(range.endContainer, range.endOffset);
      const text = piece.toString().trim(); if (text) (el.classList.contains("transcript-text") ? original : translated).push({ i: Number(el.dataset.index), text });
    }
    const parts = translated.length ? [...new Set([...original, ...translated].map(p=>p.i))].sort((a,b)=>a-b).map(i=>({i,text:snapshot.segments[i].text})) : original;
    selected = parts.length && !parts.some((p,i)=>i && p.i !== parts[i-1].i+1) ? { from: parts[0].i, to: parts.at(-1).i, text: parts.map(p=>p.text).join("\n") } : null;
  }
  root.addEventListener("mouseup", captureSelection); root.addEventListener("keyup", captureSelection);
  async function refresh() {
    if (!snapshot) return;
    const id = targetNote, sid = snapshot.id, current = await adapter.assistStatus(id, sid);
    if (id !== targetNote || sid !== snapshot?.id) return;
    job = current; renderJob();
    if (job && job.status !== "running" && terminalSeen !== job.id + job.status) {
      const data = await adapter.cloud({ path: `/api/transcripts?note=${id}&id=${sid}` });
      if (id !== targetNote || sid !== snapshot?.id) return;
      terminalSeen = job.id + job.status; assist = data.assist || { overview: null, translations: {} }; render();
    }
  }
  async function action(name, button) {
    if (!name.startsWith("yt-")) return false;
    const note = active(); if (!note || note.id !== targetNote) throw new Error("请先打开对应的视频笔记。");
    if (name === "yt-load") {
      const id = note.id, video = videoId, saved = note.transcripts?.find(t => t.videoId === video);
      notice(saved ? "正在打开已保存字幕…" : "正在读取原生字幕并保存到这篇笔记…");
      let result;
      if (saved) result = await adapter.cloud({ path: `/api/transcripts?note=${id}&id=${saved.id}` });
      else {
        const data = await adapter.transcript(video);
        result = await adapter.cloud({ path: "/api/transcripts", method: "POST", body: { noteId: id, transcript: { ...data, title: note.sources.find(s => youtubeId(s.url) === video)?.label || note.title || "YouTube 视频" } } });
        upsert(result.note); await adapter.remove("transcriptPending:" + video);
      }
      if (active()?.id === id && videoId === video) { snapshot = result.snapshot; assist = result.assist || { overview: null, translations: {} }; render(); await refresh(); await tick(true); }
      notice("字幕已打开，可以先看 Overview，也可以直接边读边记。");
    } else {
      if (!snapshot) throw new Error("先打开字幕再操作。");
      const index = Number(button.dataset.index), segment = snapshot.segments[index];
      if (name === "yt-overview-tab" || name === "yt-transcript-tab") { tab = name === "yt-overview-tab" ? "overview" : "transcript"; render(); await tick(true); if (tab === "overview") await ensureQuoteTranslations(); }
      else if (name === "yt-mode") { mode = button.dataset.mode; query = ""; render(); await tick(true); }
      else if (name === "yt-follow") { following = !following; if (following) { query = ""; render(); await tick(true); } else renderFollow(); }
      else if (name === "yt-add-overview" && assist.overview) { await addOverview(targetNote, overviewClip(assist.overview, snapshot)); renderOverview(); renderPlayback(); }
      else if (name === "yt-prev" || name === "yt-next") { pauseFollow(); page += name === "yt-next" ? 1 : -1; renderRows(); root.querySelector("#transcript-rows").scrollTop = 0; }
      else if (name === "yt-generate" || name === "yt-translate") {
        const indices = name === "yt-translate" ? rows().slice(page * 60, page * 60 + 60).map(s=>s.i) : undefined;
        terminalSeen = "";
        await adapter.assistStart({ kind: name === "yt-generate" ? "overview" : "translation", noteId: targetNote, snapshotId: snapshot.id, indices });
        await refresh();
      }
      else if (name === "yt-seek" && segment) {
        const id = targetNote, sid = snapshot.id; playbackEpoch++;
        const result = await adapter.seek(snapshot.videoId, segment.start);
        if (id !== targetNote || sid !== snapshot?.id) return true;
        if (result.demo) notice("演示中不播放视频；安装插件后会直接定位播放器。");
        else if (result.restored) { following = true; query = ""; page = Math.floor(index / 60); render(); applyPlayback({ available: true, time: result.time ?? segment.start, paused: result.paused ?? playbackState.paused }, true); }
        else { applyPlayback({ available: false, reason: result.reason || "waiting" }); notice(result.opened ? "视频已打开，在视频页点击Clips图标连接播放器。" : result.reason === "page-access" ? "先连接播放器，再点击章节；当前视频不会刷新。" : result.reason === "ad" ? "广告结束后再定位，当前字幕位置已保留。" : "播放器尚未就绪或视频已切换，请回到对应视频后重试。"); }
      }
      else if (["yt-clip", "yt-selection", "yt-quote"].includes(name)) {
        pauseFollow();
        const from = name === "yt-quote" ? Number(button.dataset.from) : index, to = name === "yt-quote" ? Number(button.dataset.to) : index;
        const chosen = name === "yt-selection" ? selected : { from, to, text: transcriptText(snapshot.segments, from, to) };
        if (!chosen) throw new Error("先选中连续的字幕文字，或点击句子旁的 ＋。");
        const translations = Array.from({length:chosen.to-chosen.from+1},(_,i)=>assist.translations[chosen.from+i]);
        const translatedText = translations.every(Boolean) ? translations.map(t=>t.text).join("\n") : "";
        if (chosen.text.length > 20000 || translatedText.length > 20000) throw new Error("一次摘录最多 20,000 字，请缩小选取范围。");
        await quote({ sourceLanguage: snapshot.language, text: chosen.text, sourceUrl: youtubeUrl(snapshot.videoId), sourceTitle: snapshot.title, videoTime: snapshot.segments[chosen.from].start, transcriptAnchor: { snapshotId: snapshot.id, from: chosen.from, to: chosen.to }, ...(translatedText && (name === "yt-quote" || mode !== "original") ? { translation: { text: translatedText, language: "zh-CN", model: translations[0].model } } : {}) });
      }
    }
    return true;
  }
  return { render, action, refresh, reconnect: async () => { playbackEpoch++; await tick(true); } };
}

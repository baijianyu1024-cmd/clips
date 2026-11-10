// Isolated content script. Page scripts have no message bridge or storage access.
(() => {
  const version = "0.9.0", key = "__shiyeYoutubeEntry";
  if (globalThis[key]?.version === version) { globalThis[key].reconcile(); return; }
  globalThis[key]?.dispose();
  let player, host, root, toastHost, button, toast, lastVideo = "", pending = null, busy = false, disposed = false;
  const validVideo = () => location.pathname === "/watch" && /^[\w-]{11}$/.test(new URL(location.href).searchParams.get("v") || "") ? new URL(location.href).searchParams.get("v") : "";
  const stamp = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
  async function message(type, fields = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...fields });
    if (!response?.ok) throw new Error(response?.error || "插件已更新，请重新点一次工具栏Clips图标。");
    return response.data;
  }
  function openPanel(event, result) {
    if (!event.isTrusted) return;
    event.stopPropagation(); message(result?.status === "saved" ? "YOUTUBE_EDIT_QUOTE" : "YOUTUBE_OPEN_PANEL", result?.status === "saved" ? { requestId: result.id } : {}).catch(e => show({ status: "error", error: e.message }));
  }
  function show(result) {
    toast.replaceChildren(); toast.hidden = false;
    const close = node("button", "×", "close"); close.setAttribute("aria-label", "关闭引用提示"); close.onclick = e => { e.stopPropagation(); toast.hidden = true; }; toast.append(close);
    toast.append(node("strong", result.status === "working" ? "正在保存双语引用…" : result.status === "saved" ? "引用已保存" : result.status === "needs-note" ? "引用时间点已暂存" : result.status === "needs-transcript" ? "先读取视频字幕" : "引用尚未保存", "heading"));
    if (result.title) toast.append(node("p", `${stamp(result.time)} · ${result.title}`, "meta"));
    if (result.text) { if (result.translation) toast.append(node("small", "原文", "section-label")); toast.append(node("blockquote", result.text)); }
    if (result.translation?.text) { toast.append(node("small", "中文 · AI 译文", "section-label")); toast.append(node("blockquote", result.translation.text, "translated")); }
    if (result.excerptBoundary === "context") toast.append(node("p", "字幕缺少清晰断句，已保留附近上下文。", "meta"));
    if (result.warning) toast.append(node("p", result.warning, "meta"));
    if (result.status === "working") { toast.append(node("p", "正在补齐句子，并结合上下文整理中文译文。", "meta")); return; }
    if (result.status === "needs-note") toast.append(node("p", "在侧栏开始这篇视频笔记后保存，当前笔记不会自动切换。", "meta"));
    else if (result.error) toast.append(node("p", result.error, "meta"));
    const actions = node("div", "", "actions"), open = node("button", result.status === "saved" ? "补充想法 / 图片" : "打开侧栏"); open.onclick = e => openPanel(e, result); actions.append(open);
    if (result.status === "saved") {
      const copy = node("button", "复制引用"), link = node("button", "复制时间链接");
      for (const [el, value] of [[copy, `${stamp(result.time)} · ${result.title}\n\n${[result.text, result.translation?.text ? "中文译文：\n" + result.translation.text : ""].filter(Boolean).join("\n\n")}\n\n${result.url}`], [link, result.url]]) el.onclick = async e => { if (!e.isTrusted) return; e.stopPropagation(); try { await navigator.clipboard.writeText(value); el.textContent = "已复制"; } catch { el.textContent = "复制失败，请重试"; } };
      actions.append(copy, link);
      if (result.translationPending) { const retry = node("button", "补译中文"); retry.onclick = e => capture(e, true); actions.append(retry); }
    } else if (pending) { const retry = node("button", "重试保存"); retry.onclick = e => capture(e, true); actions.append(retry); }
    toast.append(actions);
  }
  async function capture(event, retry = false) {
    if (!event.isTrusted || busy) return;
    event.preventDefault(); event.stopPropagation();
    const videoId = validVideo(); if (!videoId) return;
    if (!retry || !pending) pending = { id: crypto.randomUUID(), videoId };
    if (pending.videoId !== videoId) return;
    const request = pending; busy = true; button.disabled = true; button.textContent = "正在摘录…"; show({ status: "working" });
    try {
      const result = await message("YOUTUBE_QUICK_QUOTE", { requestId: request.id });
      if (validVideo() !== videoId || disposed) return;
      show(result); if (result.status === "saved" && !result.translationPending) pending = null;
    } catch (e) { if (!disposed && validVideo() === videoId) show({ status: "error", error: e.message }); }
    finally { busy = false; if (button) { button.disabled = false; button.textContent = "✎ 记一笔"; } }
  }
  function reconcile() {
    if (disposed) return;
    // An old extension context can remain after Reload; remove its inert entry.
    if (!chrome.runtime?.id) { dispose(); return; }
    const videoId = validVideo(), next = document.querySelector("#movie_player.html5-video-player") || document.querySelector(".html5-video-player");
    if (!videoId || !next) { host?.remove(); toastHost?.remove(); player = null; return; }
    if (lastVideo !== videoId) { lastVideo = videoId; pending = null; if (toast) toast.hidden = true; }
    if (player !== next || !host?.isConnected) {
      host?.remove(); document.getElementById("shiye-youtube-entry")?.remove(); player = next;
      host = node("div"); host.id = "shiye-youtube-entry"; host.style.cssText = "position:absolute;inset:0;z-index:61;pointer-events:none";
      root = host.attachShadow({ mode: "closed" });
      const style = node("style"); style.textContent = `:host{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#242522}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0}button:focus-visible{outline:3px solid #858B82;outline-offset:3px}.entry{position:absolute;top:16px;right:16px;pointer-events:auto;background:#343A36;color:white;border:1px solid #ffffff55;border-radius:7px;padding:8px 13px;font-weight:550;box-shadow:0 3px 15px #0003;transition:opacity .15s,background .15s}.entry:hover{background:#343A36}.entry:disabled{cursor:wait}.entry.quiet{opacity:0;pointer-events:none}.entry:focus-visible{opacity:1;pointer-events:auto}.toast{pointer-events:auto;position:absolute;right:20px;bottom:20px;width:min(380px,calc(100% - 40px));max-height:calc(100% - 40px);overflow:auto;overscroll-behavior:contain;background:#FFFFFF;border:1px solid #E2E4DF;border-radius:8px;padding:16px 18px;box-shadow:0 6px 28px #0002;text-shadow:none}.toast[hidden]{display:none}.heading{font-size:14px;color:#343A36;display:block;padding-right:20px}.meta{font-size:12px;color:#696D67;margin:5px 0;line-height:1.5;padding-right:16px}blockquote{font-size:13px;line-height:1.65;margin:10px 0;white-space:normal;max-height:110px;overflow:auto;overflow-wrap:anywhere}.section-label{display:block;font-size:10px;color:#696D67;margin-top:10px}.translated{color:#343A36}.close{position:absolute;right:12px;top:10px;background:none;color:#696D67;font-size:20px}.actions{display:flex;gap:12px;flex-wrap:wrap}.actions button{background:none;color:#343A36;font-size:12px;font-weight:500;padding:4px 0}.actions button:hover{text-decoration:underline}`;
      button = node("button", "✎ 记一笔", "entry"); button.setAttribute("aria-label", "Clips：引用当前视频片段"); button.title = "保存当前时间附近的字幕到随读记录"; button.onclick = capture;
      toast = node("section", "", "toast"); toast.setAttribute("role", "status"); toast.hidden = true;
      root.append(style, button); player.append(host);
      toastHost?.remove(); document.getElementById("shiye-youtube-toast")?.remove();
      toastHost = node("div"); toastHost.id = "shiye-youtube-toast"; toastHost.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      const toastRoot = toastHost.attachShadow({ mode: "closed" }); toastRoot.append(style.cloneNode(true), toast);
      // Show the entry during normal player interaction, including fullscreen.
    }
    const toastParent = document.fullscreenElement || document.body;
    if (toastHost.parentNode !== toastParent) toastParent.append(toastHost);
    const ad = player.matches(".ad-showing,.ad-interrupting");
    host.hidden = ad; toastHost.hidden = ad;
    button.classList.toggle("quiet", player.classList.contains("ytp-autohide") && toast.hidden && !busy);
    // Coexist with youtube-digest when both extensions are installed.
    button.style.right = document.getElementById("ytd-note-button") ? "128px" : "16px";
  }
  const timer = setInterval(reconcile, 700);
  function dispose() { disposed = true; clearInterval(timer); host?.remove(); toastHost?.remove(); document.removeEventListener("yt-navigate-finish", reconcile); }
  document.addEventListener("yt-navigate-finish", reconcile);
  globalThis[key] = { version, reconcile, dispose }; reconcile();
})();

// Self-contained: Chrome serializes this function into the current page.
// Read rendered text only. No cookies, private document APIs, or access-control changes.
export function readPageContent(mode = "body") {
  const url = location.href, title = document.title;
  const selection = window.getSelection();
  const video = document.querySelector("video");
  const position = { url, scrollY: Math.max(0, scrollY), ratio: Math.max(0, Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight))), videoTime: video && Number.isFinite(video.currentTime) ? video.currentTime : null, updatedAt: new Date().toISOString() };
  if (mode === "position") return { url, title, text: "", position };
  if (mode === "selection") {
    const node = selection?.anchorNode;
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    const context = el?.closest("p,li,blockquote,section,[data-block-id]")?.textContent || el?.textContent || "";
    return { url, title, text: String(selection || "").slice(0, 20000), context: context.slice(0, 8000), position };
  }
  const unavailable = reason => ({ url, title, text: "", status: "unavailable", reason, truncated: false });
  if (/(^|\.)(youtube\.com|youtu\.be|bilibili\.com)$/.test(location.hostname)) return unavailable("视频页面不是视频正文。YouTube 可先读取字幕，再用已保存字幕生成摘要；其他视频暂不支持转录。");
  if (document.contentType === "application/pdf" || /\.pdf$/i.test(location.pathname)) return unavailable("浏览器 PDF 暂不支持读取；扫描件、图片中的文字也不会自动识别。");
  const feishu = /(^|\.)(feishu\.cn|larksuite\.com|larksuite\.cn)$/.test(location.hostname);
  if (feishu && (/^(accounts|login|passport)\./.test(location.hostname) || /^\/(login|passport|accounts)(\/|$)/.test(location.pathname))) return unavailable("当前是飞书登录页，请先在原页面完成登录，再重新获取。");
  const excluded = "script,style,noscript,nav,header,footer,aside,button,input,textarea,select,[hidden],[aria-hidden=true],[role=navigation],[role=toolbar],[role=menu],[role=dialog],#shiye-youtube-entry";
  const visible = el => {
    if (el.closest(excluded)) return false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return !!el.getClientRects().length;
  };
  const textOf = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = []; let node, size = 0;
    while ((node = walker.nextNode())) {
      const el = node.parentElement, text = node.textContent.trim();
      if (!el || !text || !visible(el)) continue;
      // Feishu's document text may be contenteditable even in a reading view.
      if (!feishu && el.closest('[contenteditable="true"]')) continue;
      parts.push(text); size += text.length + 1;
      if (size > 41000) break;
    }
    return parts.join("\n");
  };
  const precise = feishu
    ? ".docx-page-block,.docx-editor,.doc-content,.zone-container,[data-page-id]"
    : ".rich_media_content,article,[role=article],.markdown-body,.theme-doc-markdown";
  let candidates = [...document.querySelectorAll(precise)], generic = false;
  if (!candidates.length) { candidates = [...document.querySelectorAll("main,[role=main]")]; generic = true; }
  // Never use body: toolbars/login screens must not become an article summary.
  // Virtualized document pages may be sibling roots. Include each loaded root once.
  const topLevel = candidates.filter(el => !candidates.some(parent => parent !== el && parent.contains(el)));
  const text = feishu ? topLevel.map(textOf).join("\n").slice(0, 41000)
    : candidates.map(textOf).sort((a, b) => b.length - a.length)[0] || "";
  const visuals = [];
  let visualsOmitted = 0;
  if (mode === "material") {
    const seen = new Set();
    for (const root of topLevel) for (const el of root.querySelectorAll("img,canvas,svg,iframe")) {
      if (!visible(el) || seen.has(el) || el.closest('svg') !== null && el.tagName.toLowerCase() !== 'svg') continue;
      seen.add(el);
      const box = el.getBoundingClientRect();
      if (box.width < 100 || box.height < 60) continue;
      const x = Math.max(0, box.left), y = Math.max(0, box.top), right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
      if (right - x < 60 || bottom - y < 40 || visuals.length >= 8) { visualsOmitted++; continue; }
      const rect = { x, y, width: right - x, height: bottom - y };
      if (visuals.some(v => Math.abs(v.rect.x-x) < 8 && Math.abs(v.rect.y-y) < 8 && Math.abs(v.rect.width-rect.width) < 8 && Math.abs(v.rect.height-rect.height) < 8)) continue;
      const kind = el.tagName.toLowerCase() === "img" ? "图片" : "画板／嵌入图形";
      const nearby = el.closest('figure,[data-block-id]')?.textContent || el.parentElement?.previousElementSibling?.textContent || "";
      visuals.push({ rect, label: `${kind}（当前可见区域） ${el.getAttribute('alt') || ''} ${nearby.trim().slice(0, 400)}` });
    }
  }
  const visualData = mode === "material" ? { visuals, visualsOmitted, viewport: { width: innerWidth, height: innerHeight }, position } : {};
  if (text.length < 80 && visuals.length) return { url, title, text, status: "partial", truncated: false, ...visualData, reason: "正文文字不足，将尝试理解当前可见的图片或画板。" };
  if (text.length < 80) return unavailable(feishu
    ? "未找到可读取的飞书正文。可能尚未加载、没有访问权限，或正文由画布渲染；当前不会解析为全文。"
    : "未找到足够的正文文字。页面可能尚未加载、需要登录，或使用图片、画布、内嵌文档；当前不会解析为全文。");
  const truncated = text.length > 40000;
  const partial = feishu || generic || truncated;
  return { url, title, text: text.slice(0, 40000), status: partial ? "partial" : "readable", truncated, ...visualData,
    reason: feishu ? mode === "material" ? "仅获取飞书当前已加载的文字；未加载部分和附件不包含在内。" : "仅获取飞书当前已加载的文字，未加载部分、图片和附件不包含在内。滚动加载后可重新获取。"
      : truncated ? "已获取前 40,000 字，后续内容未包含在本次材料中。"
      : generic ? "从页面主要区域获取，可能混有界面文字或缺少正文；请先检查预览。"
      : mode === "material" ? "已识别正文区域；未加载内容不包含在内。" : "已识别正文区域；图片和未加载内容不包含在内，请检查预览。" };
}

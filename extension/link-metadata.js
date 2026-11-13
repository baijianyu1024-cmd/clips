import { youtubeId, youtubeUrl } from './youtube.js';

// Keep navigable links intact; strip only known tracking parameters.
export function normalizeSourceUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return '';
    const video = youtubeId(raw); if (video) return youtubeUrl(video);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid|scene|spm_id_from|vd_source)$/i.test(k) || ((u.hostname === 'mp.weixin.qq.com' || /(^|\.)(feishu\.cn|larksuite\.com|larksuite\.cn)$/.test(u.hostname)) && /^(from|isappinstalled|mpshare|sharer_shareinfo|sharer_shareinfo_first|srcid|login_redirect_times)$/i.test(k))) u.searchParams.delete(k);
    u.searchParams.sort(); return u.href;
  } catch { return ''; }
}

// Identity is separate from the saved URL: WeChat signatures stay in links.
export function sourceUrlKey(raw) {
  try {
    const normalized = normalizeSourceUrl(raw); if (!normalized) return '';
    const u = new URL(normalized);
    if (u.hostname === 'mp.weixin.qq.com' && u.pathname === '/s' && u.searchParams.has('__biz') && u.searchParams.has('mid') && u.searchParams.has('idx')) {
      const params = new URLSearchParams();
      for (const k of ['__biz', 'mid', 'idx']) params.set(k, u.searchParams.get(k));
      u.search = params.toString();
    }
    u.searchParams.sort(); return u.href;
  } catch { return ''; }
}
export const titleUrlKey = sourceUrlKey;

export function cleanPageTitle(raw, url = '') {
  if (typeof raw !== 'string') return '';
  const title = raw.replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const plain = title.replace(/^[\s|·–—-]+|[\s|·–—-]+$/g, '');
  if (!plain || /^(just a moment|access denied|sign in|log in|login|登录|安全验证|访问验证|验证中心|页面不存在|404)(\b|\s|[|·-]|$)/i.test(plain) || /captcha|verify you are human|环境异常|请完成.*验证|访问过于频繁|该内容已被发布者删除|内容已删除|无权访问/i.test(plain)) return '';
  if (/^(youtube|微信公众平台|微信公众平台文章|微信|飞书|飞书云文档|lark|lark docs|feishu|loading[.…]*|加载中[.…]*|untitled|无标题)$/i.test(plain)) return '';
  try {
    const u = new URL(url);
    if ([u.hostname, u.hostname.replace(/^www\./, ''), u.href, url].includes(title)) return '';
  } catch { /* no URL supplied */ }
  return title.slice(0, 200);
}

export function needsLinkTitle(note) {
  return note.status === 'inbox' && !note.deletedAt && !note.archived && !!note.sources?.[0]?.url && !cleanPageTitle(note.title, note.sources[0].url);
}

export function titlesFromTabs(urls, tabs) {
  const result = [];
  for (const url of urls) {
    const key = titleUrlKey(url); if (!key) continue;
    // A loading tab can still carry the previous page's title.
    const tab = tabs.find(t => !t.incognito && t.status === 'complete' && titleUrlKey(t.url) === key && cleanPageTitle(t.title, t.url));
    if (tab) result.push({ url, title: cleanPageTitle(tab.title, tab.url) });
  }
  return result;
}

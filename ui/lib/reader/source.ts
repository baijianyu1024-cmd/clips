const feishuHost = (host: string) => /(^|\.)(feishu\.cn|larksuite\.com|larksuite\.cn)$/.test(host);
export const FEISHU_IMPORT_MESSAGE = "Clips尚未连接飞书账号，暂不能直接解析飞书在线文档。请在飞书复制正文，或导入正文文件；不需要更换链接。";
export function isFeishuDocument(raw: string) {
  try { const u = new URL(raw); return feishuHost(u.hostname) && /^\/(wiki|docx|docs)\/[^/]+/.test(u.pathname); }
  catch { return false; }
}
export function isFeishuLogin(raw: string) {
  try { const u = new URL(raw); return feishuHost(u.hostname) && (/^(accounts|login|passport)\./.test(u.hostname) || /^\/(accounts|login|passport)(\/|$)/.test(u.pathname)); }
  catch { return false; }
}

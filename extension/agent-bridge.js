import { AGENT_ORIGIN, AGENT_PROTOCOL, AGENT_PERMISSION } from './agent-protocol.js';
import { createAgentService } from './agent-service.js';
import { getTarget, targetKey, scopedStorage } from './storage-target.js';

const KEY = 'clipsAgentConnection', ALARM = 'clips-agent-reconnect';
// Optional and opt-in. Never expose browser/AI settings, arbitrary fetch or script execution.
export function startAgentBridge({ request, noteURL }) {
  let socket = null, interval = null, opening = false, connection = null, status = '未连接', retry = null;
  const current = async () => {
    if (!await chrome.permissions.contains({ origins: [AGENT_PERMISSION] })) throw new Error('本机连接权限已撤销，请重新授权后再操作。');
    const target = await getTarget();
    if (!connection || targetKey(target) !== connection.library.key) throw Object.assign(new Error('Clips 资料库已切换。请回到配对时的资料库，或重新配对；没有保存到其他资料库。'), { code: 'LIBRARY_CHANGED' });
    return target;
  };
  const service = createAgentService({
    request: async input => request(input, await current()),
    library: async () => { await current(); return connection.library; },
    noteURL: id => noteURL(id, connection?.library),
    changed: async note => {
      const target = await current(), storage = scopedStorage(target), { cachedNotes } = await storage.get('cachedNotes');
      if (Array.isArray(cachedNotes)) await storage.set({ cachedNotes: [note, ...cachedNotes.filter(n => n.id !== note.id)] });
      await chrome.storage.local.set({ clipsAgentLastWrite: { at: Date.now(), noteId: note.id, library: targetKey(target) } });
    },
  });
  function close() { clearInterval(interval); clearTimeout(retry); interval = null; retry = null; const old = socket; socket = null; old?.close(); }
  async function connect() {
    if (opening || socket && [0, 1].includes(socket.readyState)) return;
    opening = true;
    try {
      connection = (await chrome.storage.local.get(KEY))[KEY];
      if (!connection) return;
      if (!await chrome.permissions.contains({ origins: [AGENT_PERMISSION] })) { status = '未授权本机连接'; return; }
      await current();
      await chrome.alarms?.create(ALARM, { periodInMinutes: 1 });
      const ws = new WebSocket(AGENT_ORIGIN.replace('http:', 'ws:') + '/extension'); socket = ws; status = '正在连接';
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', protocol: AGENT_PROTOCOL, token: connection.token, library_key: connection.library.key, version: chrome.runtime.getManifest().version }));
      ws.onmessage = async event => {
        let data; try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'ready') {
          status = '已连接'; clearInterval(interval);
          interval = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); }, 20000); return;
        }
        if (data.type !== 'call' || typeof data.id !== 'string') return;
        let response;
        try { response = { type: 'result', id: data.id, ok: true, result: await service(data.name, data.arguments || {}) }; }
        catch (e) { response = { type: 'result', id: data.id, ok: false, error: e.message, code: e.code || (e.status === 409 ? 'REVISION_CONFLICT' : 'CLIPS_ERROR') }; }
        if (ws.readyState === 1) ws.send(JSON.stringify(response));
      };
      ws.onerror = () => { status = '等待本机连接器'; };
      ws.onclose = event => {
        if (socket !== ws) return;
        socket = null; clearInterval(interval);
        status = event.code === 1008 ? '配对失效或另一个浏览器资料已连接，请重新配对' : '等待本机连接器';
        if (event.code !== 1008) { clearTimeout(retry); retry = setTimeout(() => void connect(), 5000); }
      };
    } catch (e) { status = e.message; }
    finally { opening = false; }
  }
  async function handle(message) {
    if (message.type === 'AGENT_STATUS') {
      const saved = (await chrome.storage.local.get(KEY))[KEY], target = await getTarget();
      return { paired: !!saved, connected: status === '已连接', status, library: saved?.library || null, current: target ? { key: targetKey(target), name: target.name, mode: target.mode } : null, extensionId: chrome.runtime.id };
    }
    if (message.type === 'AGENT_PAIR') {
      if (!/^[a-f0-9]{64}$/.test(message.code || '')) throw new Error('请粘贴安装命令给出的配对码。');
      const target = await getTarget(); if (!target) throw new Error('请先选择并打开一个资料库。');
      if (!await chrome.permissions.contains({ origins: [AGENT_PERMISSION] })) throw new Error('请先允许连接本机。');
      await request({}, target); // Confirm access before pairing.
      const library = { key: targetKey(target), name: target.name || 'Clips', mode: target.mode };
      const res = await fetch(AGENT_ORIGIN + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: message.code, library }), signal: AbortSignal.timeout(5000), redirect: 'error' });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || '配对失败。');
      if (data.protocol !== AGENT_PROTOCOL || data.device?.library.key !== library.key || !/^[a-f0-9]{64}$/.test(data.device.token)) throw new Error('本机连接器版本不匹配。');
      close(); await chrome.storage.local.set({ [KEY]: data.device }); connection = data.device; await connect();
      return { paired: true, library };
    }
    if (message.type === 'AGENT_DISCONNECT') {
      if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'revoke' }));
      await chrome.storage.local.remove(KEY); connection = null; close(); status = '未连接'; await chrome.alarms?.clear(ALARM); return { disconnected: true };
    }
    if (message.type === 'AGENT_RECONNECT') { close(); await connect(); return { status }; }
    throw new Error('不支持的连接操作。');
  }
  chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void connect(); });
  chrome.runtime.onStartup?.addListener(() => void connect());
  chrome.permissions.onRemoved?.addListener(permissions => {
    if (permissions.origins?.includes(AGENT_PERMISSION)) { close(); status = '未授权本机连接'; }
  });
  chrome.storage.onChanged?.addListener(changes => {
    if (changes.clipsStorageTarget) { close(); void connect(); }
  });
  void connect();
  return { handle };
}

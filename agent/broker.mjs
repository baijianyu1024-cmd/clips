import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadConfig, saveConfig, secret } from './config.mjs';
import { AGENT_PROTOCOL, AGENT_PORT, validateAgentInput } from '../extension/agent-protocol.js';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const extension = origin => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || '') ? origin.slice('chrome-extension://'.length) : '';
const error = (code, message) => Object.assign(new Error(message), { code });
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw error('BAD_REQUEST', '需要 JSON 请求。');
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 100000) throw error('TOO_LARGE', '请求过大。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw error('BAD_REQUEST', 'JSON 无效。'); }
}
export async function startBroker({ config, persist = saveConfig, port = AGENT_PORT, timeout = 45000 } = {}) {
  config ||= await loadConfig();
  let pairing = null, peer = null, peerInfo = null;
  const pending = new Map(), wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const rejectPending = () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error('CONNECTION_LOST', 'Clips 连接中断。写入可能已完成；请连接后以相同 request_id 重试，避免重复记录。')); }
    pending.clear();
  };
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); } };
    // Reject websites, DNS rebinding, URL credentials and public interfaces. No CORS wildcard.
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) return reply(403, { error: 'Invalid host' });
    const isPair = req.url === '/pair' && req.method === 'POST';
    if (isPair) {
      try {
        const ext = extension(req.headers.origin);
        if (!ext || !pairing || pairing.expires < Date.now() || pairing.extensionId !== ext) throw error('PAIR_DENIED', '配对已过期或插件 ID 不匹配，请重新运行 setup。');
        const body = await jsonBody(req);
        if (!equal(body.code, pairing.code) || typeof body.library?.key !== 'string' || !body.library.key || typeof body.library.name !== 'string') throw error('PAIR_DENIED', '配对码或资料库无效。');
        pairing = null;
        const device = { id: randomUUID(), token: secret(), extensionId: ext, library: { key: body.library.key.slice(0, 200), name: body.library.name.slice(0, 200), mode: body.library.mode === 'local' ? 'local' : 'cloud' } };
        await persist({ ...config, device }); config = { ...config, device };
        peer?.close(1000, 'Repaired'); peer = null; peerInfo = null; rejectPending();
        return reply(200, { device, protocol: AGENT_PROTOCOL });
      } catch (e) { return reply(403, { error: e.message, code: e.code || 'PAIR_FAILED' }); }
    }
    if (req.headers.origin || !equal(req.headers.authorization, 'Bearer ' + config.token)) return reply(403, { error: 'Unauthorized' });
    try {
      if (req.method === 'GET' && req.url === '/status') return reply(200, { protocol: AGENT_PROTOCOL, connected: !!peer && peer.readyState === 1, library: config.device?.library || null, extension_version: peerInfo?.version || null });
      if (req.method !== 'POST') return reply(404, { error: 'Not found' });
      const body = await jsonBody(req);
      if (req.url === '/pairing') {
        if (!/^[a-p]{32}$/.test(body.extension_id || '')) throw error('INVALID_ID', '请提供 Chrome 中 Clips 的 32 位插件 ID。');
        pairing = { code: secret(), extensionId: body.extension_id, expires: Date.now() + 5 * 60000 };
        return reply(200, { code: pairing.code, expires_at: new Date(pairing.expires).toISOString() });
      }
      if (req.url === '/disconnect') {
        const { device: _device, ...clean } = config; await persist(clean); config = clean; pairing = null;
        peer?.close(1000, 'Disconnected'); peer = null; peerInfo = null; rejectPending(); return reply(200, { disconnected: true });
      }
      if (req.url === '/stop') { reply(200, { stopped: true }); setTimeout(() => close(), 50); return; }
      if (req.url !== '/call') return reply(404, { error: 'Not found' });
      validateAgentInput(body.name, body.arguments || {});
      if (!peer || peer.readyState !== 1) throw error('NOT_CONNECTED', 'Clips 尚未连接。请启动 Chrome，在 Clips「Agent 连接」中完成配对；云端模式还需保留已登录的笔记库标签页。');
      if (pending.size >= 16) throw error('BUSY', '请求过多，请稍后重试。');
      const id = randomUUID(), socket = peer;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(error('TIMEOUT', 'Clips 未及时响应。写入可能已完成；请先核对状态。新建或追加使用相同 request_id 重试；修改使用相同字段和 revision，删除使用原确认信息，过期后需重新确认。')); }, timeout);
        pending.set(id, { resolve, reject, timer, socket });
        socket.send(JSON.stringify({ type: 'call', id, name: body.name, arguments: body.arguments || {} }));
      });
      return reply(200, result);
    } catch (e) { return reply(400, { error: e.message, code: e.code || 'REQUEST_FAILED' }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/extension' || req.headers.host !== `127.0.0.1:${server.address().port}` || extension(req.headers.origin) !== config.device?.extensionId) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      let authorized = false;
      const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
      ws.on('error', () => {});
      ws.on('message', raw => {
        let data; try { data = JSON.parse(raw); } catch { ws.close(1008, 'Invalid JSON'); return; }
        if (!authorized) {
          if (data.type !== 'hello' || data.protocol !== AGENT_PROTOCOL || !equal(data.token, config.device?.token) || data.library_key !== config.device?.library.key || peer?.readyState === 1) { ws.close(1008, 'Pairing mismatch or another profile is connected'); return; }
          authorized = true; clearTimeout(authTimer); peer = ws; peerInfo = { version: String(data.version || '').slice(0, 30) };
          ws.send(JSON.stringify({ type: 'ready', protocol: AGENT_PROTOCOL })); return;
        }
        if (data.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
        if (data.type === 'revoke') {
          const { device: _device, ...clean } = config;
          config = clean; peer = null; peerInfo = null; rejectPending();
          void persist(clean).finally(() => ws.close(1000, 'Revoked')).catch(() => {}); return;
        }
        const p = pending.get(data.id);
        if (data.type !== 'result' || !p || p.socket !== ws) return;
        clearTimeout(p.timer); pending.delete(data.id);
        if (data.ok) p.resolve({ result: data.result });
        else p.reject(error(typeof data.code === 'string' ? data.code : 'CLIPS_ERROR', String(data.error || 'Clips 请求失败。').slice(0, 1000)));
      });
      ws.on('close', () => { clearTimeout(authTimer); if (peer === ws) { peer = null; peerInfo = null; rejectPending(); } });
    });
  });
  const close = () => { rejectPending(); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); };
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBroker().then(({ close }) => { process.on('SIGTERM', close); process.on('SIGINT', close); }).catch(e => { if (e.code !== 'EADDRINUSE') process.stderr.write('Clips Agent 无法启动：' + e.message + '\n'); process.exitCode = e.code === 'EADDRINUSE' ? 0 : 1; });
}

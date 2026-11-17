import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { AGENT_PROTOCOL, AGENT_ORIGIN } from '../extension/agent-protocol.js';
export async function request(path, body, config) {
  config ||= await loadConfig();
  const response = await fetch(AGENT_ORIGIN + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(50000), redirect: 'error' });
  const result = await response.json();
  if (!response.ok || result.error) throw Object.assign(new Error(result.error || `Clips HTTP ${response.status}`), { code: result.code });
  return result;
}
let starting;
export async function ensureBroker() {
  const config = await loadConfig();
  try {
    const state = await request('/status', undefined, config);
    if (state.protocol !== AGENT_PROTOCOL) throw new Error('Clips Agent 协议版本不一致，请更新连接器。');
    return state;
  } catch (e) { if (!(e instanceof TypeError)) throw e; }
  if (!starting) starting = (async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./broker.mjs', import.meta.url))], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.on('error', () => {}); child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      try { return await request('/status', undefined, config); } catch (e) { if (!(e instanceof TypeError)) throw e; }
    }
    throw new Error('本机 Clips 连接器未启动，请检查 17373 端口或运行 node agent/broker.mjs。');
  })().finally(() => { starting = null; });
  return starting;
}
export async function callTool(name, args = {}) { await ensureBroker(); return (await request('/call', { name, arguments: args })).result; }

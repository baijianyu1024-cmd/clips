import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { WebSocket } from '../../agent/node_modules/ws/wrapper.mjs';
import { startBroker } from '../../agent/broker.mjs';
const token = () => randomBytes(32).toString('hex'), ext = 'a'.repeat(32);
async function setup(t, timeout = 2000) {
  const config = { version: 1, token: token() }, broker = await startBroker({ config, port: 0, timeout, persist: async () => {} });
  t.after(() => broker.close()); const origin = `http://127.0.0.1:${broker.server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const res = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const pair = async () => {
    const { body: p } = await call('/pairing', { extension_id: ext });
    return call('/pair', { code: p.code, library: { key: 'local:test', name: 'Test library', mode: 'local' } }, { Origin: 'chrome-extension://' + ext });
  };
  const connect = device => new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace('http', 'ws') + '/extension', { origin: 'chrome-extension://' + ext });
    ws.on('error', reject); ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocol: 1, token: device.token, library_key: device.library.key, version: 'test' })));
    ws.once('message', () => resolve(ws));
  });
  return { ...broker, call, pair, connect, origin };
}
test('rejects websites, DNS rebinding, invalid credentials and arbitrary APIs', async t => {
  const s = await setup(t);
  assert.equal((await s.call('/status', undefined, { Origin: 'https://evil.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const req = http.get(s.origin + '/status', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(hostStatus, 403);
  assert.equal((await s.call('/status', undefined, { Authorization: 'Bearer ' + 'é'.repeat(64) })).status, 403);
  assert.equal((await s.call('/call', { name: 'CONFIG_GET' })).status, 400);
  assert.equal((await s.call('/call', { name: 'clips_search', arguments: {} })).body.code, 'NOT_CONNECTED');
});
test('pairing is one-time, bound to extension ID, and routes calls only after device authentication', async t => {
  const s = await setup(t), { body: p } = await s.call('/pairing', { extension_id: ext });
  const body = { code: p.code, library: { key: 'local:test', name: 'Test', mode: 'local' } };
  assert.equal((await s.call('/pair', body, { Origin: 'chrome-extension://' + 'b'.repeat(32) })).status, 403);
  const paired = await s.call('/pair', body, { Origin: 'chrome-extension://' + ext }); assert.equal(paired.status, 200);
  assert.equal((await s.call('/pair', body, { Origin: 'chrome-extension://' + ext })).status, 403);
  const ws = await s.connect(paired.body.device);
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'call') ws.send(JSON.stringify({ type: 'result', id: m.id, ok: true, result: { notes: 3 } })); });
  assert.equal((await s.call('/status')).body.connected, true);
  assert.deepEqual((await s.call('/call', { name: 'clips_search', arguments: {} })).body.result, { notes: 3 });
  await s.call('/disconnect', {}); assert.equal((await s.call('/status')).body.connected, false);
});
test('lost connections and timeout preserve uncertainty instead of silently retrying writes', async t => {
  const s = await setup(t, 80), paired = await s.pair(), ws = await s.connect(paired.body.device);
  const result = await s.call('/call', { name: 'clips_search', arguments: {} }); assert.equal(result.body.code, 'TIMEOUT');
  ws.on('message', raw => { if (JSON.parse(raw).type === 'call') ws.close(); });
  const lost = await s.call('/call', { name: 'clips_search', arguments: {} }); assert.equal(lost.body.code, 'CONNECTION_LOST');
});

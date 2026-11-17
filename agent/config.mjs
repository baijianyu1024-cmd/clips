import { mkdir, open, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AGENT_PORT } from '../extension/agent-protocol.js';
export const home = path.resolve(process.env.CLIPS_AGENT_HOME || path.join(homedir(), '.clips-agent'));
export const configFile = path.join(home, 'connection.json');
export const secret = () => randomBytes(32).toString('hex');
export async function loadConfig() {
  await mkdir(home, { recursive: true, mode: 0o700 });
  try {
    const f = await open(configFile, 'wx', 0o600);
    try { await f.writeFile(JSON.stringify({ version: 1, port: AGENT_PORT, token: secret() })); } finally { await f.close(); }
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  // Another process may just have won the exclusive create. Never replace its token.
  for (let i = 0; i < 20; i++) {
    try {
      const c = JSON.parse(await readFile(configFile, 'utf8'));
      if (c.version !== 1 || c.port !== AGENT_PORT || !/^[a-f0-9]{64}$/.test(c.token)) throw new Error('Clips Agent 配置无效，请检查 connection.json。');
      return c;
    } catch (e) { if (!(e instanceof SyntaxError) || i === 19) throw e; await new Promise(r => setTimeout(r, 50)); }
  }
}
export async function saveConfig(config) {
  const tmp = configFile + '.' + secret().slice(0, 10) + '.tmp';
  await writeFile(tmp, JSON.stringify(config), { mode: 0o600 });
  await rename(tmp, configFile);
  if (process.platform !== 'win32') await chmod(configFile, 0o600);
}

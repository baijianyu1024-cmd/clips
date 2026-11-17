import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensureBroker, request, callTool } from './client.mjs';
import { AGENT_TOOLS } from '../extension/agent-protocol.js';

const args = process.argv.slice(2), command = args.shift();
const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
try {
  if (command === 'setup') {
    const extensionId = option('--extension-id');
    if (!/^[a-p]{32}$/.test(extensionId || '')) throw new Error('用法：node agent/cli.mjs setup --extension-id <Clips插件ID> [--codex]');
    await ensureBroker();
    const pair = await request('/pairing', { extension_id: extensionId });
    if (args.includes('--codex')) {
      const argv = ['mcp', 'add', 'clips', '--', process.execPath, fileURLToPath(new URL('./server.mjs', import.meta.url))];
      const quotePS = value => "'" + value.replaceAll("'", "''") + "'";
      const result = process.platform === 'win32'
        ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& codex ' + argv.map(quotePS).join(' ') + '; exit $LASTEXITCODE'], { stdio: 'inherit', shell: false })
        : spawnSync('codex', argv, { stdio: 'inherit', shell: false });
      if (result.error || result.status !== 0) throw new Error('Codex 自动注册失败。可按 README 手动添加 MCP；原有笔记不受影响。');
    }
    console.log('在 Clips「阅读设置 → Agent 连接」粘贴以下配对码，点击连接（5 分钟内有效）：\n' + pair.code);
    console.log('\n设置页：chrome-extension://' + extensionId + '/agent.html');
    console.log('\nMCP command: ' + process.execPath + '\nMCP args: ' + JSON.stringify([fileURLToPath(new URL('./server.mjs', import.meta.url))]));
  } else if (command === 'status') { await ensureBroker(); console.log(JSON.stringify(await request('/status'), null, 2)); }
  else if (command === 'stop' || command === 'disconnect') console.log(JSON.stringify(await request('/' + command, {})));
  else if (command === 'tools') console.log(JSON.stringify(AGENT_TOOLS, null, 2));
  else if (command === 'call') {
    const name = args.shift(), filename = option('--file');
    const json = filename ? await readFile(filename, 'utf8') : option('--json') || '{}';
    console.log(JSON.stringify(await callTool(name, JSON.parse(json)), null, 2));
  } else console.log('Clips Agent\n  setup --extension-id <id> [--codex]\n  status | tools | disconnect | stop\n  call <tool> --file <input.json>\n  call <tool> --json <JSON>\n\nMCP: node agent/server.mjs');
} catch (e) { console.error(e.message); process.exitCode = 1; }

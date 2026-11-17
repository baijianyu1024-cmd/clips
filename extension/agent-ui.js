import { AGENT_PERMISSION } from './agent-protocol.js';
const $ = id => document.getElementById(id);
const send = async message => { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw new Error(r?.error || '请重新加载 Clips 插件。'); return r.data; };
async function refresh() {
  const state = await send({ type: 'AGENT_STATUS' });
  $('library').textContent = state.library?.name || state.current?.name || '尚未选择资料库';
  $('state').textContent = state.status + (state.library && state.library.key !== state.current?.key ? ' · 当前已切换到其他资料库' : '');
  $('setup-command').textContent = `node agent/cli.mjs setup --extension-id ${state.extensionId} --codex`;
}
async function run(button, task) {
  button.disabled = true; $('error').textContent = '';
  try { await task(); await refresh(); } catch (e) { $('error').textContent = e instanceof TypeError ? '连接器未启动。请先运行上面的安装与配对命令。' : e.message; }
  finally { button.disabled = false; }
}
$('pair').onclick = event => {
  // Request the optional local-network origin directly in the user gesture.
  const permission = chrome.permissions.request({ origins: [AGENT_PERMISSION] });
  void run(event.target, async () => { if (!await permission) throw new Error('需要允许连接本机才能配对。'); await send({ type: 'AGENT_PAIR', code: $('pair-code').value.trim() }); $('pair-code').value = ''; });
};
$('reconnect').onclick = event => void run(event.target, () => send({ type: 'AGENT_RECONNECT' }));
$('disconnect').onclick = event => void run(event.target, () => send({ type: 'AGENT_DISCONNECT' }));
void refresh().catch(e => { $('error').textContent = e.message; });
setInterval(() => void refresh().catch(() => {}), 3000);

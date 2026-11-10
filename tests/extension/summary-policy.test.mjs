import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryTooLong, condenseSummary } from '../../extension/summary-policy.js';

test('concise summaries do not incur another model call', async () => {
  const text = '- 工具负责执行，模型负责推理。\n- 后台进程需要独立管理。';
  assert.equal(summaryTooLong(text), false);
  assert.deepEqual(await condenseSummary(text, { fetcher: () => assert.fail() }), { text, warning: '' });
});
test('excessive length or too many points trigger only one grounded refinement', async () => {
  assert.equal(summaryTooLong('摘要'.repeat(250)), true);
  assert.equal(summaryTooLong(Array(6).fill('- 一条要点').join('\n')), true);
  let calls = 0;
  const result = await condenseSummary('摘要'.repeat(250), { model: 'test', key: 'FAKE', fetcher: async (_url, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.equal(body.messages.length, 2); assert.match(body.messages[0].content, /不逐条标注作者或读者/); assert.match(body.messages[0].content, /不补充输入没有的信息/);
    assert.equal(JSON.parse(body.messages[1].content).summary_to_condense.length, 500);
    return Response.json({ choices: [{ message: { content: '- 关键信息。' }, finish_reason: 'stop' }] });
  } });
  assert.equal(calls, 1); assert.equal(result.text, '- 关键信息。'); assert.equal(result.warning, '');
});
test('refinement failures or still-verbose output retain the first draft with a warning', async () => {
  const text = '摘要'.repeat(250);
  for (const fetcher of [async () => { throw new TypeError('network'); }, async () => new Response('', { status: 429 }), async () => Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), async () => Response.json({ choices: [{ message: { content: '截断的短句' }, finish_reason: 'length' }] })]) {
    const result = await condenseSummary(text, { fetcher }); assert.equal(result.text, text); assert.match(result.warning, /保留初稿/);
  }
});
test('a truncated first draft never becomes a falsely complete summary', async () => {
  const result = await condenseSummary('部分初稿', { incomplete: true, fetcher: async () => Response.json({ choices: [{ message: { content: '- 已返回内容的总结。' }, finish_reason: 'stop' }] }) });
  assert.match(result.warning, /检查遗漏/);
});

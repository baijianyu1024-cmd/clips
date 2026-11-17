import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryTooLong, condenseSummary, SUMMARY_GUIDANCE, CORE_SUMMARY_MAX_TOKENS } from '../../extension/summary-policy.js';

const prose = Array.from({ length: 3 }, (_, i) => `**判断 ${i + 1}。**` + '解释关键机制与适用边界，结合实际记录理解其意义。'.repeat(9)).join('\n\n');
test('paragraph summaries keep their reasoning without an unnecessary second model call', async () => {
  assert.ok(prose.length > 420 && prose.length < 850);
  for (const text of ['- 工具负责执行，模型负责推理。', prose, Array(6).fill('- 一条要点').join('\n')]) {
    assert.equal(summaryTooLong(text), false);
    assert.deepEqual(await condenseSummary(text, { fetcher: () => assert.fail('unnecessary model call') }), { text, warning: '' });
  }
});
test('runaway output gets one refinement with original material and personal context', async () => {
  const text = '摘要'.repeat(650), original = { role: 'user', content: JSON.stringify({ reading_material: '原文与已有想法', reader_supplement: '关注交接成本' }) };
  let calls = 0;
  const result = await condenseSummary(text, { model: 'test', key: 'FAKE', sourceMessages: [{ role: 'system', content: 'old' }, original], supplement: '关注交接成本', fetcher: async (_url, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, CORE_SUMMARY_MAX_TOKENS);
    assert.equal(body.messages.length, 3); assert.deepEqual(body.messages[1], original);
    assert.ok(body.messages[0].content.startsWith(SUMMARY_GUIDANCE));
    assert.match(body.messages[0].content, /以原始材料为准/);
    assert.equal(JSON.parse(body.messages[2].content).summary_to_refine, text);
    assert.equal(JSON.parse(body.messages[2].content).reader_focus_to_preserve, '关注交接成本');
    return Response.json({ choices: [{ message: { content: prose }, finish_reason: 'stop' }] });
  } });
  assert.equal(calls, 1); assert.equal(result.text, prose); assert.equal(result.warning, '');
});
test('refinement failures or still-verbose output retain the first draft with a warning', async () => {
  const text = '摘要'.repeat(650);
  for (const fetcher of [async () => { throw new TypeError('network'); }, async () => new Response('', { status: 429 }), async () => Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), async () => Response.json({ choices: [{ message: { content: '截断的短句' }, finish_reason: 'length' }] })]) {
    const result = await condenseSummary(text, { fetcher }); assert.equal(result.text, text); assert.match(result.warning, /保留初稿/);
  }
});
test('truncation recovery reuses original visual material without inferring unseen content', async () => {
  const source = [{ role: 'user', content: [{type:'text',text:'原文与记录'}, {type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}] }];
  const result = await condenseSummary('部分初稿', { incomplete: true, sourceMessages: source, fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages[1], source[0]);
    return Response.json({ choices: [{ message: { content: prose }, finish_reason: 'stop' }] });
  } });
  assert.equal(result.text, prose); assert.equal(result.warning, '');
});
test('without original material, a shortened truncated draft still warns about omissions', async () => {
  const result = await condenseSummary('部分初稿', { incomplete: true, fetcher: async (_url, options) => {
    assert.match(JSON.parse(options.body).messages[0].content, /不猜测截断部分/);
    return Response.json({ choices: [{ message: { content: '- 已返回内容的总结。' }, finish_reason: 'stop' }] });
  } });
  assert.match(result.warning, /检查遗漏/);
});

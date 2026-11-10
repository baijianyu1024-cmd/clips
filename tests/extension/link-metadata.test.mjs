import test from 'node:test';
import assert from 'node:assert/strict';
import { titleUrlKey, titlesFromTabs, needsLinkTitle } from '../../extension/link-metadata.js';

test('title matching ignores share decorations but preserves content identity', () => {
  assert.equal(titleUrlKey('https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=1&chksm=foo'), titleUrlKey('https://mp.weixin.qq.com/s?idx=1&mid=123&__biz=abc&mpshare=1'));
  assert.notEqual(titleUrlKey('https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=1'), titleUrlKey('https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=2'));
  assert.equal(titleUrlKey('https://my.feishu.cn/wiki/token?from=share&login_redirect_times=2#abc'), 'https://my.feishu.cn/wiki/token');
  assert.notEqual(titleUrlKey('https://a.feishu.cn/wiki/token'), titleUrlKey('https://b.feishu.cn/wiki/token'));
  assert.notEqual(titleUrlKey('https://example.com/article?p=1'), titleUrlKey('https://example.com/article?p=2'));
  assert.notEqual(titleUrlKey('https://example.com/?from=one'), titleUrlKey('https://example.com/?from=two'));
  assert.equal(titleUrlKey('javascript:alert(1)'), '');
});

test('browser lookup returns only requested, fully loaded public-tab titles', () => {
  const urls = ['https://my.feishu.cn/wiki/one', 'https://my.feishu.cn/wiki/two', 'https://example.com/secret'];
  const tabs = [
    { url: urls[0] + '?from=share', title: '飞书文档的真实标题', status: 'complete' },
    { url: urls[1], title: 'Previous page title', status: 'loading' },
    { url: urls[2], title: 'Incognito document', status: 'complete', incognito: true },
    { url: 'https://other.com/', title: 'Unrelated tab', status: 'complete' }
  ];
  assert.deepEqual(titlesFromTabs(urls, tabs), [{ url: urls[0], title: '飞书文档的真实标题' }]);
});

test('auto lookup protects imported/manual titles even when legacy status says unavailable', () => {
  const n = { status: 'inbox', title: 'my.feishu.cn', sources: [{ url: 'https://my.feishu.cn/wiki/one' }], linkTitleStatus: 'unavailable' };
  assert.ok(needsLinkTitle(n));
  assert.ok(!needsLinkTitle({ ...n, title: '我自己的标题' }));
  assert.ok(!needsLinkTitle({ ...n, status: 'reading' }));
  assert.ok(!needsLinkTitle({ ...n, deletedAt: 'today' }));
  assert.ok(needsLinkTitle({ ...n, title: '- YouTube', linkTitleStatus: 'ready' }));
});

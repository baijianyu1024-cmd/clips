import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown, renderRecordPreview } from '../../extension/markdown.js';

test('feed previews show the first two top-level items and keep a nested list with its parent', () => {
  const text = '## 摘要\n\n3. **一**\n   - 嵌套\n4. 二\n5. 三\n6. 四';
  const preview = renderRecordPreview(text);
  const document = JSDOM.fragment(preview.previewHtml);
  assert.equal(JSDOM.fragment(preview.html).querySelectorAll('ol > li').length, 4);
  assert.equal(document.querySelector('ol').getAttribute('start'), '3');
  assert.equal(document.querySelectorAll('ol > li').length, 2);
  assert.equal(document.querySelector('li ul li').textContent, '嵌套');
  assert.equal(document.querySelector('h2').textContent, '摘要');
  assert.equal(preview.html, renderMarkdown(text));
});

test('feed previews clamp only prose and keep headings with their content', () => {
  const prose = renderRecordPreview('# 开头\n\n**判断** 和 `code`\n\n## 证据\n\n后文');
  assert.equal(prose.clampParagraph, true);
  assert.match(prose.previewHtml, /<strong>判断<\/strong>/);
  assert.doesNotMatch(prose.previewHtml, /证据/);
  for (const text of ['## 数据\n\n| 一 |\n| --- |\n| 二 |', '# 实现\n\n    fn();']) {
    assert.equal(renderRecordPreview(text).previewHtml, '');
    assert.equal(renderRecordPreview(text).html, renderMarkdown(text));
  }
  assert.equal(renderRecordPreview('![图](https://example.com/img)').clampParagraph, false);
  assert.equal(renderRecordPreview('- 一\n- 二').previewHtml, renderMarkdown('- 一\n- 二'));
});

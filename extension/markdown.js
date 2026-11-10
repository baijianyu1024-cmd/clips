import MarkdownIt from './vendor/markdown-it.mjs';

// Raw HTML is always text. Only this renderer's generated markup reaches the DOM.
const md = new MarkdownIt({ html: false, breaks: true, linkify: true, typographer: false });
const defaultValidate = md.validateLink;
md.validateLink = value => {
  if (!defaultValidate(value) || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(value, 'https://clips.invalid').protocol); }
  catch { return false; }
};
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  tokens[i].attrSet('target', '_blank');
  tokens[i].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, i, options);
};
const image = md.renderer.rules.image;
md.renderer.rules.image = (tokens, i, options, env, self) => {
  tokens[i].attrSet('loading', 'lazy');
  tokens[i].attrSet('referrerpolicy', 'no-referrer');
  return image(tokens, i, options, env, self);
};

// Read-only task lists: editing the original Markdown remains the source of truth.
md.core.ruler.after('inline', 'clips_tasks', state => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    if (tokens[i - 2].type !== 'list_item_open' || tokens[i - 1].type !== 'paragraph_open' || token.type !== 'inline') continue;
    const text = token.children?.[0];
    if (text?.type !== 'text' || !/^\[[ xX]\]\s/.test(text.content)) continue;
    const checked = text.content[1].toLowerCase() === 'x';
    text.content = text.content.replace(/^\[[ xX]\]\s+/, '');
    const box = new state.Token('clips_checkbox', 'input', 0);
    box.meta = { checked };
    token.children.unshift(box);
    tokens[i - 2].attrJoin('class', 'md-task-item');
  }
});
md.renderer.rules.clips_checkbox = (tokens, i) => `<input type="checkbox" disabled${tokens[i].meta.checked ? ' checked' : ''} aria-label="${tokens[i].meta.checked ? '已完成' : '未完成'}">`;

/** @param {string | null | undefined} text */
export function renderMarkdown(text) { return md.render(String(text ?? '')); }

/** Plain text for compact cards and buttons, without nesting interactive markup.
 * @param {string | null | undefined} text
 */
export function markdownText(text) {
  const visit = tokens => tokens.map(t => t.children ? visit(t.children) : ['text', 'code_inline', 'code_block', 'fence'].includes(t.type) ? t.content : ['softbreak', 'hardbreak', 'paragraph_close', 'heading_close', 'list_item_close'].includes(t.type) ? '\n' : '').join('');
  return visit(md.parse(String(text ?? ''), {})).replace(/\n{3,}/g, '\n\n').trim();
}

export const markdownHelpHTML = `<details class="markdown-help"><summary>Markdown 格式</summary><div><code>**加粗** · *斜体* · ~~删除线~~</code><code># 标题 · ## 小标题</code><code>- 无序列表 · 1. 有序列表</code><code>- [ ] 待办 · - [x] 已完成</code><code>&gt; 引用</code><code>[链接文字](https://example.com)</code><code>\`行内代码\` · 三个反引号包围代码块</code><span>空行分段；也支持表格和 ![说明](图片链接)。</span></div></details>`;

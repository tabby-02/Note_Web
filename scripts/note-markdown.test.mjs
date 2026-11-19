import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { renderNoteMarkdown } from '../src/lib/note-markdown.mjs';

test('standard dollar, bracket and display formulas retain their normal rendering', () => {
  const $ = cheerio.load(renderNoteMarkdown(String.raw`$z_g$ and \(\alpha_u\)

$$x^2$$

\[y^2\]`));
  assert.equal($('.katex-error').length, 0);
  assert.equal($('.katex').length, 4);
  assert.equal($('.katex-display').length, 2);
});

test('Typora escaped parentheses preserve prose and render enclosed dollar formulas', () => {
  const $ = cheerio.load(renderNoteMarkdown(String.raw`\($z_g$\)；\(结果记为$D_g$\)；\(缩放因子$\alpha$\)；\(S=($V_S,E_S$)\)`));
  assert.equal($('.katex-error').length, 0);
  assert.equal($('.katex').length, 4);
  $('.katex').replaceWith('[formula]');
  assert.equal($('p').text(), '([formula])；(结果记为[formula])；(缩放因子[formula])；(S=([formula]))');
});

test('compatibility still reports invalid formulas and leaves code examples literal', () => {
  const source = String.raw`\(结果$\frac{x}$\)`;
  const $ = cheerio.load(renderNoteMarkdown(source));
  assert.equal($('.katex-error').length, 1);
  const code = cheerio.load(renderNoteMarkdown('`' + source + '`\n\n```text\n' + source + '\n```'));
  assert.equal(code('.katex,.katex-error').length, 0);
  assert.deepEqual(code('code').map((_, item) => code(item).text().trim()).get(), [source, source]);
});

test('adjacent display math in blockquotes does not turn preceding prose into a Setext heading', () => {
  const source = String.raw`# 基础

## 2.GRAG

> **⑦ ==Graph View：把拓扑结构编码为图 token==**
> 将节点、边的文本向量输入 GAT。
> **使用 \(缩放因子$\alpha$\) 控制消息传递**。消息公式是：
> $$
> m_u^{(l)}
> =
> \operatorname{MSG}^{(l)}(\alpha_u)
> $$
> 公式后的说明。

## 3.G-Retriever`;
  const $ = cheerio.load(renderNoteMarkdown(source));
  assert.deepEqual($('h1,h2,h3,h4,h5,h6').map((_, el) => $(el).text()).get(), ['基础', '2.GRAG', '3.G-Retriever']);
  assert.equal($('.katex-error').length, 0);
  assert.equal($('blockquote .katex-display').length, 1);
  assert.match($('blockquote p').first().text(), /⑦ ==Graph View/);
  assert.match($('blockquote p').last().text(), /公式后的说明/);
  assert.match($('.katex-display annotation').text(), /m_u\^\{\(l\)\}\s*=\s*\\operatorname/);
});

test('all display delimiters interrupt prose, while genuine Setext headings and code stay intact', () => {
  for (const formula of [String.raw`$$
x
=
y
$$`, String.raw`\[
x
=
y
\]`, String.raw`\begin{equation}
x
=
y
\end{equation}`]) {
    const $ = cheerio.load(renderNoteMarkdown('普通正文\n' + formula + '\n\n真正标题\n===\n\n二级标题\n---\n'));
    assert.deepEqual($('h1,h2').map((_, el) => $(el).text()).get(), ['真正标题', '二级标题']);
    assert.equal($('.katex-display').length, 1);
    assert.equal($('.katex-error').length, 0);
    assert.equal($('p').first().text(), '普通正文');
  }
  const $ = cheerio.load(renderNoteMarkdown('```md\n正文\n$$\nx\n=\ny\n$$\n```'));
  assert.equal($('h1,.katex').length, 0);
  assert.match($('code').text(), /x\n=\ny/);
});

test('rendered prose blocks carry source line ranges for exact inline editing', () => {
  const html = renderNoteMarkdown('# 标题\n\n第一段 **重点**。\n\n- 列表项\n');
  assert.match(html, /<h1[^>]*data-source-start="0" data-source-end="1"/);
  assert.match(html, /<p[^>]*data-source-start="2" data-source-end="3"/);
  assert.match(html, /<li[^>]*data-source-start="4" data-source-end="5"/);
});

test('HTML image spacing retains original source lines for paragraphs that follow it', () => {
  const source = '# 标题\r\n<img src="media/a.png">\r\n## 后续章节\r\n\r\n这段文字可以标注。';
  const $ = cheerio.load(renderNoteMarkdown(source));
  assert.equal($('h2').attr('data-source-start'), '2');
  assert.equal($('p').last().attr('data-source-start'), '4');
  assert.equal($('p').last().attr('data-source-end'), '5');
});

test('HTML image examples in code fences remain literal, with source mappings intact', () => {
  const $ = cheerio.load(renderNoteMarkdown('```html\n<img src="media/a.png">\n```\n\n后面的正文。'));
  assert.equal($('code').text(), '<img src="media/a.png">\n');
  assert.equal($('p').attr('data-source-start'), '4');
});

test('a manual table of contents collapses without deleting source or altering later heading IDs', () => {
  const source = '## 目录\n\n- [一](#一)\n- [二](#二)\n- [三](#三)\n\n## 一\n\n正文';
  const $ = cheerio.load(renderNoteMarkdown(source));
  assert.equal($('details.note-original-toc').length, 1);
  assert.equal($('details[open]').length, 0);
  assert.equal($('h2').text(), '一');
  assert.equal($('h2').attr('data-source-start'), '6');
  assert.equal($('details a').length, 3);
  assert.equal(cheerio.load(renderNoteMarkdown('## 目录\n\n这是一段正文。'))('h2').text(), '目录');
});

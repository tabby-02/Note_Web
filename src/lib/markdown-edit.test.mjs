import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSelectionToMarkdown } from './markdown-edit.mjs';

test('maps a DOM selection by source block and offsets when text repeats elsewhere', () => {
  const markdown = '# Topic\n\n重复词和目标短语，重复词。\n\n重复词和目标短语。';
  const mapped = mapSelectionToMarkdown(markdown, 2, 3, '重复词和目标短语，重复词。', 4, 8);
  assert.deepEqual(mapped, { start: markdown.indexOf('目标短语'), end: markdown.indexOf('目标短语') + 4, text: '目标短语' });
});

test('maps formatted Markdown characters without including syntax markers', () => {
  const markdown = '## 标题\n\n前文 **加粗目标** 后文';
  const start = markdown.indexOf('前文');
  const mapped = mapSelectionToMarkdown(markdown, 2, 3, '前文 加粗目标 后文', 3, 7);
  assert.deepEqual(mapped, { start: markdown.indexOf('加粗目标'), end: markdown.indexOf('加粗目标') + 4, text: '加粗目标' });
  assert.ok(start >= 0);
});

test('maps plain text in a paragraph that also contains inline links', () => {
  const markdown = '链接外文字 [链接标签](https://example.test) 之后的文字';
  const blockText = '链接外文字 链接标签 之后的文字';
  const selected = '之后的文字';
  const start = blockText.indexOf(selected);
  const mapped = mapSelectionToMarkdown(markdown, 0, 1, blockText, start, start + selected.length);
  assert.deepEqual(mapped, {
    start: markdown.indexOf(selected),
    end: markdown.indexOf(selected) + selected.length,
    text: selected,
  });
});

test('refuses a selection that cannot be mapped exactly to its source block', () => {
  assert.equal(mapSelectionToMarkdown('段落 $x^2$ 文本', 0, 1, '段落 x2 文本', 0, 2), null);
  assert.equal(mapSelectionToMarkdown('第一段\n\n第二段', 2, 3, '完全不同', 0, 2), null);
});

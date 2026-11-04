import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { createNoteMarkdownParser, renderNoteMarkdown } from '../src/lib/note-markdown.mjs';
import { markdownSearchPassages, wordSearchPassages } from '../src/lib/note-search.mjs';

test('index and reading page use identical heading and passage anchors, including formulas', () => {
  const markdown = '# 数据库\n\n$x^2$\n\nJDBC 第一处\n\nJDBC 第二处\n\n## 中文章节\n';
  const reader = cheerio.load(renderNoteMarkdown(markdown, createNoteMarkdownParser()));
  const indexed = cheerio.load(renderNoteMarkdown(markdown, createNoteMarkdownParser()));
  indexed('script,style,.katex-mathml').remove();
  assert.deepEqual(markdownSearchPassages(indexed), markdownSearchPassages(reader));
  assert.deepEqual(indexed('h1,h2').map((_, heading) => indexed(heading).attr('id')).get(), reader('h1,h2').map((_, heading) => reader(heading).attr('id')).get());
  assert.deepEqual(indexed('h1,h2').map((_, heading) => decodeURIComponent(indexed(heading).attr('id'))).get(), ['数据库', '中文章节']);
  const hits = markdownSearchPassages(indexed).filter(({ text }) => text.includes('JDBC'));
  assert.equal(hits.length, 2);
  assert.notEqual(hits[0].id, hits[1].id);
  for (const { id } of hits) assert.equal(reader(`[id='${id}']`).length, 1);
});

test('nested lists and table paragraphs do not duplicate matches or overwrite existing anchors', () => {
  const $ = cheerio.load('<ul><li>外层<ul><li><p>内层匹配</p></li></ul></li></ul><table><tr><td><p id="custom">表格匹配</p></td></tr></table>');
  const passages = markdownSearchPassages($);
  assert.deepEqual(passages.map(({ text }) => text), ['外层', '内层匹配', '表格匹配']);
  assert.equal(passages.at(-1).id, 'custom');
});

test('DOCX joins formatting runs without breaking words and ignores headers and deleted text', () => {
  const $ = cheerio.load('<w:document><w:hdr><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr><w:body><w:p><w:r><w:t>JD</w:t></w:r><w:r><w:t>BC</w:t></w:r><w:tab/><w:r><w:t>&amp;连接</w:t></w:r><w:del><w:r><w:t>已删除</w:t></w:r></w:del></w:p><w:p/><w:p><w:r><w:t>另一个 JDBC</w:t></w:r></w:p></w:body></w:document>', { xmlMode: true });
  assert.deepEqual(wordSearchPassages($), [
    { id: 'search-paragraph-000001', text: 'JDBC &连接' },
    { id: 'search-paragraph-000002', text: '另一个 JDBC' },
  ]);
});

import MarkdownIt from 'markdown-it';
import { full as emoji } from 'markdown-it-emoji';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import powershell from 'highlight.js/lib/languages/powershell';
import csharp from 'highlight.js/lib/languages/csharp';
import kotlin from 'highlight.js/lib/languages/kotlin';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import plaintext from 'highlight.js/lib/languages/plaintext';
import x86asm from 'highlight.js/lib/languages/x86asm';
import markdown from 'highlight.js/lib/languages/markdown';
import makefile from 'highlight.js/lib/languages/makefile';
import ini from 'highlight.js/lib/languages/ini';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import matlab from 'highlight.js/lib/languages/matlab';
for (const [name, language] of Object.entries({ cpp, python, java, javascript, typescript, css, xml, sql, bash, shell, json, yaml, powershell, csharp, kotlin, go, rust, plaintext, x86asm, markdown, makefile, ini, diff, dockerfile, matlab })) hljs.registerLanguage(name, language);
import anchor from 'markdown-it-anchor';

const privateUseGlyphs = new Map([
  ['\uF06C', '\u2022'],
  ['\uF06D', '\u2022'],
  ['\uF070', '\u25A1'],
  ['\uF071', '\u25AA'],
  ['\uF072', '\u25E6'],
  ['\uF076', '\u25C6'],
  ['\uF0A7', '\u25AA'],
  ['\uF0A8', '\u25A1'],
  ['\uF0D8', '\u25B8'],
  ['\uF0E0', '\u2192'],
]);
const languageAliases = new Map([
  ['assembly', 'x86asm'],
  ['asm', 'x86asm'],
  ['vue', 'xml'],
]);

function normalizePrivateUseText(text) {
  return [...text].map((character) => privateUseGlyphs.get(character) ?? character).join('');
}

function normalizeHeadingText(value) {
  let decoded = value.replace(/^#+/, '');
  try { decoded = decodeURIComponent(decoded); } catch {}
  return decoded.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function resolveHeadingFragment(fragment, headings) {
  const key = normalizeHeadingText(fragment);
  if (!key) return null;
  return headings.find(({ id, text }) => normalizeHeadingText(id) === key || normalizeHeadingText(text) === key)?.id ?? null;
}

export function createNoteMarkdownParser() {
  const mathDelimiters = ['dollars', 'brackets', 'beg_end'];
  const parser = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: true })
    .use(anchor)
    .use(emoji)
    .use(texmath, {
      engine: katex,
      delimiters: mathDelimiters,
      katexOptions: { throwOnError: false, strict: false },
    });

  // texmath's block rules do not interrupt paragraphs by default. Without this
  // boundary, a standalone '=' inside adjacent display math becomes a Setext
  // heading underline and pulls the preceding prose into the page outline.
  const mathBlockRules = texmath.mergeDelimiters(mathDelimiters).block.map((rule) => texmath.block(rule));
  parser.block.ruler.before('fence', 'note-math-boundary', (state, startLine, endLine, silent) => {
    return silent && mathBlockRules.some((rule) => rule(state, startLine, endLine, true));
  }, { alt: ['paragraph'] });

  const renderInlineMath = parser.renderer.rules.math_inline;
  parser.renderer.rules.math_inline = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const html = renderInlineMath(tokens, index, options, env, renderer);
    // Typora can interpret escaped parentheses around $...$ as ordinary punctuation.
    // Keep valid bracket math intact; retry only rejected spans containing dollar math.
    if (token.markup === '\\(' && token.content.includes('$') && html.includes('class="katex-error"')) {
      const inner = parser.parseInline(token.content, env);
      if (inner.some((entry) => entry.children?.some((child) => child.tag === 'math' && child.markup.startsWith('$')))) {
        return `(${parser.renderer.render(inner, options, env)})`;
      }
    }
    return html;
  };

  parser.core.ruler.after('inline', 'note-private-use-glyphs', (state) => {
    for (const token of state.tokens) {
      for (const child of token.children ?? []) {
        if (child.type === 'text') child.content = normalizePrivateUseText(child.content);
      }
    }
  });

  parser.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const info = token.info.trim();
    const language = info.split(/\s+/, 1)[0] ?? '';
    const normalizedLanguage = language.toLowerCase();
    const highlightLanguage = languageAliases.get(normalizedLanguage) ?? normalizedLanguage;
    const classLanguage = /^[a-z\d_+#.-]+$/i.test(normalizedLanguage) ? normalizedLanguage : 'text';
    let code = parser.utils.escapeHtml(token.content);

    if (highlightLanguage && hljs.getLanguage(highlightLanguage)) {
      try {
        code = hljs.highlight(token.content, { language: highlightLanguage, ignoreIllegals: true }).value;
      } catch {}
    }

    const label = parser.utils.escapeHtml(language || 'text');
    const safeClass = parser.utils.escapeHtml(classLanguage);
    return `<div class="note-code-block"><div class="note-code-label">${label}</div><pre><code class="hljs language-${safeClass}">${code}</code></pre></div>\n`;
  };

  parser.core.ruler.push('note-source-block-lines', (state) => {
    for (const token of state.tokens) {
      if (token.nesting !== 1 || !token.map || !/^(?:paragraph|heading|list_item|th|td)_open$/.test(token.type)) continue;
      const lines = state.env.noteSourceLines;
      token.attrSet('data-source-start', String(lines?.[token.map[0]] ?? token.map[0]));
      token.attrSet('data-source-end', String(lines?.[token.map[1]] ?? token.map[1]));
    }
  });

  parser.core.ruler.push('note-original-toc', (state) => {
    // Only collapse an actual hand-written list of internal links, never a prose
    // section whose title happens to be “目录”. Source Markdown stays unchanged.
    for (let index = 0; index < state.tokens.length - 3; index++) {
      const heading = state.tokens[index];
      const title = state.tokens[index + 1];
      if (heading.type !== 'heading_open' || !/^(?:目录|目次|table of contents)$/i.test(title.content?.trim() ?? '')) continue;
      const begin = index + 3;
      if (!['bullet_list_open', 'ordered_list_open'].includes(state.tokens[begin]?.type)) continue;
      let end = begin, nesting = 0, links = 0, external = false;
      for (; end < state.tokens.length; end++) {
        const token = state.tokens[end];
        if (/^(?:bullet|ordered)_list_open$/.test(token.type)) nesting++;
        if (/^(?:bullet|ordered)_list_close$/.test(token.type)) nesting--;
        for (const child of token.children ?? []) {
          if (child.type === 'link_open') { links++; external ||= !child.attrGet('href')?.startsWith('#'); }
        }
        if (!nesting) break;
      }
      if (links < 3 || external || end >= state.tokens.length) continue;
      const open = new state.Token('html_block', '', 0);
      const id = heading.attrGet('id');
      open.content = `<details class="note-original-toc" data-note-toc${id ? ` id="${parser.utils.escapeHtml(id)}"` : ''}><summary>原文目录<span>展开查看笔记中的目录链接</span></summary>\n`;
      const close = new state.Token('html_block', '', 0); close.content = '</details>\n';
      state.tokens.splice(end + 1, 0, close);
      state.tokens.splice(index, 3, open);
    }
  });

  return parser;
}

export function normalizeStandaloneHtmlImages(markdown) {
  return markdown.replace(/^([ \t]*<img\b[^>\r\n]*>)[ \t]*$/gim, '\n$1\n');
}

function normalizeAssetReference(source) {
  let value = String(source ?? '').trim().split(/[?#]/, 1)[0];
  try { value = decodeURIComponent(value); } catch {}
  value = value.replaceAll('\\', '/').replace(/^\/+/, '').replace(/^\.\//, '');
  const parts = value.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) return '';
  return parts.join('/');
}

export function markdownImageAssetPath(source) {
  if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(String(source ?? '').trim())) return null;
  const relative = normalizeAssetReference(source);
  if (!relative || relative.toLowerCase().startsWith('attachments/')) return null;
  return relative.toLowerCase().startsWith('media/') ? `media/${relative.slice(6)}` : `media/${relative}`;
}

const defaultParser = createNoteMarkdownParser();

export function renderNoteMarkdown(markdown, parser = defaultParser) {
  // Blank lines isolate Typora's HTML images. Preserve original source locations:
  // inserted lines must never shift the source range used for inline editing.
  const original = markdown.replace(/\r\n?/g, '\n').split('\n');
  const normalized = [], noteSourceLines = [];
  let fence = null;
  original.forEach((line, index) => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const inFence = Boolean(fence);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && line.slice(delimiter[0].length).trim() === '') fence = null;
    }
    const image = !inFence && !delimiter && /^[ \t]*<img\b[^>\r\n]*>[ \t]*$/i.test(line);
    if (image) { normalized.push(''); noteSourceLines.push(index); }
    normalized.push(line); noteSourceLines.push(index);
    if (image) { normalized.push(''); noteSourceLines.push(index + 1); }
  });
  noteSourceLines.push(original.length);
  return parser.render(normalized.join('\n'), { noteSourceLines });
}

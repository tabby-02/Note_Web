import MarkdownIt from 'markdown-it';
import { full as emoji } from 'markdown-it-emoji';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js';
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

  return parser;
}

export function normalizeStandaloneHtmlImages(markdown) {
  return markdown.replace(/^([ \t]*<img\b[^>\r\n]*>)[ \t]*$/gim, '\n$1\n');
}

const defaultParser = createNoteMarkdownParser();

export function renderNoteMarkdown(markdown, parser = defaultParser) {
  return parser.render(normalizeStandaloneHtmlImages(markdown));
}

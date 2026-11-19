import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { parse } from 'yaml';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';
import { createNoteMarkdownParser, markdownImageAssetPath, renderNoteMarkdown, resolveHeadingFragment } from '../src/lib/note-markdown.mjs';
import { selectMarkdownSections, splitMarkdownSections } from './note-sections.mjs';
import { inspectGallery } from '../src/lib/gallery.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const taxonomy = loadTaxonomy(root);
const leaves = flattenLeaves(taxonomy);
const md = createNoteMarkdownParser();
const failures = [];
let markdownCount = 0;
let imageCount = 0;
let galleryChapters = 0;
let attachmentCount = 0;

for (const sample of ['行内公式 $E=mc^2$', '<img src="formula-test.png">\n$E=mc^2$', '<img src="formula-test.png">\n$$\nx^2\n$$']) {
  const html = renderNoteMarkdown(sample, md);
  if (!html.includes('class="katex"') || html.includes('katex-error')) {
    failures.push(`math delimiter failed to render: ${sample}`);
  }
}
const lineBreakHtml = renderNoteMarkdown('第一行\n第二行', md);
if (!/<br\s*\/?>(?:\n)?/.test(lineBreakHtml)) failures.push('single Markdown line breaks are not preserved');
const emojiHtml = renderNoteMarkdown(':yum: :one: :postgresql:', md);
if (!emojiHtml.includes('\u{1F60B}') || !emojiHtml.includes('\u0031\uFE0F\u20E3') || !emojiHtml.includes(':postgresql:')) {
  failures.push('emoji shortcode rendering failed or changed an unknown shortcode');
}
const highlightedHtml = renderNoteMarkdown('```javascript\nconst answer = 42;\n```', md);
if (!highlightedHtml.includes('language-javascript') || !highlightedHtml.includes('hljs-keyword') || !highlightedHtml.includes('hljs-number')) {
  failures.push('fenced code language highlighting failed');
}
const legacyGlyphHtml = renderNoteMarkdown('S\uF0E0id = E\n\n\uF06D item', md);
if (!legacyGlyphHtml.includes('S→id = E') || !legacyGlyphHtml.includes('• item') || /[\uE000-\uF8FF]/.test(legacyGlyphHtml)) {
  failures.push('legacy private-use glyph normalization failed');
}
const splitSample = '# 基础\r\n正文\r\n```md\r\n# 围栏中的标题\r\n```\r\n\r\n# 工程\r\n项目\r\n';
if (splitMarkdownSections(splitSample).length !== 2 || selectMarkdownSections(splitSample, ['基础', '工程']) !== splitSample) {
  failures.push('section splitting changed content or treated a code fence as a chapter');
}

function normalizeReference(value) {
  let result = value.trim().split(/[?#]/, 1)[0];
  try { result = decodeURIComponent(result); } catch {}
  result = result.replaceAll('\\', '/');
  return result.replace(/^\/+/, '').replace(/^\.\//, '');
}

function localFile(leafPath, value) {
  if (!value || /^(?:[a-z]+:|\/\/|#)/i.test(value)) return null;
  const normalized = normalizeReference(value);
  const candidates = [
    path.resolve(leafPath, 'media', normalized),
    path.resolve(leafPath, 'attachments', normalized),
    path.resolve(leafPath, normalized),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function localMediaFile(leafPath, value) {
  const relative = markdownImageAssetPath(value ?? '');
  if (!relative) return null;
  const candidate = path.resolve(leafPath, relative);
  const mediaRoot = path.resolve(leafPath, 'media');
  return candidate.startsWith(`${mediaRoot}${path.sep}`) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

for (const leaf of leaves) {
  const leafPath = path.join(root, 'notes', ...leaf.parts);
  const manifestPath = path.join(leafPath, 'note.yml');
  if (!fs.existsSync(manifestPath)) {
    failures.push(`${leaf.slug}: missing note.yml`);
    continue;
  }
  const manifest = parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.type !== leaf.type || manifest.title !== leaf.title) failures.push(`${leaf.slug}: manifest disagrees with taxonomy`);
  if (JSON.stringify(manifest.sourceSections) !== JSON.stringify(leaf.sourceSections)) failures.push(`${leaf.slug}: source section provenance disagrees with taxonomy`);

  if (leaf.type === 'markdown') {
    markdownCount++;
    const notePath = path.join(leafPath, 'note.md');
    if (!fs.existsSync(notePath)) {
      failures.push(`${leaf.slug}: missing note.md`);
      continue;
    }
    const markdown = fs.readFileSync(notePath, 'utf8');
    if (leaf.sourceSections && JSON.stringify(splitMarkdownSections(markdown).map((section) => section.title)) !== JSON.stringify(leaf.sourceSections)) {
      failures.push(`${leaf.slug}: split note chapters disagree with the selected source sections`);
    }
    const html = renderNoteMarkdown(markdown, md);
    const $ = cheerio.load(html);
    $('.katex-error').each((_, element) => failures.push(`${leaf.slug}: KaTeX error: ${$(element).text()}`));
    const prose = cheerio.load(html);
    prose('.katex').remove();
    const visibleHtml = prose.html().replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, '');
    if (/[\uE000-\uF8FF]/.test(visibleHtml)) failures.push(`${leaf.slug}: private-use glyph remains in rendered prose`);
    const headings = $('h1, h2, h3, h4, h5, h6').toArray().map((heading) => ({
      id: $(heading).attr('id') ?? '',
      text: $(heading).text(),
    }));
    $('a[href^="#"]').each((_, element) => {
      const href = $(element).attr('href') ?? '';
      if (!resolveHeadingFragment(href, headings)) failures.push(`${leaf.slug}: broken internal heading link ${href}`);
    });
    $('img[src], source[src]').each((_, element) => {
      const ref = $(element).attr('src');
      if (/^(?:[a-z]+:|\/\/|#)/i.test(ref ?? '')) return;
      imageCount++;
      const file = localMediaFile(leafPath, ref);
      if (!file) failures.push(`${leaf.slug}: image reference must resolve to a file under media/: ${ref}`);
    });
    $('a[href]').each((_, element) => {
      const ref = $(element).attr('href');
      if (!ref || /^(?:[a-z]+:|\/\/|#)/i.test(ref)) return;
      if (/\.(?:png|jpe?g|gif|svg|webp|avif|pdf|docx?|txt|zip)$/i.test(ref) && !localFile(leafPath, ref)) {
        failures.push(`${leaf.slug}: missing file link ${ref}`);
      }
    });
  } else if (leaf.type === 'docx') {
    const docxPath = path.join(leafPath, 'note.docx');
    if (!fs.existsSync(docxPath)) failures.push(`${leaf.slug}: missing note.docx`);
    else {
      const signature = Buffer.alloc(2);
      const fd = fs.openSync(docxPath, 'r');
      fs.readSync(fd, signature, 0, 2, 0);
      fs.closeSync(fd);
      if (signature.toString() !== 'PK') failures.push(`${leaf.slug}: invalid DOCX ZIP signature`);
    }
  } else if (leaf.type === 'gallery') {
    const chapterRoot = path.join(leafPath, 'chapters');
    const gallery = inspectGallery(chapterRoot);
    failures.push(...gallery.issues.map((issue) => `${leaf.slug}: ${issue}`));
    galleryChapters += gallery.chapters.length;
    imageCount += gallery.chapters.reduce((total, chapter) => total + chapter.images.length, 0);
  } else {
    failures.push(`${leaf.slug}: unsupported note type ${leaf.type}`);
  }

  const attachments = path.join(leafPath, 'attachments');
  if (fs.existsSync(attachments)) {
    const countFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1), 0);
    attachmentCount += countFiles(attachments);
  }
}


if (failures.length) {
  console.error(`Validation failed with ${failures.length} issue(s):\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${leaves.length} note leaves, ${markdownCount} Markdown files, ${galleryChapters} image chapters, ${imageCount} images, and ${attachmentCount} auxiliary files.`);
}

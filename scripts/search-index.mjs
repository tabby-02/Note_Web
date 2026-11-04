import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import * as pagefind from 'pagefind';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';
import { createNoteMarkdownParser, renderNoteMarkdown } from '../src/lib/note-markdown.mjs';
import { inspectGallery } from '../src/lib/gallery.mjs';
import { markdownSearchPassages, wordSearchPassages } from '../src/lib/note-search.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'notes');
const sitePrefix = process.env.GITHUB_PAGES === 'true' ? '/Note_Web' : '';
const urlFor = (url) => `${sitePrefix}${url}`;
const taxonomy = loadTaxonomy(root);
const parser = createNoteMarkdownParser();
const { index, errors } = await pagefind.createIndex({ forceLanguage: 'zh' });
if (!index) throw new Error(`Cannot create Pagefind index: ${errors.join('; ')}`);
let records = 0;
const targets = [];
const clean = (value) => value.replace(/\s+/g, ' ').trim();
const add = async (url, scope, title, text, note = '') => {
  if (!clean(text)) return;
  const result = await index.addCustomRecord({
    url: urlFor(url), content: clean(text), language: 'zh',
    meta: { title }, filters: { scope: [scope], ...(note ? { note: [note] } : {}) },
  });
  if (result.errors.length) throw new Error(result.errors.join('; '));
  targets.push(urlFor(url));
  records++;
};

function visit(nodes, parents = []) {
  return Promise.all(nodes.map(async (node) => {
    const parts = [...parents, node.id];
    const url = `/notes/${parts.join('/')}/`;
    const ancestors = parents.map((id) => taxonomyTitles.get(id)).filter(Boolean);
    await add(url, 'topic', node.title, [...ancestors, node.title].join(' '));
    if (!node.type) return visit(node.children ?? [], parts);
  }));
}
const taxonomyTitles = new Map();
function collectTitles(nodes) {
  for (const node of nodes) { taxonomyTitles.set(node.id, node.title); collectTitles(node.children ?? []); }
}
collectTitles(taxonomy.groups);
await visit(taxonomy.groups);

for (const leaf of flattenLeaves(taxonomy)) {
  const directory = path.join(base, ...leaf.parts);
  const url = `/notes/${leaf.slug}/`;
  if (leaf.type === 'markdown') {
    const markdown = fs.readFileSync(path.join(directory, 'note.md'), 'utf8');
    const $ = cheerio.load(renderNoteMarkdown(markdown, parser), null, false);
    $('script,style,.katex-mathml').remove();
    for (const heading of $('h1,h2,h3,h4,h5,h6').toArray()) {
      const title = clean($(heading).text());
      const id = $(heading).attr('id') ?? '';
      if (title && id) await add(`${url}#${encodeURIComponent(id)}`, 'outline', `${leaf.title} · ${title}`, title, leaf.slug);
    }
    for (const { id, text } of markdownSearchPassages($)) {
      await add(`${url}#${encodeURIComponent(id)}`, 'body', leaf.title, text, leaf.slug);
    }
  } else if (leaf.type === 'docx') {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(directory, 'note.docx')));
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) continue;
    for (const { id, text } of wordSearchPassages(cheerio.load(xml, { xmlMode: true }))) {
      await add(`${url}#${id}`, 'body', leaf.title, text, leaf.slug);
    }
  } else {
    for (const [chapterIndex, chapter] of inspectGallery(path.join(directory, 'chapters')).chapters.entries()) {
      await add(`${url}#gallery-chapter-${chapterIndex}`, 'outline', `${leaf.title} · ${chapter.title}`, chapter.title, leaf.slug);
    }
  }
}

const output = path.join(root, 'public', 'scoped-search');
fs.rmSync(output, { recursive: true, force: true });
fs.rmSync(path.join(root, 'public', 'search-index.json'), { force: true });
const written = await index.writeFiles({ outputPath: output });
if (written.errors.length) throw new Error(written.errors.join('; '));
fs.mkdirSync(path.join(root, '.astro'), { recursive: true });
fs.writeFileSync(path.join(root, '.astro', 'note-search-targets.json'), JSON.stringify(targets));
console.log(`Prepared ${records} scoped Pagefind records for taxonomy, outlines, and note paragraphs.`);

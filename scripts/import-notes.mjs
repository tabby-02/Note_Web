import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import * as cheerio from 'cheerio';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';
import { renderNoteMarkdown } from '../src/lib/note-markdown.mjs';
import { selectMarkdownSections } from './note-sections.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.argv[2] ?? 'H:/github/note');
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif']);
if (!fs.existsSync(sourceRoot)) throw new Error(`Source directory not found: ${sourceRoot}`);

const taxonomy = loadTaxonomy(projectRoot);
const leaves = flattenLeaves(taxonomy);
const primaryPaths = new Set(leaves.filter((leaf) => leaf.sourceFile).map((leaf) => path.resolve(sourceRoot, leaf.sourceDir, leaf.sourceFile)));
const inventory = [];

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

function localFile(noteDir, rawUrl) {
  if (!rawUrl || /^(?:[a-z]+:|\/\/|#)/i.test(rawUrl)) return null;
  let value = rawUrl.trim().split(/[?#]/, 1)[0];
  try { value = decodeURIComponent(value); } catch {}
  value = value.replaceAll('\\', '/');
  value = value.replace(/^\/+/, '').replace(/^\.\//, '');
  const candidates = [path.resolve(noteDir, value), path.resolve(sourceRoot, value)];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function markdownReferences(sourceFile, markdown) {
  const html = renderNoteMarkdown(markdown);
  const $ = cheerio.load(html);
  const result = new Set();
  $('img[src], source[src]').each((_, element) => {
    const resolved = localFile(path.dirname(sourceFile), $(element).attr('src'));
    if (resolved) result.add(path.resolve(resolved));
  });
  return result;
}

function copyFile(source, target, sourceRel) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  inventory.push({ source: sourceRel, target: path.relative(projectRoot, target).replaceAll('\\', '/') });
}

function writeManifest(leaf, destination, mainFile, sourceRel) {
  const manifest = {
    title: leaf.title,
    type: leaf.type,
    mainFile,
    origin: sourceRel,
    ...(leaf.sourceSections ? { sourceSections: leaf.sourceSections } : {}),
  };
  fs.writeFileSync(path.join(destination, 'note.yml'), stringify(manifest), 'utf8');
}

function importMarkdown(leaf, sourceDir, destination) {
  const primary = path.join(sourceDir, leaf.sourceFile);
  if (!fs.existsSync(primary)) throw new Error(`Missing primary Markdown file: ${primary}`);
  const markdown = selectMarkdownSections(fs.readFileSync(primary, 'utf8'), leaf.sourceSections);
  const referenced = markdownReferences(primary, markdown);
  const files = walkFiles(sourceDir).filter((file) => !primaryPaths.has(path.resolve(file)) && path.extname(file).toLowerCase() !== '.md');

  const target = path.join(destination, 'note.md');
  fs.writeFileSync(target, markdown, 'utf8');
  inventory.push({ source: `${leaf.sourceDir}/${leaf.sourceFile}`, target: path.relative(projectRoot, target).replaceAll('\\', '/') });
  for (const file of files) {
    const relative = path.relative(sourceDir, file);
    const isReferenced = referenced.has(path.resolve(file));
    const isMedia = imageExtensions.has(path.extname(file).toLowerCase());
    const folder = isMedia && isReferenced ? 'media' : 'attachments';
    const normalized = relative.replace(/^(?:media|attachments)\//i, '');
    copyFile(file, path.join(destination, folder, normalized), `${leaf.sourceDir}/${relative}`);
  }
  writeManifest(leaf, destination, 'note.md', `${leaf.sourceDir}/${leaf.sourceFile}`);
}

function importGallery(leaf, sourceDir, destination, sourceRel) {
  const files = walkFiles(sourceDir);
  for (const file of files) {
    const relative = path.relative(sourceDir, file);
    if (imageExtensions.has(path.extname(file).toLowerCase())) {
      const chapter = path.dirname(relative) === '.' ? path.join('chapters', '00-总览') : path.join('chapters', path.dirname(relative));
      copyFile(file, path.join(destination, chapter, path.basename(file)), `${leaf.sourceDir}/${relative}`);
    } else {
      copyFile(file, path.join(destination, 'attachments', relative), `${leaf.sourceDir}/${relative}`);
    }
  }
  writeManifest(leaf, destination, '', sourceRel);
}

function importDocx(leaf, sourceDir, destination) {
  const primary = path.join(sourceDir, leaf.sourceFile);
  if (!fs.existsSync(primary)) throw new Error(`Missing primary DOCX file: ${primary}`);
  copyFile(primary, path.join(destination, 'note.docx'), `${leaf.sourceDir}/${leaf.sourceFile}`);
  writeManifest(leaf, destination, 'note.docx', `${leaf.sourceDir}/${leaf.sourceFile}`);
}

const readme = path.join(sourceRoot, 'README.md');
if (fs.existsSync(readme)) copyFile(readme, path.join(projectRoot, 'notes', 'source-index.md'), 'README.md');

for (const leaf of leaves) {
  const destination = path.join(projectRoot, 'notes', ...leaf.parts);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
    throw new Error(`Destination is not empty; refusing to overwrite: ${destination}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  const sourceDir = path.join(sourceRoot, leaf.sourceDir);
  if (leaf.type === 'markdown') importMarkdown(leaf, sourceDir, destination);
  else if (leaf.type === 'gallery') importGallery(leaf, sourceDir, destination, leaf.sourceDir);
  else if (leaf.type === 'docx') importDocx(leaf, sourceDir, destination);
  else throw new Error(`Unknown note type "${leaf.type}" for ${leaf.title}`);
}

const sourceFiles = walkFiles(sourceRoot);
const primarySourceSet = new Set(primaryPaths);
const coveredSources = new Set(inventory.map((item) => path.resolve(sourceRoot, item.source)));
const unassigned = sourceFiles
  .filter((file) => path.resolve(file) !== path.resolve(readme))
  .filter((file) => !coveredSources.has(path.resolve(file)) && !primarySourceSet.has(path.resolve(file)));

const rows = leaves.map((leaf) => {
  const prefix = `notes/${leaf.slug}/`;
  const items = inventory.filter((item) => item.target.startsWith(prefix));
  const media = items.filter((item) => item.target.includes('/media/') || /\/chapters\//.test(item.target));
  const attachments = items.filter((item) => item.target.includes('/attachments/'));
  return `| ${leaf.title} | ${leaf.type} | ${items.length} | ${media.length} | ${attachments.length} |`;
});
const reportText = [
  '# 笔记迁移清单',
  '',
  `源目录：\`${sourceRoot}\`（排除 .git；原目录保持不变）`,
  `纳入源文件：${sourceFiles.length} 个；已映射源文件：${coveredSources.size} 个；生成副本：${inventory.length} 个；未分配：${unassigned.length} 个。`,
  '',
  '| 主题 | 类型 | 文件数 | 正文媒体/图库 | 辅助文件 |',
  '| --- | --- | ---: | ---: | ---: |',
  ...rows,
  '',
  ...(unassigned.length ? ['## 未分配源文件', '', ...unassigned.map((file) => `- \`${path.relative(sourceRoot, file).replaceAll('\\', '/')}\``)] : ['所有非 .git 源文件均已映射。']),
  '',
].join('\n');
fs.writeFileSync(path.join(projectRoot, 'notes', 'migration-report.md'), reportText, 'utf8');
if (unassigned.length) throw new Error(`Migration left ${unassigned.length} source files unassigned. See notes/migration-report.md`);
console.log(`Imported ${inventory.length} files into ${leaves.length} semantic note leaves from ${sourceFiles.length} source files.`);

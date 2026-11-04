import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import * as cheerio from 'cheerio';
import { imageSize } from 'image-size';
import { loadTaxonomy, flattenLeaves, validId, validateTaxonomy } from '../taxonomy.mjs';
import { createNoteMarkdownParser, renderNoteMarkdown, resolveHeadingFragment } from '../../src/lib/note-markdown.mjs';
import { inspectGallery, isGalleryImage } from '../../src/lib/gallery.mjs';

const parser = createNoteMarkdownParser();
const validationParser = createNoteMarkdownParser();
const slash = (value) => value.split(path.sep).join('/');
const samePath = (a, b) => path.resolve(a).toLocaleLowerCase() === path.resolve(b).toLocaleLowerCase();
const relativeInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const unique = () => `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const checkedTitle = (value) => {
  assert(typeof value === 'string' && value.trim() && value.trim().length <= 160 && !/[\r\n\x00-\x1f]/.test(value), '请输入 1–160 字的单行名称');
  return value.trim();
};
const checkedId = (value) => { assert(validId(value) && value.length <= 100, '目录标识请使用字母、数字、中文、连字符或下划线（最多 100 字）'); return value; };
export const suggestedId = (title) => title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'new-note';

function walk(root, relative = '') {
  const output = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (['.git', '.notes-manager'].includes(entry.name)) continue;
    const name = path.posix.join(slash(relative), entry.name);
    assert(!entry.isSymbolicLink(), `不支持符号链接，请先复制实际文件：${name}`);
    if (entry.isDirectory()) output.push(...walk(root, name));
    else if (entry.isFile()) output.push(name);
  }
  return output.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

function locate(taxonomy, slug) {
  const parts = String(slug).split('/');
  assert(parts.length && parts.every(validId), '无效的目录路径');
  let list = taxonomy.groups;
  for (let index = 0; index < parts.length; index++) {
    const node = list.find((item) => item.id === parts[index]);
    assert(node, `目录不存在：${slug}`);
    if (index === parts.length - 1) return { node, list, parent: parts.slice(0, -1).join('/') };
    assert(!node.type, '笔记条目不能作为分类');
    list = node.children;
  }
}
function childrenOf(taxonomy, slug) {
  if (!slug) return taxonomy.groups;
  const { node } = locate(taxonomy, slug);
  assert(!node.type, '请选择知识分类，不能放入另一篇笔记');
  return node.children;
}
function allNodes(taxonomy) {
  const result = [];
  function visit(list, parents = [], names = []) {
    for (const node of list) {
      const parts = [...parents, node.id];
      const titles = [...names, node.title];
      result.push({ node, slug: parts.join('/'), names: titles, parent: parents.join('/') });
      if (!node.type) visit(node.children, parts, titles);
    }
  }
  visit(taxonomy.groups);
  return result;
}
function leafSlugs(node, baseSlug) {
  return allNodes({ groups: [node] })
    .filter(({ node: item }) => item.type)
    .map(({ slug }) => `${baseSlug}${slug.slice(node.id.length)}`);
}
function moveDirectories(moves) {
  const existing = moves.filter(({ source }) => fs.existsSync(source));
  for (const { source, destination } of existing) {
    assert(!fs.existsSync(destination), `目标笔记文件夹已存在：${destination}`);
    assert(relativeInside(path.dirname(destination), destination), '目标笔记文件夹路径无效');
    assert(!existing.some((other) => !samePath(source, other.source) && relativeInside(source, other.source)), '不能同时移动互相包含的笔记文件夹');
  }
  const moved = [];
  try {
    for (const item of existing) {
      fs.mkdirSync(path.dirname(item.destination), { recursive: true });
      fs.renameSync(item.source, item.destination);
      moved.push(item);
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      fs.mkdirSync(path.dirname(item.source), { recursive: true });
      fs.renameSync(item.destination, item.source);
    }
    throw error;
  }
  return moved;
}
function rollbackDirectories(moved) {
  for (const item of [...moved].reverse()) {
    fs.mkdirSync(path.dirname(item.source), { recursive: true });
    fs.renameSync(item.destination, item.source);
  }
}
function pruneEmptyParents(root, directories) {
  const base = path.join(root, 'notes');
  for (const directory of directories) {
    let current = path.dirname(directory);
    while (relativeInside(base, current) && !samePath(base, current)) {
      try { fs.rmdirSync(current); } catch { break; }
      current = path.dirname(current);
    }
  }
}
function verifyTaxonomy(taxonomy) { const issues = validateTaxonomy(taxonomy); assert(!issues.length, issues.join('\n')); }
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, data, 'utf8'); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function writeTaxonomy(root, taxonomy) {
  verifyTaxonomy(taxonomy);
  writeAtomic(path.join(root, 'notes', 'taxonomy.yml'), stringify(taxonomy));
}
function noteDirectory(root, slug) {
  assert(String(slug).split('/').every(validId), '无效的目录路径');
  const base = path.join(root, 'notes');
  const destination = path.resolve(base, ...slug.split('/'));
  assert(relativeInside(base, destination) && !samePath(base, destination), '目录超出笔记范围');
  let current = base;
  for (const segment of slug.split('/')) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), '笔记目录不能是符号链接');
  }
  return destination;
}
function ensureAvailable(root, taxonomy, parent, id, movingNode = null) {
  const siblings = childrenOf(taxonomy, parent);
  assert(!siblings.some((node) => node.id.toLocaleLowerCase() === id.toLocaleLowerCase()), '该分类下已存在相同目录标识，请更换');
  const slug = [parent, id].filter(Boolean).join('/');
  assert(!fs.existsSync(noteDirectory(root, slug)), '目标文件夹已存在，未覆盖任何文件');
  const ownNodes = new Set(movingNode ? allNodes({ groups: [movingNode] }).map(({ node }) => node) : []);
  assert(!allNodes(taxonomy).some(({ node }) => !ownNodes.has(node) && node.legacySlugs?.some((alias) => alias.toLocaleLowerCase() === slug.toLocaleLowerCase())), '该地址用于旧笔记跳转，请更换目录标识');
  return slug;
}

export function listLibrary(root) {
  const taxonomy = loadTaxonomy(root);
  const nodes = allNodes(taxonomy).map(({ node, slug, names, parent }) => ({ id: node.id, title: node.title, type: node.type || 'category', slug, parent, names }));
  const trashRoot = path.join(root, '.notes-manager', 'trash');
  const trash = fs.existsSync(trashRoot) ? fs.readdirSync(trashRoot).flatMap((id) => {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(trashRoot, id, 'entry.json'), 'utf8'));
      return [{ id, title: record.node.title, type: record.node.type || 'category', slug: record.slug, deletedAt: record.deletedAt }];
    } catch { return []; }
  }).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)) : [];
  return { nodes, trash, noteCount: flattenLeaves(taxonomy).length };
}

function sourceFiles(root, input) {
  assert(typeof input === 'string' && path.isAbsolute(input.trim()), '请选择文件夹，或输入完整的绝对路径');
  const source = fs.realpathSync(input.trim());
  assert(fs.statSync(source).isDirectory(), '导入来源必须是文件夹');
  // Avoid importing the manager, generated site, or an entire project by mistake.
  assert(!relativeInside(source, root), '请选择具体的笔记文件夹，不要选择网站项目或其上级目录');
  for (const name of ['.notes-manager', 'public', 'dist', 'node_modules', '.git']) {
    assert(!relativeInside(path.join(root, name), source), '不能从生成目录、回收站或项目内部工具目录导入');
  }
  return { source, files: walk(source) };
}

// Rewrite destinations while preserving the Markdown source, code, formulas and formatting.
export function rewriteReferences(markdown, mapUrl) {
  const lines = markdown.split(/(?<=\n)/);
  for (const token of parser.parse(markdown, {})) {
    if (['fence', 'code_block'].includes(token.type) && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) lines[i] = lines[i].replace(/[^\r\n]/g, ' ');
    }
  }
  let scan = lines.join('');
  for (let index = 0; index < scan.length; index++) {
    if (scan[index] !== '`') continue;
    let length = 1;
    while (scan[index + length] === '`') length++;
    const marker = '`'.repeat(length);
    let end = scan.indexOf(marker, index + length);
    while (end >= 0 && (scan[end - 1] === '`' || scan[end + length] === '`')) end = scan.indexOf(marker, end + length);
    if (end >= 0) {
      const finish = end + length;
      scan = scan.slice(0, index) + scan.slice(index, finish).replace(/[^\r\n]/g, ' ') + scan.slice(finish);
      index = finish - 1;
    } else index += length - 1;
  }
  const escapedAt = (index) => {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && scan[cursor] === '\\'; cursor--) backslashes++;
    return backslashes % 2 === 1;
  };
  const replacements = [];
  for (const pattern of [/!?\[(?:\\.|[^\]\\])*\]\(\s*/g, /^ {0,3}\[(?:\\.|[^\]\\])+\]:[ \t]*/gm]) {
    for (const match of scan.matchAll(pattern)) {
      if (escapedAt(match.index)) continue;
      const start = match.index + match[0].length;
      const destination = parser.helpers.parseLinkDestination(scan, start, scan.length);
      if (!destination.ok) continue;
      const mapped = mapUrl(destination.str);
      if (mapped !== destination.str) replacements.push({ start, end: destination.pos, value: `<${mapped}>` });
    }
  }
  for (const tag of scan.matchAll(/<(?:img|source|a|video|audio|embed|object)\b[^>]*>/gi)) {
    if (escapedAt(tag.index)) continue;
    for (const attr of tag[0].matchAll(/\s(?:src|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const raw = attr[1] ?? attr[2] ?? attr[3];
      const mapped = mapUrl(parser.utils.unescapeAll(raw));
      if (mapped !== raw) {
        const start = tag.index + attr.index + attr[0].indexOf('=') + 1;
        replacements.push({ start, end: tag.index + attr.index + attr[0].length, value: `"${mapped}"` });
      }
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  for (const item of replacements) markdown = markdown.slice(0, item.start) + item.value + markdown.slice(item.end);
  return markdown;
}

export function planImport(root, options) {
  const { source, files } = sourceFiles(root, options.source);
  assert(files.length, '所选文件夹为空');
  const candidates = files.filter((name) => /\.(?:md|markdown|docx)$/i.test(name)).map((name) => ({ file: name, type: /\.docx$/i.test(name) ? 'docx' : 'markdown' }));
  const defaultMain = candidates.find((entry) => /^(?:note|readme|笔记)\.(?:md|docx)$/i.test(entry.file)) || candidates[0];
  const type = options.type || defaultMain?.type || 'gallery';
  assert(['markdown', 'docx', 'gallery'].includes(type), '不支持的笔记类型');
  const mainFile = type === 'gallery' ? '' : options.mainFile || (defaultMain?.type === type ? defaultMain.file : candidates.find((entry) => entry.type === type)?.file);
  assert(type === 'gallery' || candidates.some((entry) => entry.file === mainFile && entry.type === type), '请选择对应类型的主笔记文件');
  const primary = mainFile ? path.join(source, mainFile) : null;
  const referenced = new Set();
  const missing = new Set();
  const externalFiles = new Set();
  const mappings = new Map();
  function mappedFile(file) {
    if (mappings.has(file)) return mappings.get(file);
    let relative;
    if (relativeInside(source, file)) relative = slash(path.relative(source, file));
    else {
      externalFiles.add(file);
      relative = `_linked/${crypto.createHash('sha256').update(file).digest('hex').slice(0, 10)}-${path.basename(file)}`;
    }
    const target = samePath(file, primary || path.join(source, '.unused')) ? 'note.md' : `${isGalleryImage(file) && referenced.has(file) ? 'media' : 'attachments'}/${relative}`;
    mappings.set(file, target);
    return target;
  }
  let markdown = '';
  if (type === 'markdown') {
    const bytes = fs.readFileSync(primary);
    try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('Markdown 不是 UTF-8 编码，请在编辑器中另存为 UTF-8 后导入'); }
    markdown = rewriteReferences(markdown, (raw) => {
      if (!raw || /^(?:#|https?:|data:|mailto:|tel:|\/\/)/i.test(raw)) return raw;
      if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw) && !/^file:/i.test(raw)) return raw;
      const split = raw.search(/[?#]/);
      let local = split < 0 ? raw : raw.slice(0, split);
      const suffix = split < 0 ? '' : raw.slice(split);
      try { local = decodeURIComponent(local); } catch {}
      local = local.replaceAll('\\', '/');
      let resolved;
      if (/^file:/i.test(local)) {
        try { resolved = fileURLToPath(local); } catch { missing.add(raw); return raw; }
      } else {
        const relative = local.replace(/^\/+/, '');
        const candidates = [path.resolve(path.dirname(primary), local), path.resolve(path.dirname(primary), relative), path.resolve(source, relative)];
        resolved = candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
      }
      if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { missing.add(raw); return raw; }
      resolved = fs.realpathSync(resolved);
      assert(!resolved.split(path.sep).some((segment) => ['.git', '.notes-manager'].includes(segment)), '笔记引用了工具或 Git 内部文件，请移除该引用');
      referenced.add(resolved);
      return mappedFile(resolved).split('/').map(encodeURIComponent).join('/') + suffix;
    });
  }
  const copies = [];
  for (const name of files) {
    const file = fs.realpathSync(path.join(source, name));
    if (primary && samePath(file, primary)) continue;
    if (type === 'gallery' && isGalleryImage(name) && !/^attachments\//i.test(name)) {
      const relative = name.replace(/^chapters\//i, '');
      const folder = path.posix.dirname(relative);
      copies.push({ source: file, target: `chapters/${folder === '.' ? '00-总览/' : ''}${relative}` });
    } else copies.push({ source: file, target: mappedFile(file) });
  }
  for (const file of externalFiles) copies.push({ source: file, target: mappedFile(file) });
  const imageCount = type === 'gallery' ? copies.filter((copy) => copy.target.startsWith('chapters/')).length : copies.filter((copy) => copy.target.startsWith('media/')).length;
  if (type === 'gallery' && !imageCount) missing.add('文件夹内没有支持的图片');
  for (const copy of copies.filter((copy) => copy.target.startsWith('media/') || copy.target.startsWith('chapters/'))) {
    try { const size = imageSize(fs.readFileSync(copy.source)); assert(size.width && size.height, '尺寸无效'); }
    catch { missing.add(`图片损坏或无法识别：${copy.target}`); }
  }
  if (type === 'markdown') {
    const $ = cheerio.load(renderNoteMarkdown(markdown, validationParser));
    $('.katex-error').each((_, item) => missing.add(`公式无法渲染：${$(item).text()}`));
    const headings = $('h1,h2,h3,h4,h5,h6').toArray().map((item) => ({ id: $(item).attr('id') || '', text: $(item).text() }));
    $('a[href^="#"]').each((_, item) => {
      const href = $(item).attr('href');
      if (!resolveHeadingFragment(href, headings)) missing.add(`文内链接缺少目标标题：${href}`);
    });
  }
  const summary = {
    source, candidates, type, mainFile, suggestedTitle: mainFile ? path.basename(mainFile, path.extname(mainFile)) : path.basename(source),
    fileCount: files.length, imageCount, attachmentCount: copies.filter((copy) => copy.target.startsWith('attachments/')).length,
    externalFiles: [...externalFiles], missing: [...missing],
    warnings: candidates.length > 1 ? ['文件夹含多个主笔记候选，请确认主文件；其他笔记会保留为辅助文件。'] : [],
  };
  return { summary, source, type, primary, copies, markdown };
}

export function importNote(root, options) {
  const title = checkedTitle(options.title);
  const id = checkedId(options.id || suggestedId(title));
  const taxonomy = loadTaxonomy(root);
  assert(options.parent, '请选择知识分类');
  const slug = ensureAvailable(root, taxonomy, options.parent, id);
  const plan = planImport(root, options);
  assert(!plan.summary.missing.length, `导入前请修复以下问题：\n${plan.summary.missing.join('\n')}`);
  const staging = path.join(root, '.notes-manager', 'staging', unique());
  const destination = noteDirectory(root, slug);
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const copy of plan.copies) {
      const target = path.join(staging, copy.target);
      assert(relativeInside(staging, target), '导入资源路径无效');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(copy.source, target);
    }
    if (plan.type === 'markdown') fs.writeFileSync(path.join(staging, 'note.md'), plan.markdown, 'utf8');
    if (plan.type === 'docx') {
      const bytes = fs.readFileSync(plan.primary);
      assert(bytes.subarray(0, 2).toString() === 'PK', 'Word 文件不是有效的 DOCX 文件');
      fs.copyFileSync(plan.primary, path.join(staging, 'note.docx'));
    }
    if (plan.type === 'gallery') {
      const { issues } = inspectGallery(path.join(staging, 'chapters'));
      assert(!issues.length, issues.join('\n'));
    }
    const mainFile = plan.type === 'markdown' ? 'note.md' : plan.type === 'docx' ? 'note.docx' : '';
    fs.writeFileSync(path.join(staging, 'note.yml'), stringify({ title, type: plan.type, mainFile, origin: plan.primary || plan.source }), 'utf8');
    childrenOf(taxonomy, options.parent).push({ id, title, type: plan.type });
    verifyTaxonomy(taxonomy);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(staging, destination);
    try { writeTaxonomy(root, taxonomy); }
    catch (error) { fs.renameSync(destination, staging); throw error; }
    return { slug, title, ...plan.summary };
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); }
}

export function createCategory(root, options) {
  const taxonomy = loadTaxonomy(root);
  const title = checkedTitle(options.title);
  const id = checkedId(options.id || suggestedId(title));
  const slug = ensureAvailable(root, taxonomy, options.parent || '', id);
  childrenOf(taxonomy, options.parent || '').push({ id, title, children: [] });
  writeTaxonomy(root, taxonomy);
  return { slug, title };
}

export function updateNode(root, options) {
  const taxonomy = loadTaxonomy(root);
  const { node, list, parent } = locate(taxonomy, options.slug);
  const title = checkedTitle(options.title ?? node.title);
  const targetParent = options.parent ?? parent;
  assert(!node.type || targetParent, '笔记必须放在知识分类下');
  assert(targetParent !== options.slug && !targetParent.startsWith(`${options.slug}/`), '不能将分类移入自身或它的子分类');
  childrenOf(taxonomy, targetParent);
  const id = checkedId(options.id || node.id);
  const slug = [targetParent, id].filter(Boolean).join('/');
  assert(slug === options.slug || slug.toLocaleLowerCase() !== options.slug.toLocaleLowerCase(), '目录标识不能只更改大小写');
  const moved = slug !== options.slug;
  const source = noteDirectory(root, options.slug);
  const directoryMoves = moved
    ? (node.type ? [{ oldSlug: options.slug, newSlug: slug }] : leafSlugs(node, options.slug).map((oldSlug) => ({ oldSlug, newSlug: `${slug}${oldSlug.slice(options.slug.length)}` })))
      .map(({ oldSlug, newSlug }) => ({ source: noteDirectory(root, oldSlug), destination: noteDirectory(root, newSlug) }))
    : [];
  if (moved) {
    ensureAvailable(root, taxonomy, targetParent, id, node);
    for (const item of allNodes({ groups: [node] })) {
      const suffix = item.slug.slice(node.id.length);
      item.node.legacySlugs = [...new Set([...(item.node.legacySlugs || []), options.slug + suffix])];
    }
    list.splice(list.indexOf(node), 1);
    childrenOf(taxonomy, targetParent).push(node);
  }
  node.id = id;
  node.title = title;
  const active = new Set(allNodes(taxonomy).map((item) => item.slug.toLocaleLowerCase()));
  for (const item of allNodes(taxonomy)) {
    if (item.node.legacySlugs) item.node.legacySlugs = item.node.legacySlugs.filter((alias) => !active.has(alias.toLocaleLowerCase()));
  }
  verifyTaxonomy(taxonomy);
  let manifestBefore;
  if (node.type) {
    if (fs.existsSync(source)) {
      manifestBefore = fs.readFileSync(path.join(source, 'note.yml'), 'utf8');
      const manifest = parse(manifestBefore); manifest.title = title;
      writeAtomic(path.join(source, 'note.yml'), stringify(manifest));
    }
  }
  let movedFiles = [];
  try {
    if (moved) movedFiles = moveDirectories(directoryMoves);
    writeTaxonomy(root, taxonomy);
    if (moved) pruneEmptyParents(root, movedFiles.map(({ source: oldPath }) => oldPath));
  } catch (error) {
    rollbackDirectories(movedFiles);
    if (manifestBefore) writeAtomic(path.join(source, 'note.yml'), manifestBefore);
    throw error;
  }
  return { slug, title };
}

export function deleteNode(root, options) {
  const taxonomy = loadTaxonomy(root);
  const { node, list, parent } = locate(taxonomy, options.slug);
  const id = unique();
  const directories = (node.type ? [options.slug] : leafSlugs(node, options.slug)).map((slug, index) => ({
    slug,
    source: noteDirectory(root, slug),
    destination: path.join(root, '.notes-manager', 'trash', id, 'files', String(index)),
  }));
  const trash = path.join(root, '.notes-manager', 'trash', id);
  fs.mkdirSync(trash, { recursive: true });
  fs.writeFileSync(path.join(trash, 'entry.json'), JSON.stringify({
    slug: options.slug, parent, node,
    files: directories.map(({ slug }, index) => ({ slug, stored: String(index) })),
    deletedAt: new Date().toISOString(),
  }, null, 2));
  let moved = [];
  try {
    moved = moveDirectories(directories);
    list.splice(list.indexOf(node), 1);
    writeTaxonomy(root, taxonomy);
    pruneEmptyParents(root, moved.map(({ source }) => source));
  } catch (error) {
    rollbackDirectories(moved);
    fs.rmSync(trash, { recursive: true, force: true });
    throw error;
  }
  return { id, title: node.title };
}

export function restoreNode(root, options) {
  assert(/^[\d]+-[a-f\d]+$/.test(options.id), '无效的回收站条目');
  const trash = path.join(root, '.notes-manager', 'trash', options.id);
  const record = JSON.parse(fs.readFileSync(path.join(trash, 'entry.json'), 'utf8'));
  const taxonomy = loadTaxonomy(root);
  const parent = options.parent ?? record.parent;
  const slug = ensureAvailable(root, taxonomy, parent, record.node.id);
  assert(slug === record.slug, '请先恢复原分类，再恢复该笔记');
  childrenOf(taxonomy, parent).push(record.node);
  verifyTaxonomy(taxonomy);
  const directoryMoves = record.files
    ? record.files.map(({ slug: oldSlug, stored }) => ({ source: path.join(trash, 'files', stored), destination: noteDirectory(root, oldSlug) }))
    : [{ source: path.join(trash, 'files'), destination: noteDirectory(root, slug) }];
  let moved = [];
  try {
    moved = moveDirectories(directoryMoves);
    writeTaxonomy(root, taxonomy);
  } catch (error) { rollbackDirectories(moved); throw error; }
  fs.rmSync(trash, { recursive: true, force: true });
  return { slug, title: record.node.title };
}

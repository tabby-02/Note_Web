import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const prefix = process.env.GITHUB_PAGES === 'true' ? '/Note_Web' : '';
const failures = [];
let htmlPages = 0;
let checkedReferences = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function checkUrl(raw, currentFile, origin) {
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw)) return;
  let url;
  try { url = new URL(raw, `${origin}/${path.relative(dist, currentFile).replaceAll('\\', '/')}`); }
  catch { failures.push(`${path.relative(dist, currentFile)}: invalid URL ${raw}`); return; }
  if (url.origin !== origin) return;
  let pathname = url.pathname;
  if (prefix && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    failures.push(`${path.relative(dist, currentFile)}: URL omits the Pages base ${raw}`);
    return;
  }
  if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) pathname = pathname.slice(prefix.length) || '/';
  try { pathname = decodeURIComponent(pathname); }
  catch { failures.push(`${path.relative(dist, currentFile)}: invalid encoded URL ${raw}`); return; }
  const target = path.resolve(dist, `.${pathname}`);
  if (!target.startsWith(`${dist}${path.sep}`) && target !== dist) {
    failures.push(`${path.relative(dist, currentFile)}: URL escapes site output ${raw}`);
    return;
  }
  const candidates = pathname.endsWith('/') ? [path.join(target, 'index.html')] : [target, path.join(target, 'index.html')];
  checkedReferences++;
  if (!candidates.some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())) {
    failures.push(`${path.relative(dist, currentFile)}: missing ${raw}`);
  }
}

const outputFiles = walk(dist);
if (!outputFiles.length) throw new Error('The dist directory is missing or empty.');
const origin = 'https://tabby-02.github.io';
const searchTargets = new Map();
const searchManifest = path.join(root, '.astro', 'note-search-targets.json');
if (!fs.existsSync(searchManifest)) failures.push('Search target validation manifest is missing.');
else for (const target of JSON.parse(fs.readFileSync(searchManifest, 'utf8'))) {
  const url = new URL(target, origin);
  const pathname = decodeURIComponent(url.pathname.slice(prefix.length));
  const targets = searchTargets.get(pathname) ?? [];
  targets.push(decodeURIComponent(url.hash.slice(1)));
  searchTargets.set(pathname, targets);
}
let checkedSearchTargets = 0;
for (const file of outputFiles) {
  if (file.endsWith('.html')) {
    htmlPages++;
    const $ = cheerio.load(fs.readFileSync(file, 'utf8'));
    $('meta[http-equiv="refresh"]').each((_, element) => {
      const target = $(element).attr('content')?.match(/url\s*=\s*(.+)$/i)?.[1];
      if (target) checkUrl(target, file, origin);
    });
    const outlines = $('[data-note-outline]');
    const headings = $('.note-prose :is(h1,h2,h3,h4,h5,h6)[id], [data-gallery-chapter][id]').filter((_, element) => Boolean($(element).attr('id')));
    const pageName = path.relative(dist, file);
    // Runtime reader templates intentionally start empty; their data and anchors
    // are filled from Supabase after navigation.
    if (pageName.startsWith('reader\\') || pageName.startsWith('reader/')) continue;
    const pageUrl = `/${pageName.replaceAll('\\', '/').replace(/index\.html$/, '')}`;
    const targets = searchTargets.get(pageUrl) ?? [];
    const targetIds = new Set($('[id]').toArray().map((element) => $(element).attr('id')));
    $('[data-search-passages]').each((_, element) => {
      for (const passage of JSON.parse($(element).attr('data-search-passages'))) targetIds.add(passage.id);
    });
    for (const id of targets) {
      checkedSearchTargets++;
      if (id && !targetIds.has(id)) failures.push(`${pageName}: search result targets missing anchor ${id}`);
    }
    searchTargets.delete(pageUrl);
    if ($('starlight-toc, mobile-starlight-toc, .right-sidebar-container').length) failures.push(`${pageName}: duplicate native page outline`);
    if (headings.length && outlines.length !== 1) failures.push(`${pageName}: expected one page outline`);
    if (outlines.length) {
      const ids = new Set(headings.toArray().map((element) => $(element).attr('id')));
      const links = outlines.find('.outline-links a');
      if (links.length !== headings.length) failures.push(`${pageName}: outline omits note headings`);
      links.each((_, element) => {
        const id = $(element).attr('href')?.slice(1);
        if (!ids.has(id)) failures.push(`${pageName}: broken outline target ${id}`);
      });
      for (const directory of ['topic', 'outline']) {
        if ($(`[data-directory-toggle="${directory}"]`).length !== 1) failures.push(`${pageName}: missing directory toggle ${directory}`);
        if ($(`[data-directory-resize="${directory}"]`).length !== 1) failures.push(`${pageName}: missing directory resize handle ${directory}`);
      }
      if (
        outlines.find('.outline-links [data-depth="0"]').length === 0 &&
        outlines.find('.outline-links [data-chapter-index]').length === 0
      ) failures.push(`${pageName}: outline tree has no first-level entries`);
    }
    $('.attachment-dock').each((_, element) => {
      const dock = $(element);
      if (dock.find('[data-attachment-dock-toggle][aria-expanded="false"]').length !== 1) failures.push(`${pageName}: attachment drawer is not collapsed by default`);
      if (dock.find('.attachment-rail').attr('inert') === undefined) failures.push(`${pageName}: collapsed attachment drawer remains focusable`);
      if (dock.find('[data-attachment-folder]').length !== dock.find('[data-folder-path]').length) failures.push(`${pageName}: attachment directory tree has incomplete folder rows`);
      dock.find('[data-attachment-folder]').each((_, folder) => {
        const depth = ($(folder).attr('data-folder-path') ?? '').split('/').length;
        if (($(folder).attr('open') !== undefined) !== (depth === 1)) failures.push(`${pageName}: attachment folder default expansion exceeds the first level`);
      });
    });
    $('[data-image-gallery]').each((_, element) => {
      const gallery = $(element);
      const total = Number(gallery.attr('data-gallery-total'));
      if (gallery.find('[data-gallery-page] img').length !== total) failures.push(`${pageName}: gallery does not render every page in the continuous reader`);
      gallery.find('[data-gallery-page] img').each((_, img) => {
        if (!$(img).attr('width') || !$(img).attr('height')) failures.push(`${pageName}: gallery page omits intrinsic dimensions`);
      });
    });
    if ($('[data-attachment-list]').length && $('[data-attachment-dialog]').length !== 1) failures.push(`${pageName}: missing attachment preview dialog`);
    $('.attachment-rail a:not([download])').each(() => failures.push(`${pageName}: attachment opens as page navigation instead of a preview`));
    $('.note-prose img[src]').each((_, element) => {
      const img = $(element);
      if (img.attr('src')?.startsWith(`${prefix}/library/`) && !img.attr('style')?.includes('aspect-ratio:')) {
        failures.push(`${pageName}: note image has no reserved aspect ratio ${img.attr('src')}`);
      }
    });
    $('[href], [src]').each((_, element) => {
      for (const attr of ['href', 'src']) {
        const value = $(element).attr(attr);
        if (value) checkUrl(value, file, origin);
      }
      const srcset = $(element).attr('srcset');
      if (srcset) for (const candidate of srcset.split(',')) checkUrl(candidate.trim().split(/\s+/, 1)[0], file, origin);
    });
  } else if (file.endsWith('.css')) {
    const css = fs.readFileSync(file, 'utf8');
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const value = match[1].trim();
      if (/^(?:data:|https?:|\/\/|#)/i.test(value)) continue;
      let cssPath = value.split(/[?#]/, 1)[0];
      if (prefix && (cssPath === prefix || cssPath.startsWith(`${prefix}/`))) cssPath = cssPath.slice(prefix.length) || '/';
      const resolved = cssPath.startsWith('/')
        ? path.resolve(dist, `.${cssPath}`)
        : path.resolve(path.dirname(file), cssPath);
      checkedReferences++;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) failures.push(`${path.relative(dist, file)}: missing CSS asset ${value}`);
    }
  }
}

for (const pageUrl of searchTargets.keys()) failures.push(`Search results target missing page ${pageUrl}`);
if (!fs.existsSync(path.join(dist, 'pagefind', 'pagefind.js'))) failures.push('Pagefind search index is missing.');
if (!fs.existsSync(path.join(dist, 'scoped-search', 'pagefind.js'))) failures.push('Scoped Pagefind search index is missing.');
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  if (!walk(path.join(dist, 'pdfjs', folder)).length) failures.push(`PDF preview runtime resources are missing: ${folder}`);
}
if (!outputFiles.some((file) => /pdf\.worker.*\.mjs$/.test(file))) failures.push('PDF preview worker is missing.');
for (const leaf of flattenLeaves(loadTaxonomy(root))) {
  if (!fs.existsSync(path.join(dist, 'notes', ...leaf.parts, 'index.html'))) failures.push(`Missing note page: ${leaf.slug}`);
}
if (!htmlPages) failures.push('No HTML pages were generated.');
if (failures.length) {
  const shown = failures.slice(0, 30);
  const remaining = failures.length - shown.length;
  console.error(`Site validation failed with ${failures.length} issue(s):\n- ${shown.join('\n- ')}${remaining ? `\n- … ${remaining} more` : ''}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${htmlPages} HTML pages, ${checkedReferences} local asset/navigation references and ${checkedSearchTargets} search targets${prefix || ' at the site root'}.`);
}

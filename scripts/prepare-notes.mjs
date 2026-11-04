import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';
import { stringify } from 'yaml';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(root, 'src', 'content', 'docs');
const publicRoot = path.join(root, 'public', 'library');
const taxonomy = loadTaxonomy(root);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyTree(source, destination) {
  if (!fs.existsSync(source)) return;
  ensureDir(path.dirname(destination));
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function writePage(parts, source) {
  const dir = path.join(docsRoot, 'notes', ...parts);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.mdx'), source, 'utf8');
}

function visit(nodes, parents = []) {
  for (const node of nodes) {
    const parts = [...parents, node.id];
    const leafPath = path.join(root, 'notes', ...parts);
    if (node.type) {
      const manifestPath = path.join(leafPath, 'note.yml');
      if (!fs.existsSync(manifestPath)) throw new Error(`Missing note manifest: ${manifestPath}`);
      const component = node.type === 'markdown' ? 'MarkdownNote' : node.type === 'gallery' ? 'ImageGallery' : 'WordNote';
      const page = `---\n${stringify({ title: node.title, description: node.title })}---\n\nimport ${component} from '@/components/${component}.astro';\n\n<${component} leafPath={${JSON.stringify(parts.join('/'))}} />\n`;
      writePage(parts, page);
      copyTree(path.join(leafPath, 'media'), path.join(publicRoot, ...parts, 'media'));
      copyTree(path.join(leafPath, 'attachments'), path.join(publicRoot, ...parts, 'attachments'));
      continue;
    }

    const groupPage = `---\n${stringify({ title: node.title, description: `${node.title} 笔记目录` })}---\n\nimport GroupOverview from '@/components/GroupOverview.astro';\n\n<GroupOverview groupPath={${JSON.stringify(parts.join('/'))}} />\n`;
    writePage(parts, groupPage);
    visit(node.children ?? [], parts);
  }
}

fs.rmSync(path.join(docsRoot, 'notes'), { recursive: true, force: true });
fs.rmSync(publicRoot, { recursive: true, force: true });
ensureDir(docsRoot);
ensureDir(publicRoot);
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  copyTree(path.join(root, 'node_modules', 'pdfjs-dist', folder), path.join(root, 'public', 'pdfjs', folder));
}

visit(taxonomy.groups ?? []);
const leaves = flattenLeaves(taxonomy);
for (const leaf of leaves) {
  const leafPath = path.join(root, 'notes', ...leaf.parts);
  const publicLeaf = path.join(publicRoot, ...leaf.parts);
  if (leaf.type === 'docx') copyTree(path.join(leafPath, 'note.docx'), path.join(publicLeaf, 'note.docx'));
  else if (leaf.type === 'markdown') copyTree(path.join(leafPath, 'note.md'), path.join(publicLeaf, 'note.md'));
  else if (leaf.type === 'gallery') copyTree(path.join(leafPath, 'chapters'), path.join(publicLeaf, 'chapters'));
}

const home = `---\ntitle: 个人学习笔记\ndescription: 按知识主题整理的个人学习笔记\n---\n\nimport LibraryHome from '@/components/LibraryHome.astro';\n\n<LibraryHome />\n`;
fs.writeFileSync(path.join(docsRoot, 'index.mdx'), home, 'utf8');
execFileSync(process.execPath, [path.join(root, 'scripts', 'search-index.mjs')], { cwd: root, stdio: 'inherit' });
console.log(`Prepared ${leaves.length} note pages from the semantic taxonomy.`);

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { createClient } from '@supabase/supabase-js';
import { markdownPassages } from '../supabase/functions/_shared/markdown.mjs';
import { wordSearchPassages as extractWordPassages } from '../supabase/functions/_shared/word.mjs';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
if (process.version.split('.')[0].slice(1) >= 24) {
  for (const file of ['.env.local', '.env.import.local']) {
    const absolute = path.join(root, file);
    if (fs.existsSync(absolute)) process.loadEnvFile(absolute);
  }
}
const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!url || !key)) throw new Error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ignored local env files.');
const db = !dryRun ? createClient(url, key, { auth: { persistSession: false } }) : null;
const mimeTypes = new Map([
  ['.avif','image/avif'],['.gif','image/gif'],['.jpeg','image/jpeg'],['.jpg','image/jpeg'],['.png','image/png'],['.webp','image/webp'],['.svg','image/svg+xml'],
  ['.pdf','application/pdf'],['.txt','text/plain'],['.csv','text/csv'],['.json','application/json'],['.xml','application/xml'],['.zip','application/zip'],
  ['.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['.doc','application/msword'],
  ['.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],['.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);
const inventory = [];
const groups = loadTaxonomy(root).groups;
const leaves = flattenLeaves({ groups });
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function walk(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${absolute}`);
    return entry.isDirectory() ? walk(absolute, relative) : [{ absolute, relative }];
  });
}

function quoteId(node) { return node.id; }

async function insertRows(table, rows, size = 100) {
  for (let offset = 0; offset < rows.length; offset += size) {
    const { error } = await db.from(table).insert(rows.slice(offset, offset + size));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function addNode(node, parentId = null, position = 0, parentParts = []) {
  const parts = [...parentParts, node.id];
  if (!dryRun) await insertRows('taxonomy_nodes', [{
    id: quoteId(node), parent_id: parentId, title: node.title, slug: node.id,
    kind: node.type ? 'note' : 'group', note_type: node.type ?? null, position,
    legacy_slugs_json: node.legacySlugs ?? [], source_json: { legacySlugs: node.legacySlugs ?? [] },
  }]);
  if (!node.type) {
    for (const [index, child] of (node.children ?? []).entries()) await addNode(child, node.id, index, parts);
    return;
  }

  const leafRoot = path.join(root, 'notes', ...parts);
  const manifest = parse(fs.readFileSync(path.join(leafRoot, 'note.yml'), 'utf8'));
  const versionId = randomUUID();
  const source = node.type === 'markdown' ? { absolute: path.join(leafRoot, 'note.md'), relative: 'note.md', role: 'source' } : null;
  const docx = node.type === 'docx' ? { absolute: path.join(leafRoot, 'note.docx'), relative: 'note.docx', role: 'docx' } : null;
  const assets = [...walk(path.join(leafRoot, 'media')).map((file) => ({ ...file, relative: `media/${file.relative}`, role: 'media' })),
    ...walk(path.join(leafRoot, 'attachments')).map((file) => ({ ...file, relative: `attachments/${file.relative}`, role: path.extname(file.relative).toLowerCase() === '.pdf' ? 'pdf' : 'attachment' })),
    ...walk(path.join(leafRoot, 'chapters')).map((file) => ({ ...file, relative: `chapters/${file.relative}`, role: 'gallery-image' }))];
  if (source) assets.unshift(source);
  if (docx) assets.unshift(docx);
  if (!assets.length) throw new Error(`No source files found for ${node.slug}`);

  const prepared = assets.map((asset) => {
    const ext = path.extname(asset.relative).toLowerCase();
    const mime = asset.role === 'source' ? 'text/markdown; charset=utf-8' : mimeTypes.get(ext) ?? 'application/octet-stream';
    // Storage keys are ASCII-only; keep the original relative path in metadata and
    // derive a collision-resistant object name from it for Unicode/space-heavy folders.
    const objectKey = `assets/${encodeURIComponent(node.id)}/${versionId}/${createHash('sha256').update(asset.relative).digest('hex')}${ext}`;
    const bytes = fs.readFileSync(asset.absolute);
    return { ...asset, bytes, mime, objectKey, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const totalBytes = prepared.reduce((sum, file) => sum + file.bytes.length, 0);
  inventory.push({ note: parts.join('/'), title: node.title, type: node.type, files: prepared.length, bytes: totalBytes });
  if (dryRun) {
    console.log(`${node.type.padEnd(8)} ${String(prepared.length).padStart(3)} files ${(totalBytes / 1024 / 1024).toFixed(1).padStart(6)} MB  ${parts.join('/')}`);
    return;
  }

  const markdown = source ? fs.readFileSync(source.absolute, 'utf8') : null;
  await insertRows('note_versions', [{ id: versionId, note_id: node.id, version: 1, status: 'staging',
    manifest_json: { ...manifest, title: node.title, type: node.type }, created_by: 'migration',
    markdown_object_key: source ? prepared.find((file) => file.role === 'source').objectKey : null,
    docx_object_key: docx ? prepared.find((file) => file.role === 'docx').objectKey : null,
    base_version_id: null, upload_mode: 'folder', expected_files_json: prepared.map(({ relative, bytes }) => ({ path: relative, size: bytes.length })) }]);
  const publishedAssets = [];
  for (let index = 0; index < prepared.length; index++) {
    const file = prepared[index];
    let uploadError = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const result = await db.storage.from('note-assets').upload(file.objectKey, file.bytes, { contentType: file.mime, upsert: true });
      uploadError = result.error;
      if (!uploadError) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
    if (uploadError) throw new Error(`${parts.join('/')}/${file.relative}: ${uploadError.message ?? 'Storage upload failed'}`);
    publishedAssets.push({ id: randomUUID(), note_id: node.id, version_id: versionId, relative_path: file.relative,
      object_key: file.objectKey, role: file.role, mime_type: file.mime, size_bytes: file.bytes.length, sha256: file.sha256 });
    if ((index + 1) % 50 === 0 || index + 1 === prepared.length) console.log(`  ${parts.join('/')}: ${index + 1}/${prepared.length} uploaded`);
  }
  await insertRows('note_assets', publishedAssets, 100);

  const passages = [{ note_id: node.id, version_id: versionId, scope: 'topic', anchor: node.id, title: node.title, content: node.title }];
  if (markdown) passages.push(...markdownPassages(markdown).map((passage) => ({ note_id: node.id, version_id: versionId, ...passage })));
  else if (docx) {
    const word = await extractWordPassages(new Uint8Array(prepared.find((file) => file.role === 'docx').bytes));
    passages.push(...word.map((passage) => ({ note_id: node.id, version_id: versionId, scope: 'body', anchor: passage.id, title: 'Word 正文', content: passage.text })));
  } else {
    const chapters = [...new Set(publishedAssets.filter((asset) => asset.role === 'gallery-image').map((asset) => {
      const relative = asset.relative_path.replace(/^chapters\//, '');
      return relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
    }))].sort(collator.compare);
    chapters.forEach((chapter, index) => {
      const title = chapter ? chapter.split('/').map((part) => part.replace(/^\d+[-.、\s]*/, '') || part).join(' / ') : '总览';
      passages.push({ note_id: node.id, version_id: versionId, scope: 'outline', anchor: `gallery-chapter-${index}`, title, content: title });
    });
  }
  await insertRows('search_passages', passages, 200);
  const { error: publishError } = await db.rpc('publish_note_version', { p_note_id: node.id, p_operation_id: versionId });
  if (publishError) throw new Error(`${node.slug}: ${publishError.message}`);
}

if (!dryRun) {
  const { count, error } = await db.from('taxonomy_nodes').select('id', { count: 'exact', head: true });
  if (error) throw error;
  if (count !== 0) throw new Error(`Supabase already contains ${count} taxonomy nodes; import stopped without changes.`);
  const { data: bucket, error: bucketError } = await db.storage.getBucket('note-assets');
  if (bucketError || !bucket) throw new Error('The private note-assets Storage bucket is unavailable. Apply the SQL migration first.');
}
for (const [index, group] of groups.entries()) await addNode(group, null, index);
console.log(`Prepared ${leaves.length} leaves, ${inventory.reduce((n, note) => n + note.files, 0)} files, ${(inventory.reduce((n, note) => n + note.bytes, 0) / 1024 / 1024).toFixed(1)} MB.`);
if (dryRun) console.log('Dry run only; Supabase was not changed.');
else console.log('Initial import complete. All published versions are live.');

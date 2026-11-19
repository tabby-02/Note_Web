import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { createClient } from '@supabase/supabase-js';
import { markdownPassages, validateMarkdownImageAssets } from '../supabase/functions/_shared/markdown.mjs';
import { wordSearchPassages } from '../supabase/functions/_shared/word.mjs';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishEnabled = process.argv.includes('--publish');
if (process.version.split('.')[0].slice(1) >= 24) {
  for (const file of ['.env.local', '.env.import.local']) {
    const absolute = path.join(root, file);
    if (fs.existsSync(absolute)) process.loadEnvFile(absolute);
  }
}

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ignored local env files.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const leaves = flattenLeaves(loadTaxonomy(root));
const leafById = new Map(leaves.map((leaf) => [leaf.id, leaf]));
const mimeTypes = new Map([
  ['.avif','image/avif'],['.gif','image/gif'],['.jpeg','image/jpeg'],['.jpg','image/jpeg'],['.png','image/png'],['.webp','image/webp'],['.svg','image/svg+xml'],
  ['.pdf','application/pdf'],['.txt','text/plain'],['.csv','text/csv'],['.json','application/json'],['.xml','application/xml'],['.zip','application/zip'],
  ['.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['.doc','application/msword'],
  ['.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],['.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

function walk(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${absolute}`);
    return entry.isDirectory() ? walk(absolute, relative) : [{ absolute, relative }];
  });
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function localAssets(leaf) {
  const folder = path.join(root, 'notes', ...leaf.parts);
  const mainPath = leaf.type === 'markdown' ? 'note.md' : leaf.type === 'docx' ? 'note.docx' : null;
  const files = mainPath ? [{ absolute: path.join(folder, mainPath), relative: mainPath }] : [];
  if (mainPath && !fs.existsSync(files[0].absolute)) throw new Error(`${leaf.id}: missing ${mainPath}`);
  for (const [dir, prefix] of [['media','media'],['attachments','attachments'],['chapters','chapters']]) {
    files.push(...walk(path.join(folder, dir)).map((file) => ({ ...file, relative: `${prefix}/${file.relative}` })));
  }
  return files.map((file) => {
    const bytes = fs.readFileSync(file.absolute);
    const extension = path.extname(file.relative).toLowerCase();
    const role = file.relative === 'note.md' ? 'source' : file.relative === 'note.docx' ? 'docx'
      : file.relative.startsWith('chapters/') ? 'gallery-image' : file.relative.startsWith('media/') ? 'media'
        : extension === '.pdf' ? 'pdf' : 'attachment';
    const mime = role === 'source' ? 'text/markdown; charset=utf-8' : mimeTypes.get(extension) ?? 'application/octet-stream';
    return { ...file, bytes, role, mime, sha256: digest(bytes), size: bytes.length };
  });
}

async function loadCloud() {
  const [{ data: nodes, error: nodeError }, { data: versions, error: versionError }] = await Promise.all([
    db.from('taxonomy_nodes').select('id,parent_id,title,slug,kind,note_type,position,deleted_at').order('id'),
    db.from('note_versions').select('id,note_id,version,status').eq('status', 'published'),
  ]);
  if (nodeError) throw new Error(`taxonomy_nodes: ${nodeError.message}`);
  if (versionError) throw new Error(`note_versions: ${versionError.message}`);
  const ids = (versions ?? []).map((version) => version.id);
  const { data: assets, error: assetError } = ids.length
    ? await db.from('note_assets').select('note_id,version_id,relative_path,size_bytes,sha256').in('version_id', ids).order('relative_path')
    : { data: [], error: null };
  if (assetError) throw new Error(`note_assets: ${assetError.message}`);
  const byNote = new Map((versions ?? []).map((version) => [version.note_id, version]));
  const assetsByNote = new Map();
  for (const asset of assets ?? []) {
    if (!assetsByNote.has(asset.note_id)) assetsByNote.set(asset.note_id, new Map());
    assetsByNote.get(asset.note_id).set(asset.relative_path, { sha256: asset.sha256, size: Number(asset.size_bytes) });
  }
  return { nodes: nodes ?? [], byNote, assetsByNote };
}

function verifyOnlyPathChanges(cloud) {
  const liveNodes = new Map(cloud.nodes.filter((node) => !node.deleted_at).map((node) => [node.id, node]));
  for (const leaf of leaves) {
    const node = liveNodes.get(leaf.id);
    if (!node || node.kind !== 'note' || node.note_type !== leaf.type || node.title !== leaf.title) {
      throw new Error(`Taxonomy changed for ${leaf.id}; refusing content-only synchronization.`);
    }
  }
  const drift = [];
  for (const leaf of leaves) {
    const version = cloud.byNote.get(leaf.id);
    if (!version) throw new Error(`Cloud note is missing: ${leaf.id}; this command never creates or restores notes.`);
    const files = localAssets(leaf);
    const localMap = new Map(files.map((file) => [file.relative, { sha256: file.sha256, size: file.size }]));
    const remoteMap = cloud.assetsByNote.get(leaf.id) ?? new Map();
    const changed = [...localMap].filter(([relative, value]) => remoteMap.has(relative)
      && (remoteMap.get(relative).sha256 !== value.sha256 || remoteMap.get(relative).size !== value.size));
    if (changed.length) throw new Error(`Same-path content changed for ${leaf.id}; refusing to overwrite: ${changed.map(([relative]) => relative).join(', ')}`);
    const added = [...localMap.keys()].filter((relative) => !remoteMap.has(relative));
    const removed = [...remoteMap.keys()].filter((relative) => !localMap.has(relative));
    if (added.length || removed.length) drift.push({ leaf, version: version.version, files, added, removed });
  }
  return drift;
}

async function publish(entry) {
  const { leaf, version, files } = entry;
  const main = files.find((file) => file.relative === 'note.md');
  if (leaf.type === 'markdown') {
    if (!main) throw new Error(`${leaf.id}: missing Markdown main file`);
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(main.bytes);
    const issues = validateMarkdownImageAssets(markdown, files.filter((file) => file.role === 'media').map((file) => file.relative));
    if (issues.length) throw new Error(`${leaf.id}: ${issues.join('; ')}`);
  }
  const docx = files.find((file) => file.relative === 'note.docx');
  if (docx && leaf.type !== 'docx') throw new Error(`${leaf.id}: unexpected Word main file`);
  if (!files.length) throw new Error(`${leaf.id}: refusing an empty folder upload`);

  const operationId = randomUUID();
  const { data: started, error: startError } = await db.rpc('start_note_upload', {
    p_note_id: leaf.id, p_expected_version: version, p_mode: 'folder', p_operation_id: operationId,
    p_files: files.map(({ relative, size }) => ({ path: relative, size })),
  });
  if (startError) throw new Error(`${leaf.id}: could not stage v${version}: ${startError.message}`);
  const rows = [];
  for (const [index, file] of files.entries()) {
    const extension = path.extname(file.relative).toLowerCase();
    const objectKey = `assets/${encodeURIComponent(leaf.id)}/${operationId}/${createHash('sha256').update(file.relative).digest('hex')}${extension}`;
    const { error: uploadError } = await db.storage.from('note-assets').upload(objectKey, file.bytes, { contentType: file.mime, upsert: false });
    if (uploadError) throw new Error(`${leaf.id}/${file.relative}: storage upload failed: ${uploadError.message}`);
    rows.push({ note_id: leaf.id, version_id: operationId, relative_path: file.relative, object_key: objectKey,
      role: file.role, mime_type: file.mime, size_bytes: file.size, sha256: file.sha256 });
    if ((index + 1) % 50 === 0 || index + 1 === files.length) console.log(`${leaf.id}: uploaded ${index + 1}/${files.length}`);
  }
  for (let offset = 0; offset < rows.length; offset += 100) {
    const { error } = await db.from('note_assets').insert(rows.slice(offset, offset + 100));
    if (error) throw new Error(`${leaf.id}: asset manifest registration failed: ${error.message}`);
  }
  const indexedPassages = [];
  if (main) {
    const { error } = await db.from('note_versions').update({ markdown_object_key: rows.find((row) => row.relative_path === 'note.md').object_key }).eq('id', operationId);
    if (error) throw new Error(`${leaf.id}: Markdown source registration failed: ${error.message}`);
    indexedPassages.push(...markdownPassages(new TextDecoder('utf-8', { fatal: true }).decode(main.bytes)));
  }
  if (docx) {
    const { error } = await db.from('note_versions').update({ docx_object_key: rows.find((row) => row.relative_path === 'note.docx').object_key }).eq('id', operationId);
    if (error) throw new Error(`${leaf.id}: Word source registration failed: ${error.message}`);
    indexedPassages.push(...(await wordSearchPassages(docx.bytes)).map((passage) => ({ scope: 'body', anchor: passage.id, title: 'Word 正文', content: passage.text })));
  }
  if (leaf.type === 'gallery') {
    const folders = new Set(files.filter((file) => file.role === 'gallery-image').map((file) => {
      const relative = file.relative.replace(/^chapters\//, '');
      return relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
    }));
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    indexedPassages.push(...[...folders].sort(collator.compare).map((folder, index) => {
      const title = folder ? folder.split('/').map((part) => part.replace(/^\d+[-.、\s]*/, '') || part).join(' / ') : '总览';
      return { scope: 'outline', anchor: `gallery-chapter-${index}`, title, content: title };
    }));
  }
  const passages = indexedPassages.map((passage) => ({ note_id: leaf.id, version_id: operationId, ...passage }));
  for (let offset = 0; offset < passages.length; offset += 200) {
    const { error: passageError } = await db.from('search_passages').insert(passages.slice(offset, offset + 200));
    if (passageError) throw new Error(`${leaf.id}: search index creation failed: ${passageError.message}`);
  }
  const { data: published, error: publishError } = await db.rpc('publish_note_version', { p_note_id: leaf.id, p_operation_id: operationId });
  if (publishError) throw new Error(`${leaf.id}: publish failed: ${publishError.message}`);
  console.log(`${leaf.id}: published v${published} (${files.length} files; removed ${entry.removed.length} old paths)`);
}

const cloud = await loadCloud();
const entries = verifyOnlyPathChanges(cloud);
if (!entries.length) {
  console.log('Local resources already match Supabase; no changes published.');
} else {
  console.log(`Publishing ${entries.length} notes after verifying all shared paths are byte-identical:`);
  for (const entry of entries) console.log(`  ${entry.leaf.title}: v${entry.version} -> ${entry.version + 1}; +${entry.added.length} / -${entry.removed.length}`);
  if (!publishEnabled) {
    console.log('Preflight only; add --publish to stage and publish these complete local resource manifests.');
  } else {
    for (const entry of entries) await publish(entry);
    console.log('All selected notes were published. Run npm run supabase:sync:review to verify the result.');
  }
}

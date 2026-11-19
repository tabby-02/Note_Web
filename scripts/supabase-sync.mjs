import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { createClient } from '@supabase/supabase-js';
import { flattenLeaves, loadTaxonomy } from './taxonomy.mjs';
import { compareFiles, commonBaseline, noteStatus, compareTaxonomy } from './sync-model.mjs';
import { renderSyncReport } from './sync-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const snapshotMode = args.has('--snapshot');
const jsonMode = args.has('--json');
const reviewMode = args.has('--review');
const failOnDrift = args.has('--fail-on-drift');
const baselinePath = path.join(root, '.supabase-sync-baseline.json');

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

function walk(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${absolute}`);
    return entry.isDirectory() ? walk(absolute, relative) : [{ absolute, relative }];
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function localFiles(leaf) {
  const leafRoot = path.join(root, 'notes', ...leaf.parts);
  const files = [];
  const main = leaf.type === 'markdown' ? 'note.md' : leaf.type === 'docx' ? 'note.docx' : null;
  if (main) {
    const absolute = path.join(leafRoot, main);
    if (!fs.existsSync(absolute)) throw new Error(`${leaf.slug}: missing ${main}`);
    files.push({ absolute, relative: main });
  }
  for (const [directory, prefix] of [['media', 'media'], ['attachments', 'attachments'], ['chapters', 'chapters']]) {
    files.push(...walk(path.join(leafRoot, directory)).map((file) => ({ ...file, relative: `${prefix}/${file.relative}` })));
  }
  return new Map(files.map((file) => {
    const bytes = fs.readFileSync(file.absolute);
    return [file.relative, { sha256: sha256(bytes), size: bytes.length, absolute: file.absolute }];
  }));
}

function taxonomyNodes(nodes, parentId = null, parentPath = []) {
  return (nodes ?? []).flatMap((node, position) => {
    const parts = [...parentPath, node.id];
    const current = [{ id: node.id, parentId, kind: node.type ? 'note' : 'group', type: node.type ?? null, title: node.title, path: parts.join('/'), slug: node.id, position }];
    return [...current, ...taxonomyNodes(node.children, node.id, parts)];
  });
}

function cloudPath(id, byId) {
  const parts = [];
  const seen = new Set();
  let node = byId.get(id);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    parts.unshift(node.slug);
    node = node.parent_id ? byId.get(node.parent_id) : null;
  }
  return parts.join('/');
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null;
  try { return JSON.parse(fs.readFileSync(baselinePath, 'utf8')); }
  catch { throw new Error(`${baselinePath} is not valid JSON; remove it or repair it before checking.`); }
}

async function loadCloud() {
  const [{ data: nodes, error: nodeError }, { data: versions, error: versionError }] = await Promise.all([
    db.from('taxonomy_nodes').select('id,parent_id,title,slug,kind,note_type,position,deleted_at').order('id'),
    db.from('note_versions').select('id,note_id,version,status,manifest_json,created_at').eq('status', 'published'),
  ]);
  if (nodeError) throw new Error(`taxonomy_nodes: ${nodeError.message}`);
  if (versionError) throw new Error(`note_versions: ${versionError.message}`);
  const activeVersions = versions ?? [];
  const versionIds = activeVersions.map((version) => version.id);
  let assets = [];
  if (versionIds.length) {
    const { data, error } = await db.from('note_assets')
      .select('note_id,version_id,relative_path,object_key,role,mime_type,size_bytes,sha256')
      .in('version_id', versionIds).order('relative_path');
    if (error) throw new Error(`note_assets: ${error.message}`);
    assets = data ?? [];
  }
  const byId = new Map((nodes ?? []).map((node) => [node.id, node]));
  const versionByNote = new Map(activeVersions.map((version) => [version.note_id, version]));
  const assetsByNote = new Map();
  for (const asset of assets) {
    if (!assetsByNote.has(asset.note_id)) assetsByNote.set(asset.note_id, []);
    assetsByNote.get(asset.note_id).push(asset);
  }
  return { nodes: nodes ?? [], byId, versionByNote, assetsByNote };
}

function localState(taxonomy) {
  const leaves = flattenLeaves(taxonomy);
  const nodes = taxonomyNodes(taxonomy.groups);
  const filesByNote = new Map(leaves.map((leaf) => [leaf.id, localFiles(leaf)]));
  return { leaves, nodes, filesByNote };
}

function cloudAssetMap(assets) {
  return Object.fromEntries((assets ?? []).map((asset) => [asset.relative_path, {
    sha256: asset.sha256,
    size: Number(asset.size_bytes),
    objectKey: asset.object_key,
    mimeType: asset.mime_type,
  }]));
}

function compare(local, cloud, baseline) {
  const entries = [];
  const localById = new Map(local.leaves.map((leaf) => [leaf.id, leaf]));
  const active = cloud.nodes.filter((node) => node.kind === 'note' && !node.deleted_at);
  const ids = new Set([...localById.keys(), ...active.map((node) => node.id)]);
  for (const id of ids) {
    const leaf = localById.get(id), node = cloud.byId.get(id), version = cloud.versionByNote.get(id);
    const localMap = Object.fromEntries(local.filesByNote.get(id) ?? []);
    const remoteMap = cloudAssetMap(cloud.assetsByNote.get(id));
    // Legacy snapshots only captured the cloud; they are not proof of a common ancestor.
    const base = baseline?.schemaVersion === 2 ? baseline.notes?.[id] : undefined;
    const files = compareFiles(localMap, remoteMap, base);
    const status = node?.deleted_at ? 'cloud-deleted' : !leaf ? 'cloud-only' : !version ? 'local-only' : noteStatus(files);
    entries.push({ id, title: leaf?.title ?? node?.title, path: leaf?.slug ?? cloudPath(id, cloud.byId), status,
      version: version?.version ?? null, baselineVersion: base?.version ?? null,
      localFiles: Object.keys(localMap).length, cloudFiles: Object.keys(remoteMap).length,
      files: files.filter((file) => file.status !== 'equal'),
      missingInCloud: files.filter((f) => f.difference === 'local-only').map((f) => f.path),
      missingLocally: files.filter((f) => f.difference === 'cloud-only').map((f) => f.path),
      changed: files.filter((f) => f.difference === 'modified').map((f) => f.path) });
  }
  return entries;
}

function baselineFrom(local, cloud, previous) {
  const notes = {};
  for (const [noteId, version] of cloud.versionByNote) {
    const localMap = Object.fromEntries(local.filesByNote.get(noteId) ?? []);
    const old = previous?.schemaVersion === 2 ? previous.notes?.[noteId] : undefined;
    notes[noteId] = { version: version.version, ...commonBaseline(localMap, cloudAssetMap(cloud.assetsByNote.get(noteId)), old) };
  }
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), notes };
}

function safeDestination(parent, relative) {
  if (!relative || relative.includes('\\') || relative.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Unsafe snapshot path');
  const destination = path.resolve(parent, ...relative.split('/'));
  if (!destination.startsWith(`${path.resolve(parent)}${path.sep}`)) throw new Error('Snapshot path escapes its root');
  return destination;
}

async function writeSnapshot(local, cloud, baseline) {
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const target = path.join(root, '.supabase-snapshots', stamp);
  const manifest = { generatedAt: new Date().toISOString(), notes: {} };
  for (const [noteId, version] of cloud.versionByNote) {
    const node = cloud.byId.get(noteId);
    if (!node) continue;
    const notePath = cloudPath(noteId, cloud.byId);
    const noteRoot = safeDestination(path.join(target, 'notes'), notePath);
    const assets = cloud.assetsByNote.get(noteId) ?? [];
    fs.mkdirSync(noteRoot, { recursive: true });
    manifest.notes[noteId] = { path: notePath, title: node.title, type: node.note_type, version: version.version, assets: {} };
    for (const asset of assets) {
      const { data, error } = await db.storage.from('note-assets').download(asset.object_key);
      if (error) throw new Error(`${noteId}/${asset.relative_path}: ${error.message}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (sha256(bytes) !== asset.sha256 || bytes.length !== Number(asset.size_bytes)) throw new Error(`${noteId}/${asset.relative_path}: snapshot integrity check failed`);
      const destination = safeDestination(noteRoot, asset.relative_path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
      manifest.notes[noteId].assets[asset.relative_path] = { sha256: asset.sha256, size: Number(asset.size_bytes) };
    }
    fs.writeFileSync(path.join(noteRoot, 'note.yml'), stringify({ title: node.title, type: node.note_type, mainFile: node.note_type === 'markdown' ? 'note.md' : node.note_type === 'docx' ? 'note.docx' : undefined }), 'utf8');
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'snapshot.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(baselinePath, JSON.stringify(baselineFrom(local, cloud, baseline), null, 2), 'utf8');
  return target;
}

function report(entries, taxonomyIssues) {
  const result = { generatedAt: new Date().toISOString(), baselineAt: readBaseline()?.generatedAt ?? null, entries, taxonomyIssues };
  if (jsonMode) console.log(JSON.stringify(result, null, 2));
  else {
    if (taxonomyIssues.length) {
      console.log('TAXONOMY DRIFT');
      for (const issue of taxonomyIssues) console.log(`  ${issue.id}: ${issue.field}: ${issue.local ?? "absent"} → ${issue.cloud ?? "absent"}`);
    }
    for (const entry of entries) {
      const suffix = entry.status === 'clean' ? '' : `; missing in cloud=${entry.missingInCloud?.length ?? 0}, missing locally=${entry.missingLocally?.length ?? 0}, changed=${entry.changed?.length ?? 0}`;
      console.log(`${entry.status.padEnd(13)} v${entry.version ?? '-'} ${entry.path}${suffix}`);
      for (const file of entry.files ?? []) console.log(`  ${file.status.padEnd(13)} ${file.difference.padEnd(10)} ${file.path}`);
    }
    const counts = Object.groupBy(entries, (entry) => entry.status);
    console.log(`Checked ${entries.length} notes: ${Object.entries(counts).map(([status, rows]) => `${status}=${rows.length}`).join(', ') || 'none'}.`);
  }
  return result;
}

const taxonomy = loadTaxonomy(root);
const local = localState(taxonomy);
const cloud = await loadCloud();
const baseline = readBaseline();
const taxonomyIssues = compareTaxonomy(local.nodes, cloud.nodes.filter((node) => !node.deleted_at).map((node) => ({
  id: node.id, parentId: node.parent_id, title: node.title, type: node.note_type, kind: node.kind, slug: node.slug, position: node.position,
})));
const result = report(compare(local, cloud, baseline), taxonomyIssues);
if (reviewMode) {
  const reviewRoot = path.join(root, '.supabase-sync-reviews');
  fs.mkdirSync(reviewRoot, { recursive: true });
  fs.writeFileSync(path.join(reviewRoot, 'latest.json'), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(reviewRoot, 'latest.html'), renderSyncReport(result), 'utf8');
  console.log('Read-only review: .supabase-sync-reviews/latest.html (no cloud changes made).');
}
if (snapshotMode) {
  const target = await writeSnapshot(local, cloud, baseline);
  console.log(`Cloud snapshot written to ${path.relative(root, target)}; baseline updated at ${path.relative(root, baselinePath)}.`);
}
if (failOnDrift && (result.taxonomyIssues.length || result.entries.some((entry) => entry.status !== 'clean'))) process.exitCode = 2;

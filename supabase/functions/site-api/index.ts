import { createClient } from '@supabase/supabase-js';
import { markdownPassages, validateMarkdownImageAssets } from '../_shared/markdown.mjs';
import { wordSearchPassages } from '../_shared/word.mjs';

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void };

const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const bucket = 'note-assets';
const maxMarkdownBytes = 2 * 1024 * 1024;
const maxUploadBytes = 25 * 1024 * 1024;
const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://tabby-02.github.io,http://localhost:4321,http://127.0.0.1:4321,http://localhost:4323,http://127.0.0.1:4323')
  .split(',').map((value) => value.trim()).filter(Boolean);
const db = projectUrl && serviceKey ? createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const mimeTypes = new Map<string, [string, string]>([
  ['.avif', ['image/avif', 'media']], ['.gif', ['image/gif', 'media']], ['.jpeg', ['image/jpeg', 'media']],
  ['.svg', ['image/svg+xml', 'media']], ['.md', ['text/markdown; charset=utf-8', 'attachment']],
  ['.jpg', ['image/jpeg', 'media']], ['.png', ['image/png', 'media']], ['.webp', ['image/webp', 'media']],
  ['.pdf', ['application/pdf', 'pdf']], ['.txt', ['text/plain; charset=utf-8', 'attachment']],
  ['.csv', ['text/csv; charset=utf-8', 'attachment']], ['.json', ['application/json', 'attachment']],
  ['.xml', ['application/xml', 'attachment']], ['.zip', ['application/zip', 'attachment']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx']],
  ['.doc', ['application/msword', 'attachment']], ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'attachment']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'attachment']],
]);

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'apikey,authorization,content-type,x-csrf-token,x-upsert',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  });
  const origin = request.headers.get('origin');
  if (origin && configuredOrigins.includes(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}

function json(request: Request, data: unknown, status = 200, extra: HeadersInit = {}): Response {
  const headers = corsHeaders(request);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(data), { status, headers });
}

function fail(request: Request, message: string, status = 400): Response {
  return json(request, { error: message }, status);
}

function publicUrl(path: string): string {
  return `${projectUrl}/functions/v1/site-api${path.startsWith('/') ? path : `/${path}`}`;
}

function escapeBase64Url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('SESSION_SIGNING_SECRET');
  if (!secret || secret.length < 32) throw new Error('Session secret is not configured');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function createSession(): Promise<{ token: string; csrf: string }> {
  const csrf = escapeBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  const payload = escapeBase64Url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, csrf })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(payload)));
  return { token: `${payload}.${escapeBase64Url(signature)}`, csrf };
}

async function session(request: Request): Promise<{ exp: number; csrf: string } | null> {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(), decodeBase64Url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return Number.isInteger(value.exp) && value.exp > Math.floor(Date.now() / 1000) && typeof value.csrf === 'string' ? value : null;
  } catch { return null; }
}

async function requireAdmin(request: Request, mutation = false) {
  const origin = request.headers.get('origin');
  if (mutation && (!origin || !configuredOrigins.includes(origin))) return { error: 'Cross-origin request rejected', status: 403 };
  const current = await session(request);
  if (!current) return { error: 'Administrator session required', status: 401 };
  if (mutation && request.headers.get('x-csrf-token') !== current.csrf) return { error: 'CSRF token is missing or invalid', status: 403 };
  return { session: current } as const;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, saltHex, expectedHex] = String(encoded ?? '').split('$');
  const iterations = Number(iterationsText);
  if (algorithm !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 200_000 || iterations > 1_000_000) return false;
  if (!/^(?:[0-9a-f]{2}){16,64}$/i.test(saltHex ?? '') || !/^(?:[0-9a-f]{2}){32}$/i.test(expectedHex ?? '')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt: Uint8Array.from(saltHex.match(/../g)!, (part) => Number.parseInt(part, 16)) }, key, 256));
  const expected = Uint8Array.from(expectedHex.match(/../g)!, (part) => Number.parseInt(part, 16));
  let diff = 0;
  for (let index = 0; index < actual.length; index++) diff |= actual[index] ^ expected[index];
  return diff === 0;
}

async function clientKey(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const secret = Deno.env.get('SESSION_SIGNING_SECRET') ?? '';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:${ip}`)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function login(request: Request): Promise<Response> {
  if (!db) return fail(request, 'Authentication is unavailable', 503);
  const origin = request.headers.get('origin');
  if (!origin || !configuredOrigins.includes(origin)) return fail(request, 'Cross-origin request rejected', 403);
  const settings = Deno.env.get('ADMIN_PASSWORD_HASH');
  if (!settings) return fail(request, 'Administrator password is not configured', 503);
  let body: any;
  try { body = await request.json(); } catch { return fail(request, 'Invalid JSON body'); }
  if (typeof body?.password !== 'string' || body.password.length > 1024) return fail(request, 'Password is invalid');
  const key = await clientKey(request);
  const now = new Date();
  const { data: attempt } = await db.from('admin_login_attempts').select('*').eq('client_key', key).maybeSingle();
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > now.getTime()) return fail(request, 'Too many attempts. Try again later.', 429);
  const valid = await verifyPassword(body.password, settings);
  if (!valid) {
    const sameWindow = attempt && now.getTime() - new Date(attempt.window_started_at).getTime() < 15 * 60 * 1000;
    const failures = sameWindow ? attempt.failures + 1 : 1;
    await db.from('admin_login_attempts').upsert({
      client_key: key, failures, window_started_at: sameWindow ? attempt.window_started_at : now.toISOString(),
      locked_until: failures >= 5 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : new Date(0).toISOString(),
    });
    return fail(request, 'Password is incorrect', 401);
  }
  await db.from('admin_login_attempts').delete().eq('client_key', key);
  const created = await createSession();
  return json(request, { accessToken: created.token, csrfToken: created.csrf, expiresIn: 12 * 60 * 60 }, 200);
}

function slugFrom(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'note';
}

function safeRelativePath(value: string | null): string | null {
  const normalized = String(value ?? '').replaceAll('\\', '/');
  if (!normalized || normalized.length > 500 || normalized.startsWith('/') || normalized.includes('\0')) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}

function pathFor(id: string, byId: Map<string, any>): string {
  const parts: string[] = [];
  let node = byId.get(id);
  const visited = new Set();
  while (node && !visited.has(node.id)) { visited.add(node.id); parts.unshift(node.slug); node = node.parent_id ? byId.get(node.parent_id) : undefined; }
  return parts.join('/');
}

async function publishedState() {
  if (!db) throw new Error('Content database is unavailable');
  const [{ data: nodes, error: nodeError }, { data: versions, error: versionError }] = await Promise.all([
    db.from('taxonomy_nodes').select('*').is('deleted_at', null).order('position').order('id'),
    db.from('note_versions').select('*').eq('status', 'published'),
  ]);
  if (nodeError || versionError) throw nodeError ?? versionError;
  const nodeById = new Map((nodes ?? []).map((node: any) => [node.id, node]));
  const versionByNote = new Map((versions ?? []).map((version: any) => [version.note_id, version]));
  return { nodes: nodes ?? [], nodeById, versionByNote };
}

function makeTree(nodes: any[], nodeById: Map<string, any>, versionByNote: Map<string, any>, includeHidden = false) {
  const children = new Map<string, any[]>();
  for (const node of nodes) {
    const list = children.get(node.parent_id ?? '') ?? [];
    list.push(node); children.set(node.parent_id ?? '', list);
  }
  const build = (parent = '') => (children.get(parent) ?? []).flatMap((node) => {
    const version = versionByNote.get(node.id);
    if (!includeHidden && node.kind === 'note' && !version) return [];
    const nested = build(node.id);
    if (!includeHidden && node.kind === 'group' && !nested.length) return [];
    return [{ id: node.id, title: node.title, slug: node.slug, path: pathFor(node.id, nodeById), kind: node.kind,
      type: node.note_type, version: version?.version ?? null, deleted: Boolean(node.deleted_at), children: nested }];
  });
  return build();
}

async function health(request: Request): Promise<Response> {
  if (!db) return fail(request, 'Content service is unavailable', 503);
  return json(request, { status: 'ok', provider: 'supabase' });
}

async function tree(request: Request): Promise<Response> {
  const state = await publishedState();
  const result = makeTree(state.nodes, state.nodeById, state.versionByNote);
  return json(request, { tree: result, noteCount: state.versionByNote.size });
}

async function adminTree(request: Request): Promise<Response> {
  const auth = await requireAdmin(request);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'Content database is unavailable', 503);
  const [{ data: nodes, error: nodeError }, { data: versions, error: versionError }] = await Promise.all([
    db.from('taxonomy_nodes').select('*').order('position').order('id'),
    db.from('note_versions').select('note_id,version').eq('status', 'published'),
  ]);
  if (nodeError || versionError) throw nodeError ?? versionError;
  const byId = new Map((nodes ?? []).map((node: any) => [node.id, node]));
  const versionByNote = new Map((versions ?? []).map((version: any) => [version.note_id, version]));
  return json(request, { tree: makeTree(nodes ?? [], byId, versionByNote, true) });
}

async function allPassages(versionId: string) {
  const data: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db!.from('search_passages').select('scope,anchor,title,content').eq('version_id', versionId).order('id').range(offset, offset + 999);
    if (page.error) return { data, error: page.error };
    data.push(...page.data);
    if (page.data.length < 1000) return { data, error: null };
  }
}

async function noteByPath(request: Request, requested: string): Promise<Response> {
  const state = await publishedState();
  const row = state.nodes.find((node: any) => node.kind === 'note' && pathFor(node.id, state.nodeById) === requested);
  const version: any = row ? state.versionByNote.get(row.id) : null;
  if (!row || !version || !db) return fail(request, 'Note not found', 404);
  const [{ data: assets, error: assetError }, { data: passages, error: passageError }] = await Promise.all([
    db.from('note_assets').select('relative_path,object_key,role,mime_type,size_bytes').eq('version_id', version.id).order('relative_path'),
    allPassages(version.id),
  ]);
  if (assetError || passageError) throw assetError ?? passageError;
  let markdown: string | null = null;
  if (row.note_type === 'markdown' && version.markdown_object_key) {
    const { data, error: downloadError } = await db.storage.from(bucket).download(version.markdown_object_key);
    if (downloadError || !data) throw downloadError ?? new Error('Markdown source is missing');
    markdown = await data.text();
  }
  const urls = new Map<string, string>();
  for (let offset = 0; offset < (assets ?? []).length; offset += 500) {
    const signedResult = await db.storage.from(bucket).createSignedUrls((assets ?? []).slice(offset, offset + 500).map((asset: any) => asset.object_key), 4 * 60 * 60);
    if (signedResult.error) throw signedResult.error;
    for (const entry of signedResult.data ?? []) if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }
  const signed = (assets ?? []).map((asset: any) => ({ ...asset, url: urls.get(asset.object_key) }));
  let document: string | null = row.note_type === 'docx' ? urls.get(version.docx_object_key) as string ?? null : null;
  return json(request, {
    id: row.id, title: row.title, path: requested, type: row.note_type, version: version.version,
    manifest: version.manifest_json, markdown, document,
    searchPassages: passages ?? [], assets: signed,
  });
}

async function asset(request: Request, objectKey: string): Promise<Response> {
  const state = await publishedState();
  const activeIds = [...state.versionByNote.values()].map((version: any) => version.id);
  if (!activeIds.length || !db) return fail(request, 'File not found', 404);
  const { data: found, error: lookupError } = await db.from('note_assets').select('object_key')
    .eq('object_key', objectKey).in('version_id', activeIds).limit(1).maybeSingle();
  if (lookupError) throw lookupError;
  const markdownKeyIsActive = [...state.versionByNote.values()].some((version: any) => version.markdown_object_key === objectKey);
  if (!found && !markdownKeyIsActive) return fail(request, 'File not found', 404);
  const { data, error: signError } = await db.storage.from(bucket).createSignedUrl(objectKey, 4 * 60 * 60);
  if (signError || !data?.signedUrl) throw signError ?? new Error('Could not sign file URL');
  const headers = corsHeaders(request);
  headers.set('location', data.signedUrl);
  headers.set('cache-control', 'private, max-age=300');
  return new Response(null, { status: 302, headers });
}

async function search(request: Request): Promise<Response> {
  if (!db) return fail(request, 'Search is unavailable', 503);
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const scope = url.searchParams.get('scope') ?? 'body';
  const noteId = url.searchParams.get('note') || null;
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!query) return json(request, { total: 0, results: [] });
  if (!['topic', 'outline', 'body'].includes(scope)) return fail(request, 'Search scope is invalid');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) return fail(request, 'Search offset is invalid');
  const { data, error: searchError } = await db.rpc('search_note_passages', {
    p_query: query, p_scope: scope, p_note_id: noteId, p_limit: 40, p_offset: offset,
  });
  if (searchError) throw searchError;
  const state = await publishedState();
  const rows = data ?? [];
  return json(request, { total: Number(rows[0]?.total_count ?? 0), results: rows.map((row: any) => ({ ...row, path: pathFor(row.note_id, state.nodeById), type: state.nodeById.get(row.note_id)?.note_type })) });
}

async function taxonomyMutation(request: Request): Promise<Response> {
  const auth = await requireAdmin(request, true);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'Content database is unavailable', 503);
  let body: any;
  try { body = await request.json(); } catch { return fail(request, 'Invalid JSON body'); }
  const action = String(body?.action ?? '');
  const title = String(body?.title ?? '').trim();
  const timestamp = new Date().toISOString();
  if (['create-group', 'create-note'].includes(action)) {
    const parentId = body.parentId ? String(body.parentId) : null;
    const noteType = action === 'create-note' ? String(body.noteType ?? '') : null;
    if (!title || title.length > 120) return fail(request, 'Title must contain 1 to 120 characters');
    if (action === 'create-note' && !['markdown', 'docx', 'gallery'].includes(noteType ?? '')) return fail(request, 'Note type is invalid');
    if (action === 'create-note' && !parentId) return fail(request, 'A note must belong to a category');
    if (parentId) {
      const { data: parent } = await db.from('taxonomy_nodes').select('id,kind,deleted_at').eq('id', parentId).maybeSingle();
      if (!parent || parent.kind !== 'group' || parent.deleted_at) return fail(request, 'Choose an active category as the parent');
    }
    const id = `${action === 'create-group' ? 'group' : 'note'}-${crypto.randomUUID()}`;
    const baseSlug = slugFrom(String(body.slug || title));
    const slug = baseSlug === 'note' ? `${baseSlug}-${id.slice(-6)}` : baseSlug;
    const parentQuery = db.from('taxonomy_nodes').select('position');
    const siblings = parentId ? parentQuery.eq('parent_id', parentId) : parentQuery.is('parent_id', null);
    const { data: positions } = await siblings.order('position', { ascending: false }).limit(1);
    const { error: insertError } = await db.from('taxonomy_nodes').insert({
      id, parent_id: parentId, title, slug, kind: action === 'create-group' ? 'group' : 'note', note_type: noteType,
      position: (positions?.[0]?.position ?? -1) + 1,
      source_json: {}, legacy_slugs_json: [], created_at: timestamp, updated_at: timestamp,
    });
    if (insertError) return fail(request, insertError.code === '23505' ? 'A sibling already uses this URL name' : 'Could not create this taxonomy node', insertError.code === '23505' ? 409 : 503);
    await db.from('content_events').insert({ note_id: id, event_type: action === 'create-note' ? 'note-created' : 'category-created', detail_json: { title, noteType } });
    return json(request, { id, title, slug, kind: action === 'create-group' ? 'group' : 'note', type: noteType }, 201);
  }

  const id = String(body.id ?? '');
  const { data: node } = await db.from('taxonomy_nodes').select('*').eq('id', id).maybeSingle();
  if (!node) return fail(request, 'Taxonomy node not found', 404);
  if (action === 'rename' || action === 'move') {
    if (node.deleted_at) return fail(request, 'Restore the node before editing it');
    const nextTitle = action === 'rename' ? title : node.title;
    const parentId = action === 'move' ? (body.parentId ? String(body.parentId) : null) : node.parent_id;
    if (!nextTitle || nextTitle.length > 120) return fail(request, 'Title must contain 1 to 120 characters');
    if (node.kind === 'note' && !parentId) return fail(request, 'A note must belong to a category');
    if (parentId) {
      const { data: parent } = await db.from('taxonomy_nodes').select('kind,deleted_at').eq('id', parentId).maybeSingle();
      if (!parent || parent.kind !== 'group' || parent.deleted_at) return fail(request, 'Choose an active category as the parent');
    }
    const { data: all } = await db.from('taxonomy_nodes').select('id,parent_id,slug');
    const byId = new Map((all ?? []).map((entry: any) => [entry.id, entry]));
    const previousPath = pathFor(id, byId);
    if (action === 'move' && node.kind === 'group') {
      let ancestor: any = parentId ? byId.get(parentId) : null;
      while (ancestor) {
        if (ancestor.id === id) return fail(request, 'A category cannot be moved inside itself');
        ancestor = ancestor.parent_id ? byId.get(ancestor.parent_id) : null;
      }
    }
    const baseSlug = action === 'rename' ? slugFrom(String(body.slug || nextTitle)) : node.slug;
    const slug = action === 'rename' && baseSlug === 'note' ? `${baseSlug}-${id.slice(-6)}` : baseSlug;
    const siblingQuery = db.from('taxonomy_nodes').select('id').neq('id', id).eq('slug', slug);
    const siblingResult = parentId ? await siblingQuery.eq('parent_id', parentId).maybeSingle() : await siblingQuery.is('parent_id', null).maybeSingle();
    if (siblingResult.data) return fail(request, 'A sibling already uses this URL name', 409);
    const { error: updateError } = await db.from('taxonomy_nodes').update({ title: nextTitle, slug, parent_id: parentId, updated_at: timestamp }).eq('id', id);
    if (updateError) return fail(request, 'Could not update this taxonomy node', 503);
    if (action === 'rename' && node.kind === 'note') {
      await db.from('note_versions').update({ manifest_json: { title: nextTitle, type: node.note_type } }).eq('note_id', id).eq('status', 'published');
      await db.from('search_passages').update({ title: nextTitle, content: nextTitle }).eq('note_id', id).eq('scope', 'topic');
    }
    await db.from('content_events').insert({ note_id: id, event_type: action === 'move' ? 'taxonomy-moved' : 'taxonomy-renamed', detail_json: { previousPath, title: nextTitle, parentId } });
    return json(request, { id, title: nextTitle, slug, previousPath });
  }

  if (action === 'delete' || action === 'restore') {
    const { data: all } = await db.from('taxonomy_nodes').select('id,parent_id,deleted_at');
    const descendants = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const child of all ?? []) if (child.parent_id && descendants.has(child.parent_id) && !descendants.has(child.id)) { descendants.add(child.id); changed = true; }
    }
    if (action === 'restore' && node.parent_id) {
      const { data: parent } = await db.from('taxonomy_nodes').select('deleted_at').eq('id', node.parent_id).maybeSingle();
      if (!parent || parent.deleted_at) return fail(request, 'Restore the parent category first');
    }
    const changes = action === 'delete' ? { deleted_at: timestamp, updated_at: timestamp } : { deleted_at: null, updated_at: timestamp };
    const { error: updateError } = await db.from('taxonomy_nodes').update(changes).in('id', [...descendants]);
    if (updateError) return fail(request, 'Could not update the recycle bin', 503);
    await db.from('content_events').insert({ note_id: id, event_type: action === 'delete' ? 'taxonomy-soft-deleted' : 'taxonomy-restored', detail_json: { count: descendants.size } });
    return json(request, { id, deleted: action === 'delete' });
  }
  return fail(request, 'Unknown taxonomy action');
}

async function startUpload(request: Request, noteId: string): Promise<Response> {
  const auth = await requireAdmin(request, true);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'File storage is unavailable', 503);
  let body: any;
  try { body = await request.json(); } catch { return fail(request, 'Invalid upload request'); }
  if (!['main','main-media','attachments','folder'].includes(body.mode) || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) return fail(request, 'Upload mode or expected version is invalid');
  const { data: note } = await db.from('taxonomy_nodes').select('note_type').eq('id', noteId).is('deleted_at', null).maybeSingle();
  if (!note) return fail(request, 'Note not found', 404);
  if (!Array.isArray(body.files) || !body.files.length || body.files.length > 2000) return fail(request, 'Select between 1 and 2000 files');
  const files: Array<{path: string; size: number}> = [];
  for (const file of body.files) {
    const path = safeRelativePath(file.path);
    const problem = path ? uploadPathError(path, note.note_type) : 'File path is invalid';
    if (problem) return fail(request, problem);
    if (!Number.isInteger(file.size) || file.size < 0 || file.size > (path === 'note.md' ? maxMarkdownBytes : maxUploadBytes)) return fail(request, 'File exceeds its size limit', 413);
    if (body.mode === 'main' && path !== (note.note_type === 'markdown' ? 'note.md' : 'note.docx')) return fail(request, 'Main-file mode accepts only the main file');
    if (body.mode === 'attachments' && !path!.startsWith('attachments/')) return fail(request, 'Attachment mode accepts only auxiliary files');
    if (files.some((existing) => existing.path === path)) return fail(request, 'Two files use the same destination path');
    files.push({ path: path!, size: file.size });
  }
  if (['main','main-media','folder'].includes(body.mode) && note.note_type !== 'gallery' && !files.some((file) => file.path === (note.note_type === 'markdown' ? 'note.md' : 'note.docx'))) return fail(request, 'The main file is required for this upload mode');
  if (body.mode === 'main' && note.note_type === 'gallery') return fail(request, 'Use a folder to update a gallery');
  const operationId = crypto.randomUUID();
  const { data, error: startError } = await db.rpc('start_note_upload', {
    p_note_id: noteId, p_expected_version: body.expectedVersion, p_mode: body.mode, p_operation_id: operationId, p_files: files,
  });
  if (startError) return fail(request, startError.message.includes('conflict') ? 'This note changed in another session' : 'Could not start this upload', startError.message.includes('conflict') ? 409 : 400);
  const version = data?.[0]?.version;
  return json(request, { operationId, version, mode: body.mode }, 201);
}

function uploadPathError(path: string, noteType: string): string | null {
  const fileName = path.split('/').at(-1) ?? '';
  const extension = fileName.slice(fileName.lastIndexOf('.') || fileName.length).toLowerCase();
  const entry = mimeTypes.get(extension);
  if (path.toLowerCase() === 'note.md') {
    if (noteType !== 'markdown') return 'This note does not accept Markdown';
  } else if (!entry) return 'This file type is not supported';
  if (path.toLowerCase() === 'note.docx' && noteType !== 'docx') return 'This note does not accept Word documents';
  if ((path.startsWith('chapters/') || path.startsWith('media/')) && !['.avif','.gif','.jpeg','.jpg','.png','.webp','.svg'].includes(extension)) return 'Chapter and media paths accept image files only';
  if (path.startsWith('chapters/') && noteType !== 'gallery') return 'Only gallery notes can contain chapter images';
  if (!['note.md','note.docx'].includes(path.toLowerCase()) && !path.startsWith('media/') && !path.startsWith('chapters/') && !path.startsWith('attachments/')) return 'Use note.md, note.docx, media/, chapters/, or attachments/ as the file path';
  return null;
}

async function reserveUpload(request: Request, noteId: string, operationId: string): Promise<Response> {
  const auth = await requireAdmin(request, true);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'File storage is unavailable', 503);
  const path = safeRelativePath(new URL(request.url).searchParams.get('path'));
  if (!path) return fail(request, 'File path is invalid');
  const { data: staged } = await db.from('note_versions').select('id,note_id,status,expected_files_json').eq('id', operationId).eq('note_id', noteId).eq('status', 'staging').maybeSingle();
  const { data: note } = await db.from('taxonomy_nodes').select('note_type').eq('id', noteId).maybeSingle();
  if (!staged || !note) return fail(request, 'Upload operation has expired', 404);
  const problem = uploadPathError(path, note.note_type);
  if (problem) return fail(request, problem, 415);
  const plan = (staged.expected_files_json as any[]).find((file) => file.path === path);
  if (!plan) return fail(request, 'File was not included in this upload plan');
  const objectKey = `assets/${encodeURIComponent(noteId)}/${operationId}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const { data, error: signError } = await db.storage.from(bucket).createSignedUploadUrl(objectKey, { upsert: false });
  if (signError || !data?.signedUrl) return fail(request, 'Could not create an upload URL', 503);
  return json(request, { path, objectKey, signedUrl: data.signedUrl, mime: path === 'note.md' ? 'text/markdown' : mimeTypes.get(path.slice(path.lastIndexOf('.')).toLowerCase())![0].split(';')[0] }, 201);
}

async function completeUpload(request: Request, noteId: string, operationId: string): Promise<Response> {
  const auth = await requireAdmin(request, true);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'File storage is unavailable', 503);
  let body: any;
  try { body = await request.json(); } catch { return fail(request, 'Invalid upload metadata'); }
  const path = safeRelativePath(body.path);
  if (!path || !Number.isInteger(body.size) || body.size < 0 || body.size > maxUploadBytes) return fail(request, 'File size or path is invalid', body.size > maxUploadBytes ? 413 : 400);
  const { data: staged } = await db.from('note_versions').select('id,note_id,status,expected_files_json').eq('id', operationId).eq('note_id', noteId).eq('status', 'staging').maybeSingle();
  const { data: note } = await db.from('taxonomy_nodes').select('note_type,title').eq('id', noteId).maybeSingle();
  if (!staged || !note) return fail(request, 'Upload operation has expired', 404);
  const problem = uploadPathError(path, note.note_type);
  if (problem) return fail(request, problem, 415);
  const plan = (staged.expected_files_json as any[]).find((file) => file.path === path);
  if (!plan || plan.size !== body.size) return fail(request, 'File metadata does not match the upload plan');
  const extension = path.slice(path.lastIndexOf('.') || path.length).toLowerCase();
  const entry = mimeTypes.get(extension);
  const isMarkdown = path.toLowerCase() === 'note.md';
  if (!isMarkdown && !entry) return fail(request, 'This file type is not supported', 415);
  const mime = isMarkdown ? 'text/markdown; charset=utf-8' : entry![0];
  const isDocx = path.toLowerCase() === 'note.docx';
  const role = isMarkdown ? 'source' : isDocx ? 'docx' : path.startsWith('chapters/') ? 'gallery-image' : path.startsWith('media/') ? 'media' : entry![1];
  const objectKey = `assets/${encodeURIComponent(noteId)}/${operationId}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const { data: object, error: downloadError } = await db.storage.from(bucket).download(objectKey);
  if (downloadError || !object) return fail(request, 'Uploaded object is missing', 409);
  if (object.size !== body.size || object.size > maxUploadBytes) return fail(request, 'Uploaded object size does not match', 409);
  const bytes = new Uint8Array(await object.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const { error: assetError } = await db.from('note_assets').upsert({
    note_id: noteId, version_id: operationId, relative_path: path, object_key: objectKey,
    role, mime_type: mime, size_bytes: bytes.byteLength, sha256,
  }, { onConflict: 'version_id,relative_path' });
  if (assetError) return fail(request, 'Could not register this uploaded file', 503);
  if (isMarkdown) {
    if (bytes.byteLength > maxMarkdownBytes) return fail(request, 'Markdown exceeds 2 MB', 413);
    let markdown: string;
    try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail(request, 'Markdown must be UTF-8 text'); }
    const { error: versionError } = await db.from('note_versions').update({ markdown_object_key: objectKey }).eq('id', operationId);
    if (versionError) return fail(request, 'Could not register the Markdown source', 503);
    await db.from('search_passages').delete().eq('version_id', operationId).neq('scope', 'topic');
    const passages = markdownPassages(markdown).map((passage) => ({ note_id: noteId, version_id: operationId, ...passage }));
    const { error: passageError } = await insertPassages(passages);
    if (passageError) return fail(request, 'Could not index the Markdown source', 503);
  }
  if (isDocx) {
    await db.from('note_versions').update({ docx_object_key: objectKey }).eq('id', operationId);
    await db.from('search_passages').delete().eq('version_id', operationId).eq('scope', 'body');
    const passages = await wordSearchPassages(bytes);
    const { error: passageError } = await insertPassages(passages.map((passage) => ({ note_id: noteId, version_id: operationId, scope: 'body', anchor: passage.id, title: 'Word 正文', content: passage.text })));
    if (passageError) return fail(request, 'Could not index the Word document', 503);
  }
  return json(request, { path, size: bytes.byteLength, sha256 });
}

async function insertPassages(passages: any[]) {
  if (!db || !passages.length) return { error: null };
  for (let offset = 0; offset < passages.length; offset += 250) {
    const { error } = await db.from('search_passages').insert(passages.slice(offset, offset + 250));
    if (error) return { error };
  }
  return { error: null };
}

async function publishUpload(request: Request, noteId: string, operationId: string): Promise<Response> {
  const auth = await requireAdmin(request, true);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'Content database is unavailable', 503);
  const { data: note } = await db.from('taxonomy_nodes').select('note_type,title').eq('id', noteId).maybeSingle();
  const { data: staged } = await db.from('note_versions').select('version,markdown_object_key').eq('id', operationId).eq('note_id', noteId).eq('status', 'staging').maybeSingle();
  if (!note || !staged) return fail(request, 'Upload operation has expired', 404);
  if (note.note_type === 'markdown' && staged.markdown_object_key) {
    const { data: markdownFile, error: markdownError } = await db.storage.from(bucket).download(staged.markdown_object_key);
    if (markdownError || !markdownFile) return fail(request, 'Could not verify Markdown image references', 503);
    let markdown: string;
    try { markdown = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await markdownFile.arrayBuffer())); }
    catch { return fail(request, 'Markdown must be valid UTF-8 text'); }
    const { data: media, error: mediaError } = await db.from('note_assets').select('relative_path').eq('version_id', operationId).eq('role', 'media');
    if (mediaError) return fail(request, 'Could not verify Markdown image resources', 503);
    const issues = validateMarkdownImageAssets(markdown, (media ?? []).map((asset: any) => asset.relative_path));
    if (issues.length) return fail(request, issues[0]);
  }
  if (note.note_type === 'gallery') {
    const { data: images } = await db.from('note_assets').select('relative_path').eq('version_id', operationId).eq('role', 'gallery-image');
    const folders = new Set((images ?? []).map((asset: any) => {
      const relative = asset.relative_path.replace(/^chapters\//, '');
      return relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
    }));
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    const outlines = [...folders].sort(collator.compare).map((folder, index) => {
      const title = folder ? folder.split('/').map((part) => part.replace(/^\d+[-.、\s]*/, '') || part).join(' / ') : '总览';
      return { note_id: noteId, version_id: operationId, scope: 'outline', anchor: `gallery-chapter-${index}`, title, content: title };
    });
    await db.from('search_passages').delete().eq('version_id', operationId).eq('scope', 'outline');
    const { error: passageError } = await insertPassages(outlines);
    if (passageError) return fail(request, 'Could not index gallery chapters', 503);
  }
  const { data, error: publishError } = await db.rpc('publish_note_version', { p_note_id: noteId, p_operation_id: operationId });
  if (publishError) return fail(request, publishError.message.includes('required') ? publishError.message : 'Could not publish this version', publishError.message.includes('conflict') ? 409 : 400);
  return json(request, { id: noteId, version: data, updatedAt: new Date().toISOString() });
}

async function saveMarkdown(request: Request, noteId: string): Promise<Response> {
  const auth = await requireAdmin(request, true);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'Content database is unavailable', 503);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxMarkdownBytes + 4096) return fail(request, 'Markdown exceeds 2 MB', 413);
  let body: any;
  try { body = await request.json(); } catch { return fail(request, 'Invalid JSON body'); }
  if (typeof body?.content !== 'string' || new TextEncoder().encode(body.content).byteLength > maxMarkdownBytes) return fail(request, 'Markdown exceeds 2 MB', 413);
  const { data: note } = await db.from('taxonomy_nodes').select('id,title,note_type').eq('id', noteId).eq('kind', 'note').is('deleted_at', null).maybeSingle();
  if (!note) return fail(request, 'Note not found', 404);
  if (note.note_type !== 'markdown') return fail(request, 'Only Markdown notes can use this endpoint', 415);
  const { data: active } = await db.from('note_versions').select('id,version').eq('note_id', noteId).eq('status', 'published').maybeSingle();
  if ((active?.version ?? 0) !== body.expectedVersion) return fail(request, 'This note changed in another session', 409);
  const { data: media, error: mediaError } = await db.from('note_assets').select('relative_path').eq('version_id', active?.id ?? '').eq('role', 'media');
  if (mediaError) return fail(request, 'Could not verify Markdown image resources', 503);
  const imageIssues = validateMarkdownImageAssets(body.content, (media ?? []).map((asset: any) => asset.relative_path));
  if (imageIssues.length) return fail(request, imageIssues[0]);
  const operationId = crypto.randomUUID();
  const { error: startError } = await db.rpc('start_note_upload', { p_note_id: noteId, p_expected_version: body.expectedVersion, p_mode: 'edit', p_operation_id: operationId, p_files: [] });
  if (startError) return fail(request, 'Could not start a new Markdown version', startError.message.includes('conflict') ? 409 : 503);
  try {
    const objectKey = `sources/${encodeURIComponent(noteId)}/${operationId}/note.md`;
    const bytes = new TextEncoder().encode(body.content);
    const { error: storageError } = await db.storage.from(bucket).upload(objectKey, bytes, { contentType: 'text/markdown; charset=utf-8', upsert: false });
    if (storageError) throw storageError;
    const { error: updateError } = await db.from('note_versions').update({ markdown_object_key: objectKey }).eq('id', operationId);
    if (updateError) throw updateError;
    await db.from('search_passages').delete().eq('version_id', operationId).neq('scope', 'topic');
    const passages = markdownPassages(body.content).map((passage) => ({ note_id: noteId, version_id: operationId, ...passage }));
    const { error: passageError } = await insertPassages(passages);
    if (passageError) throw passageError;
    const { data: version, error: publishError } = await db.rpc('publish_note_version', { p_note_id: noteId, p_operation_id: operationId });
    if (publishError) throw publishError;
    return json(request, { id: noteId, version, updatedAt: new Date().toISOString(), passageCount: passages.length });
  } catch (cause) {
    await db.from('note_versions').update({ status: 'discarded' }).eq('id', operationId).eq('status', 'staging');
    return fail(request, cause instanceof Error ? cause.message : 'Could not publish this Markdown version', 503);
  }
}

async function versions(request: Request, noteId: string): Promise<Response> {
  const auth = await requireAdmin(request);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'Content database is unavailable', 503);
  const { data, error } = await db.from('note_versions').select('version,status,created_at,created_by')
    .eq('note_id', noteId).in('status', ['published','superseded']).order('version', { ascending: false });
  if (error) throw error;
  return json(request, { versions: data ?? [] });
}

async function restore(request: Request, noteId: string): Promise<Response> {
  const auth = await requireAdmin(request, true);
  if (!auth.session) return fail(request, auth.error, auth.status);
  if (!db) return fail(request, 'Content database is unavailable', 503);
  let body: any;
  try { body = await request.json(); } catch { return fail(request, 'Invalid restore request'); }
  const { data: active } = await db.from('note_versions').select('version').eq('note_id', noteId).eq('status', 'published').maybeSingle();
  if ((active?.version ?? 0) !== body.expectedVersion) return fail(request, 'This note changed in another session', 409);
  const { data, error } = await db.rpc('restore_note_version', { p_note_id: noteId, p_target_version: body.targetVersion, p_expected_version: body.expectedVersion });
  if (error) return fail(request, error.message.includes('conflict') ? 'This note changed in another session' : 'Version not found or could not be restored', error.message.includes('conflict') ? 409 : 404);
  return json(request, { version: data, updatedAt: new Date().toISOString() });
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const marker = '/functions/v1/site-api';
  const route = url.pathname.includes(marker)
    ? url.pathname.slice(url.pathname.indexOf(marker) + marker.length)
    : url.pathname.replace(/^\/site-api(?=\/|$)/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (!db) return fail(request, 'Content service is unavailable', 503);
  if (request.method === 'POST' && route === '/api/auth/login') return await login(request);
  if (route === '/api/admin/session' && request.method === 'GET') {
    const current = await session(request);
    return json(request, { authenticated: Boolean(current), csrfToken: current?.csrf ?? '' });
  }
  if (route === '/api/auth/logout' && request.method === 'POST') {
    const auth = await requireAdmin(request, true);
    return auth.session ? json(request, { ok: true }) : fail(request, auth.error, auth.status);
  }
  if (request.method === 'GET' && route === '/api/health') return await health(request);
  if (request.method === 'GET' && route === '/api/tree') return await tree(request);
  if (request.method === 'GET' && route === '/api/search') return await search(request);
  if (route === '/api/admin/taxonomy' && request.method === 'GET') return await adminTree(request);
  if (route === '/api/admin/taxonomy' && request.method === 'POST') return await taxonomyMutation(request);
  const segments = route.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (segments[0] === 'api' && segments[1] === 'notes' && request.method === 'GET') return await noteByPath(request, segments.slice(2).join('/'));
  if (segments[0] === 'api' && segments[1] === 'assets' && request.method === 'GET') return await asset(request, segments.slice(2).join('/'));
  if (segments[0] === 'api' && segments[1] === 'admin' && segments[2] === 'notes') {
    const noteId = segments[3] ?? '';
    const resource = segments[4] ?? '';
    if (resource === 'markdown' && request.method === 'PUT') return await saveMarkdown(request, noteId);
    if (resource === 'versions' && request.method === 'GET') return await versions(request, noteId);
    if (resource === 'restore' && request.method === 'POST') return await restore(request, noteId);
    if (resource === 'uploads' && request.method === 'POST' && segments.length === 5) return await startUpload(request, noteId);
    if (resource === 'uploads' && segments[5] && request.method === 'POST' && segments.length === 6) return await reserveUpload(request, noteId, segments[5]);
    if (resource === 'uploads' && segments[5] && segments[6] === 'complete' && request.method === 'POST') return await completeUpload(request, noteId, segments[5]);
    if (resource === 'uploads' && segments[5] && segments[6] === 'publish' && request.method === 'POST') return await publishUpload(request, noteId, segments[5]);
  }
  return fail(request, 'Route not found', 404);
}

if (import.meta.main) Deno.serve(async (request) => {
  try { return await handle(request); }
  catch (cause) {
    console.error('site-api request failed', cause);
    return fail(request, 'The content service could not complete this request', 503);
  }
});

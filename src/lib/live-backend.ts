const projectUrl = (import.meta.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const publishableKey = import.meta.env.PUBLIC_SUPABASE_KEY ?? '';
const apiRoot = projectUrl ? `${projectUrl}/functions/v1/site-api` : '';

export const hasLiveBackend = Boolean(apiRoot && publishableKey);

export function liveApiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return hasLiveBackend ? `${apiRoot}${suffix}` : suffix;
}

export function liveApiHeaders(headers: HeadersInit = {}): Headers {
  const result = new Headers(headers);
  if (hasLiveBackend) result.set('apikey', publishableKey);
  if (typeof sessionStorage !== 'undefined') {
    const token = sessionStorage.getItem('notes-admin-session');
    if (token) result.set('authorization', `Bearer ${token}`);
  }
  return result;
}

export function liveFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(liveApiUrl(path), {
    cache: 'no-store',
    credentials: 'omit',
    ...options,
    headers: liveApiHeaders(options.headers),
  });
}

export type LiveNode = { id: string; title: string; path: string; kind: 'group' | 'note'; type: 'markdown' | 'docx' | 'gallery'; children?: LiveNode[] };
export type LiveAsset = { relative_path: string; role: string; url: string; size_bytes: number };
export type LiveNote = LiveNode & { version: number; markdown?: string; document?: string; assets: LiveAsset[]; searchPassages: Array<{ scope: string; anchor: string; content: string; title: string }> };
const livePath = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('liveNote') ?? '';
let treeRequest: Promise<{ tree: LiveNode[]; noteCount: number } | null> | undefined;
const noteRequests = new Map<string, Promise<LiveNote | null>>();
export const flattenLiveTree = (nodes: LiveNode[]): LiveNode[] => nodes.flatMap((node) => [node, ...flattenLiveTree(node.children ?? [])]);
export function getLiveTree() {
  return treeRequest ??= (async () => {
    if (!hasLiveBackend) return null;
    const response = await liveFetch('/api/tree');
    if (!response.ok) return null;
    return response.json();
  })().catch(() => null);
}
export function liveReaderUrl(node: Pick<LiveNode, 'path' | 'type'>, hash = '') {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return `${base}reader/${node.type}/?liveNote=${encodeURIComponent(node.path)}${hash ? `#${encodeURIComponent(hash)}` : ''}`;
}
export function getLiveNote(element: HTMLElement): Promise<LiveNote | null> {
  const key = livePath || element.dataset.noteId || '';
  if (!noteRequests.has(key)) noteRequests.set(key, (async () => {
    const tree = await getLiveTree();
    const node = flattenLiveTree(tree?.tree ?? []).find((node) => livePath ? node.path === livePath : node.id === key);
    if (!node) return null;
    const response = await liveFetch(`/api/notes/${node.path.split('/').map(encodeURIComponent).join('/')}`);
    if (!response.ok) throw new Error('暂时无法读取在线笔记，请稍后重试。');
    return response.json();
  })());
  return noteRequests.get(key)!;
}
export function applyLiveNote(element: HTMLElement, note: LiveNote) {
  element.dataset.noteId = note.id;
  element.dataset.searchNote = note.path;
  document.title = `${note.title} | 个人学习笔记`;
  const heading = document.querySelector('main h1');
  if (heading) heading.textContent = note.title;
  document.dispatchEvent(new CustomEvent('notes:live-note', { detail: note }));
}

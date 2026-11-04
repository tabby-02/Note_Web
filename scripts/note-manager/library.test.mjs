import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { inspectGallery } from '../../src/lib/gallery.mjs';
import { loadTaxonomy, validateTaxonomy } from '../taxonomy.mjs';
import { createManager } from './server.mjs';
import { planImport, importNote, updateNode, deleteNode, restoreNode, createCategory, listLibrary, rewriteReferences } from './library.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH5kAAAAASUVORK5CYII=', 'base64');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'note-manager-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project');
  const source = path.join(temp, 'source');
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true }); fs.mkdirSync(source);
  fs.writeFileSync(path.join(root, 'notes', 'taxonomy.yml'), stringify({ groups: [{ id: 'first', title: '第一类', children: [] }, { id: 'second', title: '第二类', children: [] }] }));
  function put(relative, content, base = source) { const file = path.join(base, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; }
  return { root, source, put, temp };
}

test('import preserves Markdown, formulas, code and all auxiliary files; rewrites local resources', (t) => {
  const { root, source, put, temp } = fixture(t);
  put('图片/图 1.png', png); put('shared.png', png, temp);
  put('补充/手册.txt', '辅助资料'); put('another.md', '# 另一篇'); put('note.yml', 'source: original');
  const markdown = '# 示例\n\n公式 $E=mc^2$ :yum:\n![示意图](图片/图%201.png)\n<img src="图片/图%201.png">\n<img src="\\图片\\图 1.png">\n![共享](../shared.png)\n[手册](补充/手册.txt)\n![引用][图]\n\n[图]: 图片/图%201.png\n\n```md\n![示例](do-not-change.png)\n```\n`![行内示例](literal.png)`\n';
  put('main.md', markdown);
  const preview = planImport(root, { source, mainFile: 'main.md' }).summary;
  assert.equal(preview.type, 'markdown'); assert.deepEqual(preview.missing, []); assert.equal(preview.externalFiles.length, 1);
  const result = importNote(root, { source, mainFile: 'main.md', title: '测试: 新笔记', id: 'new-note', parent: 'first' });
  const folder = path.join(root, 'notes', result.slug);
  const output = fs.readFileSync(path.join(folder, 'note.md'), 'utf8');
  assert.match(output, /media\/%E5%9B%BE%E7%89%87\/.*%201\.png/);
  assert.match(output, /src="media\//); assert.match(output, /\[手册\]\(<attachments\//); assert.match(output, /media\/_linked\//);
  assert.ok(output.includes('$E=mc^2$ :yum:')); assert.ok(output.includes('![示例](do-not-change.png)')); assert.ok(output.includes('`![行内示例](literal.png)`'));
  assert.equal(fs.readFileSync(path.join(folder, 'attachments', '补充', '手册.txt'), 'utf8'), '辅助资料');
  assert.ok(fs.existsSync(path.join(folder, 'attachments', 'another.md'))); assert.ok(fs.existsSync(path.join(folder, 'attachments', 'note.yml')));
  assert.equal(fs.readFileSync(path.join(source, 'main.md'), 'utf8'), markdown);
  assert.equal(listLibrary(root).noteCount, 1);
});

test('mixed Typora math imports unchanged while genuinely invalid formulas remain blocked', (t) => {
  const { root, source, put } = fixture(t);
  const markdown = String.raw`# GraphRAG

\($z_g$\)；\(结果记为$D_g$\)；\(缩放因子$\alpha$\)`;
  const original = put('main.md', markdown);
  assert.deepEqual(planImport(root, { source }).summary.missing, []);
  const result = importNote(root, { source, title: 'GraphRAG', id: 'graphrag', parent: 'first' });
  assert.equal(fs.readFileSync(path.join(root, 'notes', result.slug, 'note.md'), 'utf8'), markdown);
  assert.equal(fs.readFileSync(original, 'utf8'), markdown);
  put('main.md', String.raw`\(结果$\frac{x}$\)`);
  assert.ok(planImport(root, { source }).summary.missing.some((issue) => issue.startsWith('公式无法渲染')));
  assert.throws(() => importNote(root, { source, title: '错误公式', id: 'invalid', parent: 'first' }), /公式无法渲染/);
  assert.equal(listLibrary(root).noteCount, 1);
});

test('reject missing references, broken heading links and duplicate paths without partial imports', (t) => {
  const { root, source, put } = fixture(t);
  put('main.md', '# Hello\n![broken](missing.png)\n[跳转](#absent)');
  const preview = planImport(root, { source }).summary;
  assert.equal(preview.missing.length, 2);
  assert.throws(() => importNote(root, { source, parent: 'first', title: '失败', id: 'failed' }), /修复/);
  assert.equal(listLibrary(root).noteCount, 0); assert.ok(!fs.existsSync(path.join(root, 'notes/first/failed')));
  put('main.md', '# Hello');
  importNote(root, { source, parent: 'first', title: '成功', id: 'success' });
  assert.throws(() => importNote(root, { source, parent: 'first', title: '成功', id: 'success' }), /已存在/);
  assert.equal(listLibrary(root).noteCount, 1);
});

test('gallery accepts arbitrary chapter counts, root images and nested folders; reports invalid content', (t) => {
  const { root, source, put, temp } = fixture(t);
  put('cover.png', png); put('01-章节/02-小节/02.png', png); put('01-章节/01.png', png); put('资料/readme.txt', '说明');
  const result = importNote(root, { source, title: '图库', parent: 'first', id: 'gallery', type: 'gallery' });
  const gallery = inspectGallery(path.join(root, 'notes', result.slug, 'chapters'));
  assert.deepEqual(gallery.issues, []); assert.equal(gallery.chapters.length, 3); assert.equal(gallery.chapters.flatMap((chapter) => chapter.images).length, 3);
  const log = execFileSync(process.execPath, [fileURLToPath(new URL('../validate-notes.mjs', import.meta.url)), root], { encoding: 'utf8', windowsHide: true });
  assert.match(log, /3 image chapters/);
  assert.ok(gallery.chapters.some((chapter) => chapter.title === '章节 / 小节'));
  const invalid = path.join(temp, 'invalid'); fs.mkdirSync(path.join(invalid, 'empty'), { recursive: true });
  fs.writeFileSync(path.join(invalid, 'broken.png'), 'not an image'); fs.writeFileSync(path.join(invalid, 'manual.pdf'), 'aux');
  assert.equal(inspectGallery(invalid).issues.length, 3);
  put('broken.png', 'bad');
  assert.throws(() => importNote(root, { source, title: '坏图库', parent: 'second', type: 'gallery' }), /损坏/);
  assert.equal(listLibrary(root).noteCount, 1);
});

test('failed configuration save rolls back moved files and renamed manifest', (t) => {
  const { root, source, put } = fixture(t); put('main.md', '# Content');
  importNote(root, { source, title: '原名称', id: 'note', parent: 'first' });
  const taxonomy = path.join(root, 'notes', 'taxonomy.yml');
  const before = fs.readFileSync(taxonomy, 'utf8');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === taxonomy) throw new Error('simulated save failure');
    return rename(from, to);
  });
  assert.throws(() => updateNode(root, { slug: 'first/note', title: '新名称', parent: 'second' }), /simulated/);
  assert.equal(fs.readFileSync(taxonomy, 'utf8'), before);
  assert.match(fs.readFileSync(path.join(root, 'notes/first/note/note.yml'), 'utf8'), /原名称/);
  assert.ok(!fs.existsSync(path.join(root, 'notes/second/note')));
});

test('Word import copies main document and retains auxiliary directory hierarchy', (t) => {
  const { root, source, put } = fixture(t);
  put('文档.docx', Buffer.from('PK\x03\x04fixture')); put('资料/模板.txt', '说明');
  const result = importNote(root, { source, title: 'Word 笔记', id: 'word', parent: 'first', type: 'docx' });
  assert.ok(fs.existsSync(path.join(root, 'notes', result.slug, 'note.docx')));
  assert.ok(fs.existsSync(path.join(root, 'notes', result.slug, 'attachments/资料/模板.txt')));
});

test('rename, move (including move back), subtree deletion and recovery preserve files and aliases', (t) => {
  const { root, source, put } = fixture(t); put('main.md', '# Content');
  createCategory(root, { title: '专题', id: 'topic', parent: 'first' });
  importNote(root, { source, title: '测试', id: 'note', parent: 'first/topic' });
  updateNode(root, { slug: 'first/topic/note', title: '新标题', parent: 'second' });
  assert.equal(listLibrary(root).nodes.find((node) => node.slug === 'second/note').title, '新标题');
  assert.ok(loadTaxonomy(root).groups[1].children[0].legacySlugs.includes('first/topic/note'));
  updateNode(root, { slug: 'second/note', parent: 'first/topic' });
  updateNode(root, { slug: 'first/topic', parent: 'second' });
  const movedNotePath = path.join(root, 'notes/second/topic/note');
  assert.ok(fs.existsSync(path.join(movedNotePath, 'note.md')));
  assert.ok(!fs.existsSync(path.join(root, 'notes/first/topic/note')));
  const before = fs.readFileSync(path.join(root, 'notes/second/topic/note/note.md'));
  assert.throws(() => updateNode(root, { slug: 'second', parent: 'second/topic' }), /自身/);
  const deleted = deleteNode(root, { slug: 'second/topic' });
  assert.equal(listLibrary(root).noteCount, 0); assert.equal(listLibrary(root).trash.length, 1);
  restoreNode(root, { id: deleted.id });
  assert.equal(listLibrary(root).noteCount, 1); assert.equal(listLibrary(root).trash.length, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, 'notes/second/topic/note/note.md')), before);
  assert.ok(fs.existsSync(path.join(root, 'notes/second/topic/note/note.yml')));
  assert.deepEqual(validateTaxonomy(loadTaxonomy(root)), []);
});

test('failed category move rolls back every descendant note folder', (t) => {
  const { root, source, put } = fixture(t); put('main.md', '# Content');
  createCategory(root, { title: '专题', id: 'topic', parent: 'first' });
  importNote(root, { source, title: 'A', id: 'a', parent: 'first/topic' });
  importNote(root, { source, title: 'B', id: 'b', parent: 'first/topic' });
  const taxonomy = path.join(root, 'notes', 'taxonomy.yml');
  const before = fs.readFileSync(taxonomy, 'utf8');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === taxonomy) throw new Error('simulated save failure');
    return rename(from, to);
  });
  assert.throws(() => updateNode(root, { slug: 'first/topic', parent: 'second' }), /simulated/);
  assert.equal(fs.readFileSync(taxonomy, 'utf8'), before);
  for (const id of ['a', 'b']) {
    assert.ok(fs.existsSync(path.join(root, `notes/first/topic/${id}/note.md`)));
    assert.ok(!fs.existsSync(path.join(root, `notes/second/topic/${id}`)));
  }
});

test('unsafe IDs and conflicting taxonomy are rejected', (t) => {
  const { root } = fixture(t);
  for (const id of ['../outside', 'CON', 'a/b', '.', 'with space']) assert.throws(() => createCategory(root, { id, title: '分类' }));
  assert.throws(() => createCategory(root, { id: 'first', title: '重复分类' }), /已存在/);
  assert.ok(validateTaxonomy({ groups: [{ id: 'same', title: 'A', children: [] }, { id: 'Same', title: 'B', children: [] }] }).length);
});

test('Markdown rewriting preserves reference titles and inline/code fence examples', () => {
  const source = '![x](<image with spaces.png> "caption")\n[x]: image.png "title"\n`![x](literal.png)`\n```md\n![x](example.png)\n```\n\\<img src="example.png">\n\\[object Window](example)\n<img\n src="multiline.png">\n';
  const result = rewriteReferences(source, (url) => `media/${encodeURIComponent(url)}`);
  assert.ok(result.includes('![x](<media/image%20with%20spaces.png> "caption")'));
  assert.ok(result.includes('[x]: <media/image.png> "title"')); assert.ok(result.includes('`![x](literal.png)`')); assert.ok(result.includes('![x](example.png)'));
  assert.ok(result.includes('\\<img src="example.png">')); assert.ok(result.includes('\\[object Window](example)'));
  assert.ok(result.includes('<img\n src="media/multiline.png">'));
});

test('local HTTP manager requires same-origin token and supports folder selection and mutations', async (t) => {
  const { root, source, put } = fixture(t); put('main.md', '# Hello');
  let refreshes = 0;
  const server = createManager({ root, port: 0, refresh: async () => { refreshes++; }, folderPicker: async () => source });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(origin)).text(); const token = html.match(/name="notes-token" content="([^"]+)"/)[1];
  const headers = { 'Content-Type': 'application/json', 'X-Notes-Token': token, Origin: origin };
  assert.equal((await fetch(`${origin}/api/library`)).status, 403);
  assert.equal((await fetch(`${origin}/api/category`, { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: '{}' })).status, 403);
  const selected = await (await fetch(`${origin}/api/pick-folder`, { method: 'POST', headers, body: '{}' })).json(); assert.equal(selected.source, source);
  const imported = await fetch(`${origin}/api/import`, { method: 'POST', headers, body: JSON.stringify({ source, parent: 'first', title: 'API note', id: 'api-note' }) });
  assert.equal(imported.status, 200); assert.equal(refreshes, 1); assert.equal(listLibrary(root).noteCount, 1);
});

async function pickerFixture(t, options) {
  const { root } = fixture(t);
  const server = createManager({ root, port: 0, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(origin)).text();
  const token = html.match(/name="notes-token" content="([^"]+)"/)[1];
  return (signal) => fetch(`${origin}/api/pick-folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Notes-Token': token, Origin: origin }, body: '{}', signal,
  });
}

test('a new folder selection cancels an abandoned picker without an old completion unlocking the new one', async (t) => {
  const attempts = [];
  let started = Promise.withResolvers();
  const pick = await pickerFixture(t, { folderPicker: ({ signal }) => {
    const attempt = { signal, ...Promise.withResolvers() };
    attempts.push(attempt); started.resolve(); return attempt.promise;
  } });
  const first = pick(); await started.promise;
  started = Promise.withResolvers();
  const second = pick(); await started.promise;
  assert.equal(attempts[0].signal.aborted, true);
  assert.match((await (await first).json()).error, /旧的选择已取消/);
  // The original picker may finish late, after a replacement is already running.
  attempts[0].resolve('stale');
  started = Promise.withResolvers();
  const third = pick(); await started.promise;
  assert.equal(attempts[1].signal.aborted, true);
  assert.match((await (await second).json()).error, /旧的选择已取消/);
  attempts[2].resolve('chosen-folder');
  assert.deepEqual(await (await third).json(), { source: 'chosen-folder' });
});

test('closing or cancelling the browser request aborts its native picker and allows retry', async (t) => {
  const started = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  let calls = 0;
  const pick = await pickerFixture(t, { folderPicker: ({ signal }) => {
    if (++calls > 1) return 'retry-folder';
    signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
    started.resolve(); return new Promise(() => {});
  } });
  const controller = new AbortController();
  const request = pick(controller.signal);
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await started.promise; controller.abort();
  await rejected;
  await Promise.race([cancelled.promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Picker did not abort after disconnection')), 2000);
    cancelled.promise.then(() => clearTimeout(timer));
  })]);
  assert.deepEqual(await (await pick()).json(), { source: 'retry-folder' });
});

test('a stalled picker times out and releases the request even when its promise ignores cancellation', async (t) => {
  let signal;
  let calls = 0;
  const pick = await pickerFixture(t, { pickerTimeoutMs: 30, folderPicker: (options) => {
    if (++calls > 1) return 'after-timeout';
    signal = options.signal;
    return new Promise(() => {});
  } });
  const response = await pick();
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /超时/);
  assert.equal(signal.aborted, true);
  assert.deepEqual(await (await pick()).json(), { source: 'after-timeout' });
});

test('native cancellation and picker failures both allow the next attempt', async (t) => {
  let calls = 0;
  const pick = await pickerFixture(t, { folderPicker: async () => {
    if (++calls === 1) return '';
    if (calls === 2) throw new Error('picker failed');
    return 'recovered';
  } });
  assert.deepEqual(await (await pick()).json(), { source: '' });
  assert.match((await (await pick()).json()).error, /picker failed/);
  assert.deepEqual(await (await pick()).json(), { source: 'recovered' });
});

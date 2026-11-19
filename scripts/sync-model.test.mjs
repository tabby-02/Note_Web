import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFiles, commonBaseline, noteStatus, compareTaxonomy } from './sync-model.mjs';
import { renderSyncReport } from './sync-report.mjs';
const a = { sha256: 'a', size: 1 }, b = { sha256: 'b', size: 2 }, c = { sha256: 'c', size: 3 };
test('distinguishes deletion, independent additions, conflicts and identical changes', () => {
  const files = compareFiles({ main: b, local: a, same: b }, { main: c, remote: a, same: b, removed: a }, { assets: { main: a, same: a, removed: a } });
  assert.equal(files.find((f) => f.path === 'main').status, 'conflict');
  assert.equal(files.find((f) => f.path === 'local').status, 'local-changed');
  assert.equal(files.find((f) => f.path === 'remote').status, 'cloud-changed');
  assert.equal(files.find((f) => f.path === 'removed').status, 'local-changed');
  assert.equal(files.find((f) => f.path === 'same').status, 'equal');
  assert.equal(noteStatus(files), 'both-changed');
});
test('a snapshot of divergent content cannot manufacture a common ancestor', () => {
  const base = commonBaseline({ main: a }, { main: b });
  assert.deepEqual(base.unknownPaths, ['main']);
  assert.equal(compareFiles({ main: a }, { main: c }, base)[0].status, 'unbased');
  const previous = { assets: { main: a } };
  assert.deepEqual(commonBaseline({ main: b }, { main: c }, previous).assets, previous.assets);
  assert.equal(noteStatus(compareFiles({ main: b }, { main: c }, previous)), 'both-changed');
});
test('snapshots retain agreed absence and converge after explicit reconciliation', () => {
  const base = commonBaseline({ new: a }, {}, { assets: {} });
  assert.equal(compareFiles({ new: a }, {}, base)[0].status, 'local-changed');
  assert.equal(noteStatus(compareFiles({ main: b }, { main: b })), 'clean');
  const reconciled = commonBaseline({ main: b }, { main: b }, { assets: {}, unknownPaths: ['main'] });
  assert.deepEqual(reconciled, { assets: { main: b }, unknownPaths: [] });
});
test('directory moves and ordering changes are visible even when titles match', () => {
  const node = { id: 'x', title: 'X', kind: 'note', type: 'markdown', parentId: 'a', slug: 'x', position: 0 };
  assert.deepEqual(compareTaxonomy([node], [{ ...node, parentId: 'b', position: 2 }]).map((d) => d.field), ['parentId', 'position']);
});

test('read-only review escapes file paths and titles from either source', () => {
  const html = renderSyncReport({ generatedAt: 'now', entries: [{ id: 'a', title: '<script>alert(1)</script>', path: '<path>', status: 'drift', files: [{ path: '<img src=x onerror=alert(1)>', status: 'unbased', difference: 'cloud-only' }] }], taxonomyIssues: [] });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src='));
  assert.ok(html.includes('&lt;path&gt;'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMarkdown, validateMarkdownImageAssets } from '../supabase/functions/_shared/markdown.mjs';

test('validates embedded Markdown, HTML, and reference-style images only', () => {
  const markdown = [
    '![inline](one.png)',
    '<img src="two.png">',
    '![reference][diagram]',
    '[diagram]: three.png',
    '[open image](linked.png)',
    '`![literal](code.png)`',
    '```md\n![example](fence.png)\n```',
  ].join('\n');
  assert.deepEqual(validateMarkdownImageAssets(markdown, ['media/one.png', 'media/two.png', 'media/three.png']), []);
});

test('rejects missing media and explicit references into attachments', () => {
  const issues = validateMarkdownImageAssets('![missing](not-here.png)\n![wrong](attachments/wrong.png)', []);
  assert.equal(issues.length, 2);
  assert.match(issues[0], /missing from media/);
  assert.match(issues[1], /inside media/);
});

test('inspects image references and search passages in one rendered document', () => {
  const result = inspectMarkdown('# JDBC\n\nA paragraph with $x^2$ and an image ![diagram](jdbc.png).', ['media/jdbc.png']);
  assert.deepEqual(result.issues, []);
  assert.ok(result.passages.some((passage) => passage.scope === 'outline' && passage.content === 'JDBC'));
  assert.ok(result.passages.some((passage) => passage.scope === 'body' && passage.content.includes('A paragraph with')));

  const invalid = inspectMarkdown('A missing image: ![missing](absent.png)', []);
  assert.equal(invalid.issues.length, 1);
  assert.match(invalid.issues[0], /missing from media/);
  assert.ok(invalid.passages.some((passage) => passage.scope === 'body'));
});

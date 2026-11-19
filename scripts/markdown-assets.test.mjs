import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMarkdownImageAssets } from '../supabase/functions/_shared/markdown.mjs';

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

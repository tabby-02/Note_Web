import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareUpload } from './live-upload.mjs';

const file = (name) => ({ name: name.split('/').at(-1), webkitRelativePath: `folder/${name}`, size: 10 });

test('full-folder upload places referenced images in media and other images in attachments', () => {
  const files = [file('note.md'), file('images/used.png'), file('images/extra.png'), file('attachments/old.png')];
  const prepared = prepareUpload(files, 'markdown', 'folder', 'note.md', new Set(['images/used.png']));
  assert.deepEqual(prepared.map((item) => item.relative), ['note.md', 'media/images/used.png', 'attachments/images/extra.png', 'attachments/old.png']);
});

test('main plus images uploads only Markdown-referenced images', () => {
  const files = [file('note.md'), file('images/used.png'), file('images/extra.png')];
  const prepared = prepareUpload(files, 'markdown', 'main-media', 'note.md', new Set(['images/used.png']));
  assert.deepEqual(prepared.map((item) => item.relative), ['note.md', 'media/images/used.png']);
});

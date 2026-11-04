import test from 'node:test';
import assert from 'node:assert/strict';
import { findCurrentHeading, createActiveLinkSetter } from '../src/lib/note-outline.ts';

test('scroll selection handles the beginning, exact boundary, large jumps and end of a note', () => {
  const positions = [100, 200, 300, 400];
  for (const [offset, expected] of [[0, 0], [100, 0], [199, 0], [200, 1], [399, 2], [10000, 3]]) {
    assert.equal(findCurrentHeading(positions.length, (index) => positions[index], offset), expected);
  }
  assert.equal(findCurrentHeading(0, () => { throw new Error('Should not read an absent heading'); }, 100), -1);
});

test('live position reads follow reflow without rebuilding a document-wide geometry cache', () => {
  const positions = [0, 200, 400];
  assert.equal(findCurrentHeading(3, (index) => positions[index], 250), 1);
  positions[1] += 100; positions[2] += 100;
  assert.equal(findCurrentHeading(3, (index) => positions[index], 250), 0);
});

test('even a 4096-heading note needs at most 13 geometry reads per update', () => {
  const count = 4096;
  for (const offset of [-1, 0, 123456, 409500, 1000000]) {
    let reads = 0;
    const index = findCurrentHeading(count, (index) => { reads++; return index * 100; }, offset);
    assert.equal(index, Math.max(0, Math.min(count - 1, Math.floor(offset / 100))));
    assert.ok(reads <= 13, `Read geometry ${reads} times`);
  }
});

test('scrolling within one chapter makes no DOM writes; a chapter change only touches two links', () => {
  const calls = [];
  const link = (name) => ({
    setAttribute: (...args) => calls.push([name, 'set', ...args]),
    removeAttribute: (...args) => calls.push([name, 'remove', ...args]),
  });
  const first = link('first'), second = link('second');
  const setCurrent = createActiveLinkSetter();
  setCurrent(first);
  assert.deepEqual(calls, [['first', 'set', 'aria-current', 'location']]);
  calls.length = 0;
  for (let frame = 0; frame < 120; frame++) setCurrent(first);
  assert.deepEqual(calls, []);
  setCurrent(second);
  assert.deepEqual(calls, [['first', 'remove', 'aria-current'], ['second', 'set', 'aria-current', 'location']]);
  calls.length = 0;
  setCurrent(undefined); setCurrent(undefined);
  assert.deepEqual(calls, [['second', 'remove', 'aria-current']]);
});

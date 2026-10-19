import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc } from '../server/providers/lyrics.js';

test('synced lyrics: timestamps to milliseconds, sorted, repeated lines with several stamps', () => {
  const lines = parseLrc('[ar: Someone]\n[00:01.20] Yeah\n[00:12.50][01:02.00] Chorus\n[00:30.00]\n[00:05:40] Old format');
  assert.deepEqual(lines, [
    { ms: 1200, text: 'Yeah' },
    { ms: 5400, text: 'Old format' },
    { ms: 12500, text: 'Chorus' },
    { ms: 30000, text: '' },
    { ms: 62000, text: 'Chorus' },
  ]);
  assert.deepEqual(parseLrc(''), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NewsProvider } from '../server/providers/news.js';

const names = (p) => p.sources.map((s) => s.name);

test('explicit sources win over country and language defaults', () => {
  const sources = [{ name: 'Mine', url: 'https://example.com/rss' }];
  assert.deepEqual(new NewsProvider({ language: 'es', country: 'MX', sources }).sources, sources);
  assert.deepEqual(new NewsProvider({ language: 'es', country: 'MX', sources, kind: 'markets' }).sources, sources);
});

test('language + country picks the per-country list', () => {
  const mx = new NewsProvider({ language: 'es', country: 'MX' });
  assert.ok(names(mx).includes('El Universal'));
  assert.ok(!names(mx).includes('El País'));
  assert.deepEqual(names(new NewsProvider({ language: 'es', country: 'mx' })), names(mx));
  const mxMarkets = new NewsProvider({ language: 'es', country: 'MX', kind: 'markets' });
  assert.ok(mxMarkets.sources.some((s) => s.url.includes('gl=MX')));
});

test('unknown country falls back to the language defaults', () => {
  const es = names(new NewsProvider({ language: 'es' }));
  assert.ok(es.includes('El País'));
  assert.deepEqual(names(new NewsProvider({ language: 'es', country: 'XX' })), es);
  assert.deepEqual(
    names(new NewsProvider({ language: 'es', country: 'XX', kind: 'markets' })),
    names(new NewsProvider({ language: 'es', kind: 'markets' })),
  );
});

test('unknown language falls back to English', () => {
  const en = names(new NewsProvider({ language: 'en' }));
  assert.ok(en.includes('BBC News'));
  assert.deepEqual(names(new NewsProvider({ language: 'xx' })), en);
  assert.deepEqual(names(new NewsProvider({ language: 'xx', country: 'MX' })), en);
});

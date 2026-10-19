import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, tokens, similarity, NewsProvider } from '../server/providers/news.js';

test('HTML and entities are stripped', () => {
  assert.equal(stripHtml('<p>Espa&ntilde;a gana&nbsp;<b>2-1</b> &amp; m&aacute;s</p>'), 'España gana 2-1 & más');
  assert.equal(stripHtml('a<script>evil()</script>b'), 'a b');
  assert.equal(stripHtml('&#8220;Hola&#8221;'), '“Hola”');
});

test('near-identical headlines are detected', () => {
  const a = tokens('El Gobierno aprueba la nueva ley de vivienda');
  const b = tokens('Gobierno aprueba nueva ley de vivienda, según fuentes');
  const c = tokens('El Valencia empata ante el Athletic en Mestalla');
  assert.ok(similarity(a, b) >= 0.6);
  assert.ok(similarity(a, c) < 0.3);
});

test('feeds are merged round-robin, deduplicated and old items dropped', async () => {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60e3).toISOString();
  const p = new NewsProvider({ language: 'es', sources: [{ name: 'A' }, { name: 'B' }] });
  p.fetchSource = async (src) =>
    src.name === 'A'
      ? [
          { id: '1', title: 'El Gobierno aprueba la nueva ley de vivienda', publishedAt: iso(5), image: null },
          { id: '2', title: 'Noticia antigua', publishedAt: iso(60 * 48), image: null },
        ]
      : [{ id: '3', title: 'Gobierno aprueba nueva ley de vivienda hoy', publishedAt: iso(10), image: 'https://img/x.jpg' }];
  const { items } = await p.fetch();
  assert.equal(items.length, 1, 'duplicate merged and 48 h old item dropped');
  assert.equal(items[0].image, 'https://img/x.jpg', 'the duplicate lends its image');
});

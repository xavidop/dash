import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, t, tn, ord, LANGUAGES } from '../server/lib/i18n.js';

test('bundled languages are discovered', () => {
  assert.ok(LANGUAGES.includes('en'));
  assert.ok(LANGUAGES.includes('es'));
});

test('interpolates variables', () => {
  setLanguage('en');
  assert.equal(t('sports.points', { n: 12 }), '12 pts');
  setLanguage('es');
  assert.equal(t('status.quarter', { n: ord(3) }), '3º cuarto');
});

test('falls back to English, then to the key', () => {
  setLanguage('es');
  assert.equal(t('does.not.exist'), 'does.not.exist');
  setLanguage('xx'); // unknown → English
  assert.equal(t('common.today'), 'Today');
});

test('plurals and ordinals', () => {
  setLanguage('en');
  assert.equal(tn('mlb.runs', 1), '1 run');
  assert.equal(tn('mlb.runs', 3), '3 runs');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map((n) => ord(n)), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  setLanguage('es');
  assert.equal(ord(7, 'f'), '7ª');
  assert.equal(ord(7), '7º');
});

test('ordinals in the other languages', () => {
  setLanguage('fr');
  assert.deepEqual([ord(1), ord(1, 'f'), ord(3)], ['1er', '1re', '3e']);
  setLanguage('de');
  assert.equal(ord(3), '3.');
  for (const l of ['pt', 'it']) {
    setLanguage(l);
    assert.deepEqual([ord(3), ord(3, 'f')], ['3º', '3ª']);
  }
});

test('every language has every English key, the same placeholders, and quotes', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => JSON.parse(readFileSync(new URL(`../locales/${f}`, import.meta.url)));
  const en = read('en.json');
  // Paths as arrays: some keys contain dots ("fifa.world").
  const paths = (o, p = []) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? paths(v, [...p, k]) : [[...p, k]]));
  const keys = (o) => paths(o).map((p) => JSON.stringify(p));
  const get = (o, k) => JSON.parse(k).reduce((a, b) => a?.[b], o);
  const vars = (v) => (JSON.stringify(v ?? '').match(/\{\w+\}/g) || []).sort().join();
  for (const lang of LANGUAGES.filter((l) => l !== 'en')) {
    const dict = read(`${lang}.json`);
    const have = new Set(keys(dict));
    const missing = keys(en).filter((k) => !k.startsWith('["f1","countries"') && !have.has(k));
    assert.deepEqual(missing, [], `${lang}: missing keys`);
    const differ = keys(en).filter((k) => have.has(k) && vars(get(en, k)) !== vars(get(dict, k)));
    assert.deepEqual(differ, [], `${lang}: placeholders differ`);
    assert.ok(dict.meta?.name && dict.meta?.locale, `${lang}: meta`);
    assert.ok(read(`quotes/${lang}.json`).length >= 10, `${lang}: quotes`);
  }
});

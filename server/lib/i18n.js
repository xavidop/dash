import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const DIR = path.join(ROOT, 'locales');
export const LANGUAGES = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

let dict = {};
let fallback = {};
export let language = 'en';

const load = (lang) => JSON.parse(readFileSync(path.join(DIR, `${lang}.json`), 'utf8'));
const lookup = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function setLanguage(lang) {
  language = LANGUAGES.includes(lang) ? lang : 'en';
  fallback = load('en');
  dict = language === 'en' ? fallback : load(language);
}

/** t('status.quarter', { n: '3º' }) → "3º cuarto". Missing keys fall back to English, then to the key. */
export function t(key, vars) {
  let s = lookup(dict, key) ?? lookup(fallback, key) ?? key;
  if (typeof s !== 'string') return s;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}

/** Plural: t(`${key}_one|_other`). */
export const tn = (key, n, vars = {}) => t(`${key}_${n === 1 ? 'one' : 'other'}`, { n, ...vars });

/** Ordinal number: es/pt/it 3º / 7ª (gender 'f'), fr 1er / 3e, de 3., en 3rd. */
export function ord(n, gender = 'm') {
  if (language === 'es' || language === 'pt' || language === 'it') return `${n}${gender === 'f' ? 'ª' : 'º'}`;
  if (language === 'fr') return n === 1 ? (gender === 'f' ? '1re' : '1er') : `${n}e`;
  if (language === 'en') {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  return `${n}.`;
}

setLanguage('en');

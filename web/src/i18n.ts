// All locale files are bundled (they're small); config.language picks one at runtime.
const files = import.meta.glob('../../locales/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;
const DICTS: Record<string, Record<string, unknown>> = {};
for (const [path, dict] of Object.entries(files)) DICTS[path.replace(/^.*\/(\w+)\.json$/, '$1')] = dict;

let lang = 'en';
let dict = DICTS.en;

const lookup = (obj: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);

export function setLanguage(l: string | undefined) {
  lang = l && DICTS[l] ? l : 'en';
  dict = DICTS[lang];
  document.documentElement.lang = lang;
}

export const language = () => lang;
export const defaultLocale = () => (lookup(dict, 'meta.locale') as string) || 'en-GB';

/** t('sports.points', { n: 5 }) → "5 pts". Missing keys fall back to English, then to the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = lookup(dict, key) ?? lookup(DICTS.en, key) ?? key;
  if (typeof s !== 'string') return key;
  if (vars) s = (s as string).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s as string;
}

/** Non-string entries (arrays, maps). */
export const tv = <T>(key: string): T | undefined => (lookup(dict, key) ?? lookup(DICTS.en, key)) as T | undefined;

export const tn = (key: string, n: number, vars: Record<string, string | number> = {}) => t(`${key}_${n === 1 ? 'one' : 'other'}`, { n, ...vars });

/** Ordinal number: es/pt/it 3º / 7ª (gender 'f'), fr 1er / 3e, de 3., en 3rd. */
export function ord(n: number, gender: 'm' | 'f' = 'm') {
  if (lang === 'es' || lang === 'pt' || lang === 'it') return `${n}${gender === 'f' ? 'ª' : 'º'}`;
  if (lang === 'fr') return n === 1 ? (gender === 'f' ? '1re' : '1er') : `${n}e`;
  if (lang === 'en') {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  return `${n}.`;
}

/** Position in a table or ranking: "3º" (es/pt/it), "1er" / "3e" (fr), "3." (de), "#3" (en). */
export const rank = (n: number) => (lang === 'en' ? `#${n}` : lang === 'fr' ? (n === 1 ? '1er' : `${n}e`) : lang === 'de' ? `${n}.` : `${n}º`);

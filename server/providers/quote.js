import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fetchJson } from '../lib/http.js';
import { ROOT } from '../lib/config.js';

const DIR = path.join(ROOT, 'locales', 'quotes');

/**
 * Quote of the day. English uses ZenQuotes' daily quote (no key); every language also has a
 * bundled list (locales/quotes/<lang>.json), picked by day of the year, used offline or as fallback.
 */
export class QuoteProvider {
  constructor(config) {
    this.language = config.language;
    this.timezone = config.timezone;
  }

  localList() {
    for (const lang of [this.language, 'en']) {
      const file = path.join(DIR, `${lang}.json`);
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    }
    return [];
  }

  /** Same quote all day: index by the local date. */
  pickLocal() {
    const list = this.localList();
    if (!list.length) return null;
    const ymd = new Date().toLocaleDateString('en-CA', { timeZone: this.timezone });
    const day = Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 864e5);
    const q = list[day % list.length];
    return { text: q.text, author: q.author, date: ymd, source: 'local' };
  }

  async fetch() {
    const ymd = new Date().toLocaleDateString('en-CA', { timeZone: this.timezone });
    if (this.language === 'en') {
      try {
        const [q] = await fetchJson('https://zenquotes.io/api/today', { timeoutMs: 8000 });
        if (q?.q && !/too many requests/i.test(q.q)) return { text: q.q, author: q.a, date: ymd, source: 'zenquotes' };
      } catch {}
    }
    const local = this.pickLocal();
    if (!local) throw new Error('no quotes available');
    return local;
  }
}

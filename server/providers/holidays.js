import { fetchJson } from '../lib/http.js';

// Spain: reverse geocoding may give the province (ES-M); holidays are per autonomous community (ES-MD).
const ES_PROVINCE_TO_COMMUNITY = {
  A: 'VC', AB: 'CM', AL: 'AN', AV: 'CL', B: 'CT', BA: 'EX', BI: 'PV', BU: 'CL', C: 'GA', CA: 'AN', CC: 'EX', CE: 'CE', CO: 'AN', CR: 'CM',
  CS: 'VC', CU: 'CM', GC: 'CN', GI: 'CT', GR: 'AN', GU: 'CM', H: 'AN', HU: 'AR', J: 'AN', L: 'CT', LE: 'CL', LO: 'RI', LU: 'GA', M: 'MD',
  MA: 'AN', ML: 'ML', MU: 'MC', NA: 'NC', O: 'AS', OR: 'GA', P: 'CL', PM: 'IB', PO: 'GA', S: 'CB', SA: 'CL', SE: 'AN', SG: 'CL', SO: 'CL',
  SS: 'PV', T: 'CT', TE: 'AR', TF: 'CN', TO: 'CM', V: 'VC', VA: 'CL', VI: 'PV', Z: 'AR', ZA: 'CL',
};
export function normalizeRegion(country, region) {
  if (country === 'ES' && region?.startsWith('ES-')) {
    const code = region.slice(3);
    return ES_PROVINCE_TO_COMMUNITY[code] ? `ES-${ES_PROVINCE_TO_COMMUNITY[code]}` : region;
  }
  return region;
}

/** Public holidays (national + your region) from Nager.Date, free and keyless. */
/** Main language of a country ("BR" → "pt"), from CLDR likely-subtags data. */
export function countryLanguage(country) {
  try {
    return new Intl.Locale(`und-${country}`).maximize().language;
  } catch {
    return null;
  }
}

export class HolidaysProvider {
  constructor() {
    this.cache = new Map(); // `${year}-${country}` → list
  }

  async year(year, country) {
    const key = `${year}-${country}`;
    if (!this.cache.has(key)) this.cache.set(key, await fetchJson(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`));
    return this.cache.get(key);
  }

  /** @param {{country:string, region:string, timezone:string}} where */
  async fetch({ country, region, timezone, language = 'en' }) {
    if (!country) throw new Error('unknown country');
    const ymd = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-CA', { timeZone: timezone });
    const today = ymd(0);
    const year = Number(today.slice(0, 4));
    region = normalizeRegion(country, region);
    const list = [...(await this.year(year, country)), ...(await this.year(year + 1, country).catch(() => []))]
      .filter((h) => h.global || !h.counties || (region && h.counties.includes(region)))
      // Nager gives the local-language name and an English one: use the local name only when it is
      // in the display's language (a German display in Spain gets English, not Spanish).
      .map((h) => ({ date: h.date, name: language === countryLanguage(country) ? h.localName : h.name || h.localName, regional: !h.global }));
    const upcoming = list.filter((h) => h.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    return {
      today: upcoming.find((h) => h.date === today) || null,
      tomorrow: upcoming.find((h) => h.date === ymd(1)) || null,
      next: upcoming.find((h) => h.date > today) || null,
    };
  }
}

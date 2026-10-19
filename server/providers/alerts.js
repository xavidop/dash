import { fetchJson } from '../lib/http.js';
import { norm } from './sports/provider.js';

// MeteoAlarm country feeds (all EUMETNET members publish here).
const METEOALARM = {
  AT: 'austria', BA: 'bosnia-herzegovina', BE: 'belgium', BG: 'bulgaria', CH: 'switzerland', CY: 'cyprus', CZ: 'czechia', DE: 'germany',
  DK: 'denmark', EE: 'estonia', ES: 'spain', FI: 'finland', FR: 'france', GB: 'united-kingdom', GR: 'greece', HR: 'croatia', HU: 'hungary',
  IE: 'ireland', IL: 'israel', IS: 'iceland', IT: 'italy', LT: 'lithuania', LU: 'luxembourg', LV: 'latvia', MD: 'moldova', ME: 'montenegro',
  MK: 'republic-of-north-macedonia', MT: 'malta', NL: 'netherlands', NO: 'norway', PL: 'poland', PT: 'portugal', RO: 'romania', RS: 'serbia',
  SE: 'sweden', SI: 'slovenia', SK: 'slovakia', UA: 'ukraine',
};
const LEVELS = { 2: 'yellow', 3: 'orange', 4: 'red' };
const RANK = { yellow: 1, orange: 2, red: 3 };

/**
 * Official weather warnings for the current location:
 *  - Europe: MeteoAlarm (national services, e.g. AEMET). Warnings carry an area name and code, not a polygon,
 *    so they're matched against the location's province/district/city names, or `alerts.areas` from config.
 *  - USA: National Weather Service, matched by exact point.
 * Only yellow (moderate) and above, active now or starting within 24 h.
 */
export class AlertsProvider {
  constructor(config) {
    this.language = config.language;
    this.areas = (config.alerts?.areas || []).map((a) => String(a));
    this.place = null; // { key, country, names[] }
  }

  async locate(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (this.place?.key === key) return this.place;
    const d = await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${this.language}`);
    const admin = d.localityInfo?.administrative || [];
    // Province, district, city (adminLevel ≥ 4); the country/region levels are too broad to match area names.
    const names = admin.filter((a) => (a.adminLevel ?? 0) >= 4).map((a) => a.name);
    names.push(d.city, d.locality);
    this.place = { key, country: d.countryCode, names: [...new Set(names.filter(Boolean).map(norm))].filter((n) => n.length > 2) };
    return this.place;
  }

  matches(areaDesc, codes) {
    if (this.areas.length) return this.areas.some((a) => codes.includes(a) || norm(areaDesc) === norm(a));
    const area = norm(areaDesc);
    return this.place.names.some((n) => area.includes(n) || (area.length > 3 && n.includes(area)));
  }

  async meteoalarm(slug) {
    const d = await fetchJson(`https://feeds.meteoalarm.org/api/v1/warnings/feeds-${slug}`, { timeoutMs: 20000 });
    const now = Date.now();
    const out = [];
    for (const w of d.warnings || []) {
      const infos = w.alert?.info || [];
      const info = infos.find((i) => i.language?.startsWith(this.language)) || infos.find((i) => i.language?.startsWith('en')) || infos[0];
      if (!info) continue;
      const lvl = Number(String(info.parameter?.find((p) => p.valueName === 'awareness_level')?.value || '').split(';')[0]);
      const level = LEVELS[lvl];
      if (!level) continue; // green = no warning
      const onset = Date.parse(info.onset || info.effective);
      const expires = Date.parse(info.expires);
      if (!(expires > now) || onset > now + 24 * 3600e3) continue;
      for (const area of info.area || []) {
        const codes = (area.geocode || []).map((g) => g.value);
        if (!this.matches(area.areaDesc, codes)) continue;
        out.push({ level, event: info.event, headline: info.headline, area: area.areaDesc, onset: new Date(onset).toISOString(), expires: new Date(expires).toISOString(), description: info.description || '' });
      }
    }
    return out;
  }

  async nws(lat, lon) {
    const d = await fetchJson(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
    const sev = { Extreme: 'red', Severe: 'orange', Moderate: 'yellow' };
    return (d.features || [])
      .map((f) => f.properties)
      .filter((p) => sev[p.severity])
      .map((p) => ({ level: sev[p.severity], event: p.event, headline: p.headline || p.event, area: p.areaDesc, onset: p.onset || p.effective, expires: p.ends || p.expires, description: p.description || '' }));
  }

  async fetch({ lat, lon }) {
    const place = await this.locate(lat, lon);
    let list = [];
    if (place.country === 'US') list = await this.nws(lat, lon);
    else if (METEOALARM[place.country]) list = await this.meteoalarm(METEOALARM[place.country]);
    // One entry per event (the highest level wins), most severe first.
    const byEvent = new Map();
    for (const a of list) {
      const k = norm(a.event.replace(/de nivel \w+|level \w+|(yellow|orange|red)/gi, ''));
      if (!byEvent.has(k) || RANK[a.level] > RANK[byEvent.get(k).level]) byEvent.set(k, a);
    }
    return { alerts: [...byEvent.values()].sort((a, b) => RANK[b.level] - RANK[a.level]), country: place.country };
  }
}

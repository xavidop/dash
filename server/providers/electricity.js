import { fetchJson, settleAll } from '../lib/http.js';

// Red Eléctrica (REE) geo ids for the regulated PVPC price.
const REGIONS = { peninsula: 8741, canarias: 8742, baleares: 8743, ceuta: 8744, melilla: 8745 };

/** Cheapest run of `len` consecutive hours among `prices` (only hours ≥ fromHour). */
export function cheapestWindow(prices, len = 2, fromHour = 0) {
  let best = null;
  for (let i = 0; i + len <= prices.length; i++) {
    if (prices[i].hour < fromHour) continue;
    const slice = prices.slice(i, i + len);
    if (slice.some((p, k) => k && p.hour !== slice[k - 1].hour + 1)) continue;
    const avg = Math.round((slice.reduce((a, p) => a + p.price, 0) / len) * 1e4) / 1e4;
    if (!best || avg < best.avg) best = { start: slice[0].hour, end: slice.at(-1).hour + 1, avg };
  }
  return best;
}

/** Each hour tagged cheap / mid / expensive by the day's thirds. */
export function tagLevels(prices) {
  const sorted = prices.map((p) => p.price).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 3)];
  const q2 = sorted[Math.floor((sorted.length * 2) / 3)];
  return prices.map((p) => ({ ...p, level: p.price < q1 ? 'cheap' : p.price >= q2 ? 'expensive' : 'mid' }));
}

/** Spain's regulated electricity price (PVPC) by hour, from REE's free API. €/kWh. */
export class ElectricityProvider {
  constructor(config) {
    this.region = REGIONS[config.electricity?.region] ? config.electricity.region : 'peninsula';
    this.tz = config.timezone;
  }

  async day(ymd) {
    const geo = this.region === 'peninsula' ? '' : `&geo_limit=${this.region}&geo_ids=${REGIONS[this.region]}`;
    const d = await fetchJson(
      `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${ymd}T00:00&end_date=${ymd}T23:59&time_trunc=hour${geo}`,
    );
    const pvpc = (d.included || []).find((x) => x.id === '1001' || /pvpc/i.test(x.type || x.attributes?.title || ''));
    return (pvpc?.attributes?.values || []).map((v) => ({ hour: Number(v.datetime.slice(11, 13)), price: Math.round(v.value) / 1000 }));
  }

  async fetch() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    // Tomorrow's prices are published around 20:15; until then that request is just empty.
    const [t, m] = await settleAll([() => this.day(today), () => this.day(tomorrow)], 2);
    if (!t?.length) throw new Error('no PVPC prices for today');
    const hourNow = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
    const prices = tagLevels(t);
    const now = prices.find((p) => p.hour === hourNow) || null;
    const values = prices.map((p) => p.price);
    return {
      date: today,
      region: this.region,
      prices,
      now,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1e4) / 1e4,
      // Best 2-hour slot for the rest of today (e.g. the washing machine).
      cheapest: cheapestWindow(prices, 2, hourNow) || cheapestWindow(prices, 2),
      tomorrow: m?.length ? { date: tomorrow, prices: tagLevels(m), cheapest: cheapestWindow(m, 2) } : null,
    };
  }
}

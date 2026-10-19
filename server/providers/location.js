import { fetchJson } from '../lib/http.js';
import { language } from '../lib/i18n.js';

/**
 * Location resolution, best source wins:
 *   1. "device": coordinates reported by the browser (Windows location services via Edge)
 *   2. "ip":     IP geolocation, used at startup and when the browser can't provide one
 *   3. "config": config.location.fallback (or fixed coords when mode is "fixed")
 */
export class LocationProvider {
  constructor(config, store) {
    this.config = config;
    this.store = store;
  }

  current() {
    return this.store.get('location')?.data ?? null;
  }

  async init() {
    const { mode, fallback, lat, lon, name } = this.config.location;
    if (mode === 'fixed' && lat != null && lon != null) {
      const place = await this.reverse(lat, lon);
      this.store.set('location', { lat, lon, ...place, city: name || place.city, source: 'config' });
      return;
    }
    const cached = this.current();
    // A previous device fix is better than IP; keep it until the browser reports again
    // (filling in country/region if it was saved by an older version).
    if (cached?.source === 'device') {
      if (!cached.country) {
        const place = await this.reverse(cached.lat, cached.lon);
        if (place.country) this.store.set('location', { ...cached, country: place.country, region: place.region });
      }
      return;
    }
    try {
      const ip = await this.fromIp();
      // Country and region codes (holidays, electricity, broadcasts) come from reverse geocoding.
      const place = await this.reverse(ip.lat, ip.lon);
      this.store.set('location', { ...ip, country: place.country, region: place.region, city: ip.city || place.city });
    } catch (err) {
      if (!cached && fallback?.lat != null) {
        const place = await this.reverse(fallback.lat, fallback.lon);
        this.store.set('location', { lat: fallback.lat, lon: fallback.lon, ...place, city: fallback.name || place.city, source: 'config' });
      }
      console.warn('[location] IP lookup failed, using', cached ? 'cached location' : fallback ? 'config fallback' : 'nothing', err.message);
    }
  }

  async fromIp() {
    try {
      const d = await fetchJson('https://ipwho.is/?fields=success,city,latitude,longitude', { timeoutMs: 6000 });
      if (d.success) return { lat: d.latitude, lon: d.longitude, city: d.city, source: 'ip' };
    } catch {}
    const d = await fetchJson('http://ip-api.com/json/?fields=status,city,lat,lon', { timeoutMs: 6000 });
    if (d.status !== 'success') throw new Error('ip-api failed');
    return { lat: d.lat, lon: d.lon, city: d.city, source: 'ip' };
  }

  /** → { city, country: "ES", region: "ES-VC" } (ISO 3166). Empty strings when the lookup fails. */
  async reverse(lat, lon) {
    try {
      const d = await fetchJson(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${language}`,
        { timeoutMs: 6000 },
      );
      // Region = first-level subdivision (Spain: autonomous community, e.g. ES-MD), which is what holiday data uses.
      // principalSubdivisionCode sometimes returns the province instead (ES-M for Madrid).
      const admin = d.localityInfo?.administrative || [];
      const first = admin.filter((a) => a.isoCode && a.isoCode.startsWith(`${d.countryCode}-`)).sort((a, b) => (a.adminLevel ?? 99) - (b.adminLevel ?? 99))[0];
      return { city: d.city || d.locality || d.principalSubdivision || '', country: d.countryCode || '', region: first?.isoCode || d.principalSubdivisionCode || '' };
    } catch {
      return { city: '', country: '', region: '' };
    }
  }

  /** Called when the browser reports a geolocation fix. Returns true if location changed meaningfully. */
  async fromDevice(lat, lon, accuracy) {
    if (this.config.location.mode === 'fixed') return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const cur = this.current();
    const moved = !cur || distanceKm(cur, { lat, lon }) > 2 || cur.source !== 'device';
    if (!moved) return false;
    const place = await this.reverse(lat, lon);
    this.store.set('location', { lat, lon, ...place, city: place.city || cur?.city || '', accuracy, source: 'device' });
    return true;
  }
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

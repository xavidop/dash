import { fetchJson } from '../lib/http.js';

const POLLEN = ['grass', 'olive', 'birch', 'alder', 'mugwort', 'ragweed'];

/** European AQI bands (0–20 good … >100 extremely poor). */
export function aqiLevel(aqi) {
  if (aqi == null) return null;
  if (aqi <= 20) return 'good';
  if (aqi <= 40) return 'fair';
  if (aqi <= 60) return 'moderate';
  if (aqi <= 80) return 'poor';
  if (aqi <= 100) return 'veryPoor';
  return 'extremelyPoor';
}

/** Pollen grains/m³ → level (generic thresholds; species differ, this is a household hint). */
export function pollenLevel(v) {
  if (v == null) return null;
  if (v < 10) return 'low';
  if (v < 50) return 'moderate';
  if (v < 200) return 'high';
  return 'veryHigh';
}

/** Air quality + pollen from Open-Meteo (free, no key). Pollen is only modelled for Europe. */
export class AirQualityProvider {
  constructor(config) {
    this.tz = config.timezone;
  }

  async fetch({ lat, lon }) {
    const vars = ['european_aqi', 'pm2_5', 'pm10', 'ozone', ...POLLEN.map((p) => `${p}_pollen`)].join(',');
    const d = await fetchJson(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=${vars}&hourly=${POLLEN.map((p) => `${p}_pollen`).join(',')}&forecast_days=1&timezone=${encodeURIComponent(this.tz)}`,
    );
    const c = d.current || {};
    // Pollen: the day's peak per species is more useful than the current hour.
    const pollen = POLLEN.map((type) => {
      const series = (d.hourly?.[`${type}_pollen`] || []).filter((v) => v != null);
      const value = series.length ? Math.max(...series) : c[`${type}_pollen`];
      return { type, value: value == null ? null : Math.round(value), level: pollenLevel(value) };
    })
      .filter((p) => p.value != null)
      .sort((a, b) => b.value - a.value);
    return {
      aqi: c.european_aqi ?? null,
      level: aqiLevel(c.european_aqi),
      pm25: c.pm2_5 ?? null,
      pm10: c.pm10 ?? null,
      pollen,
    };
  }
}

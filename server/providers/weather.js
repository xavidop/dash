import { fetchJson } from '../lib/http.js';

import { t } from '../lib/i18n.js';

// WMO weather interpretation codes → description key + icon key used by the frontend.
const WMO = {
  0: ['clear', 'clear'], 1: ['mainlyClear', 'clear'], 2: ['partly', 'partly'], 3: ['cloudy', 'cloudy'],
  45: ['fog', 'fog'], 48: ['rimeFog', 'fog'],
  51: ['drizzleLight', 'drizzle'], 53: ['drizzle', 'drizzle'], 55: ['drizzleDense', 'drizzle'], 56: ['freezingDrizzle', 'drizzle'], 57: ['freezingDrizzle', 'drizzle'],
  61: ['rainLight', 'rain'], 63: ['rain', 'rain'], 65: ['rainHeavy', 'rain'], 66: ['freezingRain', 'rain'], 67: ['freezingRain', 'rain'],
  71: ['snowLight', 'snow'], 73: ['snow', 'snow'], 75: ['snowHeavy', 'snow'], 77: ['snowGrains', 'snow'],
  80: ['showers', 'showers'], 81: ['showers', 'showers'], 82: ['showersHeavy', 'showers'], 85: ['snowShowers', 'snow'], 86: ['snowShowers', 'snow'],
  95: ['storm', 'storm'], 96: ['stormHail', 'storm'], 99: ['stormHail', 'storm'],
};

const describe = (code) => {
  const [key, icon] = WMO[code] || ['cloudy', 'cloudy'];
  return [t(`wmo.${key}`), icon];
};

export class WeatherProvider {
  constructor(config) {
    this.tz = config.timezone;
  }

  async fetch({ lat, lon }) {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      '&current=temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m,uv_index' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max' +
      `&timezone=${encodeURIComponent(this.tz)}&forecast_days=7`;
    const d = await fetchJson(url);

    const c = d.current;
    const [desc, icon] = describe(c.weather_code);

    // Hourly strip: the next 6 hours from the current local hour.
    const nowHour = c.time.slice(0, 13); // "2026-10-16T13"
    let start = d.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour);
    if (start < 0) start = 0;
    const hourly = [];
    for (let i = start + 1; i < Math.min(start + 7, d.hourly.time.length); i++) {
      hourly.push({
        time: d.hourly.time[i],
        temp: Math.round(d.hourly.temperature_2m[i]),
        icon: describe(d.hourly.weather_code[i])[1],
        isDay: d.hourly.is_day[i] === 1,
        precip: d.hourly.precipitation_probability[i] ?? 0,
      });
    }

    // "Rain soon": first hour in the next 12 with a real chance of rain (for the Today strip).
    let rainSoon = null;
    for (let i = start; i < Math.min(start + 13, d.hourly.time.length); i++) {
      const p = d.hourly.precipitation_probability[i] ?? 0;
      if (p >= 50) {
        rainSoon = { time: d.hourly.time[i], prob: p, now: i <= start + 1 };
        break;
      }
    }

    const daily = d.daily.time.map((date, i) => ({
      date,
      max: Math.round(d.daily.temperature_2m_max[i]),
      min: Math.round(d.daily.temperature_2m_min[i]),
      icon: describe(d.daily.weather_code[i])[1],
      desc: describe(d.daily.weather_code[i])[0],
      precip: d.daily.precipitation_probability_max[i] ?? 0,
      sunrise: d.daily.sunrise[i],
      sunset: d.daily.sunset[i],
    }));

    return {
      current: {
        temp: Math.round(c.temperature_2m),
        feels: Math.round(c.apparent_temperature),
        desc,
        icon,
        code: c.weather_code,
        isDay: c.is_day === 1,
        humidity: c.relative_humidity_2m,
        wind: Math.round(c.wind_speed_10m),
        uv: c.uv_index != null ? Math.round(c.uv_index) : null,
      },
      uvMax: d.daily.uv_index_max?.[0] != null ? Math.round(d.daily.uv_index_max[0]) : null,
      today: daily[0],
      rainSoon,
      hourly,
      daily: daily.slice(1, 6),
    };
  }
}

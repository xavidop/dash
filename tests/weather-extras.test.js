import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aqiLevel, pollenLevel } from '../server/providers/airQuality.js';
import { AlertsProvider } from '../server/providers/alerts.js';

test('European AQI and pollen levels', () => {
  assert.deepEqual([10, 35, 55, 75, 95, 120].map(aqiLevel), ['good', 'fair', 'moderate', 'poor', 'veryPoor', 'extremelyPoor']);
  assert.deepEqual([2, 20, 120, 400].map(pollenLevel), ['low', 'moderate', 'high', 'veryHigh']);
  assert.equal(aqiLevel(null), null);
});

test('MeteoAlarm warnings: yellow+ only, active, matched to my area, highest level per event', async (t) => {
  const now = Date.now();
  const warning = (level, area, event, expiresIn = 3600e3) => ({
    alert: {
      info: [
        {
          language: 'es-ES',
          event,
          headline: event,
          onset: new Date(now - 60e3).toISOString(),
          expires: new Date(now + expiresIn).toISOString(),
          parameter: [{ valueName: 'awareness_level', value: `${level}; x; y` }],
          area: [{ areaDesc: area, geocode: [{ value: 'ES000' }] }],
        },
      ],
    },
  });
  const feed = {
    warnings: [
      warning(2, 'Litoral sur de Valencia', 'Aviso de lluvias de nivel amarillo'),
      warning(3, 'Interior de Valencia', 'Aviso de lluvias de nivel naranja'),
      warning(1, 'Litoral sur de Valencia', 'Aviso de nieblas de nivel verde'), // green: not a warning
      warning(3, 'Menorca', 'Aviso de vientos de nivel naranja'), // elsewhere
      warning(2, 'Litoral sur de Valencia', 'Aviso de calor de nivel amarillo', -3600e3), // expired
    ],
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(feed), { headers: { 'content-type': 'application/json' } }));
  const p = new AlertsProvider({ language: 'es', alerts: {} });
  p.place = { key: '39.47,-0.38', country: 'ES', names: ['valencia', 'comarca de valencia'] };
  p.locate = async () => p.place;
  const { alerts } = await p.fetch({ lat: 39.47, lon: -0.38 });
  assert.equal(alerts.length, 1, 'rain warnings collapse to one');
  assert.equal(alerts[0].level, 'orange');
  assert.equal(alerts[0].area, 'Interior de Valencia');
});

test('config alerts.areas pins exact zones', () => {
  const p = new AlertsProvider({ language: 'es', alerts: { areas: ['ES523'] } });
  p.place = { names: ['valencia'] };
  assert.equal(p.matches('Interior de Valencia', ['ES521']), false);
  assert.equal(p.matches('Litoral sur de Valencia', ['ES523']), true);
});

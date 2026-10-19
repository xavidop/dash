import { fetchJson } from '../lib/http.js';

/**
 * RainViewer radar frames (free, keyless): the last ~2 hours in 10-minute steps.
 * The free tier has no forecast frames and serves radar tiles up to zoom 7; the browser
 * loads the tiles directly and draws them over a CARTO base map.
 */
export class RadarProvider {
  async fetch() {
    const d = await fetchJson('https://api.rainviewer.com/public/weather-maps.json');
    const frames = [...(d.radar?.past || []), ...(d.radar?.nowcast || [])].map((f) => ({ time: f.time * 1000, path: f.path }));
    if (!frames.length) throw new Error('no radar frames');
    return { host: d.host, frames, nowcastFrom: (d.radar?.past || []).length };
  }
}

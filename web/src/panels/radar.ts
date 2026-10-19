import type { AppState } from '../types';
import { esc, ago, timeOf } from '../format';
import { t } from '../i18n';
import { now } from '../store';

// Base map at zoom 8 (OpenStreetMap by default, see config radar.tiles), radar at zoom 7
// (RainViewer's free limit), drawn 2× so both line up.
const Z = 8;
const TILE = 256;
const FRAME_MS = 600;
const HOLD_MS = 1800;

function worldPx(lat: number, lon: number, z: number) {
  const n = 2 ** z * TILE;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

// ─── Coverage: RainViewer has no radar over much of Africa, South America and Asia ──
// Its coverage layer is transparent where radar exists and opaque where it doesn't. Sample the
// pixel at the display's location once (cached per ~10 km) and hide the radar where it's blind.
const coverage = new Map<string, boolean | 'checking'>();
let onCoverage: () => void = () => {};
export const onRadarCoverage = (fn: () => void) => (onCoverage = fn);

export function radarCovered(lat: number, lon: number): boolean | null {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const known = coverage.get(key);
  if (known === true || known === false) return known;
  if (!known) {
    try {
      const saved = localStorage.getItem(`dash:radarCoverage:${key}`);
      if (saved === '1' || saved === '0') {
        coverage.set(key, saved === '1');
        return saved === '1';
      }
    } catch {}
    coverage.set(key, 'checking');
    const z = 6;
    const p = worldPx(lat, lon, z);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let covered = true;
      try {
        const c = document.createElement('canvas');
        c.width = c.height = TILE;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        covered = g.getImageData(Math.floor(p.x % TILE), Math.floor(p.y % TILE), 1, 1).data[3] < 128;
      } catch {}
      coverage.set(key, covered);
      try {
        localStorage.setItem(`dash:radarCoverage:${key}`, covered ? '1' : '0');
      } catch {}
      onCoverage();
    };
    // Can't tell (offline, blocked): assume covered rather than hide a working radar.
    img.onerror = () => {
      coverage.set(key, true);
      onCoverage();
    };
    img.src = `https://tilecache.rainviewer.com/v2/coverage/0/256/${z}/${Math.floor(p.x / TILE)}/${Math.floor(p.y / TILE)}/0/0_0.png`;
  }
  return null;
}

/** Radar usable here at all (feature on, frames loaded, location known and covered). */
export function radarAvailable(s: AppState) {
  const loc = s.sections.location?.data;
  if (s.config?.features?.radar === false || !s.sections.radar?.data?.frames?.length || !loc) return false;
  return radarCovered(loc.lat, loc.lon) === true;
}

/** Show the radar in the rotation: always, or only when rain is likely. */
export function radarWanted(s: AppState) {
  if (!radarAvailable(s)) return false;
  if (s.config?.radarShowWhen === 'always') return true;
  const w = s.sections.weather?.data;
  return !!w && (!!w.rainSoon || ['rain', 'showers', 'storm', 'drizzle'].includes(w.current.icon));
}

let timer: number | undefined;

/** Builds the map inside `host` (panel or overlay) and starts the frame animation. */
export function mountRadar(host: HTMLElement, s: AppState, opts: { overlay?: boolean } = {}) {
  clearInterval(timer);
  const r = s.sections.radar?.data;
  const loc = s.sections.location?.data;
  if (!r || !loc) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <div class="${opts.overlay ? 'radar-sheet-inner' : 'panel-pad'} radar">
      <h1 class="panel-title">${t('radar.title')}<span class="page-of">${t('radar.last')}</span>${opts.overlay ? `<button class="set-done rd-close" data-radar-close>${t('radar.close')}</button>` : ''}</h1>
      <div class="card rd-map"><div class="rd-tiles"></div><div class="rd-frame"></div><div class="rd-attrib">${esc(`${s.config?.radarAttribution || '© OpenStreetMap'} · ${t('radar.attribution')}`)}</div><div class="rd-bar"></div></div>
    </div>`;
  const map = host.querySelector<HTMLElement>('.rd-map')!;
  const tiles = map.querySelector<HTMLElement>('.rd-tiles')!;
  const label = map.querySelector<HTMLElement>('.rd-frame')!;
  const bar = map.querySelector<HTMLElement>('.rd-bar')!;

  requestAnimationFrame(() => {
    const W = map.clientWidth || window.innerWidth;
    const H = map.clientHeight || window.innerHeight * 0.7;
    const c = worldPx(loc.lat, loc.lon, Z);
    const ox = c.x - W / 2;
    const oy = c.y - H / 2;
    const max = 2 ** Z;
    const tileUrl = s.config?.radarTiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    let html = '<div class="rd-layer base">';
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++) {
      for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + H) / TILE); ty++) {
        if (ty < 0 || ty >= max) continue;
        const x = ((tx % max) + max) % max;
        const src = tileUrl.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(ty));
        html += `<img src="${esc(src)}" style="left:${tx * TILE - ox}px;top:${ty * TILE - oy}px" alt="" referrerpolicy="strict-origin-when-cross-origin">`;
      }
    }
    html += '</div>';
    // Radar frames: zoom 7 tiles, each covering 2×2 base tiles (512 px).
    const R = TILE * 2;
    const max7 = 2 ** (Z - 1);
    r.frames.forEach((f, i) => {
      html += `<div class="rd-layer radar ${i === r.frames.length - 1 ? 'on' : ''}" data-i="${i}">`;
      for (let tx = Math.floor(ox / R); tx <= Math.floor((ox + W) / R); tx++) {
        for (let ty = Math.floor(oy / R); ty <= Math.floor((oy + H) / R); ty++) {
          if (ty < 0 || ty >= max7) continue;
          const x = ((tx % max7) + max7) % max7;
          html += `<img src="${esc(r.host)}${esc(f.path)}/256/${Z - 1}/${x}/${ty}/2/1_1.png" style="left:${tx * R - ox}px;top:${ty * R - oy}px;width:${R}px;height:${R}px" alt="" loading="eager">`;
        }
      }
      html += '</div>';
    });
    html += `<span class="rd-me" style="left:${W / 2}px;top:${H / 2}px"></span>`;
    tiles.innerHTML = html;

    const layers = [...tiles.querySelectorAll<HTMLElement>('.rd-layer.radar')];
    const total = layers.length;
    let i = total - 1;
    let held = 0;
    const show = () => {
      layers.forEach((l, k) => l.classList.toggle('on', k === i));
      const f = r.frames[i];
      const mins = Math.round((now() - f.time) / 60e3);
      label.textContent = `${timeOf(new Date(f.time))} · ${mins <= 5 ? t('radar.now') : ago(f.time)}`;
      bar.style.transform = `scaleX(${(i + 1) / total})`;
    };
    show();
    // Play the last 2 hours, then hold on the latest frame for a moment.
    timer = window.setInterval(() => {
      if (i === total - 1 && (held += FRAME_MS) < HOLD_MS) return;
      held = 0;
      i = (i + 1) % total;
      show();
    }, FRAME_MS);
  });
}

export const stopRadar = () => clearInterval(timer);

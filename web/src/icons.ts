/**
 * Weather icons as inline SVG. Large icons animate with CSS (transform/opacity only,
 * compositor-friendly); small ones in strips are static to save CPU.
 */

const SUN = '#FFB300';
const MOON = '#F3E6B5';
const CLOUD = '#FFFFFF';
const CLOUD_DARK = '#B8C4D6';
const DROP = '#4A90E2';

function sun(cx = 32, cy = 32, r = 11) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 5);
    const y1 = cy + Math.sin(a) * (r + 5);
    const x2 = cx + Math.cos(a) * (r + 10);
    const y2 = cy + Math.sin(a) * (r + 10);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join('');
  return `<g class="wi-sun" style="transform-origin:${cx}px ${cy}px"><g stroke="${SUN}" stroke-width="3.2" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/></g>`;
}

function moon(cx = 32, cy = 30) {
  return `<g class="wi-moon"><path d="M${cx + 6} ${cy - 14} a14 14 0 1 0 10 20 a11 11 0 1 1 -10 -20z" fill="${MOON}"/></g>`;
}

function cloud(x = 0, y = 0, scale = 1, fill = CLOUD, cls = 'wi-cloud') {
  return `<g class="${cls}" transform="translate(${x} ${y}) scale(${scale})"><path d="M18 46h30a10 10 0 0 0 0-20a14 14 0 0 0-27-3a10 10 0 0 0-3 23z" fill="${fill}" stroke="rgba(30,50,80,.12)" stroke-width="1"/></g>`;
}

function drops(n: number, cls = 'wi-drop', color = DROP) {
  return Array.from({ length: n }, (_, i) => {
    const x = 22 + i * 9;
    return `<line class="${cls}" style="animation-delay:${(i * 0.27).toFixed(2)}s" x1="${x}" y1="50" x2="${x - 3}" y2="58" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
  }).join('');
}

function flakes(n: number) {
  return Array.from({ length: n }, (_, i) => `<circle class="wi-flake" style="animation-delay:${(i * 0.4).toFixed(1)}s" cx="${22 + i * 9}" cy="54" r="2.6" fill="#fff" stroke="#9fb4cc" stroke-width=".8"/>`).join('');
}

export function weatherIcon(key: string, isDay = true, opts: { animated?: boolean; size?: string } = {}) {
  const body = (() => {
    const orb = isDay ? sun(24, 24, 9) : moon(26, 24);
    switch (key) {
      case 'clear':
        return isDay ? sun() : moon(30, 32);
      case 'partly':
        return orb + cloud(8, 6, 0.9);
      case 'cloudy':
        return cloud(-6, -6, 0.8, CLOUD_DARK, 'wi-cloud wi-cloud-back') + cloud(4, 2, 1);
      case 'fog':
        return cloud(2, -4, 0.95) + `<g class="wi-fog" stroke="#C9D3E0" stroke-width="3" stroke-linecap="round"><line x1="14" y1="52" x2="50" y2="52"/><line x1="20" y1="58" x2="46" y2="58"/></g>`;
      case 'drizzle':
        return cloud(2, -4, 0.95) + drops(3);
      case 'rain':
        return cloud(2, -6, 0.95, CLOUD_DARK) + drops(4);
      case 'showers':
        return orb + cloud(6, 0, 0.9) + drops(3);
      case 'snow':
        return cloud(2, -6, 0.95) + flakes(4);
      case 'storm':
        return cloud(2, -8, 0.95, '#8E9BB0') + `<path class="wi-bolt" d="M34 44l-8 12h7l-4 10 12-15h-7l4-7z" fill="#FFC107"/>` + drops(2);
      default:
        return cloud(2, 2, 1);
    }
  })();
  return `<svg class="wi ${opts.animated ? 'wi-animated' : ''}" viewBox="0 0 64 64" aria-hidden="true" ${opts.size ? `style="width:${opts.size};height:${opts.size}"` : ''}>${body}</svg>`;
}

export const ICON = {
  drop: `<svg viewBox="0 0 24 24" class="ico"><path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" fill="currentColor"/></svg>`,
  sunrise: `<svg viewBox="0 0 24 24" class="ico"><path d="M4 18h16M7 15a5 5 0 0 1 10 0M12 4v5m-3-2 3-3 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sunset: `<svg viewBox="0 0 24 24" class="ico"><path d="M4 18h16M7 15a5 5 0 0 1 10 0M12 4v5m-3-2 3 3 3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" class="ico"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="var(--pin-hole, #fff)"/></svg>`,
  wind: `<svg viewBox="0 0 24 24" class="ico"><path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  ball: `<svg viewBox="0 0 24 24" class="ico ball"><circle cx="12" cy="12" r="9.5" fill="#fff" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.5l3.6 2.6-1.4 4.3H9.8L8.4 10.1z" fill="currentColor"/></svg>`,
};

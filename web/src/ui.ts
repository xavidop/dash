import { esc, ago } from './format';
import type { Section, TeamRef } from './types';
import { now } from './store';
import { t } from './i18n';

/** Team crest inside a white chip so any logo reads on any background. */
export function crest(t: { logo: string | null; name: string; abbr?: string } | null | undefined, cls = '') {
  if (!t) return `<span class="crest ${cls}"></span>`;
  const initials = esc((t.abbr || t.name || '?').slice(0, 3));
  return `<span class="crest ${cls}" data-initials="${initials}">${
    t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''
  }</span>`;
}

/** Subtle freshness label, only when the data is stale or the last refresh failed. */
export function staleLabel(section: Section<unknown> | undefined, expectedMinutes: number) {
  if (!section?.updatedAt) return '';
  const age = now() - section.updatedAt;
  if (!section.error && age < expectedMinutes * 60e3 * 2.5) return '';
  return `<div class="stale">${esc(t('common.updated', { ago: ago(section.updatedAt) }))}</div>`;
}

export const teamColor = (t: TeamRef | { color?: string | null }, fallback = '#3b4a63') => t?.color || fallback;

/** Pick readable text color for a background hex. */
export function onColor(hex: string | null | undefined) {
  const h = (hex || '#333').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#14202e' : '#ffffff';
}

/** Darken/lighten a hex color by amount (-1..1). */
export function shade(hex: string | null | undefined, amt: number) {
  const h = (hex || '#3b4a63').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Near-white team colors (some ESPN primaries are #ffffff) are useless as a surface: use the alt color. */
export function surfaceColor(t: { color?: string | null; altColor?: string | null }) {
  const c = t.color || '#3b4a63';
  return onColor(c) === '#14202e' && t.altColor ? t.altColor : c;
}

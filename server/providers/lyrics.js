import { fetchJson } from '../lib/http.js';

// Lyrics for the Music panel from LRCLIB (lrclib.net: free, no key, community-made). Most popular
// songs have time-synced lines, so the screen can follow along; others have plain text only.

const API = 'https://lrclib.net/api';
const cache = new Map(); // Spotify uri → lyrics (or null when there are none)

/** "[01:02.50] line" (a line may carry several timestamps) → [{ ms, text }] sorted by time. */
export function parseLrc(lrc) {
  const out = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) out.push({ ms: Math.round((Number(s[1]) * 60 + Number(s[2].replace(':', '.'))) * 1000), text });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

function shape(d) {
  if (!d) return null;
  if (d.instrumental) return { instrumental: true, synced: null, plain: null };
  const synced = parseLrc(d.syncedLyrics);
  const plain = d.plainLyrics?.trim() || null;
  return synced.length || plain ? { instrumental: false, synced: synced.length ? synced : null, plain } : null;
}

const get = (url) => fetchJson(url, { headers: { 'User-Agent': 'Dash smart display (open source)' }, timeoutMs: 10000 });

/** Lyrics for a song, or null. Exact match first (title, artist, album, length), then a search. */
export async function lyricsFor({ uri, track, artist, album, durationMs }) {
  if (!track || !artist) return null;
  const key = uri || `${artist}|${track}`;
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try {
    const q = new URLSearchParams({ track_name: track, artist_name: artist, ...(album ? { album_name: album } : {}), ...(durationMs ? { duration: String(Math.round(durationMs / 1000)) } : {}) });
    result = shape(await get(`${API}/get?${q}`));
  } catch (err) {
    if (!/HTTP 404/.test(err.message)) throw err;
  }
  if (!result) {
    // No exact match (a remaster, "- Live", a different album): the closest-length search hit.
    const hits = await get(`${API}/search?${new URLSearchParams({ track_name: track.replace(/\s+[-(].*$/, ''), artist_name: artist })}`).catch(() => []);
    const near = (hits || []).filter((h) => !durationMs || Math.abs(h.duration * 1000 - durationMs) < 8000).sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics));
    result = shape(near[0]);
  }
  cache.set(key, result);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return result;
}

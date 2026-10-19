import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA_DIR } from './config.js';

const CACHE_FILE = path.join(DATA_DIR, 'cache.json');

/**
 * Central state. Each section ({ data, updatedAt, error }) is persisted to disk so a
 * restart paints the last known data instantly, and failures never blank the screen.
 */
export class Store extends EventEmitter {
  constructor({ persist = true } = {}) {
    super();
    this.persist = persist;
    this.sections = {};
    this.meta = {}; // non-broadcast persisted values (resolved team IDs, location, …)
    this._saveTimer = null;
    if (persist) this._load();
  }

  _load() {
    try {
      if (!existsSync(CACHE_FILE)) return;
      const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
      this.sections = raw.sections || {};
      this.meta = raw.meta || {};
      // Live data from a previous run is never trustworthy after a restart.
      delete this.sections.live;
    } catch (err) {
      console.warn('[store] could not read cache:', err.message);
    }
  }

  _scheduleSave() {
    if (!this.persist || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        mkdirSync(DATA_DIR, { recursive: true });
        const tmp = CACHE_FILE + '.tmp';
        writeFileSync(tmp, JSON.stringify({ sections: this.sections, meta: this.meta }));
        renameSync(tmp, CACHE_FILE);
      } catch (err) {
        console.warn('[store] could not write cache:', err.message);
      }
    }, 2000);
  }

  get(key) {
    return this.sections[key];
  }

  /** Successful refresh. */
  set(key, data) {
    this.sections[key] = { data, updatedAt: Date.now(), error: null };
    this._scheduleSave();
    this.emit('update', key, this.sections[key]);
  }

  /** Failed refresh: keep the old data, flag it as stale. */
  fail(key, err) {
    const prev = this.sections[key];
    console.warn(`[${key}] refresh failed:`, err?.message || err);
    this.sections[key] = { data: prev?.data ?? null, updatedAt: prev?.updatedAt ?? null, error: String(err?.message || err) };
    this.emit('update', key, this.sections[key]);
  }

  getMeta(key) {
    return this.meta[key];
  }

  setMeta(key, value) {
    this.meta[key] = value;
    this._scheduleSave();
  }

  snapshot() {
    return this.sections;
  }
}

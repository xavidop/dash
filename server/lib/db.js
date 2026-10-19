import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DATA_DIR } from './config.js';

const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_AUTO = 14; // daily copies kept
const KEEP_MANUAL = 10; // copies taken before a restore

/** What a backup carries: everything the household entered, not caches or config bookkeeping. */
const BACKUP_KEYS = {
  favorites: 'object',
  notes: 'array',
  countdowns: 'array',
  settings: 'object',
  shopping: 'array',
  recipes: 'array',
  memories: 'array',
};
const BACKUP_NAME = /^db-\d{8}-\d{6}(\d{3})?-(auto|before-restore)\.json$/;

/**
 * Tiny local JSON database (data/db.json) for user data that must survive restarts:
 * favourites (teams, F1 drivers, tennis players) and notes. Writes are atomic.
 */
export class Db {
  /**
   * @param {object} defaults      config.json favourites (+ symbols): seed and source of truth when changed
   * @param {object} baseSettings  config.json general settings: Settings-screen overrides are dropped when they change
   */
  constructor(defaults, baseSettings = {}) {
    this.data = { version: 1, favorites: { teams: [], drivers: [], players: [], symbols: [] }, notes: [], countdowns: [], settings: {} };
    const hash = createHash('sha1').update(JSON.stringify(defaults || {})).digest('hex');

    if (existsSync(DB_FILE)) {
      try {
        this.data = { ...this.data, ...JSON.parse(readFileSync(DB_FILE, 'utf8')) };
      } catch (err) {
        console.warn('[db] unreadable db.json, starting from defaults:', err.message);
      }
    }
    // config.json `favorites` is the source of truth when it changes; Ajustes edits persist until then.
    if (this.data.seedHash !== hash) {
      if (this.data.seedHash) console.log('[db] favourites in config.json changed: applying them');
      this.data.seedHash = hash;
      this.seed(defaults);
    }
    // Per setting: if a value changed in config.json since last start, config wins for that setting only.
    const prevBase = this.data.settingsBase;
    if (prevBase) {
      for (const k of Object.keys(this.data.settings || {})) {
        if (k in prevBase && JSON.stringify(prevBase[k]) !== JSON.stringify(baseSettings[k])) {
          console.log(`[db] "${k}" changed in config.json: it replaces the on-screen setting`);
          delete this.data.settings[k];
        }
      }
    }
    this.data.settingsBase = baseSettings;
    delete this.data.settingsHash;
    this.save();
  }

  // ── Backup and restore ──
  /** A portable copy of the user's data (download it from Settings). */
  exportData() {
    const data = {};
    for (const k of Object.keys(BACKUP_KEYS)) if (this.data[k] !== undefined) data[k] = this.data[k];
    return { app: 'dash', format: 1, exportedAt: new Date().toISOString(), data };
  }

  /** Checks a backup file and tells what's in it, without changing anything. */
  static inspect(backup) {
    if (!backup || backup.app !== 'dash' || typeof backup.data !== 'object' || !backup.data) throw new Error('not a Dash backup');
    if (backup.format > 1) throw new Error('backup made by a newer Dash version');
    const counts = {};
    for (const [k, type] of Object.entries(BACKUP_KEYS)) {
      const v = backup.data[k];
      if (v === undefined) continue;
      if (type === 'array' ? !Array.isArray(v) : typeof v !== 'object' || Array.isArray(v) || v === null) throw new Error(`invalid "${k}" in backup`);
      counts[k] = type === 'array' ? v.length : k === 'favorites' ? (v.teams?.length || 0) + (v.drivers?.length || 0) + (v.players?.length || 0) : Object.keys(v).length;
    }
    return { exportedAt: backup.exportedAt || null, counts };
  }

  /**
   * Replaces the user's data with a backup's. A copy of the current data is saved first. The
   * config.json bookkeeping (seed hash, settings base) of this install is kept, so restored
   * favourites and settings aren't overwritten by config.json on the next start.
   */
  importData(backup) {
    const info = Db.inspect(backup);
    const before = this.snapshot('before-restore');
    for (const k of Object.keys(BACKUP_KEYS)) if (backup.data[k] !== undefined) this.data[k] = structuredClone(backup.data[k]);
    this.data.favorites = { teams: [], drivers: [], players: [], symbols: [], ...this.data.favorites };
    this.save();
    return { ...info, savedCurrentAs: before };
  }

  /** Writes data/backups/db-YYYYMMDD-HHMMSS-<reason>.json and prunes old copies. */
  snapshot(reason = 'auto') {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`;
    const name = `db-${stamp}-${reason}.json`;
    writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(this.exportData(), null, 2));
    for (const [kind, keep] of [['auto', KEEP_AUTO], ['before-restore', KEEP_MANUAL]]) {
      for (const old of this.backups().filter((b) => b.kind === kind).slice(keep)) unlinkSync(path.join(BACKUP_DIR, old.name));
    }
    return name;
  }

  /** Copies on disk, newest first. */
  backups() {
    if (!existsSync(BACKUP_DIR)) return [];
    return readdirSync(BACKUP_DIR)
      .filter((n) => BACKUP_NAME.test(n))
      .map((name) => {
        const st = statSync(path.join(BACKUP_DIR, name));
        return { name, kind: name.includes('before-restore') ? 'before-restore' : 'auto', at: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  }

  readBackup(name) {
    if (!BACKUP_NAME.test(String(name))) throw new Error('unknown backup');
    const file = path.join(BACKUP_DIR, name);
    if (!existsSync(file)) throw new Error('unknown backup');
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  /** One automatic copy a day (called at start and periodically). */
  autoBackup() {
    const last = this.backups().find((b) => b.kind === 'auto');
    if (last && Date.now() - last.at < 20 * 3600e3) return null;
    return this.snapshot('auto');
  }

  // ── General settings (overrides on top of config.json) ──
  settings() {
    return this.data.settings || {};
  }

  setSettings(patch) {
    this.data.settings = { ...this.settings(), ...patch };
    this.save();
    return this.data.settings;
  }

  seed(defaults = {}) {
    this.data.favorites = {
      teams: (defaults.teams || []).map((t) => ({ ...t })),
      drivers: [...(defaults.drivers || [])],
      players: [...(defaults.players || [])],
      symbols: [...(defaults.symbols || [])],
      leagues: [...(defaults.leagues || [])],
    };
    this.save();
  }

  save() {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, DB_FILE);
  }

  // ── Favourites ──
  favorites() {
    return this.data.favorites;
  }

  setFavorites(fav) {
    this.data.favorites = {
      teams: Array.isArray(fav.teams) ? fav.teams : this.data.favorites.teams,
      drivers: Array.isArray(fav.drivers) ? fav.drivers : this.data.favorites.drivers,
      players: Array.isArray(fav.players) ? fav.players : this.data.favorites.players,
      symbols: Array.isArray(fav.symbols) ? fav.symbols : this.data.favorites.symbols || [],
      leagues: Array.isArray(fav.leagues) ? fav.leagues : this.data.favorites.leagues || [],
    };
    this.save();
    return this.data.favorites;
  }

  // ── Notes ──
  notes() {
    return this.data.notes;
  }

  addNote({ text, color = 'yellow', pinned = false, remindAt = null }) {
    const note = {
      id: randomUUID(),
      text: String(text || '').slice(0, 500),
      color,
      pinned: !!pinned,
      done: false,
      remindAt: validTime(remindAt), // optional reminder (epoch ms): pops up on screen at that time
      reminded: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.notes.unshift(note);
    this.save();
    return note;
  }

  updateNote(id, patch) {
    const n = this.data.notes.find((x) => x.id === id);
    if (!n) return null;
    for (const k of ['text', 'color', 'pinned', 'done', 'reminded']) if (k in patch) n[k] = k === 'text' ? String(patch.text).slice(0, 500) : patch[k];
    if ('remindAt' in patch) {
      n.remindAt = validTime(patch.remindAt);
      n.reminded = false;
    }
    n.updatedAt = Date.now();
    this.save();
    return n;
  }

  // ── Recipes cooked recently (cooking mode history) ──
  recipes() {
    return this.data.recipes || [];
  }

  /** Saves a recipe at the top of the history (same title or link replaces the old copy). */
  saveRecipe(recipe) {
    const same = (x) => (recipe.source && x.source === recipe.source) || x.title.toLocaleLowerCase() === recipe.title.toLocaleLowerCase();
    const prev = this.recipes().find(same);
    const saved = { ...recipe, id: prev?.id || randomUUID(), savedAt: Date.now() };
    this.data.recipes = [saved, ...this.recipes().filter((x) => !same(x))].slice(0, 30);
    this.save();
    return saved;
  }

  deleteRecipe(id) {
    const before = this.recipes().length;
    this.data.recipes = this.recipes().filter((x) => x.id !== id);
    this.save();
    return this.recipes().length !== before;
  }

  // ── Things the assistant was asked to remember ──
  memories() {
    return this.data.memories || [];
  }

  remember(text) {
    const t = String(text || '').trim().slice(0, 300);
    if (!t) throw new Error('nothing to remember');
    const m = { id: randomUUID(), text: t, createdAt: Date.now() };
    this.data.memories = [...this.memories(), m].slice(-200);
    this.save();
    return m;
  }

  /** Forgets by id, or every memory containing all the given words (case-insensitive). */
  forget({ id, about } = {}) {
    const words = String(about || '')
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const hit = (m) => m.id === id || (words.length && words.every((w) => m.text.toLocaleLowerCase().includes(w)));
    const gone = this.memories().filter(hit);
    this.data.memories = this.memories().filter((m) => !hit(m));
    this.save();
    return gone;
  }

  // ── Shopping list ──
  shopping() {
    return this.data.shopping || [];
  }

  /** Adds items, skipping ones already on the list (a ticked-off duplicate comes back). */
  addShopping(items) {
    const list = [...this.shopping()];
    const added = [];
    for (const raw of [].concat(items || [])) {
      const text = String(raw || '').trim().slice(0, 80);
      if (!text) continue;
      const same = list.find((x) => x.text.toLocaleLowerCase() === text.toLocaleLowerCase());
      if (same) {
        if (same.done) Object.assign(same, { done: false, updatedAt: Date.now() });
        continue;
      }
      const item = { id: randomUUID(), text, done: false, createdAt: Date.now(), updatedAt: Date.now() };
      list.push(item);
      added.push(item);
    }
    this.data.shopping = list.slice(-100);
    this.save();
    return added;
  }

  updateShopping(id, { done, text } = {}) {
    const item = this.shopping().find((x) => x.id === id);
    if (!item) return null;
    if (done !== undefined) item.done = !!done;
    if (typeof text === 'string' && text.trim()) item.text = text.trim().slice(0, 80);
    item.updatedAt = Date.now();
    this.save();
    return item;
  }

  /** Removes by id, or by name (case-insensitive) for the voice assistant. */
  removeShopping({ id, names } = {}) {
    const wanted = new Set([].concat(names || []).map((n) => String(n).trim().toLocaleLowerCase()));
    const before = this.shopping().length;
    this.data.shopping = this.shopping().filter((x) => x.id !== id && !wanted.has(x.text.toLocaleLowerCase()));
    this.save();
    return before - this.shopping().length;
  }

  clearShoppingDone() {
    this.data.shopping = this.shopping().filter((x) => !x.done);
    this.save();
  }

  // ── Countdowns ("12 days to the trip") ──
  countdowns() {
    return this.data.countdowns || [];
  }

  addCountdown({ title, date, yearly = false }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('date must be YYYY-MM-DD');
    const c = { id: randomUUID(), title: String(title || '').trim().slice(0, 60), date, yearly: !!yearly };
    if (!c.title) throw new Error('title required');
    this.data.countdowns = [...this.countdowns(), c];
    this.save();
    return c;
  }

  deleteCountdown(id) {
    const before = this.countdowns().length;
    this.data.countdowns = this.countdowns().filter((c) => c.id !== id);
    this.save();
    return this.countdowns().length !== before;
  }

  deleteNote(id) {
    const before = this.data.notes.length;
    this.data.notes = this.data.notes.filter((x) => x.id !== id);
    this.save();
    return this.data.notes.length !== before;
  }
}

function validTime(v) {
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

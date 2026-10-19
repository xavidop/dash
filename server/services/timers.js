import { randomUUID } from 'node:crypto';

const MAX_TIMERS = 6;
const RING_KEEP_MS = 30 * 60e3; // a finished timer keeps ringing (on screen) until dismissed, at most 30 min

/**
 * Kitchen timers. Kept on the server so a timer started from a phone rings on the display,
 * and survives a page reload (persisted with the store cache).
 */
export class TimersService {
  constructor(store) {
    this.store = store;
    const prev = store.get('timers')?.data?.timers || [];
    this.timers = prev.filter((x) => Date.now() - x.endsAt < RING_KEEP_MS);
    this.publish();
  }

  publish() {
    this.store.set('timers', { timers: this.timers });
  }

  add(seconds, label = '') {
    const s = Math.round(Number(seconds));
    if (!(s >= 5 && s <= 24 * 3600)) throw new Error('duration must be between 5 s and 24 h');
    if (this.timers.length >= MAX_TIMERS) throw new Error(`at most ${MAX_TIMERS} timers`);
    const timer = { id: randomUUID(), label: String(label).slice(0, 40), seconds: s, startedAt: Date.now(), endsAt: Date.now() + s * 1000 };
    this.timers.push(timer);
    this.publish();
    return timer;
  }

  extend(id, seconds) {
    const tm = this.timers.find((x) => x.id === id);
    if (!tm) return null;
    // Adding time to a finished timer restarts it from now.
    tm.endsAt = Math.max(tm.endsAt, Date.now()) + Math.round(seconds) * 1000;
    tm.seconds += Math.round(seconds);
    this.publish();
    return tm;
  }

  remove(id) {
    const before = this.timers.length;
    this.timers = this.timers.filter((x) => x.id !== id);
    this.publish();
    return this.timers.length !== before;
  }
}

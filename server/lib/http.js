const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Dash/0.1 (home display)';

// A source that answers 403/429 is usually rate-limiting us: stop asking it for a while (the whole
// host, not just that URL), doubling the pause while it continues, so a burst can't snowball.
const MIN_PAUSE = 60e3;
const MAX_PAUSE = 15 * 60e3;
const paused = new Map(); // host → { until, wait }

// Speed limit per source: requests to these hosts are spaced out (queued), so a restart or a
// "refresh everything" can't turn into a burst. ESPN is the one that pushes back.
const MIN_GAP_MS = { 'site.api.espn.com': 700, 'site.web.api.espn.com': 700, 'sports.core.api.espn.com': 700 };
const nextSlot = new Map(); // host → earliest start of the next request
const MAX_QUEUE_MS = 60e3;
async function waitTurn(host) {
  const gap = MIN_GAP_MS[host];
  if (!gap) return;
  const slot = Math.max(Date.now(), nextSlot.get(host) || 0);
  // A queue over a minute long means demand outruns the speed limit: refuse instead of letting it
  // grow for hours (stale cards until a restart). The job keeps its last data and retries later.
  if (slot - Date.now() > MAX_QUEUE_MS) throw new Error(`${host} is busy (too many queued requests)`);
  nextSlot.set(host, slot + gap);
  if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()));
}

// Requests per host over the last hour (shown in /api/health), to see what Dash really costs.
const sent = new Map(); // host → timestamps
function count(host) {
  const now = Date.now();
  const list = (sent.get(host) || []).filter((t) => now - t < 3600e3);
  list.push(now);
  sent.set(host, list);
}
export const requestsLastHour = () =>
  Object.fromEntries(
    [...sent]
      .map(([h, l]) => [h, l.filter((t) => Date.now() - t < 3600e3).length])
      .filter(([, n]) => n)
      .sort((a, b) => b[1] - a[1]),
  );

/** For tests and the health endpoint. */
export const pausedHosts = () => [...paused].filter(([, p]) => Date.now() < p.until).map(([host, p]) => ({ host, until: p.until }));
export const resetPauses = () => {
  paused.clear();
  nextSlot.clear();
  sent.clear();
};

function pauseHost(host, res) {
  const prev = paused.get(host);
  // Requests already in flight when the pause began also come back refused: that's the same
  // episode, not a reason to double the pause.
  if (prev && Date.now() < prev.until) return;
  const retryAfter = Number(res.headers.get('retry-after')) * 1000;
  const wait = retryAfter > 0 ? Math.min(retryAfter, MAX_PAUSE) : Math.min(MAX_PAUSE, prev ? prev.wait * 2 : MIN_PAUSE);
  paused.set(host, { until: Date.now() + wait, wait });
  console.warn(`[http] ${host} answered ${res.status} (limiting requests?): pausing it for ${Math.round(wait / 60e3)} min`);
}

// Several parts of Dash ask for the same page at the same moment (a team card and the live poller
// reading one scoreboard, every competition right after a restart): share the request in flight.
const inFlight = new Map(); // key → promise

export function fetchText(url, opts = {}) {
  const key = `${url}|${JSON.stringify(opts.headers || {})}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  // Hard deadline on top of fetch's own timeout: a request stuck mid-body would otherwise stay
  // in flight forever, and every later caller of this URL would wait on it until a restart.
  const limit = (opts.timeoutMs ?? 12000) + 5000;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${limit / 1000}s (${new URL(url).host})`)), limit);
  });
  const promise = Promise.race([request(url, opts), deadline]).finally(() => {
    clearTimeout(timer);
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function request(url, { timeoutMs = 12000, headers = {} } = {}) {
  const host = new URL(url).host;
  const checkPause = () => {
    const p = paused.get(host);
    if (p && Date.now() < p.until) {
      throw Object.assign(new Error(`${host} paused until ${new Date(p.until).toTimeString().slice(0, 5)} (it was limiting requests)`), { paused: true });
    }
  };
  checkPause();
  await waitTurn(host);
  checkPause(); // a pause may have started while this request waited its turn
  const attempt = () => {
    count(host);
    return fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  };
  let res;
  try {
    res = await attempt();
  } catch (err) {
    // Network-level failure (reset, DNS hiccup, dropped Wi-Fi): one quick retry before giving up.
    // Timeouts aren't retried, so a slow source can't double the wait.
    if (err.name === 'TimeoutError') throw new Error(`timed out after ${timeoutMs / 1000}s (${new URL(url).host})`);
    await new Promise((r) => setTimeout(r, 1500));
    try {
      res = await attempt();
    } catch (err2) {
      // "fetch failed" alone says nothing: add the cause (ECONNRESET, ENOTFOUND, ETIMEDOUT…) and host.
      const cause = err2.cause?.code || err2.cause?.message || err2.message;
      throw new Error(`network error: ${cause} (${new URL(url).host})`);
    }
  }
  if (res.status === 403 || res.status === 429) pauseHost(host, res);
  else if (res.ok && paused.has(host)) {
    paused.delete(host);
    console.log(`[http] ${host} is answering again`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

/** Run async fns with bounded concurrency; failures resolve to undefined. */
export async function settleAll(tasks, concurrency = 4) {
  const out = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        out[idx] = await tasks[idx]();
      } catch (err) {
        out[idx] = undefined;
        if (process.env.DASH_DEBUG) console.warn('[settleAll]', err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return out;
}

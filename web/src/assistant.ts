// "Hey Dash": voice assistant on the Gemini Live API.
//
// - Wake word: the browser's speech recognition listens for "dash" (config assistant.wakeWords).
//   Meanwhile the mic keeps the last ~2.5 s of audio in memory only, so "Hey Dash, what's the
//   weather?" said in one breath reaches Gemini whole. Nothing leaves the screen before the wake word
//   (except to the browser's own speech service, which Edge/Chrome use for recognition).
// - Session: the server mints a single-use token with the setup locked in (it holds the API key).
//   Audio goes straight to Gemini over WebSocket: 16 kHz PCM up, 24 kHz PCM down.
// - Tools (shopping list, notes, timers) run on the server: POST /api/assistant/tool.
// - Half-duplex: the mic isn't sent while Dash speaks, so it doesn't hear itself on speakers without
//   echo cancellation. Tap the sheet to cut it short.
import { getState, subscribe } from './store';
import { esc, matchWhen } from './format';
import { t, tv, defaultLocale } from './i18n';
import { isCooking, cookingGo, cookingTimer, cookingStop, speakStep } from './cooking';
import type { Cooking } from './types';

type Phase = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

const IN_RATE = 16000;
const OUT_RATE = 24000;
const CHUNK = 1600; // 100 ms
const PREROLL_CHUNKS = 25; // 2.5 s of audio before the wake word fired
const MAX_SESSION_MS = 5 * 60e3;

let btn: HTMLButtonElement;
let sheet: HTMLElement;
let phase: Phase = 'off';
// The conversation on screen: what you said, what Dash said, and what it did.
type Msg = { role: 'user' | 'dash' | 'action'; text: string };
let log: Msg[] = [];
let turnOpen: Record<'user' | 'dash', boolean> = { user: false, dash: false };

/** Streams transcription into the current bubble, or starts a new one for a new turn. */
function say(role: 'user' | 'dash', chunk: string) {
  const last = log[log.length - 1];
  if (turnOpen[role] && last?.role === role) last.text += chunk;
  else log.push({ role, text: chunk.trimStart() });
  turnOpen[role] = true;
  // Whoever speaks now closes the other side's bubble.
  turnOpen[role === 'user' ? 'dash' : 'user'] = false;
  if (log.length > 12) log = log.slice(-12);
}
let errorText = '';

const cfg = () => getState().config?.assistant || null;
export const isAssistantOpen = () => phase !== 'off';

// ─── Microphone (always-on ring buffer while the assistant is enabled) ──
let micCtx: AudioContext | null = null;
let micStream: MediaStream | null = null;
const ring: ArrayBuffer[] = [];
let onChunk: ((pcm: ArrayBuffer) => void) | null = null;

const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Int16Array(${CHUNK}); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pcm16', Pcm16);`;

async function startMic() {
  if (micCtx) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // The context resamples the mic to 16 kHz for us.
    micCtx = new AudioContext({ sampleRate: IN_RATE });
    await micCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    const node = new AudioWorkletNode(micCtx, 'pcm16');
    node.port.onmessage = (e) => {
      ring.push(e.data);
      if (ring.length > PREROLL_CHUNKS) ring.shift();
      onChunk?.(e.data);
    };
    micCtx.createMediaStreamSource(micStream).connect(node);
    return true;
  } catch (err) {
    console.warn('[assistant] microphone unavailable', err);
    micCtx = null;
    return false;
  }
}

function stopMic() {
  micStream?.getTracks().forEach((tr) => tr.stop());
  micCtx?.close().catch(() => {});
  micCtx = null;
  micStream = null;
  ring.length = 0;
}

// ─── Playback ───────────────────────────────────────────────
let outCtx: AudioContext | null = null;
let playHead = 0;
const playing = new Set<AudioBufferSourceNode>();
let speakingUntil = 0;

function play(b64: string) {
  outCtx ??= new AudioContext({ sampleRate: OUT_RATE });
  if (outCtx.state === 'suspended') outCtx.resume();
  const bin = atob(b64);
  const pcm = new Int16Array(bin.length / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
  const buf = outCtx.createBuffer(1, pcm.length, OUT_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
  const src = outCtx.createBufferSource();
  src.buffer = buf;
  src.connect(outCtx.destination);
  playHead = Math.max(playHead, outCtx.currentTime + 0.05);
  src.start(playHead);
  playHead += buf.duration;
  speakingUntil = Date.now() + (playHead - outCtx.currentTime) * 1000;
  playing.add(src);
  src.onended = () => playing.delete(src);
}

function stopPlayback() {
  for (const s of playing) s.stop();
  playing.clear();
  playHead = 0;
  speakingUntil = 0;
}

const isSpeaking = () => Date.now() < speakingUntil + 250;

function chime(up = true) {
  outCtx ??= new AudioContext({ sampleRate: OUT_RATE });
  const c = outCtx;
  if (c.state === 'suspended') c.resume();
  const t0 = c.currentTime + 0.02;
  (up ? [660, 990] : [880, 587]).forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.11);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.11 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.11 + 0.16);
    o.connect(g).connect(c.destination);
    o.start(t0 + i * 0.11);
    o.stop(t0 + i * 0.11 + 0.18);
  });
}

// ─── Session ────────────────────────────────────────────────
let ws: WebSocket | null = null;
let idleTimer: number | undefined;
let maxTimer: number | undefined;
let ending = false;

function b64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const sendAudio = (pcm: ArrayBuffer) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(pcm), mimeType: `audio/pcm;rate=${IN_RATE}` } } }));

function armIdle() {
  clearTimeout(idleTimer);
  // Wait for Dash to finish talking, then give the user a few seconds to follow up.
  const wait = Math.max(0, speakingUntil - Date.now()) + (cfg()?.idleSeconds ?? 8) * 1000;
  idleTimer = window.setTimeout(() => (ending || !heardSinceTurn ? close() : armIdle()), wait);
}
let heardSinceTurn = false;

/** Opens the assistant (mic button, cooking screen, scheduled briefing). `prompt` is sent as text first. */
export const openAssistant = (prompt?: string) => open(false, prompt);

async function open(preroll: boolean, prompt?: string) {
  if (phase !== 'off' && phase !== 'error') return;
  stopWake();
  log = [];
  turnOpen = { user: false, dash: false };
  errorText = '';
  ending = false;
  setPhase('connecting');
  chime(true);
  const pending = preroll ? ring.slice() : [];
  if (!(await startMic())) return fail(t('assistant.noMic'));
  try {
    const res = await fetch('/api/assistant/session', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.url) throw new Error(d.error || `HTTP ${res.status}`);
    ws = new WebSocket(d.url);
  } catch (err) {
    console.warn('[assistant] session', err);
    return fail(t('assistant.error'));
  }
  ws.onopen = () => ws?.send(JSON.stringify({ setup: {} }));
  ws.onmessage = async (ev) => {
    const text = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
    let m: any;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (m.setupComplete) {
      setPhase('listening');
      if (prompt) ws?.send(JSON.stringify({ realtimeInput: { text: prompt } }));
      for (const c of pending) sendAudio(c);
      onChunk = (pcm) => {
        if (!isSpeaking()) sendAudio(pcm);
      };
      maxTimer = window.setTimeout(close, MAX_SESSION_MS);
      armIdle();
      return;
    }
    if (m.toolCall) return runTools(m.toolCall.functionCalls || []);
    if (m.goAway) return close();
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) {
      say('user', sc.inputTranscription.text);
      heardSinceTurn = true;
      if (phase === 'listening') setPhase('thinking');
      else render();
    }
    for (const p of sc.modelTurn?.parts || []) {
      if (p.inlineData?.data) {
        play(p.inlineData.data);
        if (phase !== 'speaking') setPhase('speaking');
      }
    }
    if (sc.outputTranscription?.text) {
      say('dash', sc.outputTranscription.text);
      render();
    }
    if (sc.interrupted) stopPlayback();
    if (sc.turnComplete) {
      heardSinceTurn = false;
      turnOpen = { user: false, dash: false };
      window.setTimeout(() => {
        if (phase === 'speaking' || phase === 'thinking') setPhase('listening');
      }, Math.max(0, speakingUntil - Date.now()));
      if (ending) idleTimer = window.setTimeout(close, Math.max(0, speakingUntil - Date.now()) + 400);
      else armIdle();
    }
  };
  ws.onclose = (e) => {
    if (phase !== 'off' && phase !== 'error') {
      if (e.code !== 1000 && !log.some((x) => x.role === 'dash')) fail(t('assistant.error'));
      else close();
    }
  };
}

async function runTools(calls: { id: string; name: string; args?: Record<string, unknown> }[]) {
  setPhase('thinking');
  const functionResponses = [];
  for (const c of calls) {
    let response: unknown;
    try {
      response = await (await fetch('/api/assistant/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: c.name, args: c.args || {} }) })).json();
    } catch {
      response = { error: 'tool failed' };
    }
    if (c.name === 'end_conversation') ending = true;
    const done = actionText(c.name, c.args || {}, response as Record<string, unknown>);
    if (done) {
      log.push({ role: 'action', text: done });
      turnOpen = { user: false, dash: false };
      render();
    }
    functionResponses.push({ id: c.id, name: c.name, response });
  }
  ws?.send(JSON.stringify({ toolResponse: { functionResponses } }));
}

/** "Added to the shopping list: milk, eggs" — a visible receipt for what the assistant changed. */
function actionText(name: string, args: Record<string, any>, res: Record<string, any>) {
  if (!res || res.error) return '';
  const list = (v: unknown) => [].concat((v as never) || []).join(', ');
  switch (name) {
    case 'add_to_shopping_list':
      // Only what was really added; items already on the list are just confirmed.
      return res.added?.length ? t('assistant.did.added', { items: list(res.added) }) : t('assistant.did.already', { items: list(args.items) });
    case 'remove_from_shopping_list':
      return res.removed ? t('assistant.did.removed', { items: list(args.items) }) : '';
    case 'add_note':
      return res.remindAt ? t('assistant.did.reminder', { text: String(args.text || ''), time: matchWhen(new Date(Number(res.remindAt)).toISOString()).text }) : t('assistant.did.note', { text: String(args.text || '') });
    case 'remember':
      return t('assistant.did.remembered', { text: String(res.saved || args.fact || '') });
    case 'forget':
      return t('assistant.did.forgot', { text: list(res.forgotten) });
    case 'start_recipe':
    case 'open_saved_recipe':
      return t('assistant.did.cooking', { title: String(res.title || '') });
    case 'spotify_play':
      return res.playing ? t('assistant.did.playing', { name: [res.playing.name, res.playing.by].filter(Boolean).join(' · ') }) : '';
    case 'start_step_timer':
      return t('assistant.did.timer', { n: res.minutes, label: '' });
    case 'start_timer':
      return args.at ? t('assistant.did.alarm', { time: String(args.at), label: args.label ? ` · ${args.label}` : '' }) : t('assistant.did.timer', { n: res.minutes, label: args.label ? ` · ${args.label}` : '' });
    case 'add_time_to_timer':
      return t('assistant.did.timerChanged', { n: res.minutes_left, label: res.label ? ` · ${res.label}` : '' });
    case 'cancel_timer':
      return t('assistant.did.timerCancelled', { label: list(res.cancelled) });
    default:
      return '';
  }
}

function fail(msg: string) {
  errorText = msg;
  setPhase('error');
  teardown();
  window.setTimeout(() => phase === 'error' && close(), 4000);
}

function teardown() {
  onChunk = null;
  clearTimeout(idleTimer);
  clearTimeout(maxTimer);
  if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
  ws = null;
}

function close() {
  if (phase === 'off') return;
  teardown();
  stopPlayback();
  if (phase !== 'error') chime(false);
  setPhase('off');
  window.setTimeout(startWake, 1500);
}

// ─── Wake word ──────────────────────────────────────────────
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
let rec: Recognition | null = null;
let wakeOn = false;
let wakeBlocked = false;
let restartDelay = 300;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ');

/** Exact wake words anywhere; sound-alikes ("das", "dach") only after "hey/oye/ok…", since "das" is a common word. */
function wakeRegex() {
  const words = (cfg()?.wakeWords || ['dash']).map(norm).map((w) => w.trim()).filter(Boolean);
  const alike = words.flatMap((w) => (w === 'dash' ? ['dasch', 'dach', 'dache', 'dass', 'dahs', ...(getState().config?.language === 'de' ? [] : ['das'])] : []));
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = words.map(esc).join('|');
  const loose = alike.map(esc).join('|');
  return new RegExp(`(?:^|\\s)(?:${exact})(?:\\s|$)${loose ? `|(?:^|\\s)(?:hey|hei|ei|ey|oye|ok|okay|hola|hallo|ehi|eh)\\s+(?:${loose})(?:\\s|$)` : ''}`);
}

function startWake() {
  if (!cfg() || wakeBlocked || phase !== 'off' || wakeOn) return;
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return;
  startMic(); // keeps the pre-roll buffer filling
  rec = new SR() as Recognition;
  rec.lang = getState().config?.locale || defaultLocale();
  rec.continuous = true;
  rec.interimResults = true;
  const re = wakeRegex();
  rec.onresult = (e: any) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      // Cooking: short commands ("next", "siguiente paso") act at once, without Gemini.
      if (e.results[i].isFinal && cookingCommand(norm(e.results[i][0].transcript))) return;
      if (re.test(` ${norm(e.results[i][0].transcript)} `)) {
        restartDelay = 300;
        open(true);
        return;
      }
    }
  };
  rec.onerror = (e: any) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wakeBlocked = true;
      console.warn('[assistant] wake word unavailable:', e.error, '(tap the mic button instead)');
    }
  };
  rec.onend = () => {
    wakeOn = false;
    btn.classList.remove('wake');
    rec = null;
    // Recognition stops on its own every so often: restart, backing off if it keeps failing.
    if (phase === 'off' && cfg() && !wakeBlocked) window.setTimeout(startWake, (restartDelay = Math.min(restartDelay * 2, 30000)));
  };
  try {
    rec.start();
    wakeOn = true;
    btn.classList.add('wake');
    window.setTimeout(() => wakeOn && (restartDelay = 300), 10000);
  } catch {
    rec = null;
  }
}

// ─── Cooking voice commands (local, instant, free) ──────────
let lastCommand = 0;
const commandRegex = (key: string) => {
  const words = (tv<string[]>(`cooking.commands.${key}`) || []).map(norm).map((w) => w.trim()).filter(Boolean);
  const wake = (cfg()?.wakeWords || ['dash']).map(norm).join('|');
  // The whole utterance must be the command (optionally after the wake word), so a step read
  // aloud or a sentence that merely contains "next" doesn't trigger it.
  return new RegExp(`^(?:(?:hey|oye|ok)\\s+)?(?:(?:${wake})\\s+)?(?:${words.join('|') || '$^'})(?:\\s+(?:please|por favor|s il vous plait|bitte|per favore))?$`);
};

function cookingCommand(said: string) {
  if (!isCooking() || Date.now() - lastCommand < 1500) return false;
  // Our own voice reading a step must not count as a command.
  if ('speechSynthesis' in window && speechSynthesis.speaking) return false;
  const text = said.trim().replace(/\s+/g, ' ');
  const act = async (fn: () => Promise<Response>, speak = true) => {
    lastCommand = Date.now();
    chime(true);
    const res = await fn();
    if (speak && res.ok) speakStep((await res.json().catch(() => null)) as Cooking | null);
  };
  if (commandRegex('next').test(text)) return void act(() => cookingGo('next')), true;
  if (commandRegex('previous').test(text)) return void act(() => cookingGo('previous')), true;
  if (commandRegex('repeat').test(text)) {
    lastCommand = Date.now();
    speakStep();
    return true;
  }
  if (commandRegex('timer').test(text)) return void act(cookingTimer, false), true;
  if (commandRegex('exit').test(text)) return void act(() => cookingStop('voice'), false), true;
  return false;
}

// ─── Morning briefing at a set time ─────────────────────────
function checkBriefing() {
  const b = getState().config?.briefing;
  if (!b?.time || !cfg() || phase !== 'off') return;
  const tz = getState().config?.timezone;
  const now = new Date();
  const hm = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const day = now.toLocaleDateString('en-CA', { timeZone: tz });
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  // Within 5 minutes after the set time, once a day.
  const mins = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
  const late = mins(hm) - mins(b.time);
  if (late < 0 || late > 5 || !b.weekdays.includes(dow)) return;
  try {
    if (localStorage.getItem('dash:briefing') === day) return;
    localStorage.setItem('dash:briefing', day);
  } catch {}
  open(false, '[briefing]');
}

function stopWake() {
  wakeOn = false;
  btn?.classList.remove('wake');
  if (rec) {
    rec.onend = null;
    rec.abort();
    rec = null;
  }
}

// ─── UI ─────────────────────────────────────────────────────
// Lower Spotify while Dash listens and talks, and put it back afterwards (server remembers the volume).
let ducking = false;
function duck(on: boolean) {
  if (on === ducking || !getState().config?.spotify?.connected) return;
  ducking = on;
  fetch('/api/spotify/duck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) }).catch(() => {});
}

function setPhase(p: Phase) {
  duck(p !== 'off' && p !== 'error');
  phase = p;
  document.body.classList.toggle('assistant-open', p !== 'off');
  render();
}

function render() {
  sheet.hidden = phase === 'off';
  if (phase === 'off') return;
  const status: Record<Phase, string> = {
    off: '',
    connecting: t('assistant.connecting'),
    listening: t('assistant.listening'),
    thinking: t('assistant.thinking'),
    speaking: '',
    error: errorText,
  };
  sheet.dataset.phase = phase;
  const msgs = log.filter((m) => m.text.trim());
  sheet.innerHTML = `
    <div class="as-card">
      <header class="as-head">
        <div class="as-orb"><i></i><i></i><i></i></div>
        <span class="as-status">${esc(phase === 'speaking' ? 'Dash' : status[phase])}</span>
        <button class="as-close" data-as-close aria-label="${esc(t('assistant.close'))}">✕</button>
      </header>
      ${
        msgs.length
          ? `<div class="as-log">${msgs
              .map((m) => (m.role === 'action' ? `<p class="as-msg action"><span>✓</span>${esc(m.text)}</p>` : `<p class="as-msg ${m.role}">${esc(m.text.trim())}</p>`))
              .join('')}</div>`
          : `<p class="as-hint">${esc(phase === 'error' ? '' : t('assistant.hint'))}</p>`
      }
    </div>`;
  // Keep the newest words in view.
  const box = sheet.querySelector('.as-log');
  if (box) box.scrollTop = box.scrollHeight;
}

function sync() {
  const on = !!cfg();
  btn.hidden = !on;
  document.body.classList.toggle('has-assistant', on);
  if (on) startWake();
  else {
    stopWake();
    if (phase !== 'off') close();
    stopMic();
  }
}

export function initAssistant() {
  btn = document.createElement('button');
  btn.className = 'assistant-btn';
  btn.hidden = true;
  btn.setAttribute('aria-label', t('assistant.title'));
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>`;
  sheet = document.createElement('section');
  sheet.className = 'assistant-sheet';
  sheet.hidden = true;
  document.body.append(btn, sheet);

  btn.addEventListener('click', () => (phase === 'off' ? open(false) : close()));
  sheet.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-as-close]') || e.target === sheet) return close();
    // Tap while Dash talks: stop talking and listen.
    if (phase === 'speaking') {
      stopPlayback();
      setPhase('listening');
      armIdle();
    }
  });
  // Browsers start audio only after a first touch (the kiosk flag lifts this on the display).
  document.addEventListener('pointerdown', () => outCtx?.state === 'suspended' && outCtx.resume(), { capture: true });

  let last = '';
  subscribe((_s, changed) => {
    if (changed !== 'config') return;
    const key = JSON.stringify(cfg()) + (getState().config?.language || '');
    if (key === last) return;
    last = key;
    btn.setAttribute('aria-label', t('assistant.title'));
    stopWake();
    sync();
  });
  sync();
  window.setInterval(checkBriefing, 20e3);
  window.addEventListener('dash:ask', () => (phase === 'off' ? open(false) : undefined));
}

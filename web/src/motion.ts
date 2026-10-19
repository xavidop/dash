// Wake on motion: the camera watches for movement so the screen wakes when someone walks into the
// kitchen, and dims when the room has been empty for a while.
//
// Privacy: frames are tiny (64×48, grey), compared in memory twice a second and thrown away. Nothing
// is stored, recognised or sent anywhere: only "did enough pixels change?" is kept.
import { getState, subscribe } from './store';

const W = 64;
const H = 48;
const EVERY_MS = 500;
// Share of pixels that must change (by more than PIXEL_DELTA grey levels) to count as movement.
const SENSITIVITY = { low: 0.06, medium: 0.03, high: 0.012 } as const;
const PIXEL_DELTA = 28;

let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;
let timer: number | undefined;
let prev: Uint8ClampedArray | null = null;
let lastMotion = Date.now();
let ctx: CanvasRenderingContext2D | null = null;
let shade: HTMLElement;

const cfg = () => {
  const c = getState().config;
  return c?.features?.motion ? c.motion || { dimAfterMinutes: 10, sensitivity: 'medium' as const } : null;
};

/** Fraction of pixels that changed between two grey frames. */
export function changed(a: Uint8ClampedArray, b: Uint8ClampedArray, delta = PIXEL_DELTA) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > delta) n++;
  return n / a.length;
}

function grey(data: Uint8ClampedArray) {
  const out = new Uint8ClampedArray(W * H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) out[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  return out;
}

function sample() {
  const c = cfg();
  if (!c || !video || !ctx || video.readyState < 2) return;
  ctx.drawImage(video, 0, 0, W, H);
  const frame = grey(ctx.getImageData(0, 0, W, H).data);
  if (prev && changed(prev, frame) > SENSITIVITY[c.sensitivity]) moved();
  prev = frame;
  // Empty room for long enough: dim (a tap or the next movement brings it back).
  const dim = c.dimAfterMinutes > 0 && Date.now() - lastMotion > c.dimAfterMinutes * 60e3;
  document.body.classList.toggle('dimmed', dim);
}

function moved() {
  const wasDim = document.body.classList.contains('dimmed');
  lastMotion = Date.now();
  document.body.classList.remove('dimmed');
  // Night mode: someone's here, show the day screen for a while (like a tap).
  window.dispatchEvent(new CustomEvent('dash:motion', { detail: { wasDim } }));
}

async function start() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120, frameRate: 5, facingMode: 'user' }, audio: false });
  } catch (err) {
    console.warn('[motion] camera unavailable:', (err as Error).message);
    stream = null;
    return;
  }
  video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream });
  await video.play().catch(() => {});
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  lastMotion = Date.now();
  timer = window.setInterval(sample, EVERY_MS);
}

function stop() {
  clearInterval(timer);
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
  video = null;
  prev = null;
  document.body.classList.remove('dimmed');
}

export function initMotion() {
  shade = document.createElement('div');
  shade.className = 'dim-shade';
  document.body.appendChild(shade);
  // Any touch also counts as someone being here.
  document.addEventListener('pointerdown', () => {
    lastMotion = Date.now();
    document.body.classList.remove('dimmed');
  }, { capture: true });
  const sync = () => (cfg() ? start() : stop());
  subscribe((_s, changed) => changed === 'config' && sync());
  sync();
}

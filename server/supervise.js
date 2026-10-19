// Keeps the Dash server running: restarts it if it exits or crashes, with backoff.
// Usage: node server/supervise.js [--demo]   (npm start uses this)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const args = process.argv.slice(2);
let child = null;
let stopping = false;
let failures = 0;

function start() {
  const startedAt = Date.now();
  child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (stopping) return process.exit(code ?? 0);
    // A run that lasted a minute resets the backoff; quick crash loops slow down to 30 s.
    failures = Date.now() - startedAt > 60e3 ? 1 : failures + 1;
    const delay = Math.min(30, 2 ** (failures - 1)) * 1000;
    console.warn(`[supervisor] server exited (${signal || `code ${code}`}); restarting in ${delay / 1000}s`);
    setTimeout(start, delay);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill(sig);
    else process.exit(0);
  });
}

start();

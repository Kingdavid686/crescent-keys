// util.js — math helpers, input, and the WebAudio synth. No dependencies.

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const dist2 = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
export const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

// Shortest signed angular difference from a to b.
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Deterministic seeded RNG so the city is the same on every load.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const rand = (rng, a, b) => a + rng() * (b - a);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// Circle vs axis-aligned rect collision: returns push-out vector or null.
export function circleRectCollide(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { x: nx + (dx / d) * r, y: ny + (dy / d) * r, nx: dx / d, ny: dy / d };
  }
  // Centre inside the rect: push out along the smallest penetration axis.
  const left = cx - rect.x, right = rect.x + rect.w - cx;
  const top = cy - rect.y, bottom = rect.y + rect.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: rect.x - r, y: cy, nx: -1, ny: 0 };
  if (m === right) return { x: rect.x + rect.w + r, y: cy, nx: 1, ny: 0 };
  if (m === top) return { x: cx, y: rect.y - r, nx: 0, ny: -1 };
  return { x: cx, y: rect.y + rect.h + r, nx: 0, ny: 1 };
}

export function pointInRect(x, y, rect, pad = 0) {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}

// ---------------- Input ----------------
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered, cleared each frame by main loop
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }
  down(...names) { return names.some((n) => this.keys.has(n)); }
  hit(...names) { return names.some((n) => this.pressed.has(n)); }
  get up() { return this.down('w', 'arrowup'); }
  get downKey() { return this.down('s', 'arrowdown'); }
  get left() { return this.down('a', 'arrowleft'); }
  get right() { return this.down('d', 'arrowright'); }
  endFrame() { this.pressed.clear(); }
}

// ---------------- Audio synth ----------------
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.sirenOsc = null;
    this.sirenGain = null;
  }
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur, vol = 0.2, freq = 400) {
    if (!this.ctx || this.muted) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start();
  }
  crash(big = false) { this.noise(big ? 0.35 : 0.18, big ? 0.35 : 0.2, big ? 300 : 500); this.tone(big ? 70 : 100, 0.2, 'triangle', 0.2, 0, 40); }
  pickup() { this.tone(880, 0.09, 'sine', 0.16); this.tone(1320, 0.14, 'sine', 0.16, 0.08); }
  cash() { this.tone(990, 0.08, 'square', 0.08); this.tone(1480, 0.16, 'square', 0.08, 0.07); }
  success() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.14, i * 0.09)); }
  fail() { this.tone(220, 0.3, 'sawtooth', 0.1, 0, 110); }
  blip() { this.tone(1200, 0.05, 'sine', 0.08); }
  door() { this.tone(180, 0.08, 'square', 0.1, 0, 90); }
  setSiren(on, level = 0.05) {
    if (!this.ctx) return;
    if (on && !this.muted) {
      if (!this.sirenOsc) {
        this.sirenOsc = this.ctx.createOscillator();
        this.sirenGain = this.ctx.createGain();
        this.sirenOsc.type = 'triangle';
        this.sirenGain.gain.value = 0;
        this.sirenOsc.connect(this.sirenGain).connect(this.ctx.destination);
        this.sirenOsc.start();
      }
      const t = this.ctx.currentTime;
      const wail = 700 + Math.sin(t * 2.4) * 220;
      this.sirenOsc.frequency.setValueAtTime(wail, t);
      this.sirenGain.gain.setTargetAtTime(level, t, 0.2);
    } else if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }
}

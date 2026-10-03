// Sound and touch. Every sound is synthesised on the spot with Web Audio (no files to load),
// and every haptic goes through one place:
//  - Android and other browsers with navigator.vibrate get real vibration patterns.
//  - iPhone (no vibrate) gets the system's tap: iOS 18 plays a haptic when a switch-style
//    checkbox flips, so a hidden one is flipped for each pulse.
// Both can be switched off in Stats, and both stay quiet until the first touch (browsers
// require it anyway).

const KEY = "shelfie.fx";
let prefs = { sound: true, haptics: true, visitors: true, motion: false };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
} catch {}

export const fx = {
  get sound() {
    return prefs.sound;
  },
  get haptics() {
    return prefs.haptics;
  },
  get visitors() {
    return prefs.visitors !== false;
  },
  get motion() {
    return prefs.motion === true;
  },
  set(k, v) {
    prefs[k] = !!v;
    if (k === "sound" && v) unlock();
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {}
  },
};

/* ---------------- haptics ---------------- */

const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * iPhone has no vibration API, but iOS 18 plays the system tap when a switch-style checkbox
 * flips. A fresh hidden switch is flipped and removed for each tap (the reliable way: a
 * long-lived one stops responding in some versions and in home-screen apps).
 */
function iosTap() {
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.append(input);
  document.head.append(label);
  label.click();
  label.remove();
}

// Android ignores pulses that are too short on many phones, so nothing here is under 12 ms.
const PATTERNS = {
  tick: [12],
  light: [16],
  medium: [24],
  heavy: [40],
  select: [14],
  success: [18, 60, 30],
  warning: [30, 50, 30],
  error: [50, 40, 50, 40, 50],
  celebrate: [30, 50, 40, 50, 80],
  thud: [45],
};

/** A pattern name, a number of ms, or an array of on/off ms. */
export function haptic(p = "light") {
  if (!prefs.haptics) return;
  if (typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  const pattern = typeof p === "string" ? PATTERNS[p] || PATTERNS.light : Array.isArray(p) ? p : [Math.max(12, p)];
  try {
    if (canVibrate) return void navigator.vibrate(pattern);
    if (!coarse) return; // desktop: nothing to tap
    // iOS: the first tap now (inside the touch, where iOS allows it), the rest of a pattern after.
    iosTap();
    let t = 0;
    pattern.forEach((ms, i) => {
      if (i > 0 && i % 2 === 0) setTimeout(iosTap, t);
      t += ms;
    });
  } catch {}
}

/* ---------------- sound ---------------- */

let ctx = null;
let master = null;

function make() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC({ latencyHint: "interactive" });
  master = ctx.createGain();
  master.gain.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  return ctx;
}

function audio() {
  if (!prefs.sound) return null;
  if (!ctx) return null; // created inside a touch only (see unlock), or iOS keeps it muted
  return ctx.state === "running" ? ctx : null;
}

/**
 * iOS (and Chrome) only let audio start inside a touch, and iOS suspends it again whenever
 * the app goes to the background or the screen locks. So on every touch, if it isn't running,
 * create or resume it and play one silent sample, which is what actually unlocks it on iOS.
 */
function unlock() {
  if (!prefs.sound) return;
  try {
    if (!ctx && !make()) return;
    if (ctx.state !== "running") {
      ctx.resume?.();
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch {}
}
if (typeof addEventListener === "function") {
  for (const type of ["pointerdown", "touchend", "keydown"]) addEventListener(type, unlock, { capture: true, passive: true });
  // After a phone call, lock screen or app switch, iOS marks audio "interrupted": try again.
  document.addEventListener?.("visibilitychange", () => document.visibilityState === "visible" && ctx && ctx.state !== "running" && ctx.resume?.().catch(() => {}));
}

function tone(c, { f = 440, to = null, type = "sine", dur = 0.12, gain = 0.3, at = 0, attack = 0.005 }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(c, { dur = 0.1, gain = 0.2, type = "bandpass", f = 2000, to = null, q = 1, at = 0 }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const filt = c.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f, t);
  if (to) filt.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

/** A voice that glides through pitches, with vibrato: for the animals. */
function voice(c, { type = "sawtooth", f = [400, 600], dur = 0.5, vib = 0, vibDepth = 0, gain = 0.12, lp = 2400, at = 0 }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f[0], t);
  f.slice(1).forEach((hz, k) => o.frequency.linearRampToValueAtTime(hz, t + ((k + 1) / (f.length - 1)) * dur));
  if (vib) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = vib;
    lg.gain.value = vibDepth;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = lp;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
  g.gain.setValueAtTime(gain, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(filt).connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1567.98, 1760, 2093];

const SOUNDS = {
  tick: (c) => tone(c, { f: 2400, type: "square", dur: 0.018, gain: 0.04 }),
  detent: (c) => (tone(c, { f: 1800, type: "triangle", dur: 0.025, gain: 0.08 }), noise(c, { dur: 0.02, f: 5000, gain: 0.05 })),
  click: (c) => (noise(c, { dur: 0.03, f: 3200, q: 2, gain: 0.25 }), tone(c, { f: 180, to: 90, dur: 0.06, gain: 0.25 })),
  page: (c) => noise(c, { dur: 0.07, type: "highpass", f: 2500, to: 6000, gain: 0.12 }),
  pop: (c) => tone(c, { f: 500, to: 1300, dur: 0.1, gain: 0.3 }),
  swoosh: (c) => noise(c, { dur: 0.22, f: 500, to: 2600, q: 0.8, gain: 0.25 }),
  whoosh: (c) => noise(c, { dur: 0.35, f: 2600, to: 300, q: 0.7, gain: 0.3 }),
  thunk: (c) => (tone(c, { f: 140, to: 50, dur: 0.18, gain: 0.5 }), noise(c, { dur: 0.08, type: "lowpass", f: 900, gain: 0.3 })),
  stamp: (c) => (tone(c, { f: 90, to: 40, dur: 0.25, gain: 0.6 }), noise(c, { dur: 0.12, type: "lowpass", f: 1400, gain: 0.5 })),
  flip: (c) => noise(c, { dur: 0.16, f: 1200, to: 4000, q: 1.5, gain: 0.18 }),
  coin: (c) => (tone(c, { f: 988, type: "square", dur: 0.07, gain: 0.08 }), tone(c, { f: 1319, type: "square", dur: 0.28, gain: 0.08, at: 0.07 })),
  sparkle: (c) => {
    for (let i = 0; i < 6; i++) tone(c, { f: 1800 + Math.random() * 2600, dur: 0.12, gain: 0.07, at: i * 0.045 });
  },
  levelup: (c) => [0, 2, 4, 5, 7].forEach((n, i) => tone(c, { f: NOTES[n], type: "triangle", dur: 0.22, gain: 0.22, at: i * 0.08 })),
  fanfare: (c) => {
    [0, 2, 4].forEach((n, i) => tone(c, { f: NOTES[n], type: "sawtooth", dur: 0.14, gain: 0.08, at: i * 0.11 }));
    [0, 2, 4, 7].forEach((n) => tone(c, { f: NOTES[n], type: "triangle", dur: 0.9, gain: 0.14, at: 0.36 }));
    noise(c, { dur: 0.5, type: "highpass", f: 6000, gain: 0.06, at: 0.36 });
  },
  error: (c) => tone(c, { f: 160, to: 110, type: "sawtooth", dur: 0.22, gain: 0.12 }),
  snap: (c) => (tone(c, { f: 900, to: 1400, type: "triangle", dur: 0.06, gain: 0.12 }), noise(c, { dur: 0.04, f: 4000, gain: 0.08 })),
  pull: (c, k = 0) => tone(c, { f: 220 + k * 500, type: "triangle", dur: 0.06, gain: 0.08 }),
  combo: (c, n = 1) => {
    const base = Math.min(NOTES.length - 3, n - 1);
    [0, 2].forEach((d, i) => tone(c, { f: NOTES[base + d], type: "square", dur: 0.09, gain: 0.07, at: i * 0.06 }));
  },
  drop: (c) => (tone(c, { f: 700, to: 200, dur: 0.18, gain: 0.25 }), noise(c, { dur: 0.1, type: "lowpass", f: 800, gain: 0.3, at: 0.1 })),
  open: (c) => tone(c, { f: 300, to: 600, type: "triangle", dur: 0.14, gain: 0.15 }),
  // The passing critters.
  hum: (c) => voice(c, { type: "triangle", f: [220, 260, 240], dur: 0.9, vib: 6, vibDepth: 12, gain: 0.16, lp: 1200 }),
  neigh: (c) => voice(c, { f: [700, 1100, 900, 500], dur: 0.8, vib: 14, vibDepth: 60, gain: 0.08, lp: 3000 }),
  quack: (c) => [0, 0.16].forEach((at) => voice(c, { type: "square", f: [520, 380], dur: 0.12, gain: 0.08, lp: 1400, at })),
  meow: (c) => voice(c, { type: "triangle", f: [500, 900, 650], dur: 0.6, vib: 5, vibDepth: 10, gain: 0.14, lp: 2600 }),
  rawr: (c) => (voice(c, { f: [180, 120, 90], dur: 0.7, vib: 30, vibDepth: 20, gain: 0.16, lp: 900 }), noise(c, { dur: 0.6, type: "lowpass", f: 600, gain: 0.15 })),
  squeak: (c) => [0, 0.12].forEach((at) => tone(c, { f: 1800, to: 2600, dur: 0.08, gain: 0.09, at })),
  clop: (c) => [0, 0.14, 0.38, 0.52].forEach((at) => noise(c, { dur: 0.04, f: 1800, q: 3, gain: 0.25, at })),
  honk: (c) => voice(c, { type: "square", f: [330, 300], dur: 0.35, gain: 0.07, lp: 1000 }),
  chirp: (c) => [0, 0.1, 0.2].forEach((at) => tone(c, { f: 2600, to: 3400, dur: 0.06, gain: 0.07, at })),
  close: (c) => tone(c, { f: 600, to: 280, type: "triangle", dur: 0.14, gain: 0.15 }),
};

let last = {};
/** Play a named sound. Rapid repeats of the same sound are thinned out. */
export function sound(name, arg) {
  const c = audio();
  if (!c || !SOUNDS[name]) return;
  const now = performance.now();
  if (now - (last[name] || 0) < 28) return;
  last[name] = now;
  try {
    SOUNDS[name](c, arg);
  } catch {}
}

/** Sound and haptic together, the common case. */
export function feel(name, h, arg) {
  sound(name, arg);
  if (h) haptic(h);
}

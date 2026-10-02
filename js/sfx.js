// Sound and touch. Every sound is synthesised on the spot with Web Audio (no files to load),
// and every haptic goes through one place:
//  - Android and other browsers with navigator.vibrate get real vibration patterns.
//  - iPhone (no vibrate) gets the system's tap: iOS 18 plays a haptic when a switch-style
//    checkbox flips, so a hidden one is flipped for each pulse.
// Both can be switched off in Stats, and both stay quiet until the first touch (browsers
// require it anyway).

const KEY = "shelfie.fx";
let prefs = { sound: true, haptics: true };
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
  set(k, v) {
    prefs[k] = !!v;
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {}
  },
};

/* ---------------- haptics ---------------- */

const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
let iosSwitch = null;

function iosTap() {
  if (!iosSwitch) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    iosSwitch = document.createElement("label");
    iosSwitch.className = "haptic-switch";
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.append(input);
    document.body.append(iosSwitch);
  }
  iosSwitch.click();
}

const PATTERNS = {
  tick: [4],
  light: [8],
  medium: [16],
  heavy: [28],
  select: [6],
  success: [12, 60, 22],
  warning: [20, 50, 20],
  error: [40, 40, 40, 40, 40],
  celebrate: [20, 50, 30, 50, 60],
  thud: [35],
};

/** A pattern name, a number of ms, or an array of on/off ms. */
export function haptic(p = "light") {
  if (!prefs.haptics) return;
  if (typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  const pattern = typeof p === "string" ? PATTERNS[p] || PATTERNS.light : Array.isArray(p) ? p : [p];
  try {
    if (canVibrate) return navigator.vibrate(pattern);
    // iOS: one tap per "on" segment.
    let t = 0;
    pattern.forEach((ms, i) => {
      if (i % 2 === 0) setTimeout(iosTap, t);
      t += ms;
    });
  } catch {}
}

/* ---------------- sound ---------------- */

let ctx = null;
let master = null;

function audio() {
  if (!prefs.sound) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Unlock audio on the first touch (iOS needs it started inside a gesture).
if (typeof addEventListener === "function")
  addEventListener("pointerdown", () => audio(), { once: true, capture: true });

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

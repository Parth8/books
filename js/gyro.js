// Motion controls. Shelfie can feel your phone move:
//   - Tilt: the pile leans, the background shifts, the bulbs swing and the light on the cover
//     slides, as if the whole thing were a little diorama in your hand.
//   - Turn the phone to face right or left and back (like turning a page): next or previous book.
//   - Twist it like a steering wheel: the next or previous shelf, one per twist.
//   - Bounce it up or down, or flick the top towards or away from you: add a book.
//
// Turns are read from the gyroscope (how fast the phone turns), which is clean and immediate. A
// bounce is read from the accelerometer, measured along gravity so it works however you hold
// the phone.
//
// The axes. The web standard names rotation rates alpha (about the axis through the screen),
// beta (side to side) and gamma (top to bottom). Safari on iPhone fills them in a different
// order (alpha, beta, gamma = side to side, top to bottom, through the screen), which is why a
// front-and-back flick used to change the shelf. So the rates are mapped per platform, and the
// mapping is then checked against the phone's own orientation readings while you hold it: the
// axis whose turning matches the change in tilt is the one it says it is. What's learnt is kept
// on this device.
//
// iPhone asks permission, and only from a tap, so it's switched on from a button. Nothing about
// how you move your phone is stored or sent anywhere (except that axis mapping, on this device).

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const AXES_KEY = "shelfie.motionAxes";

/** True where motion controls can work: a touch device with motion sensors. */
export const motionSupported = () =>
  typeof window !== "undefined" &&
  "DeviceOrientationEvent" in window &&
  "DeviceMotionEvent" in window &&
  typeof matchMedia === "function" &&
  matchMedia("(pointer: coarse)").matches;

/** Ask for permission (iPhone). Must be called from a tap. Resolves true if allowed. */
export async function askMotion() {
  try {
    const O = window.DeviceOrientationEvent;
    const M = window.DeviceMotionEvent;
    const asks = [O?.requestPermission, M?.requestPermission].filter((f) => typeof f === "function");
    if (!asks.length) return true; // Android and others: no prompt needed
    const answers = await Promise.all([O?.requestPermission?.(), M?.requestPermission?.()].filter(Boolean));
    return answers.every((a) => a === "granted");
  } catch {
    return false;
  }
}

/** iPhone and iPad (iPadOS says it's a Mac, but a Mac has no touch screen). */
export const isApple = (nav = globalThis.navigator) => /iPhone|iPad|iPod/.test(nav?.userAgent || "") || (/Macintosh/.test(nav?.userAgent || "") && nav?.maxTouchPoints > 1);

/**
 * How the three reported rates map onto the phone's own axes: for each of x (side to side), y (top
 * to bottom) and z (through the screen), which reported name holds it, and with which sign.
 */
export const AXES = {
  standard: { x: ["beta", 1], y: ["gamma", 1], z: ["alpha", 1] },
  apple: { x: ["alpha", 1], y: ["beta", 1], z: ["gamma", 1] },
};

/** Reported rates → { x, y, z } in degrees a second, about the phone's own axes. */
export function toDevice(r, axes) {
  const get = ([name, sign]) => (+r?.[name] || 0) * sign;
  return { x: get(axes.x), y: get(axes.y), z: get(axes.z) };
}

/**
 * Learns which reported rate is which axis, from how the tilt changes. feed() it the turn reported
 * between two orientation readings (each rate summed over that time, in degrees) and how far beta
 * (tip, about x) and gamma (about y) moved; result() is a mapping once it's sure, else null.
 */
export function axisLearner() {
  const names = ["alpha", "beta", "gamma"];
  const sx = { alpha: 0, beta: 0, gamma: 0 };
  const sy = { alpha: 0, beta: 0, gamma: 0 };
  let movedX = 0;
  let movedY = 0;
  const pick = (s) => {
    const ranked = names.map((n) => [n, s[n]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return Math.abs(ranked[0][1]) > 2.5 * Math.abs(ranked[1][1]) ? [ranked[0][0], Math.sign(ranked[0][1])] : null;
  };
  return {
    feed(turn, dBeta, dGamma, beta) {
      // Big jumps are the readings wrapping round (or a glitch), not a turn.
      if (Math.abs(dBeta) > 30 || Math.abs(dGamma) > 30) return;
      for (const n of names) sx[n] += (turn[n] || 0) * dBeta;
      movedX += Math.abs(dBeta);
      // gamma only means "about y" while the phone isn't near upright.
      if (Math.abs(beta) < 55) {
        for (const n of names) sy[n] += (turn[n] || 0) * dGamma;
        movedY += Math.abs(dGamma);
      }
    },
    result() {
      if (movedX < 60) return null;
      const x = pick(sx);
      if (!x) return null;
      const y = movedY >= 60 ? pick(sy) : null;
      if (y && y[0] === x[0]) return null;
      if (!y) {
        // Only x is known yet: it tells us which order the platform uses; take y and z from that.
        const base = x[0] === "alpha" ? AXES.apple : AXES.standard;
        if (base.x[0] !== x[0]) return null;
        return { x, y: base.y, z: base.z };
      }
      // z is whichever is left; its sign follows the platform (both orders are right-handed).
      const z = names.find((n) => n !== x[0] && n !== y[0]);
      return { x, y, z: [z, 1] };
    },
  };
}

/**
 * The gesture reader, kept apart from the sensors so it can be tested with made-up numbers.
 * feed(t ms, rate {x, y, z} in degrees a second about the phone's axes, interval ms?, bounce?)
 * → a gesture name or null. bounce is { v, h }: acceleration along gravity and across it (m/s²).
 *
 * Turns: it adds up how far the phone turned about each axis over the last quarter second. A
 * gesture is a quick turn of at least ~28° that is clearly about one axis. Its first half gives
 * the direction. Bounces: a sharp push along gravity while the phone isn't turning much.
 * After any gesture it waits until the phone has been still for a moment (and at least 0.8 s), so
 * the swing back never counts, and a twist is one shelf, never several.
 */
export function gestureReader({ window: win = 260, need = 28, settle = 45, quiet = 220, gap = 800, push = 7 } = {}) {
  let samples = [];
  let last = 0;
  let armed = true;
  let firedAt = -1e9;
  let still = 0; // since when the phone has been calm (after a gesture)
  return function feed(t, r, interval, bounce) {
    const x = +r?.x || 0;
    const y = +r?.y || 0;
    const z = +r?.z || 0;
    // The sensor says how often it reports; trust that over our clock (some old iPhones say it in
    // seconds, everyone else in milliseconds).
    const iv = interval > 0 && interval < 1 ? interval * 1000 : interval;
    const dt = (iv > 0 ? clamp(iv, 1, 50) : last ? clamp(t - last, 1, 50) : 16) / 1000;
    last = t;
    const v = +bounce?.v || 0;
    const across = +bounce?.h || 0;
    if (!armed) {
      const calm = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < settle && Math.abs(v) < push * 0.4;
      if (!calm) still = 0;
      else if (!still) still = t;
      if (still && t - still >= quiet && t - firedAt >= gap) {
        armed = true;
        samples = [];
      }
      return null;
    }
    samples.push({ t, x: x * dt, y: y * dt, z: z * dt });
    while (samples.length && t - samples[0].t > win) samples.shift();
    let X = 0;
    let Y = 0;
    let Z = 0;
    for (const s of samples) {
      X += s.x;
      Y += s.y;
      Z += s.z;
    }
    const fire = (name) => {
      armed = false;
      still = 0;
      firedAt = t;
      samples = [];
      return name;
    };
    // A bounce: a hard push up or down, with the phone hardly turning.
    if (Math.abs(v) >= push && Math.abs(v) > across * 1.5 && Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z)) < need * 0.6) return fire("add");
    const turns = [
      ["x", X],
      ["y", Y],
      ["z", Z],
    ].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const [axis, deg] = turns[0];
    // Twisting needs a bit more (wrists roll a little with every flick), and clear dominance.
    const enough = Math.abs(deg) >= (axis === "z" ? need * 1.4 : need);
    if (!enough || Math.abs(deg) < Math.abs(turns[1][1]) * 1.7) return null;
    if (axis === "y") return fire(deg > 0 ? "next" : "prev");
    if (axis === "z") return fire(deg > 0 ? "shelfPrev" : "shelfNext");
    return fire("add"); // a flick of the top towards you or away
  };
}

/** Acceleration along gravity (v) and across it (h), from a devicemotion event. Null if unknown. */
export function bounceOf(e) {
  const a = e.acceleration;
  const ag = e.accelerationIncludingGravity;
  if (!a || !ag || a.x == null || ag.x == null) return null;
  const g = { x: ag.x - a.x, y: ag.y - a.y, z: ag.z - a.z };
  const gl = Math.hypot(g.x, g.y, g.z);
  if (gl < 5) return null; // no sense of down (free fall, or a sensor that can't tell)
  const v = (a.x * g.x + a.y * g.y + a.z * g.z) / gl;
  const total = Math.hypot(a.x, a.y, a.z);
  return { v, h: Math.sqrt(Math.max(0, total * total - v * v)) };
}

function savedAxes() {
  try {
    const a = JSON.parse(localStorage.getItem(AXES_KEY) || "null");
    if (a?.x?.length === 2 && a?.y?.length === 2 && a?.z?.length === 2) return a;
  } catch {}
  return null;
}

/**
 * onTilt(x, y): -1..1 each, smoothed, at most once a frame (x: left/right, y: towards/away).
 * onGesture(name): "next" | "prev" | "shelfNext" | "shelfPrev" | "add".
 * canGesture(): false while something else has your attention (a drag, a panel, typing).
 */
export function createGyro({ onTilt, onGesture, canGesture = () => true, tilt = () => true }) {
  let on = false;
  // Where "level" is: how you're holding the phone, learnt slowly so tilt is relative to it.
  let base = null;
  let raw = [0, 0];
  let tx = 0;
  let ty = 0;
  let painted = [0, 0];
  let raf = 0;
  let lastFrame = 0;
  let read = gestureReader();
  let axes = savedAxes() || (isApple() ? AXES.apple : AXES.standard);
  let learner = savedAxes() ? null : axisLearner();
  let turn = { alpha: 0, beta: 0, gamma: 0 }; // reported turn since the last orientation reading
  let lastO = null;

  // Smoothing runs per frame against the clock, not per sensor event, so it feels the same on a
  // 60 Hz and a 120 Hz screen and whatever rate the sensors happen to report at.
  function paint(now) {
    raf = 0;
    const dt = lastFrame ? Math.min(now - lastFrame, 64) : 16;
    lastFrame = now;
    const k = 1 - Math.exp(-dt / 70); // ~70 ms to catch up: soft, but never laggy
    tx += (raw[0] - tx) * k;
    ty += (raw[1] - ty) * k;
    const moving = Math.abs(raw[0] - tx) > 0.003 || Math.abs(raw[1] - ty) > 0.003;
    if (Math.abs(tx - painted[0]) >= 0.003 || Math.abs(ty - painted[1]) >= 0.003) {
      painted = [tx, ty];
      onTilt?.(tx, ty);
    }
    if (moving) raf = requestAnimationFrame(paint);
    else lastFrame = 0;
  }

  function orientation(e) {
    if (e.beta == null || e.gamma == null) return;
    if (learner) {
      if (lastO) learner.feed(turn, e.beta - lastO.beta, e.gamma - lastO.gamma, e.beta);
      turn = { alpha: 0, beta: 0, gamma: 0 };
      lastO = { beta: e.beta, gamma: e.gamma };
      const learnt = learner.result();
      if (learnt) {
        axes = learnt;
        learner = null;
        try {
          localStorage.setItem(AXES_KEY, JSON.stringify(learnt));
        } catch {}
      }
    }
    if (!tilt()) return;
    const b = clamp(e.beta, -90, 90);
    const g = clamp(e.gamma, -90, 90);
    if (!base) base = { b, g };
    // The "level" follows your hold over a few seconds.
    base.b += (b - base.b) * 0.01;
    base.g += (g - base.g) * 0.01;
    raw = [clamp((g - base.g) / 22, -1, 1), clamp((b - base.b) / 22, -1, 1)];
    if (!raf) raf = requestAnimationFrame(paint);
  }

  function motion(e) {
    const now = e.timeStamp || performance.now();
    const r = e.rotationRate;
    if (learner && r) {
      const iv = e.interval > 0 && e.interval < 1 ? e.interval * 1000 : e.interval || 16;
      const dt = clamp(iv, 1, 50) / 1000;
      for (const n of ["alpha", "beta", "gamma"]) turn[n] += (+r[n] || 0) * dt;
    }
    if (!canGesture()) {
      read = gestureReader(); // forget anything half-done
      return;
    }
    const name = read(now, toDevice(r, axes), e.interval, bounceOf(e));
    if (name) onGesture?.(name);
  }

  return {
    get on() {
      return on;
    },
    start() {
      if (on) return;
      on = true;
      base = null;
      read = gestureReader();
      addEventListener("deviceorientation", orientation);
      addEventListener("devicemotion", motion);
    },
    stop() {
      if (!on) return;
      on = false;
      removeEventListener("deviceorientation", orientation);
      removeEventListener("devicemotion", motion);
      cancelAnimationFrame(raf);
      raf = 0;
      raw = [0, 0];
      tx = ty = 0;
      painted = [0, 0];
      onTilt?.(0, 0);
    },
    /** Re-learn "level" (after a big change in how you hold the phone). */
    recentre() {
      base = null;
    },
  };
}

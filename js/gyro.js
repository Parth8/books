// Motion controls. Shelfie can feel your phone move:
//   - Tilt: the pile leans, the background shifts, the bulbs swing and the light on the cover
//     slides, as if the whole thing were a little diorama in your hand.
//   - Flick: turn the phone to face right or left and back (like turning a page): next or
//     previous book.
//   - Bounce: a quick bounce up and down: add a book.
//
// Flicks are read from the gyroscope (how fast the phone turns), which is clean and immediate. A
// bounce is read from the accelerometer, measured along gravity so it works however you hold
// the phone. (Twisting for shelves and tipping the top towards you were dropped: in recordings,
// walking while turning looked like a twist, and a tip looked like picking the phone up.)
//
// The axes. The web standard names rotation rates alpha (about the axis through the screen),
// beta (side to side) and gamma (top to bottom). Safari on iPhone fills them in a different
// order (alpha, beta, gamma = side to side, top to bottom, through the screen), confirmed with
// recordings from a real iPhone. So the rates are mapped per platform.
//
// iPhone asks permission, and only from a tap, so it's switched on from a button. Nothing about
// how you move your phone is stored or sent anywhere.

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
 * The gesture reader, kept apart from the sensors so it can be tested with recordings.
 * feed(t ms, rate {x, y, z} in degrees a second about the phone's axes, interval, sense?) → a
 * gesture name or null. sense is { v, h, g }: acceleration along gravity and across it (m/s²),
 * and which way is down (pointing down; createGyro evens out the platforms).
 *
 * Tuned on two recordings of real moves on an iPhone (tests/fixtures/motion-iphone*.json).
 *
 * Every gesture is a quick snap and back. Slow turns (tilting to play with the light, twisting
 * slowly, turning round as you walk) never count: in the recordings they stayed under 280°/s and
 * took half a second or more, while snaps peaked at 290–890°/s within a third of a second.
 *
 * - Flick sideways (books). Asked to "turn the phone to face right and back", people do one of
 *   two things: turn it about its top-to-bottom axis (y), or snap it round like a steering
 *   wheel (z). Both count. Right, or clockwise: next. Left, or anticlockwise: back one.
 * - Tip the top edge away or towards you, and back (x): next or previous shelf.
 * - Bounce (add a book): a push up then down (or down then up) along gravity, while the phone
 *   hardly turns. A knock on a table or setting the phone down is one short spike: no.
 *
 * A snap is a stretch of turning one way (a "lobe") of 38°+ that peaks above 280°/s and lasts
 * under 0.4 s; it fires as the swing back starts (15° into it). Wrists turn about more than one
 * axis at once (a flick to the left also tips the top towards you by 60–80% as much), so the
 * axis that turned furthest wins. Picking the phone up or putting it down turns it a lot too, so
 * a snap only counts if the phone ended up held about the same way as half a second before (a
 * quick snap before it is fine: it came back), and not within 1.5 s of lying still face up (on a
 * table: you're picking it up or putting it down).
 *
 * After any gesture it waits until the phone has been calm for a moment (and at least half a
 * second), so the swing back or the bounce back never counts twice.
 */
export function gestureReader({
  need = 38, // degrees a snap has to turn
  peak = 280, // degrees a second it has to reach
  quick = 400, // ms it may take at most
  back = 15, // degrees of the swing back before it fires
  backWithin = 700, // ms after the snap ends for the swing back to start
  steady = 40, // how far (degrees) "down" may have moved over the 0.5 s before a snap
  rested = 1500, // ms after lying still face up before a snap counts
  drift = 45, // how far "down" may move beyond what the snap itself explains
  push = 5.5, // m/s² for each half of a bounce
  impulse = 0.6, // m/s of speed each half must give the phone
  pair = 450, // ms between the two halves
  spin = 220, // the phone hardly turning during a bounce: under this many degrees a second
  settle = 150,
  quiet = 40,
  gap = 350,
} = {}) {
  let last = 0;
  let armed = true;
  let firedAt = -1e9;
  let still = 0;
  const downs = []; // [t, unit gravity]: the last second of where down was
  let restedAt = -1e9; // when the phone last lay still, face up
  let restFrom = 0;
  // Per axis: the current lobe { s, t, ang, pk, g, ok }, and the last finished snap waiting for
  // its swing back { s, t, end, ang, g, ok }.
  const lobes = { x: null, y: null, z: null };
  const snaps = { x: null, y: null, z: null };
  let push1 = null; // the current push along gravity: { s, t, imp, pk, across }
  let half = null; // a finished strong push waiting for its opposite: { s, end, pk, across }
  let spun = 0; // fastest turn (any axis) during the current bounce

  const angle = (a, b) => (Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) * 180) / Math.PI;
  const downAt = (t) => {
    for (let i = downs.length - 1; i >= 0; i--) if (downs[i][0] <= t) return downs[i][1];
    return downs[0]?.[1];
  };
  // Which gesture a snap about each axis means, by the direction of the snap.
  const meaning = { y: (s) => (s > 0 ? "next" : "prev"), z: (s) => (s < 0 ? "next" : "prev"), x: (s) => (s < 0 ? "shelfNext" : "shelfPrev") };
  const reset = () => {
    for (const k in lobes) lobes[k] = snaps[k] = null;
    push1 = half = null;
  };

  return function feed(t, r, interval, sense) {
    const rate = { x: +r?.x || 0, y: +r?.y || 0, z: +r?.z || 0 };
    // The sensor says how often it reports; trust that over our clock (iPhone says it in seconds,
    // everyone else in milliseconds).
    const iv = interval > 0 && interval < 1 ? interval * 1000 : interval;
    const dt = (iv > 0 ? clamp(iv, 1, 50) : last ? clamp(t - last, 1, 50) : 16) / 1000;
    last = t;
    const v = +sense?.v || 0;
    const across = +sense?.h || 0;
    const g = sense?.g;
    if (g) {
      const l = Math.hypot(g.x, g.y, g.z) || 1;
      downs.push([t, [g.x / l, g.y / l, g.z / l]]);
      while (downs.length && t - downs[0][0] > 1200) downs.shift();
    }
    const turning = Math.max(Math.abs(rate.x), Math.abs(rate.y), Math.abs(rate.z));
    // Lying on a table: flat, face up, and stiller than any hand (for a fifth of a second).
    const flat = g && downs[downs.length - 1][1][2] < -0.97 && turning < 10;
    if (!flat) restFrom = 0;
    else if (!restFrom) restFrom = t;
    else if (t - restFrom >= 200) restedAt = t;

    if (!armed) {
      const calm = turning < settle && Math.abs(v) < 3;
      if (!calm) still = 0;
      else if (!still) still = t;
      if (still && t - still >= quiet && t - firedAt >= gap) {
        armed = true;
        reset();
      }
      return null;
    }
    const fire = (name) => {
      armed = false;
      still = 0;
      firedAt = t;
      reset();
      return name;
    };

    // Snaps: follow each axis, one lobe at a time.
    let ready = null; // a snap whose swing back has started: [axis, snap]
    for (const k of ["x", "y", "z"]) {
      const w = rate[k];
      const s = w > 40 ? 1 : w < -40 ? -1 : 0;
      let lobe = lobes[k];
      if (lobe && s !== lobe.s) {
        // A lobe ends. Was it a snap?
        if (Math.abs(lobe.ang) >= need && lobe.pk >= peak && t - lobe.t <= quick) snaps[k] = { s: lobe.s, t: lobe.t, end: t, ang: Math.abs(lobe.ang), g: lobe.g, ok: lobe.ok };
        lobe = lobes[k] = null;
      }
      if (s && !lobe) {
        const g0 = downAt(t);
        const was = downAt(t - 500);
        // Held about the same way as half a second ago, and not just lifted off a table?
        const ok = (!g0 || !was || angle(g0, was) < steady) && t - restedAt > rested;
        lobe = lobes[k] = { s, t, ang: 0, pk: 0, g: g0, ok };
      }
      if (lobe) {
        lobe.ang += w * dt;
        lobe.pk = Math.max(lobe.pk, Math.abs(w));
      }
      const snap = snaps[k];
      if (snap && t - snap.end > backWithin) snaps[k] = null;
      else if (snap && lobe && lobe.s === -snap.s && Math.abs(lobe.ang) >= back && (!ready || snap.ang > ready[1].ang)) ready = [k, snap];
    }
    if (ready) {
      const [k, snap] = ready;
      // Another axis turned further over the same moment: that's the real move, not this one.
      const bigger = ["x", "y", "z"].some((j) => {
        if (j === k) return false;
        const o = snaps[j] || lobes[j];
        const end = o?.end ?? t;
        return o && end >= snap.t && o.t <= snap.end && Math.abs(o.ang) > snap.ang;
      });
      snaps[k] = null;
      if (!bigger) {
        const now = downAt(t);
        // A turn can only move "down" by as much as it turned: if it moved much further, the
        // phone was also being picked up or put down.
        const moved = snap.g && now ? angle(snap.g, now) : 0;
        const home = moved < snap.ang - Math.abs(lobes[k].ang) + drift;
        if (snap.ok && home) return fire(meaning[k](snap.s));
      }
    }

    // Bounces: the same idea along gravity. A strong push is remembered; the opposite push
    // fires as soon as it's strong enough (no need to wait for it to finish).
    const ps = v > 2 ? 1 : v < -2 ? -1 : 0;
    const strong = (p) => p.pk >= push && p.imp >= impulse;
    if (push1 && ps !== push1.s) {
      if (strong(push1)) half = { s: push1.s, end: t, pk: push1.pk, across: push1.across };
      push1 = null;
    }
    if (ps && !push1) {
      if (!half) spun = 0;
      push1 = { s: ps, t, imp: 0, pk: 0, across: 0 };
    }
    if (push1) {
      push1.imp += Math.abs(v) * dt;
      push1.pk = Math.max(push1.pk, Math.abs(v));
      push1.across = Math.max(push1.across, across);
      if (half && half.s === -push1.s && strong(push1) && push1.t - half.end <= pair && spun < spin && Math.max(half.across, push1.across) < 0.7 * Math.min(half.pk, push1.pk)) return fire("add");
    }
    if (half && t - half.end > pair) half = null;
    spun = Math.max(spun, turning);
    return null;
  };
}

/** Acceleration along gravity (v) and across it (h), and gravity itself (g), from a devicemotion event. Null if unknown. */
export function bounceOf(e) {
  const a = e.acceleration;
  const ag = e.accelerationIncludingGravity;
  if (!a || !ag || a.x == null || ag.x == null) return null;
  const g = { x: ag.x - a.x, y: ag.y - a.y, z: ag.z - a.z };
  const gl = Math.hypot(g.x, g.y, g.z);
  if (gl < 5) return null; // no sense of down (free fall, or a sensor that can't tell)
  const v = (a.x * g.x + a.y * g.y + a.z * g.z) / gl;
  const total = Math.hypot(a.x, a.y, a.z);
  return { v, h: Math.sqrt(Math.max(0, total * total - v * v)), g };
}

/**
 * How the phone leans, in degrees, from which way is down (a unit vector in the phone's own axes,
 * x right, y up the screen, z out of it). side: the right edge dipping is positive. back: how far
 * the screen faces up, from 0 upright to 90 lying flat. Unlike the orientation event's beta and
 * gamma, these never jump when you hold the phone upright (Euler angles flip there).
 */
export function leanOf(d) {
  return {
    side: (Math.atan2(d.x, Math.hypot(d.y, d.z)) * 180) / Math.PI,
    back: (Math.atan2(-d.z, -d.y) * 180) / Math.PI,
  };
}

const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * onTilt(x, y): -1..1 each, smoothed, at most once a frame (x: left/right, y: towards/away).
 * onGesture(name): "next" | "prev" | "add".
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
  const apple = isApple();
  const axes = apple ? AXES.apple : AXES.standard;
  let fromGravity = false; // once motion events say where down is, tilt comes from them
  let baseAt = 0;
  let heard = -Infinity; // when the sensors last said something new
  let lastSig = "";
  // Real sensors always jitter a little; a reading that never changes (an emulator, or a browser
  // filling in a blank) doesn't count as the sensors talking.
  const hear = (sig) => {
    if (sig !== lastSig && lastSig) heard = performance.now();
    lastSig = sig;
  };
  // An axis guess saved by an earlier version: it could have been wrong, so it goes.
  try {
    localStorage.removeItem(AXES_KEY);
  } catch {}

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

  // Tilt from where down is (motion events): smooth through upright.
  function lean(g, now) {
    const l = 1 / Math.hypot(g.x, g.y, g.z);
    const { side, back } = leanOf({ x: g.x * l, y: g.y * l, z: g.z * l });
    const dt = baseAt ? clamp(now - baseAt, 0, 100) : 16;
    baseAt = now;
    if (!base) base = { s: side, b: back };
    // "Level" follows how you hold the phone, slowly (over ~4 s), so the scene answers to the
    // phone's position, and still settles when you shift your grip for good.
    const k = 1 - Math.exp(-dt / 4000);
    base.s += (side - base.s) * k;
    base.b += wrap(back - base.b) * k;
    // Soft limits (tanh), so a big tilt eases to the edge instead of hitting a wall.
    raw = [Math.tanh((side - base.s) / 18), Math.tanh(-wrap(back - base.b) / 24)];
    if (!raf) raf = requestAnimationFrame(paint);
  }

  // Tilt from the orientation event: only where motion events don't say where down is.
  function orientation(e) {
    if (e.beta == null || e.gamma == null) return;
    hear(`o${e.alpha},${e.beta},${e.gamma}`);
    if (fromGravity || !tilt()) return;
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
    const g = e.accelerationIncludingGravity;
    if (r?.alpha != null || g?.x != null) hear(`m${r?.alpha},${r?.beta},${r?.gamma},${g?.x},${g?.y},${g?.z}`);
    const sense = bounceOf(e);
    // Safari on iPhone reports gravity pointing down; the standard has it pointing up. Down, here.
    if (sense && !apple) sense.g = { x: -sense.g.x, y: -sense.g.y, z: -sense.g.z };
    if (sense) {
      if (!fromGravity) base = null; // (level was learnt from the other kind of reading)
      fromGravity = true;
      if (tilt()) lean(sense.g, now);
    }
    if (!canGesture()) {
      read = gestureReader(); // forget anything half-done
      return;
    }
    const name = read(now, toDevice(r, axes), e.interval, sense);
    if (name) onGesture?.(name);
  }

  return {
    get on() {
      return on;
    },
    /** Are readings actually arriving? (On iPhone they don't until permission is given.) */
    get alive() {
      return on && performance.now() - heard < 1500;
    },
    start() {
      if (on) return;
      on = true;
      base = null;
      fromGravity = false;
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

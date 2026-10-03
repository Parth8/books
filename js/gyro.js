// Motion controls. Shelfie can feel your phone move:
//   - Tilt: the pile leans, the background shifts, the bulbs swing and the light on the cover
//     slides, as if the whole thing were a little diorama in your hand.
//   - Flick the phone right or left (turn it like a page and back): the next or previous book.
//   - Twist it like a steering wheel: the next or previous shelf.
//   - Flick the top towards you: add a book.
// Gestures are read from the gyroscope (how fast the phone turns), not the accelerometer: turning
// is clean and fast to measure, while a push shows up in the accelerometer mixed with gravity,
// hand shake and the bounce back, which is why the old flicks were slow and sometimes backwards.
// iPhone asks permission, and only from a tap, so it's switched on from a button. Nothing about
// how you move your phone is stored or sent anywhere.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

/**
 * The gesture reader, kept apart from the sensors so it can be tested with made-up numbers.
 * feed(t ms, rate {alpha, beta, gamma} in degrees a second, interval ms?) → a gesture name or null.
 *
 * It adds up how far the phone has turned about each axis over the last fraction of a second.
 * A gesture is a quick turn of at least ~28° that is clearly about one axis (so a twist isn't
 * mistaken for a flick). Its first half gives the direction; then it waits for the phone to
 * settle, so the swing back to where you started never counts as a gesture the other way.
 *   alpha: about the axis through the screen (steering wheel)
 *   beta: about the side-to-side axis (top edge tips towards / away from you)
 *   gamma: about the up-down axis (turns the screen to face right / left)
 */
export function gestureReader({ window: win = 260, need = 28, settle = 70, quiet = 140 } = {}) {
  let samples = [];
  let last = 0;
  let armed = true;
  let still = 0; // since when the phone has been calm (after a gesture)
  return function feed(t, r, interval) {
    const a = +r?.alpha || 0;
    const b = +r?.beta || 0;
    const g = +r?.gamma || 0;
    // The sensor says how often it reports; trust that over our clock (some old iPhones say it in
    // seconds, everyone else in milliseconds).
    const iv = interval > 0 && interval < 1 ? interval * 1000 : interval;
    const dt = (iv > 0 ? clamp(iv, 1, 50) : last ? clamp(t - last, 1, 50) : 16) / 1000;
    last = t;
    if (!armed) {
      // Wait for the swing back to finish: everything calm for a moment.
      if (Math.max(Math.abs(a), Math.abs(b), Math.abs(g)) > settle) still = 0;
      else if (!still) still = t;
      if (still && t - still >= quiet) {
        armed = true;
        samples = [];
      }
      return null;
    }
    samples.push({ t, a: a * dt, b: b * dt, g: g * dt });
    while (samples.length && t - samples[0].t > win) samples.shift();
    let A = 0;
    let B = 0;
    let G = 0;
    for (const s of samples) {
      A += s.a;
      B += s.b;
      G += s.g;
    }
    const turns = [
      ["a", A],
      ["b", B],
      ["g", G],
    ].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
    const [axis, deg] = turns[0];
    // Twisting needs a bit more (wrists roll a little with every flick), and clear dominance.
    const enough = Math.abs(deg) >= (axis === "a" ? need * 1.4 : need);
    if (!enough || Math.abs(deg) < Math.abs(turns[1][1]) * 1.7) return null;
    let name = null;
    if (axis === "g") name = deg > 0 ? "next" : "prev";
    else if (axis === "a") name = deg > 0 ? "shelfPrev" : "shelfNext";
    else if (deg > 0) name = "add"; // top edge towards you; tipping it away is just how people hold phones
    // A big turn that isn't a gesture (tipping the phone away) still has to settle first, or its
    // swing back would read as the opposite move.
    armed = false;
    still = 0;
    samples = [];
    return name;
  };
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
    if (e.beta == null || e.gamma == null || !tilt()) return;
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
    if (!canGesture()) {
      read = gestureReader(); // forget anything half-done
      return;
    }
    const name = read(now, e.rotationRate, e.interval);
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

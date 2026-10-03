// Motion controls. Shelfie can feel your phone move:
//   - Tilt: the pile leans, the background shifts, the bulbs swing and the light on the cover
//     slides, as if the whole thing were a little diorama in your hand.
//   - Flick the phone right or left: the next or previous book.
//   - Twist it like a steering wheel: the next or previous shelf.
//   - Flick it up: add a book.
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
 * onTilt(x, y): -1..1 each, smoothed, at most once a frame (x: left/right, y: towards/away).
 * onGesture(name): "next" | "prev" | "shelfNext" | "shelfPrev" | "add".
 * canGesture(): false while something else has your attention (a drag, a panel, typing).
 */
export function createGyro({ onTilt, onGesture, canGesture = () => true, tilt = () => true }) {
  let on = false;
  // Where "level" is: how you're holding the phone, learnt slowly so tilt is relative to it.
  let base = null;
  let tx = 0;
  let ty = 0;
  let painted = [0, 0];
  let raf = 0;
  let cooldown = 0;
  let spike = null; // the first big push of a flick: { axis, sign, t }

  function paint() {
    raf = 0;
    if (Math.abs(tx - painted[0]) < 0.004 && Math.abs(ty - painted[1]) < 0.004) return;
    painted = [tx, ty];
    onTilt?.(tx, ty);
  }

  function orientation(e) {
    if (e.beta == null || e.gamma == null || !tilt()) return;
    const b = clamp(e.beta, -90, 90);
    const g = clamp(e.gamma, -90, 90);
    if (!base) base = { b, g };
    // The "level" follows your hold over a couple of seconds.
    base.b += (b - base.b) * 0.012;
    base.g += (g - base.g) * 0.012;
    const nx = clamp((g - base.g) / 22, -1, 1);
    const ny = clamp((b - base.b) / 22, -1, 1);
    tx += (nx - tx) * 0.25;
    ty += (ny - ty) * 0.25;
    if (!raf) raf = requestAnimationFrame(paint);
  }

  function motion(e) {
    const a = e.acceleration;
    const r = e.rotationRate;
    const now = performance.now();
    if (now < cooldown || !canGesture()) return;
    // Twist like a steering wheel: a fast spin around the axis through the screen.
    const spin = r?.alpha ?? 0;
    if (Math.abs(spin) > 280) {
      fire(spin > 0 ? "shelfPrev" : "shelfNext", now);
      return;
    }
    if (!a) return;
    const ax = a.x ?? 0;
    const ay = a.y ?? 0;
    // A flick is a sharp push one way, mostly along one axis. Its first push gives the direction.
    if (!spike || now - spike.t > 220) spike = null;
    if (!spike && Math.abs(ax) > 11 && Math.abs(ax) > Math.abs(ay) * 1.5) spike = { axis: "x", sign: Math.sign(ax), t: now };
    else if (!spike && ay > 12 && ay > Math.abs(ax) * 1.5) spike = { axis: "y", sign: 1, t: now };
    if (spike) {
      const name = spike.axis === "x" ? (spike.sign > 0 ? "next" : "prev") : "add";
      spike = null;
      fire(name, now);
    }
  }

  function fire(name, now) {
    cooldown = now + 700;
    onGesture?.(name);
  }

  return {
    get on() {
      return on;
    },
    start() {
      if (on) return;
      on = true;
      base = null;
      addEventListener("deviceorientation", orientation);
      addEventListener("devicemotion", motion);
    },
    stop() {
      if (!on) return;
      on = false;
      removeEventListener("deviceorientation", orientation);
      removeEventListener("devicemotion", motion);
      tx = ty = 0;
      onTilt?.(0, 0);
    },
    /** Re-learn "level" (after a big change in how you hold the phone). */
    recentre() {
      base = null;
    },
  };
}

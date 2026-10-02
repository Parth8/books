// Springs, velocity and rubber bands: the motion engine behind every gesture.
//
// Everything that moves is a spring with a value, a target and a velocity. Letting go of a
// card hands the spring your finger's speed, so a flick carries on and settles naturally, and
// a new gesture can grab anything mid-flight. One shared frame loop steps them all.

import { prefersReducedMotion } from "./util.js";

const live = new Set();
const after = new Set();
let raf = 0;
let last = 0;

function tick(t) {
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 1 / 60);
  last = t;
  for (const s of [...live]) s.step(dt);
  const fns = [...after];
  after.clear();
  for (const fn of fns) fn();
  if (live.size || after.size) raf = requestAnimationFrame(tick);
  else {
    raf = 0;
    last = 0;
  }
}

function wake() {
  raf ||= requestAnimationFrame(tick);
}

/** Run fn once at the end of the current (or next) frame, after springs have stepped. */
export function afterFrame(fn) {
  after.add(fn);
  wake();
}

export class Spring {
  constructor(value = 0, { stiffness = 320, damping = 30, mass = 1, precision = 0.002, onChange, onRest } = {}) {
    Object.assign(this, { value, target: value, v: 0, stiffness, damping, mass, precision, onChange, onRest });
  }
  /** Spring towards a target, optionally with a starting velocity (units per second). */
  to(target, velocity, opts) {
    if (opts) Object.assign(this, opts);
    this.target = target;
    if (velocity != null) this.v = velocity;
    if (prefersReducedMotion()) return this.jump(target);
    live.add(this);
    wake();
    return this;
  }
  /** Go straight there (a finger is dragging it). */
  jump(value) {
    this.value = this.target = value;
    this.v = 0;
    live.delete(this);
    this.onChange?.(value);
    return this;
  }
  get moving() {
    return live.has(this);
  }
  step(dt) {
    // Semi-implicit Euler in small steps stays stable even for stiff springs.
    const n = Math.ceil(dt / 0.004);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const f = -this.stiffness * (this.value - this.target) - this.damping * this.v;
      this.v += (f / this.mass) * h;
      this.value += this.v * h;
    }
    const scale = Math.max(1, Math.abs(this.target));
    if (Math.abs(this.v) < this.precision * 60 * scale && Math.abs(this.value - this.target) < this.precision * scale) {
      this.value = this.target;
      this.v = 0;
      live.delete(this);
      this.onChange?.(this.value);
      this.onRest?.(this.value);
      return;
    }
    this.onChange?.(this.value);
  }
}

/**
 * A bundle of springs (x, y, rotation…) that renders once per frame.
 *   const m = motion({ x: 0, r: 0 }, (v) => el.style.transform = `translateX(${v.x}px) rotate(${v.r}deg)`)
 *   m.to({ x: 100 }, { x: 800 })   // target, velocity
 */
export function motion(init, render, opts = {}) {
  const springs = {};
  const values = { ...init };
  let queued = false;
  const paint = () => {
    queued = false;
    render(values);
  };
  const dirty = () => {
    if (queued) return;
    queued = true;
    afterFrame(paint);
  };
  for (const [k, v] of Object.entries(init)) {
    springs[k] = new Spring(v, {
      ...opts,
      ...(opts[k] || {}),
      onChange: (x) => {
        values[k] = x;
        dirty();
      },
    });
  }
  render(values);
  return {
    values,
    springs,
    to(targets, velocity = {}, o) {
      for (const [k, t] of Object.entries(targets)) springs[k]?.to(t, velocity[k], o);
    },
    jump(targets) {
      for (const [k, t] of Object.entries(targets)) springs[k]?.jump(t);
    },
    get moving() {
      return Object.values(springs).some((s) => s.moving);
    },
    /** Resolves when every spring has come to rest. */
    settle() {
      return new Promise((resolve) => {
        const check = () => (Object.values(springs).some((s) => s.moving) ? afterFrame(check) : resolve());
        check();
      });
    },
  };
}

/** Finger speed from the last ~80 ms of movement, in px per second. */
export class Velocity {
  constructor() {
    this.pts = [];
  }
  reset(x = 0, y = 0) {
    this.pts = [{ x, y, t: performance.now() }];
  }
  add(x, y) {
    const t = performance.now();
    this.pts.push({ x, y, t });
    while (this.pts.length > 2 && t - this.pts[0].t > 80) this.pts.shift();
  }
  get() {
    const p = this.pts;
    if (p.length < 2) return { x: 0, y: 0 };
    const a = p[0];
    const b = p[p.length - 1];
    const dt = Math.max(1, b.t - a.t) / 1000;
    if (performance.now() - b.t > 100) return { x: 0, y: 0 }; // finger stopped before letting go
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }
}

/** iOS-style rubber band: the further past the edge, the harder it pulls back. */
export function rubber(over, limit = 120) {
  const s = Math.sign(over);
  const a = Math.abs(over);
  return s * limit * (1 - 1 / ((a * 0.55) / limit + 1));
}

/** Where a flick would come to rest (for snapping with momentum). */
export const project = (v, decel = 0.998) => ((v / 1000) * decel) / (1 - decel);

export const lerp = (a, b, t) => a + (b - a) * t;

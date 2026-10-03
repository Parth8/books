// Liquid that fills a book's cover as you read. The surface is a row of little springs that
// pull on their neighbours, so a fast scrub makes a splash, a sideways flick tilts it and it
// sloshes back, and bubbles rise while it's filling.

import { prefersReducedMotion } from "./util.js";
import { Spring } from "./physics.js";

const N = 28;

export function createLiquid(canvas, { color = "#2b3bff", level = 0 } = {}) {
  const ctx = canvas.getContext("2d");
  const h = new Float32Array(N); // surface offsets, in px
  const v = new Float32Array(N);
  const bubbles = [];
  let w = 0;
  let ht = 0;
  let dpr = 1;
  let raf = 0;
  let t0 = performance.now();
  let alive = true;
  let calm = 0;
  let idleTimer = 0;
  const lvl = new Spring(level, { stiffness: 120, damping: 18, onChange: () => run() });

  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(1.5, devicePixelRatio || 1);
    w = r.width;
    ht = r.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(ht * dpr));
  }

  function frame(t) {
    raf = 0;
    if (!alive) return;

    if (!w) return; // not laid out yet (or hidden): the ResizeObserver starts it once it has a size
    const reduced = prefersReducedMotion();
    // Waves: each point springs back to flat and pulls its neighbours along.
    let energy = 0;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < N; i++) {
        v[i] += -0.025 * h[i] - 0.03 * v[i];
      }
      for (let i = 0; i < N; i++) {
        const l = i > 0 ? h[i - 1] : h[i];
        const r = i < N - 1 ? h[i + 1] : h[i];
        v[i] += 0.12 * (l + r - 2 * h[i]);
      }
      for (let i = 0; i < N; i++) {
        h[i] += v[i];
        energy += Math.abs(v[i]) + Math.abs(h[i]) * 0.05;
      }
    }
    const time = (t - t0) / 1000;
    const level = lvl.value;
    const base = ht * (1 - level);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, ht);
    if (level > 0.001) {
      const pts = [];
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        // A little life while it moves, easing to flat (and still) as it settles.
        const idle = reduced || calm > 12 ? 0 : (Math.sin(time * 2.2 + i * 0.45) * 2.2 + Math.sin(time * 1.3 - i * 0.3) * 1.4) * (1 - calm / 12);
        pts.push([x, Math.max(-6, base + h[i] + idle)]);
      }
      // Body
      ctx.beginPath();
      ctx.moveTo(0, ht);
      ctx.lineTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < N; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      ctx.lineTo(w, pts[N - 1][1]);
      ctx.lineTo(w, ht);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, base, 0, ht);
      g.addColorStop(0, color);
      g.addColorStop(1, shade(color, -0.35));
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = g;
      ctx.fill();
      ctx.globalAlpha = 1;
      // Bright meniscus line
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < N; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Bubbles
      if (!reduced && lvl.moving && lvl.target > lvl.value && Math.random() < 0.5)
        bubbles.push({ x: Math.random() * w, y: ht + 4, r: 1.5 + Math.random() * 3.5, s: 0.6 + Math.random() * 1.4 });
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y -= b.s * 2.2;
        b.x += Math.sin((b.y + i) / 9) * 0.4;
        if (b.y < base + 4) {
          bubbles.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    calm = energy < 0.5 && !bubbles.length && !lvl.moving ? calm + 1 : 0;
    // Draw only while something moves (a scrub, a splash, bubbles). At rest the canvas keeps its
    // last frame and costs nothing; the gentle idle ripple is a CSS wave on top (GPU only).
    if (calm < 20) run();
  }

  function run() {
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (alive) raf ||= requestAnimationFrame(frame);
  }
  function idle() {
    if (alive && !idleTimer && !raf) idleTimer = setTimeout(() => ((idleTimer = 0), run()), 40);
  }
  function wake() {
    run();
  }
  const onVisible = () => document.visibilityState === "visible" && run();
  document.addEventListener("visibilitychange", onVisible);

  const ro = new ResizeObserver(() => {
    size();
    if (w) run();
  });
  ro.observe(canvas);

  return {
    /** 0..1. */
    level(frac, immediate = false) {
      frac = Math.min(1, Math.max(0, frac));
      if (immediate) lvl.jump(frac);
      else lvl.to(frac);
      wake();
    },
    /** A push on the surface: up to ±1 strength, at x (0..1, default middle). */
    splash(strength, at = 0.5) {
      const c = Math.round(at * (N - 1));
      for (let i = 0; i < N; i++) v[i] += strength * 9 * Math.exp(-((i - c) ** 2) / 18);
      wake();
    },
    /** Tilt it (a sideways flick): positive tips the right side up. */
    slosh(strength) {
      for (let i = 0; i < N; i++) v[i] += (strength * 6 * (i - N / 2)) / (N / 2);
      wake();
    },
    color(c) {
      color = c;
      run();
    },
    /** Pick the idle ripple back up (after a panel closes). */
    wake: () => run(),
    destroy() {
      alive = false;
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      cancelAnimationFrame(raf);
      clearTimeout(idleTimer);
    },
  };
}

/** Darken (negative) or lighten a hex colour. */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

// The pile of stamps, and every gesture on it.
//
//   swipe ← / →        flip to the next / previous book (the + stamp is always last)
//   drag ↑ / ↓         on a book you're reading: turn pages
//   pull ↑             on the + stamp: open search
//   hold, then drag    lift a book and drop it on a shelf (or the bin)
//   tap                flip the stamp over
//   double-tap         poke it (easter eggs)
//
// Cards are springs, so they keep your finger's speed when you let go and can be caught
// mid-flight. The cards behind follow along as you drag, so the pile always feels connected.

import { motion, Velocity, rubber, lerp } from "./physics.js";
import { buzz, clamp } from "./util.js";

const HOLD_MS = 420;
const TAP_GAP = 260;

export function createDeck(root, opts) {
  let items = []; // [{ id, el, m }]
  let i = 0;
  let W = 260;
  const vel = new Velocity();
  let g = null; // the gesture in progress
  let lastTap = { t: 0, id: null, timer: 0 };

  const slotPos = (k) => {
    if (k >= 0) {
      const kk = Math.min(k, 4);
      return { x: kk * 18, y: kk * 9, r: kk * 4, s: 1 - kk * 0.055, o: k > 3.5 ? Math.max(0, 4.5 - k) : 1 };
    }
    const t = Math.max(-1, k); // -1..0: off to the left, sliding back in
    return { x: lerp(0, -W * 1.35, -t), y: lerp(0, 30, -t), r: lerp(0, -16, -t), s: lerp(1, 0.92, -t), o: k < -1 ? 0 : 1 };
  };

  function make(item) {
    const el = item.el;
    el.classList.add("card");
    el.style.position = "absolute";
    root.append(el);
    item.m = motion({ x: 0, y: 0, r: 0, s: 1, o: 1 }, (v) => {
      el.style.transform = `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0) rotate(${v.r.toFixed(2)}deg) scale(${v.s.toFixed(4)})`;
      el.style.opacity = String(clamp(v.o, 0, 1));
      el.style.visibility = v.o <= 0.01 ? "hidden" : "visible";
    }, { stiffness: 340, damping: 30, s: { stiffness: 420, damping: 28 } });
    return item;
  }

  function layout(shift = 0, { except = null, velocity = {}, soft = false } = {}) {
    items.forEach((it, j) => {
      if (it === except) return;
      const k = j - i + shift;
      const p = slotPos(k);
      it.el.style.zIndex = String(200 - Math.round((j - i) * 2));
      it.el.classList.toggle("top", j === i);
      it.el.inert = j !== i;
      if (soft) it.m.to(p, j === i ? velocity : {});
      else it.m.to(p, j === i ? velocity : {});
    });
  }

  const top = () => items[i];

  function go(to, velocity = {}) {
    const from = i;
    i = clamp(to, 0, items.length - 1);
    layout(0, { velocity });
    if (i !== from) {
      buzz(6);
      opts.onIndex?.(top()?.id, i);
    }
  }

  /** Replace the pile. `deal` animates a shelf change: old cards drop away, new ones fly in. */
  function set(next, { keep = null, deal = 0 } = {}) {
    W = root.clientWidth * 0.62 || 260;
    const byId = new Map(items.map((it) => [it.id, it]));
    const ids = new Set(next.map((n) => n.id));
    for (const it of items) {
      if (ids.has(it.id) && !deal) continue;
      // Leaving: drop off the bottom (shelf switch) or shrink away (removed).
      it.el.inert = true;
      it.el.classList.remove("top");
      it.el.classList.add("leaving");
      it.m.to(deal ? { y: 420, r: deal * -12, x: deal * -60, o: 0 } : { s: 0.4, o: 0 });
      it.m.settle().then(() => it.el.remove());
    }
    const prevTop = top()?.id;
    items = next.map((n) => {
      const old = !deal && byId.get(n.id);
      if (old) {
        if (old.el !== n.el) {
          // Fresh element for the same book (its content changed): swap it in place.
          n.el.style.cssText = old.el.style.cssText;
          old.el.replaceWith(n.el);
          n.el.classList.add("card");
          old.m = motion({ ...old.m.values }, renderFor(n.el), { stiffness: 340, damping: 30 });
          old.el = n.el;
        }
        return old;
      }
      const it = make({ id: n.id, el: n.el });
      it.m.jump(deal ? { x: deal * 120, y: -60 - Math.random() * 40, r: deal * 14, s: 0.8, o: 0 } : { x: 0, y: 40, s: 0.6, o: 0 });
      return it;
    });
    const want = keep ?? prevTop;
    const at = deal ? 0 : items.findIndex((it) => it.id === want);
    i = clamp(at < 0 ? i : at, 0, items.length - 1);
    if (deal) {
      items.forEach((it, j) => setTimeout(() => layoutOne(it, j), 60 + j * 55));
    } else layout();
    opts.onIndex?.(top()?.id, i);
  }

  function renderFor(el) {
    return (v) => {
      el.style.transform = `translate3d(${v.x.toFixed(2)}px, ${v.y.toFixed(2)}px, 0) rotate(${v.r.toFixed(2)}deg) scale(${v.s.toFixed(4)})`;
      el.style.opacity = String(clamp(v.o, 0, 1));
      el.style.visibility = v.o <= 0.01 ? "hidden" : "visible";
    };
  }

  function layoutOne(it, j) {
    if (!items.includes(it)) return;
    it.el.style.zIndex = String(200 - Math.round((j - i) * 2));
    it.el.classList.toggle("top", j === i);
    it.el.inert = j !== i;
    it.m.to(slotPos(j - i), {}, { stiffness: 260, damping: 22 });
  }

  /* ---------------- gestures ---------------- */

  root.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || g) return;
    const card = e.target.closest(".card");
    const it = top();
    if (!card || !it || card !== it.el) return;
    if (e.target.closest("button, a, input")) return;
    e.preventDefault(); // no native drag or text selection: this gesture is ours
    root.setPointerCapture(e.pointerId);
    vel.reset(e.clientX, e.clientY);
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, mode: "press", it, lastY: e.clientY };
    g.hold = setTimeout(() => {
      if (g?.mode === "press" && it.id !== "add" && opts.canLift?.(it.id)) startLift();
    }, HOLD_MS);
    it.m.to({ s: 0.97 });
  });

  root.addEventListener("pointermove", (e) => {
    if (!g || e.pointerId !== g.id) return;
    vel.add(e.clientX, e.clientY);
    g.dx = e.clientX - g.x0;
    g.dy = e.clientY - g.y0;
    if (g.mode === "press") {
      if (Math.hypot(g.dx, g.dy) < 8) return;
      clearTimeout(g.hold);
      const vertical = Math.abs(g.dy) > Math.abs(g.dx) * 1.1;
      if (vertical && g.it.id !== "add" && opts.canScrub?.(g.it.id)) {
        g.mode = "scrub";
        g.lastY = e.clientY;
        opts.onScrubStart?.(g.it.id);
      } else if (vertical && g.it.id === "add" && g.dy < 0) g.mode = "pull";
      else g.mode = "swipe";
    }
    if (g.mode === "swipe") swipeMove();
    else if (g.mode === "scrub") {
      const step = e.clientY - g.lastY;
      g.lastY = e.clientY;
      opts.onScrub?.(g.it.id, -step, -vel.get().y);
      g.it.m.jump({ y: rubber(g.dy, 40), s: 1 + clamp(-g.dy / 3000, -0.03, 0.03), r: 0, x: 0 });
    } else if (g.mode === "pull") {
      g.it.m.jump({ y: rubber(Math.min(0, g.dy), 160), s: 1 + Math.min(0.08, -g.dy / 1500) });
      opts.onPull?.(clamp(-g.dy / 110, 0, 1));
    } else if (g.mode === "lift") liftMove(e);
  });

  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.hold);
    const v = vel.get();
    const { mode, it } = g;
    const cur = g;
    g = null;
    if (mode === "press") {
      it.m.to({ s: 1 });
      return tap(it);
    }
    if (mode === "swipe") return swipeEnd(cur, v);
    if (mode === "scrub") {
      it.m.to({ x: 0, y: 0, s: 1, r: 0 }, { y: v.y * 0.2 });
      return opts.onScrubEnd?.(it.id, -v.y);
    }
    if (mode === "pull") {
      opts.onPull?.(0);
      if (cur.dy < -100 || v.y < -700) {
        buzz([8, 30, 10]);
        it.m.to({ y: -40, s: 1.04 });
        setTimeout(() => it.m.to({ y: 0, s: 1 }), 220);
        return opts.onPullUp?.();
      }
      return it.m.to({ y: 0, s: 1 }, { y: v.y });
    }
    if (mode === "lift") return liftEnd(cur, v);
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);

  function swipeMove() {
    const s = g.dx / W;
    const atStart = i === 0;
    const atEnd = i === items.length - 1;
    if (g.dx < 0) {
      const dx = atEnd ? rubber(g.dx, 70) : g.dx;
      g.it.m.jump({ x: dx, y: g.dy * 0.22, r: dx * 0.06, s: 1, o: 1 });
      if (!atEnd) layout(Math.max(s, -1), { except: g.it });
      opts.onDrag?.(dx / W);
    } else {
      if (atStart) {
        const dx = rubber(g.dx, 70);
        g.it.m.jump({ x: dx, y: g.dy * 0.22, r: dx * 0.06 });
      } else {
        layout(Math.min(s, 1));
        // The card coming back in follows the finger directly.
        const prev = items[i - 1];
        const k = -1 + Math.min(s * 1.15, 1);
        prev.m.jump({ ...slotPos(k), y: slotPos(k).y + g.dy * 0.22 });
      }
      opts.onDrag?.(g.dx / W);
    }
  }

  function swipeEnd(cur, v) {
    opts.onDrag?.(0);
    const atStart = i === 0;
    const atEnd = i === items.length - 1;
    if (cur.dx < 0 && !atEnd && (cur.dx < -W * 0.28 || v.x < -650)) {
      const out = cur.it;
      i++;
      buzz(6);
      out.el.style.zIndex = "300";
      out.m.to({ ...slotPos(-1), y: cur.dy * 0.4 + 30 }, { x: Math.min(v.x, -800), r: -60 });
      layout(0, { except: out });
      out.el.inert = true;
      out.el.classList.remove("top");
      opts.onIndex?.(top().id, i);
      opts.onFlick?.(v.x);
      return;
    }
    if (cur.dx > 0 && !atStart && (cur.dx > W * 0.28 || v.x > 650)) {
      i--;
      buzz(6);
      layout(0, { velocity: { x: Math.max(v.x, 600) } });
      opts.onIndex?.(top().id, i);
      opts.onFlick?.(v.x);
      return;
    }
    if (atEnd && cur.dx < -40) opts.onEdge?.("end");
    if (atStart && cur.dx > 40) opts.onEdge?.("start");
    layout(0, { velocity: { x: v.x, r: v.x * 0.03 } });
  }

  function tap(it) {
    const now = performance.now();
    if (lastTap.id === it.id && now - lastTap.t < TAP_GAP) {
      clearTimeout(lastTap.timer);
      lastTap = { t: 0, id: null, timer: 0 };
      return opts.onDoubleTap?.(it.id, it.el);
    }
    clearTimeout(lastTap.timer);
    lastTap = { t: now, id: it.id, timer: setTimeout(() => opts.onTap?.(it.id, it.el), it.id === "add" ? 0 : TAP_GAP) };
    if (it.id === "add") lastTap.id = null;
  }

  /* ---------------- lift and drop ---------------- */

  let hover = null;
  function startLift() {
    g.mode = "lift";
    buzz([12, 40, 12]);
    g.it.el.classList.add("lifted");
    g.it.el.style.zIndex = "400";
    g.it.m.to({ s: 0.8, r: -4, y: -12 });
    opts.onLift?.(g.it.id, true);
  }

  function liftMove(e) {
    const zones = opts.zones?.() || [];
    let near = null;
    for (const z of zones) {
      const r = z.el.getBoundingClientRect();
      const pad = 24;
      if (e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad) near = z;
    }
    if (near?.id !== hover?.id) {
      hover = near;
      if (near) buzz(10);
      opts.onHover?.(near?.id || null);
    }
    let x = g.dx;
    let y = g.dy - 12;
    let s = 0.8;
    if (near) {
      // Magnet: pulled towards the middle of the zone, and shrinking into it.
      const zr = near.el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const cx = zr.left + zr.width / 2 - (rr.left + rr.width / 2);
      const cy = zr.top + zr.height / 2 - (rr.top + rr.height / 2);
      x = lerp(x, cx, 0.45);
      y = lerp(y, cy, 0.45);
      s = 0.55;
    }
    g.it.m.to({ x, y, r: g.dx * 0.04, s }, {}, { stiffness: 600, damping: 40 });
  }

  function liftEnd(cur, v) {
    const it = cur.it;
    it.el.classList.remove("lifted");
    opts.onLift?.(it.id, false);
    const zone = hover;
    hover = null;
    opts.onHover?.(null);
    if (zone) {
      const zr = zone.el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      it.m.to({ x: zr.left + zr.width / 2 - (rr.left + rr.width / 2), y: zr.top + zr.height / 2 - (rr.top + rr.height / 2), s: 0.15, o: 0, r: 20 }, {}, { stiffness: 300, damping: 26 });
      buzz([10, 30, 20]);
      return opts.onDrop?.(it.id, zone.id);
    }
    layout(0, { velocity: { x: v.x, y: v.y } });
  }

  /* ---------------- keyboard ---------------- */

  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "ArrowRight") go(i + 1);
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && opts.canScrub?.(top()?.id)) opts.onScrubKey?.(top().id, e.key === "ArrowUp" ? 1 : -1);
    else if (e.key === "Enter" || e.key === " ") top() && opts.onTap?.(top().id, top().el);
    else return;
    e.preventDefault();
  });

  new ResizeObserver(() => {
    W = root.clientWidth * 0.62 || 260;
  }).observe(root);

  return {
    set,
    go,
    get index() {
      return i;
    },
    get top() {
      return top();
    },
    get dragging() {
      return !!g && g.mode !== "press";
    },
    item: (id) => items.find((it) => it.id === id),
    ids: () => items.map((it) => it.id),
  };
}

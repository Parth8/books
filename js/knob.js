// The rotary knob on the page dock. Spin it with a finger: every notch is a page, with a tick
// you can feel. Let go mid-spin and it keeps turning, slowing down like a real dial.
// Arrow keys turn it one notch at a time.

import { h, buzz, prefersReducedMotion } from "./util.js";

const NOTCH = 14; // degrees per page

export function createKnob({ label = "Page dial", onTurn, onRelease } = {}) {
  const cap = h("span", { class: "knob-cap" }, h("i", { class: "knob-dot" }), h("span", { class: "knob-grip" }));
  const ring = h("span", { class: "knob-ring" });
  const el = h("div", { class: "knob", role: "slider", tabIndex: 0, "aria-label": label }, ring, cap);
  let angle = 0;
  let acc = 0; // degrees not yet turned into a page
  let drag = null;
  let spin = 0;
  let raf = 0;

  const paint = () => (cap.style.transform = `rotate(${angle.toFixed(1)}deg)`);

  function turn(deg) {
    angle += deg;
    acc += deg;
    paint();
    let pages = 0;
    while (acc >= NOTCH) {
      acc -= NOTCH;
      pages++;
    }
    while (acc <= -NOTCH) {
      acc += NOTCH;
      pages--;
    }
    if (pages) {
      buzz(4);
      ring.classList.remove("tick");
      void ring.offsetWidth;
      ring.classList.add("tick");
      onTurn?.(pages);
    }
  }

  const center = () => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const at = (e, c) => (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI;

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    spin = 0;
    const c = center();
    drag = { id: e.pointerId, c, a: at(e, c), t: performance.now(), w: 0 };
    el.setPointerCapture(e.pointerId);
    el.classList.add("grab");
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = at(e, drag.c);
    let d = a - drag.a;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    drag.a = a;
    const now = performance.now();
    const dt = Math.max(1, now - drag.t);
    drag.t = now;
    drag.w = drag.w * 0.6 + (d / dt) * 0.4; // degrees per ms, smoothed
    turn(d);
  });
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    el.classList.remove("grab");
    spin = drag.w * 16; // degrees per frame
    drag = null;
    if (Math.abs(spin) > 1.2 && !prefersReducedMotion()) coast();
    else onRelease?.();
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);

  function coast() {
    spin *= 0.95;
    turn(spin);
    if (Math.abs(spin) > 0.4) raf = requestAnimationFrame(coast);
    else onRelease?.();
  }

  el.addEventListener("keydown", (e) => {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (!step) return;
    e.preventDefault();
    turn(step * NOTCH - acc);
    onRelease?.();
  });

  return { el, value: (text) => el.setAttribute("aria-valuetext", text) };
}

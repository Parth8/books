// Panels that you pull up from the bottom and fling back down. They follow your finger the
// whole way (the background dims as they rise), and keep your speed when you let go.

import { Spring, Velocity, rubber } from "./physics.js";
import { buzz } from "./util.js";

export function createPanel(el, { handles = [], onOpen, onClose, onProgress } = {}) {
  const shade = document.createElement("div");
  shade.className = "shade";
  el.before(shade);
  let H = innerHeight;
  let isOpen = false;
  const y = new Spring(1, {
    stiffness: 380,
    damping: 36,
    onChange: (v) => {
      el.style.transform = `translate3d(0, ${(v * H).toFixed(1)}px, 0)`;
      const p = Math.max(0, Math.min(1, 1 - v));
      shade.style.opacity = String(p);
      // A peek (or the last moments of closing) must never swallow a swipe on the pile.
      shade.style.pointerEvents = p > 0.3 ? "auto" : "none";
      shade.classList.toggle("on", p > 0.6);
      el.style.visibility = v >= 0.999 ? "hidden" : "visible";
      onProgress?.(p);
    },
  });
  y.jump(1);
  const app = document.getElementById("app");

  function settle(open, v = 0) {
    const was = isOpen;
    isOpen = open;
    y.to(open ? 0 : 1, v / H);
    el.setAttribute("aria-hidden", String(!open));
    el.inert = !open;
    if (app) app.inert = open;
    if (open && !was) {
      onOpen?.();
      setTimeout(() => el.querySelector("[autofocus], input, button")?.focus({ preventScroll: true }), 250);
    }
    if (!open && was) onClose?.();
  }

  /** Drag from `from` (0 = open, 1 = closed) by the finger. */
  function grab(target, { from, canStart = () => true }) {
    const vel = new Velocity();
    let d = null;
    target.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || !canStart(e)) return;
      if (!e.target.closest("button, input")) e.preventDefault();
      d = { id: e.pointerId, y0: e.clientY, start: from(), moved: false };
      // Capture now: a quick flick leaves the handle before it counts as a drag.
      target.setPointerCapture(e.pointerId);
      vel.reset(0, e.clientY);
    });
    target.addEventListener("pointermove", (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y0;
      if (!d.moved) {
        if (Math.abs(dy) < 6) return;
        d.moved = true;
      }
      vel.add(0, e.clientY);
      H = innerHeight;
      let v = d.start + dy / H;
      if (v < 0) v = rubber(v * H, 60) / H;
      y.jump(Math.min(1, v));
    });
    const up = (e) => {
      if (!d || e.pointerId !== d.id) return;
      const moved = d.moved;
      d = null;
      if (!moved) return;
      const v = vel.get().y;
      const open = v < -500 || (v < 500 && y.value < 0.55);
      if (open !== isOpen) buzz(8);
      settle(open, v);
    };
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  for (const hnd of handles) grab(hnd, { from: () => 1 });
  // Drag the panel down by its top bar.
  grab(el, { from: () => 0, canStart: (e) => !!e.target.closest(".panel-grab") && !e.target.closest("input, button") });
  shade.addEventListener("click", () => settle(false));
  addEventListener("resize", () => {
    H = innerHeight;
    y.jump(y.value);
  });
  el.inert = true;

  return {
    open: () => settle(true),
    close: () => settle(false),
    /** Nudge it up a little (a hint that it can be pulled). */
    peek() {
      y.to(0.92, -1.2);
      setTimeout(() => !isOpen && y.to(1), 260);
    },
    get isOpen() {
      return isOpen;
    },
  };
}

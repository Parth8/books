// An arcade lever: grab the ball and pull it all the way down to fire. Let go early and it
// springs back up. It's a deliberate, physical "are you sure?", used for the big, scary actions.
// Keyboard: focus it and press Enter or Space to pull it.

import { h, prefersReducedMotion } from "./util.js";
import { Spring } from "./physics.js";
import { feel, haptic } from "./sfx.js";

export function createLever({ label, sub = "PULL ALL THE WAY DOWN", tone = "red", onPull }) {
  const ball = h("span", { class: "lever-ball", "aria-hidden": "true" });
  const stick = h("span", { class: "lever-stick", "aria-hidden": "true" });
  const arm = h("span", { class: "lever-arm", "aria-hidden": "true" }, stick, ball);
  const slot = h("span", { class: "lever-slot", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("i"));
  const el = h(
    "button",
    { type: "button", class: `lever tone-${tone}`, "aria-label": `${label}. Press to pull the lever.` },
    h("span", { class: "lever-base" }, slot, arm),
    h("span", { class: "lever-text" }, h("b", { text: label }), h("small", { text: sub })),
  );
  const TRAVEL = 1; // 0 (up) .. 1 (fully down)
  let clicks = 0;
  const pos = new Spring(0, {
    stiffness: 160,
    damping: 14,
    onChange: (v) => {
      el.style.setProperty("--pull", v.toFixed(3));
      // A ratchet click every fifth of the way down.
      const notch = Math.floor(Math.max(0, v) * 5);
      if (notch > clicks) feel("detent", "tick");
      clicks = notch;
    },
  });
  let drag = null;
  let fired = false;

  const fire = () => {
    if (fired) return;
    fired = true;
    feel("drop", "heavy");
    haptic("celebrate");
    el.classList.add("fired");
    setTimeout(() => {
      el.classList.remove("fired");
      pos.to(0, -4);
      fired = false;
      onPull?.();
    }, prefersReducedMotion() ? 0 : 260);
  };

  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const r = el.querySelector(".lever-base").getBoundingClientRect();
    drag = { id: e.pointerId, y0: e.clientY, h: r.height * 0.62, start: pos.value };
    el.classList.add("held");
    feel("click", "medium");
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const v = Math.max(-0.08, Math.min(TRAVEL, drag.start + (e.clientY - drag.y0) / drag.h));
    pos.jump(v);
    if (v >= 0.92) {
      drag = null;
      el.classList.remove("held");
      pos.jump(1);
      fire();
    }
  });
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    el.classList.remove("held");
    clicks = 0;
    pos.to(0, -2); // not far enough: it springs back
    if (pos.value > 0.05) feel("snap", "light");
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  // Keyboard and screen readers: the click pulls it all the way.
  el.addEventListener("click", (e) => {
    if (e.detail !== 0) return; // a real tap is handled as a drag above
    pos.to(1, 4);
    setTimeout(fire, prefersReducedMotion() ? 0 : 380);
  });
  return el;
}

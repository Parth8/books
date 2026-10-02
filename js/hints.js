// Gesture hints: a little chip with a ghost finger that shows the next gesture you haven't
// tried yet. Do the gesture once and that hint never comes back.

import { h } from "./util.js";

const KEY = "shelfie.learned";
export const HINTS = {
  swipe: { text: "SWIPE ← → TO FLIP", anim: "swipe" },
  scrub: { text: "DRAG ↑ ON THE BOOK TO READ", anim: "up" },
  hold: { text: "HOLD A BOOK TO MOVE IT", anim: "hold" },
  pull: { text: "PULL ↑ TO ADD", anim: "up" },
  stats: { text: "PULL THE BOTTOM BAR UP FOR STATS", anim: "up" },
  poke: { text: "DOUBLE-TAP A COVER 👀", anim: "tap" },
  tape: { text: "DRAG THE SHELF NAME TO SWITCH", anim: "swipe" },
};

let learned = new Set();
try {
  learned = new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
} catch {}

export function createHints(root) {
  const finger = h("i", { class: "ghost", "aria-hidden": "true" });
  const label = h("span", { class: "hint-text" });
  const chip = h("div", { class: "hint", role: "status" }, finger, label);
  root.append(chip);
  let shown = null;

  return {
    /** Show the first hint from `order` that hasn't been learned. */
    offer(order) {
      const next = order.find((k) => !learned.has(k)) || null;
      if (next === shown) return;
      shown = next;
      chip.classList.toggle("on", !!next);
      if (!next) return;
      label.textContent = HINTS[next].text;
      chip.dataset.anim = HINTS[next].anim;
    },
    learn(k) {
      if (learned.has(k)) return;
      learned.add(k);
      try {
        localStorage.setItem(KEY, JSON.stringify([...learned]));
      } catch {}
      if (shown === k) {
        shown = null;
        chip.classList.remove("on");
      }
    },
    has: (k) => learned.has(k),
  };
}

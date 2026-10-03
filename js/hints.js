// Gesture hints: a little chip with a ghost finger that shows the next gesture you haven't
// tried yet. Do the gesture once (or tap the chip) and that hint never comes back. Each hint
// gives up after showing on 2 app opens, and what you've learned is kept in your synced data,
// so the home-screen app and the browser don't nag you separately. Hints only come in your
// first three app opens at all.

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

const SHOWS = "shelfie.hintShows";
const MAX_OPENS = 2;
let shows = {};
try {
  shows = JSON.parse(localStorage.getItem(SHOWS) || "{}") || {};
} catch {}
const countedThisOpen = new Set();
let forced = false; // asked for again (How to use): show them whatever the count

/** `seen(k)` / `mark(k)`: the synced record (your data), on top of this device's own. */
export function createHints(root, { seen = () => false, mark = () => {}, active = () => true } = {}) {
  const finger = h("i", { class: "ghost", "aria-hidden": "true" });
  const label = h("span", { class: "hint-text" });
  const close = h("span", { class: "hint-x", "aria-hidden": "true", text: "✕" });
  const chip = h("button", { type: "button", class: "hint", "aria-label": "Hint. Tap to dismiss." }, finger, label, close);
  root.append(chip);
  let shown = null;
  const known = (k) => learned.has(k) || seen(`h:${k}`);

  function learn(k) {
    const was = known(k);
    learned.add(k);
    try {
      localStorage.setItem(KEY, JSON.stringify([...learned]));
    } catch {}
    if (!seen(`h:${k}`)) mark(`h:${k}`);
    if (shown === k) {
      shown = null;
      chip.classList.remove("on");
    }
    return !was;
  }
  // Tapping the chip means "got it".
  chip.addEventListener("click", () => shown && learn(shown));

  return {
    /** Show the first hint from `order` that hasn't been learned. */
    offer(order) {
      let next = null;
      for (const k of forced || active() ? order : []) {
        if (known(k)) continue;
        // Shown on two app opens already: let it go.
        if (!countedThisOpen.has(k) && (shows[k] || 0) >= MAX_OPENS) {
          learn(k);
          continue;
        }
        next = k;
        break;
      }
      if (next === shown) return;
      shown = next;
      chip.classList.toggle("on", !!next);
      if (!next) return;
      label.textContent = HINTS[next].text;
      chip.dataset.anim = HINTS[next].anim;
      if (!countedThisOpen.has(next)) {
        countedThisOpen.add(next);
        shows[next] = (shows[next] || 0) + 1;
        try {
          localStorage.setItem(SHOWS, JSON.stringify(shows));
        } catch {}
      }
    },
    learn,
    has: (k) => known(k),
    /** Forget everything learned (How to use → pop-ups again). */
    reset() {
      forced = true;
      learned = new Set();
      shows = {};
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(SHOWS);
      } catch {}
    },
  };
}

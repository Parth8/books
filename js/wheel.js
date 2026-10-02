// A scroll wheel for page numbers, like the drum of an iOS time picker. Flick it, and the page
// numbers roll past on a cylinder with a soft tick on each one. Arrow keys and Page Up/Down work
// too, for keyboards and screen readers.

import { h, buzz, clamp, prefersReducedMotion } from "./util.js";

const ROW = 44;
const VISIBLE = 5; // rows showing: two above, the chosen one, two below

export function createWheel({ max, value = 0, label = "Page", onInput, onChange } = {}) {
  const list = h("div", { class: "wheel-list" });
  for (let i = 0; i <= max; i++) list.append(h("span", { class: "wheel-item", text: String(i) }));
  const scroller = h("div", { class: "wheel-scroll" }, list);
  const el = h(
    "div",
    { class: "wheel", role: "spinbutton", tabIndex: 0, "aria-label": label, "aria-valuemin": "0", "aria-valuemax": String(max), vars: { "--row": `${ROW}px`, "--rows": VISIBLE } },
    h("i", { class: "wheel-lens", "aria-hidden": "true" }),
    scroller,
  );
  const items = list.children;
  let current = clamp(value, 0, max);
  let quiet = false;
  let raf = 0;
  let settle = 0;

  function paint() {
    raf = 0;
    const pos = scroller.scrollTop / ROW;
    const from = Math.max(0, Math.floor(pos) - 4);
    const to = Math.min(max, Math.ceil(pos) + 4);
    for (let i = from; i <= to; i++) {
      const d = i - pos;
      const s = items[i].style;
      s.transform = `perspective(400px) rotateX(${(-d * 20).toFixed(1)}deg)`;
      s.opacity = String(Math.max(0.12, 1 - Math.abs(d) * 0.3));
      items[i].classList.toggle("on", Math.abs(d) < 0.5);
    }
    // Clean up rows that just left the window.
    for (const i of [from - 1, from - 2, to + 1, to + 2]) if (items[i]) items[i].style.opacity = "0";
    const v = clamp(Math.round(pos), 0, max);
    if (v !== current) {
      current = v;
      el.setAttribute("aria-valuenow", String(v));
      if (!quiet) {
        buzz(3);
        onInput?.(v);
      }
    }
  }

  scroller.addEventListener("scroll", () => {
    raf ||= requestAnimationFrame(paint);
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!quiet) onChange?.(current);
      quiet = false;
    }, 140);
  }, { passive: true });

  el.addEventListener("keydown", (e) => {
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10, Home: -Infinity, End: Infinity }[e.key];
    if (step == null) return;
    e.preventDefault();
    const v = clamp(current + step, 0, max);
    set(v, true);
    onInput?.(v);
    onChange?.(v);
  });

  /** Move without telling anyone (the slider moved, or the screen opened). */
  function set(v, smooth = false) {
    v = clamp(Math.round(v), 0, max);
    quiet = true;
    scroller.scrollTo({ top: v * ROW, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
    current = v;
    el.setAttribute("aria-valuenow", String(v));
    raf ||= requestAnimationFrame(paint);
  }

  // Once it's on screen, jump to the starting page.
  requestAnimationFrame(() => set(current));
  el.setAttribute("aria-valuenow", String(current));

  return { el, set, get value() { return current; } };
}

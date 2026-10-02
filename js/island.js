// The island: a black capsule at the top of the screen that stretches open from its middle to
// celebrate something (XP, a level, a badge, a streak), then pinches shut again.
// Messages queue up, so a page logged, a milestone and a badge play one after the other.

import { h, prefersReducedMotion, SPRING, EASE, wait, buzz } from "./util.js";

/** Bring a popover to the front of the top layer (above any sheet opened since). */
export function toTop(el) {
  if (!el.showPopover) return;
  try {
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
  } catch {}
}

export function createIsland() {
  const icon = h("span", { class: "isl-icon" });
  const title = h("b", { class: "isl-title" });
  const sub = h("span", { class: "isl-sub" });
  const value = h("span", { class: "isl-value" });
  const bar = h("i", { class: "isl-bar" });
  const inner = h("div", { class: "isl-inner" }, icon, h("span", { class: "isl-text" }, title, sub), value, bar);
  // A manual popover sits in the top layer, so it shows above open sheets too.
  const el = h("div", { class: "island", role: "status", "aria-live": "polite", popover: "manual" }, inner);
  document.body.append(el);

  const queue = [];
  let busy = false;
  let skip = null;
  el.addEventListener("click", () => skip?.());

  async function run() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const m = queue.shift();
      await showOne(m);
    }
    busy = false;
  }

  async function showOne(m) {
    el.dataset.tone = m.tone || "pink";
    icon.textContent = m.icon || "✨";
    title.textContent = m.title || "";
    sub.textContent = m.sub || "";
    sub.hidden = !m.sub;
    value.textContent = "";
    value.hidden = m.value == null;
    bar.hidden = m.bar == null;
    if (m.bar != null) bar.style.setProperty("--p", m.bar);

    const reduced = prefersReducedMotion();
    el.classList.add("open");
    toTop(el);
    el.style.width = "";
    el.style.height = "";
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    if (m.buzz !== false) buzz(m.big ? [10, 40, 20] : 10);
    if (!reduced) {
      // Grow from a small pill: width first (from the middle, it's centred), then height.
      const a = el.animate(
        [
          { width: "120px", height: "36px", borderRadius: "18px", offset: 0 },
          { width: `${w}px`, height: "36px", borderRadius: "18px", offset: 0.45 },
          { width: `${w}px`, height: `${hgt}px`, borderRadius: `${Math.min(28, hgt / 2)}px`, offset: 1 },
        ],
        { duration: 620, easing: SPRING },
      );
      inner.animate([{ opacity: 0, filter: "blur(6px)", transform: "scale(0.9)" }, { opacity: 1, filter: "none", transform: "none" }], { duration: 380, delay: 160, easing: EASE, fill: "backwards" });
      icon.animate([{ transform: "scale(0) rotate(-40deg)" }, { transform: "scale(1.35) rotate(10deg)", offset: 0.6 }, { transform: "none" }], { duration: 640, delay: 180, easing: EASE, fill: "backwards" });
      await a.finished.catch(() => {});
    }
    if (m.value != null) countUp(value, m.value, m.unit || "", reduced);

    await new Promise((resolve) => {
      const t = setTimeout(resolve, m.big ? 3200 : 2100);
      skip = () => {
        clearTimeout(t);
        resolve();
      };
    });
    skip = null;

    if (!reduced) {
      const now = el.getBoundingClientRect();
      inner.animate([{ opacity: 1 }, { opacity: 0, filter: "blur(4px)" }], { duration: 160, fill: "forwards" });
      await el
        .animate(
          [
            { width: `${now.width}px`, height: `${now.height}px` },
            { width: "120px", height: "36px", borderRadius: "18px", offset: 0.6 },
            { width: "36px", height: "36px", borderRadius: "18px", opacity: 0 },
          ],
          { duration: 420, easing: EASE },
        )
        .finished.catch(() => {});
      inner.getAnimations().forEach((x) => x.cancel());
    }
    el.classList.remove("open");
    try {
      el.hidePopover?.();
    } catch {}
    await wait(90);
  }

  function countUp(node, to, unit, reduced) {
    if (reduced || typeof to !== "number") return (node.textContent = `${typeof to === "number" && to > 0 ? "+" : ""}${to}${unit}`);
    const start = performance.now();
    const dur = 600;
    const step = (t) => {
      const k = Math.min(1, Math.max(0, (t - start) / dur));
      const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
      node.textContent = `+${v}${unit}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  return {
    /** { icon, title, sub, value, unit, tone, big, bar } */
    say(m) {
      queue.push(m);
      run();
    },
    el,
  };
}

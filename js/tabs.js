// The shelf switcher: a pill bar whose highlight stretches like taffy. On a switch its leading
// edge shoots ahead and the trailing edge catches up a beat later, so the blob grows long, then
// snaps into the new tab with a little squash.

import { h, prefersReducedMotion, buzz } from "./util.js";

export function createTabs(root, tabs, { onChange } = {}) {
  const blob = h("i", { class: "tab-blob", "aria-hidden": "true" });
  const buttons = tabs.map((t) =>
    h(
      "button",
      { type: "button", role: "tab", class: "tab", "data-tab": t.id, "aria-selected": "false", vars: { "--tone": t.tone } },
      h("span", { class: "tab-emoji", "aria-hidden": "true", text: t.emoji }),
      h("span", { class: "tab-name", text: t.label }),
      h("span", { class: "tab-count", text: "0" }),
    ),
  );
  root.replaceChildren(blob, ...buttons);
  root.setAttribute("role", "tablist");
  let current = null;
  let anim = null;

  const box = (btn) => ({ l: btn.offsetLeft, r: btn.offsetLeft + btn.offsetWidth });

  function place(btn) {
    const { l, r } = box(btn);
    blob.style.left = `${l}px`;
    blob.style.width = `${r - l}px`;
    blob.style.setProperty("--tone", btn.style.getPropertyValue("--tone"));
  }

  function select(id, { silent = false, animate = true } = {}) {
    const btn = buttons.find((b) => b.dataset.tab === id) || buttons[0];
    const prev = buttons.find((b) => b.dataset.tab === current);
    if (current === btn.dataset.tab) return;
    current = btn.dataset.tab;
    for (const b of buttons) {
      const on = b === btn;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (prev && animate && !prefersReducedMotion()) stretch(prev, btn);
    else place(btn);
    if (!silent) {
      buzz(6);
      onChange?.(current);
    }
  }

  function stretch(from, to) {
    anim?.cancel();
    const a = box(from);
    const b = box(to);
    const right = b.l > a.l;
    // Leading edge first, trailing edge after: mid-way the blob stretches across both tabs.
    const mid = right ? { l: a.l + (b.l - a.l) * 0.25, r: b.r } : { l: b.l, r: a.r - (a.r - b.r) * 0.25 };
    blob.style.setProperty("--tone", to.style.getPropertyValue("--tone"));
    anim = blob.animate(
      [
        { left: `${a.l}px`, width: `${a.r - a.l}px`, transform: "scaleY(1)" },
        { left: `${mid.l}px`, width: `${mid.r - mid.l}px`, transform: "scaleY(0.78)", offset: 0.42 },
        { left: `${b.l}px`, width: `${b.r - b.l}px`, transform: "scaleY(1.08)", offset: 0.78 },
        { left: `${b.l}px`, width: `${b.r - b.l}px`, transform: "scaleY(1)" },
      ],
      { duration: 560, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
    );
    place(to);
    to.animate([{ transform: "scale(0.9)" }, { transform: "scale(1.08)", offset: 0.6 }, { transform: "none" }], { duration: 420, easing: "ease-out" });
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (btn) select(btn.dataset.tab);
  });
  root.addEventListener("keydown", (e) => {
    const i = buttons.findIndex((b) => b.dataset.tab === current);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = buttons[(i + step + buttons.length) % buttons.length];
    select(next.dataset.tab);
    next.focus();
  });
  new ResizeObserver(() => current && place(buttons.find((b) => b.dataset.tab === current))).observe(root);

  return {
    select,
    get current() {
      return current;
    },
    counts(map) {
      for (const b of buttons) {
        const c = b.querySelector(".tab-count");
        const v = String(map[b.dataset.tab] ?? 0);
        if (c.textContent !== v) {
          c.textContent = v;
          if (!prefersReducedMotion()) c.animate([{ transform: "scale(1.6)" }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.3,1.6,.5,1)" });
        }
      }
      if (current) place(buttons.find((b) => b.dataset.tab === current));
    },
  };
}

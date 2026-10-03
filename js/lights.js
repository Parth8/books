// Edison bulbs: warm filament bulbs on a drooping wire, strung over the big headings. Every
// second or two one of them stutters, as if the wiring's a bit dodgy. Only short fades (GPU),
// and nothing runs while the app is in the background.

import { h, rng, prefersReducedMotion } from "./util.js";

const FILAMENT = `<svg viewBox="0 0 20 30" aria-hidden="true"><path d="M7 2v9l-2 4 3 3-3 3 3 3-1 4M13 2v9l2 4-3 3 3 3-3 3 1 4" fill="none" stroke="#fff3c4" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A strand of `n` bulbs across its container. `sag`: how far the wire droops (px). */
export function edisonString({ n = 7, sag = 16, seed = 1, cls = "" } = {}) {
  const r = rng(seed);
  const droop = (t) => 3 + Math.sin(t * Math.PI) * sag;
  const path = `M0 3 ${Array.from({ length: 25 }, (_, i) => `L${(i / 24) * 100} ${droop(i / 24).toFixed(1)}`).join(" ")}`;
  const el = h("div", { class: `edison ${cls}`, "aria-hidden": "true", vars: { "--sag": `${sag + 6}px` } }, h("span", { class: "ed-wire", svg: `<svg viewBox="0 0 100 ${sag + 6}" preserveAspectRatio="none"><path d="${path}" vector-effect="non-scaling-stroke"/></svg>` }));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const drop = 6 + Math.round(r() * 14); // each hangs on its own length of cord
    el.append(
      h(
        "span",
        {
          class: "ed-bulb",
          vars: {
            "--x": `${(t * 100).toFixed(2)}%`,
            "--y": `${droop(t).toFixed(1)}px`,
            "--drop": `${drop}px`,
            "--sway": `${(r() * 6 - 3).toFixed(1)}deg`,
          },
        },
        h("i", { class: "ed-cord" }),
        h("i", { class: "ed-halo" }),
        h("i", { class: "ed-cap" }),
        h("i", { class: "ed-glass", svg: FILAMENT }),
      ),
    );
  }
  return el;
}

/**
 * The flicker: every second or two, a random bulb on screen (or a heading's bulb) stutters.
 * Short animations that start and stop, instead of endless ones, so idle bulbs cost nothing.
 */
export function startStutters() {
  if (prefersReducedMotion()) return;
  const STUTTER = [{ opacity: 1 }, { opacity: 0.2, offset: 0.2 }, { opacity: 1, offset: 0.35 }, { opacity: 0.35, offset: 0.55 }, { opacity: 1 }];
  const tick = () => {
    setTimeout(tick, 900 + Math.random() * 1800);
    if (document.visibilityState !== "visible") return;
    const panelUp = document.body.classList.contains("panel-up");
    const bulbs = [...document.querySelectorAll(panelUp ? ".panel .ed-bulb, .panel .p-h" : ".hud .ed-bulb, .fairy i")].filter((b) => b.getClientRects().length);
    for (let k = Math.random() < 0.25 ? 2 : 1; k > 0 && bulbs.length; k--) {
      const b = bulbs.splice(Math.floor(Math.random() * bulbs.length), 1)[0];
      if (b.classList.contains("p-h")) {
        b.classList.remove("flick");
        void b.offsetWidth;
        b.classList.add("flick");
        continue;
      }
      const opts = { duration: 380 + Math.random() * 260, easing: "steps(1)" };
      if (b.matches(".fairy i")) {
        b.animate(STUTTER, opts);
        continue;
      }
      b.querySelector(".ed-glass")?.animate(STUTTER, opts);
      b.querySelector(".ed-halo")?.animate(STUTTER, opts);
    }
  };
  setTimeout(tick, 1500);
}

// Spotlight tips: the first time you meet a part of the app, the screen dims except for that
// part and a bright bubble explains what it does. Each tip shows once (remembered on this
// device); "How to use" in Stats can reset them.

import { h, prefersReducedMotion } from "./util.js";
import { feel } from "./sfx.js";

const KEY = "shelfie.tips";
let seen = new Set();
try {
  seen = new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
} catch {}
const remember = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {}
};

const queue = [];
let showing = false;
let blocked = () => false;

/** Something else is on screen (a tour, a pop-up, a drag): tips wait. */
export function holdTipsWhile(fn) {
  blocked = fn;
}

export function resetTips() {
  seen = new Set();
  remember();
}

export const tipSeen = (id) => seen.has(id);

/** { id, el: () => element, title, text, tone } — shown once, after anything already queued. */
export function tip(t) {
  if (seen.has(t.id) || queue.some((q) => q.id === t.id)) return;
  queue.push(t);
  pump();
}

function pump() {
  if (showing || !queue.length) return;
  if (blocked() || document.visibilityState !== "visible") return void setTimeout(pump, 900);
  const t = queue.shift();
  const el = t.el();
  const r = el?.getBoundingClientRect();
  if (!r || !r.width || seen.has(t.id)) return pump();
  showing = true;
  seen.add(t.id);
  remember();
  show(t, r).then(() => {
    showing = false;
    setTimeout(pump, 400);
  });
}

function show({ title, text, tone = "lime", cta = "GOT IT" }, r) {
  return new Promise((resolve) => {
    const pad = 8;
    const ring = h("i", { class: "tip-ring", vars: { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` } });
    const below = r.top + r.height / 2 < innerHeight / 2;
    const btn = h("button", { type: "button", class: "tip-btn", text: cta });
    const bubble = h(
      "div",
      { class: `tip-bubble tone-${tone} ${below ? "below" : "above"}`, role: "dialog", "aria-label": title },
      h("b", { class: "tip-title", text: title }),
      h("p", { class: "tip-text", text }),
      btn,
    );
    const x = Math.min(innerWidth - 16, Math.max(16, r.left + r.width / 2));
    bubble.style.setProperty("--arrow-x", `${x}px`);
    if (below) bubble.style.top = `${r.bottom + pad + 16}px`;
    else bubble.style.bottom = `${innerHeight - r.top + pad + 16}px`;
    const wrap = h("div", { class: "tip", popover: "manual" }, ring, bubble);
    document.body.append(wrap);
    try {
      wrap.showPopover?.();
    } catch {}
    feel("pop", "light");
    if (!prefersReducedMotion()) {
      ring.animate([{ opacity: 0, transform: "scale(1.3)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: "cubic-bezier(.2,1.2,.4,1)" });
      bubble.animate([{ opacity: 0, transform: `translateY(${below ? -14 : 14}px) scale(.9)` }, { opacity: 1, transform: "none" }], { duration: 460, delay: 120, easing: "cubic-bezier(.2,1.4,.4,1)", fill: "backwards" });
    }
    const close = () => {
      wrap.removeEventListener("click", close);
      const done = () => {
        wrap.remove();
        resolve();
      };
      if (prefersReducedMotion()) return done();
      wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" }).finished.then(done, done);
    };
    wrap.addEventListener("click", close);
    wrap.addEventListener("keydown", (e) => (e.key === "Escape" || e.key === "Enter") && close());
    setTimeout(() => btn.focus({ preventScroll: true }), 50);
  });
}

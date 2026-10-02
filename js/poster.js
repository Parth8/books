// Big moments get a poster: the screen floods with colour and giant type slams in, line by
// line. Swipe it away (any direction) or tap; it also leaves on its own after a few seconds.

import { h, buzz, prefersReducedMotion } from "./util.js";
import { Spring, Velocity } from "./physics.js";
import { rain } from "./confetti.js";

let current = null;

/** { lines: ["DONE."], kicker, sub, tone, ink, art (element), emoji } */
export function poster({ lines, kicker = "", sub = "", tone = "#2b3bff", ink = "#fff", art = null, emoji = null, onDone = null }) {
  current?.dismiss(true);
  const words = h(
    "div",
    { class: "poster-words" },
    lines.map((l, k) => h("span", { class: "poster-line", vars: { "--k": k } }, h("b", { text: l }))),
  );
  const el = h(
    "div",
    { class: "poster", role: "alertdialog", "aria-label": `${lines.join(" ")} ${sub}`, vars: { "--tone": tone, "--ink": ink }, popover: "manual", tabIndex: -1 },
    h("div", { class: "poster-inner" }, h("small", { class: "poster-kicker", text: kicker }), words, art ? h("div", { class: "poster-art" }, art) : null, h("p", { class: "poster-sub", text: sub }), h("small", { class: "poster-hint", text: "SWIPE AWAY ↓" })),
  );
  document.body.append(el);
  try {
    el.showPopover?.();
  } catch {}
  // Long lines ("WELCOME", "HOME, ALEXANDRA.") shrink to fit the width instead of clipping.
  for (const b of words.querySelectorAll("b")) {
    const room = b.parentElement.clientWidth;
    if (room && b.scrollWidth > room) b.style.fontSize = `${(parseFloat(getComputedStyle(b).fontSize) * room) / b.scrollWidth - 0.5}px`;
  }
  buzz([20, 60, 30, 60, 40]);
  if (emoji) rain({ count: 180, emoji });

  const y = new Spring(0, { stiffness: 200, damping: 24, onChange: (v) => (el.style.transform = `translate3d(0, ${v}px, 0)`) });
  const x = new Spring(0, { stiffness: 200, damping: 24, onChange: (v) => (el.style.translate = `${v}px 0`) });
  if (!prefersReducedMotion()) {
    el.animate([{ clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(150% at 50% 50%)" }], { duration: 650, easing: "cubic-bezier(.7,0,.2,1)" });
  }
  el.focus({ preventScroll: true });

  let gone = false;
  const vel = new Velocity();
  let d = null;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    d = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    vel.reset(e.clientX, e.clientY);
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    vel.add(e.clientX, e.clientY);
    x.jump(e.clientX - d.x0);
    y.jump(e.clientY - d.y0);
  });
  el.addEventListener("pointerup", (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    d = null;
    const v = vel.get();
    if (Math.hypot(dx, dy) < 10 || Math.hypot(dx, dy) > 90 || Math.hypot(v.x, v.y) > 700) dismiss(false, v, dx, dy);
    else {
      x.to(0, v.x);
      y.to(0, v.y);
    }
  });
  el.addEventListener("keydown", (e) => (e.key === "Escape" || e.key === "Enter") && dismiss());
  const timer = setTimeout(() => dismiss(), 5200);

  function dismiss(now = false, v = { x: 0, y: 900 }, dx = 0, dy = 1) {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    const finish = () => {
      el.remove();
      onDone?.();
    };
    if (now || prefersReducedMotion()) return finish();
    const len = Math.hypot(dx, dy) || 1;
    x.to((dx / len) * innerWidth * 1.4, v.x);
    y.to((dy / len) * innerHeight * 1.4, v.y);
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 120, fill: "forwards" }).finished.then(finish, finish);
    if (current === api) current = null;
  }
  const api = { dismiss, el };
  current = api;
  return api;
}

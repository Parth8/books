// Confetti, sparks and floating "+XP" numbers on one full-screen canvas that only runs while
// something is flying.

import { prefersReducedMotion } from "./util.js";
import { toTop } from "./island.js";

const COLORS = ["#ff3d7f", "#ffb81f", "#c6ff3d", "#2de2ff", "#8b5cff", "#ff6bd6", "#ffffff"];
let canvas;
let ctx;
let parts = [];
let running = false;
let dpr = 1;

function ensure() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("popover", "manual");
  document.body.append(canvas);
  ctx = canvas.getContext("2d");
  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  size();
  addEventListener("resize", size);
}

function loop() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.g;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;
    const fade = Math.min(1, p.life / 30);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.kind === "rect") {
      ctx.scale(1, Math.cos(p.rot * 3));
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else if (p.kind === "dot") {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "star") {
      star(p.size);
    } else {
      ctx.font = `${p.size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.text, 0, 0);
    }
    ctx.restore();
  }
  if (parts.length) requestAnimationFrame(loop);
  else {
    running = false;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    try {
      canvas.hidePopover?.();
    } catch {}
  }
}

function star(r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r / 2.4 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function start() {
  toTop(canvas);
  if (running) return;
  running = true;
  requestAnimationFrame(loop);
}

/** A burst from a point (or the middle of an element). */
export function burst(at, { count = 60, spread = 1, power = 1, kinds = ["rect", "rect", "dot", "star"], colors = COLORS, emoji = null } = {}) {
  if (prefersReducedMotion()) return;
  ensure();
  const { x, y } = point(at);
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6 * spread;
    const v = (4 + Math.random() * 9) * power;
    const useEmoji = emoji && Math.random() < 0.35;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      g: 0.28,
      drag: 0.975,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      size: useEmoji ? 18 + Math.random() * 10 : 6 + Math.random() * 8,
      color: colors[(Math.random() * colors.length) | 0],
      kind: useEmoji ? "text" : kinds[(Math.random() * kinds.length) | 0],
      text: useEmoji ? emoji[(Math.random() * emoji.length) | 0] : "",
      life: 90 + Math.random() * 70,
    });
  }
  start();
}

/** Confetti raining from the top edge: for finishing a book or levelling up. */
export function rain({ count = 160, emoji = null } = {}) {
  if (prefersReducedMotion()) return;
  ensure();
  for (let i = 0; i < count; i++) {
    const useEmoji = emoji && Math.random() < 0.25;
    parts.push({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.6,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      g: 0.06,
      drag: 0.995,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.3,
      size: useEmoji ? 22 : 7 + Math.random() * 7,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      kind: useEmoji ? "text" : Math.random() < 0.7 ? "rect" : "star",
      text: useEmoji ? emoji[(Math.random() * emoji.length) | 0] : "",
      life: 200 + Math.random() * 120,
    });
  }
  start();
}

/** "+12 XP" floating up from where you tapped. */
export function floatText(at, text, color = "#c6ff3d") {
  if (prefersReducedMotion()) return;
  ensure();
  const { x, y } = point(at);
  parts.push({ x, y, vx: 0, vy: -2.6, g: 0.02, drag: 0.985, rot: 0, vr: 0, size: 26, color, kind: "text", text, life: 70 });
  start();
}

function point(at) {
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return at || { x: innerWidth / 2, y: innerHeight / 2 };
}

/** Little pages fluttering off a book while you read. `up` sends them upward. */
export function pages(at, { count = 3, up = true } = {}) {
  if (prefersReducedMotion()) return;
  ensure();
  const { x, y } = point(at);
  for (let i = 0; i < count; i++) {
    parts.push({
      x: x + (Math.random() - 0.5) * 80,
      y: y + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 3,
      vy: up ? -3 - Math.random() * 4 : 2 + Math.random() * 2,
      g: 0.12,
      drag: 0.97,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.5,
      size: 10 + Math.random() * 6,
      color: Math.random() < 0.8 ? "#f6f1e6" : "#e7ff3d",
      kind: "rect",
      text: "",
      life: 55 + Math.random() * 25,
    });
  }
  start();
}

/** A shower of spinning coins: XP you can see. */
export function coins(at, n = 12) {
  burst(at, { count: n, kinds: ["dot"], colors: ["#ffd60a", "#ffe873", "#ffb800"], power: 0.9, spread: 0.9 });
}

/** A ring that expands from a point and fades: for landings and big moments. */
export function shockwave(at, color = "#e7ff3d") {
  if (prefersReducedMotion()) return;
  const { x, y } = point(at);
  const el = document.createElement("i");
  el.className = "shockwave";
  el.style.cssText = `left:${x}px;top:${y}px;border-color:${color}`;
  document.body.append(el);
  try {
    el.popover = "manual";
    el.showPopover?.();
  } catch {}
  el.animate([{ transform: "translate(-50%,-50%) scale(0.1)", opacity: 1 }, { transform: "translate(-50%,-50%) scale(1)", opacity: 0 }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" }).finished.then(
    () => el.remove(),
    () => el.remove(),
  );
}

/** Shake an element like something heavy just landed. */
export function shake(el, strength = 8) {
  if (prefersReducedMotion() || !el?.animate) return;
  const k = strength;
  el.animate(
    [{ transform: "none" }, { transform: `translate(${-k}px, ${k / 2}px) rotate(-0.6deg)` }, { transform: `translate(${k}px, ${-k / 2}px) rotate(0.6deg)` }, { transform: `translate(${-k / 2}px, ${k / 3}px)` }, { transform: `translate(${k / 3}px, 0)` }, { transform: "none" }],
    { duration: 420, easing: "ease-out" },
  );
}

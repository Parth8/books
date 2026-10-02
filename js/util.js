import { haptic } from "./sfx.js";

/**
 * DOM builder. All text goes through textContent, so a book title from a search can never
 * become HTML. Static, trusted SVG comes only from this app's own modules.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "vars") for (const [k, v] of Object.entries(value)) el.style.setProperty(k, v);
    else if (key === "on") for (const [evt, fn] of Object.entries(value)) el.addEventListener(evt, fn);
    else if (key === "svg") el.append(svg(value));
    else if (key in el && !key.startsWith("aria") && !key.startsWith("data")) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const tpl = document.createElement("template");
/** Parse a trusted, static SVG string. */
export function svg(markup) {
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild.cloneNode(true);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A tiny tap on phones (Android vibration, iPhone's system tap). See sfx.js. */
export function buzz(ms = 8) {
  haptic(ms);
}

/** Seeded random numbers (mulberry32): the same book always gets the same art. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const fmt = (n) => new Intl.NumberFormat().format(n);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Animate and resolve when done; instant (and still resolved) with reduced motion. */
export function play(el, frames, opts) {
  if (!el?.animate || prefersReducedMotion()) return Promise.resolve();
  return el.animate(frames, opts).finished.catch(() => {});
}

export const SPRING = "linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1)";
export const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

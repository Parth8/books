// Book art. Every book is a little 3D object: a front cover on a hinge, a spine, a block of
// pages behind it and a glossy shine that follows your finger.
//
// Books from the catalogue wear their real cover. Everything else (and any cover that fails to
// load) gets generated art: a palette and a pattern picked from the title, so the same book
// always looks the same, and the pattern moves gently while the book is in focus.

import { h, svg, rng } from "./util.js";

export const PALETTES = [
  ["#ff3d7f", "#ffb81f", "#1d0a2b"],
  ["#c6ff3d", "#2de2ff", "#0a1a24"],
  ["#8b5cff", "#ff6bd6", "#130926"],
  ["#ff6a3d", "#ffe14d", "#260c0c"],
  ["#2de2ff", "#8b5cff", "#07121f"],
  ["#3dffb0", "#ff3d7f", "#081d18"],
  ["#ffd23d", "#ff3d5a", "#1f0a14"],
  ["#a3ff3d", "#ff8a3d", "#0f1906"],
  ["#ff9ef5", "#7af0ff", "#170c22"],
];

const PATTERNS = ["orbs", "rings", "stripes", "sun", "waves", "grid", "burst"];

export function paletteOf(seed) {
  return PALETTES[seed % PALETTES.length];
}

/** The generated art, as static SVG markup built only from numbers and our own colours. */
let uid = 0;
export function artSvg(seed, id = `a${++uid}`) {
  const r = rng(seed);
  const [a, b, bg] = paletteOf(seed);
  const kind = PATTERNS[Math.floor(r() * PATTERNS.length)];
  const n = (x) => x.toFixed(1);
  let body = "";
  if (kind === "orbs") {
    for (let i = 0; i < 4; i++) {
      body += `<circle class="fx-float f${i % 3}" cx="${n(30 + r() * 140)}" cy="${n(40 + r() * 200)}" r="${n(30 + r() * 50)}" fill="${i % 2 ? a : b}" opacity="${n(0.55 + r() * 0.4)}" filter="url(#${id}b)"/>`;
    }
  } else if (kind === "rings") {
    const cx = n(60 + r() * 80);
    const cy = n(90 + r() * 80);
    for (let i = 0; i < 6; i++) {
      body += `<circle class="fx-spin s${i % 2}" cx="${cx}" cy="${cy}" r="${18 + i * 18}" fill="none" stroke="${i % 2 ? a : b}" stroke-width="${n(3 + r() * 6)}" stroke-dasharray="${n(8 + r() * 40)} ${n(6 + r() * 20)}" style="transform-origin:${cx}px ${cy}px"/>`;
    }
  } else if (kind === "stripes") {
    // The tilt sits on an outer group: a CSS animation on the same element would replace it.
    body += `<g transform="rotate(${n(-30 + r() * 60)} 100 150)"><g class="fx-slide">`;
    for (let i = -6; i < 14; i++) body += `<rect x="${i * 26 - 100}" y="-120" width="${n(8 + r() * 10)}" height="540" fill="${i % 3 ? a : b}" opacity="${i % 3 ? 0.85 : 0.6}"/>`;
    body += "</g></g>";
  } else if (kind === "sun") {
    body += `<g class="fx-spin s0" style="transform-origin:100px 200px">`;
    for (let i = 0; i < 18; i++) body += `<rect x="98" y="40" width="4" height="70" rx="2" fill="${b}" opacity="0.7" transform="rotate(${i * 20} 100 200)"/>`;
    body += `</g><circle class="fx-pulse" cx="100" cy="200" r="62" fill="${a}" style="transform-origin:100px 200px"/>`;
    for (let i = 0; i < 4; i++) body += `<rect x="0" y="${208 + i * 18}" width="200" height="${8 - i}" fill="${bg}"/>`;
  } else if (kind === "waves") {
    for (let i = 0; i < 9; i++) {
      const y = 30 + i * 28;
      const amp = n(8 + r() * 12);
      let d = `M -200 ${y}`;
      for (let x = -200; x < 400; x += 50) d += ` q 25 ${-amp} 50 0`;
      body += `<path class="fx-wave w${i % 3}" d="${d}" fill="none" stroke="${i % 2 ? a : b}" stroke-width="${n(4 + r() * 5)}" stroke-linecap="round"/>`;
    }
  } else if (kind === "grid") {
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 6; x++) {
        const big = r() > 0.75;
        body += `<circle class="${big ? "fx-pulse" : ""}" cx="${20 + x * 32}" cy="${24 + y * 32}" r="${big ? 10 : 4}" fill="${big ? a : b}" opacity="${big ? 1 : 0.6}" style="transform-origin:${20 + x * 32}px ${24 + y * 32}px;animation-delay:${n(-r() * 3)}s"/>`;
      }
  } else {
    body += `<g class="fx-spin s1" style="transform-origin:100px 130px">`;
    for (let i = 0; i < 12; i++) body += `<path d="M100 130 L ${n(100 + 200 * Math.cos((i * Math.PI) / 6))} ${n(130 + 200 * Math.sin((i * Math.PI) / 6))} L ${n(100 + 200 * Math.cos((i * Math.PI) / 6 + 0.25))} ${n(130 + 200 * Math.sin((i * Math.PI) / 6 + 0.25))} Z" fill="${i % 2 ? a : b}" opacity="0.8"/>`;
    body += `</g><circle class="fx-pulse" cx="100" cy="130" r="26" fill="${bg}" style="transform-origin:100px 130px"/>`;
  }
  return `<svg class="art" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
  <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="${bg}" stop-opacity="0"/><stop offset="1" stop-color="${bg}" stop-opacity="0.85"/></linearGradient></defs>
  <rect width="200" height="300" fill="${bg}"/>${body}<rect width="200" height="300" fill="url(#${id}f)"/></svg>`;
}

export function coverUrl(id, size = "L") {
  return `https://covers.openlibrary.org/b/id/${id}-${size}.jpg?default=false`;
}

/**
 * A book, ready to drop anywhere. `size` only changes the CSS class; the 3D box scales with
 * the element's width.
 */
export function bookArt(book, { size = "md" } = {}) {
  const [a, b, bg] = paletteOf(book.seed);
  // Generated art is always underneath, so a slow or missing cover never leaves a blank book.
  const front = h(
    "div",
    { class: "book-front" },
    svg(artSvg(book.seed)),
    h("span", { class: "book-label" }, h("b", { text: book.title }), book.author ? h("small", { text: book.author }) : null),
  );
  if (book.cover) {
    const img = h("img", { src: coverUrl(book.cover, size === "sm" ? "M" : "L"), alt: "", decoding: "async", loading: size === "sm" ? "lazy" : "eager", draggable: false, referrerPolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove(), { once: true });
    img.addEventListener("load", () => {
      // Open Library answers some lookups with a 1x1 placeholder.
      if (img.naturalWidth < 10) img.remove();
      else img.classList.add("in");
    }, { once: true });
    front.append(img);
  }
  front.append(h("i", { class: "book-shine", "aria-hidden": "true" }));

  return h(
    "div",
    { class: `book ${size}`, vars: { "--c1": a, "--c2": b, "--bg": bg }, "aria-hidden": "true" },
    h(
      "div",
      { class: "book-3d" },
      h("i", { class: "book-pages" }),
      h("div", { class: "book-leaf", text: book.title }),
      h("i", { class: "book-back" }),
      h("div", { class: "book-hinge" }, front, h("i", { class: "book-inside" })),
      h("i", { class: "book-spine" }),
    ),
    h("div", { class: "book-fx" }),
  );
}

/** Lean the book towards the pointer, with the shine following. */
export function tiltable(el, target = el.querySelector(".book")) {
  if (!target) return;
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    target.style.setProperty("--rx", `${(-y * 16).toFixed(2)}deg`);
    target.style.setProperty("--ry", `${(x * 22).toFixed(2)}deg`);
    target.style.setProperty("--sx", `${((x + 0.5) * 100).toFixed(1)}%`);
    target.style.setProperty("--sy", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const reset = () => {
    for (const p of ["--rx", "--ry", "--sx", "--sy"]) target.style.removeProperty(p);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerleave", reset);
  el.addEventListener("pointercancel", reset);
}

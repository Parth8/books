// Every book is a postage stamp: perforated paper, a picture window with the cover, a big
// denomination in the corner (how far through you are) and the title set in heavy type.
// Finished books get postmarked. Flip a stamp over for the details on the back.
//
// Covers come from Google Books (or Open Library). Anything without one, and any cover still
// loading, shows generated art: a grainy gradient with a bold shape, picked from the title so
// the same book always looks the same.

import { knownHd, findHd, srcsetOf, sized } from "./covers.js";
import { h, svg, rng } from "./util.js";

// [background, colour, accent, liquid that stands out against both]
export const PALETTES = [
  ["#2b3bff", "#ff9a6b", "#ffd9c4", "#e7ff3d"],
  ["#ff5a1f", "#ffd60a", "#1a1a1a", "#2b3bff"],
  ["#1f3cff", "#ff2b2b", "#f6f1e6", "#ffd60a"],
  ["#111111", "#33e07a", "#e7ff3d", "#ff6ad5"],
  ["#ffd60a", "#ff2b6b", "#111111", "#2b3bff"],
  ["#25c7ff", "#2b3bff", "#ffffff", "#ff5a1f"],
  ["#7a3cff", "#ff6ad5", "#ffe0f4", "#e7ff3d"],
  ["#0b3d2a", "#33d17a", "#ffd60a", "#ff6ad5"],
  ["#ff2b2b", "#ffd60a", "#2b3bff", "#25c7ff"],
];
const SHAPES = ["flower", "cube", "rings", "sun", "stripes", "dots", "blob"];

export const paletteOf = (seed) => PALETTES[seed % PALETTES.length];
export const liquidOf = (seed) => paletteOf(seed)[3];

let uid = 0;
/** Generated cover art: static SVG built only from numbers and our own colours. */
export function artSvg(seed) {
  const id = `g${++uid}`;
  const r = rng(seed);
  const [bg, a, b] = paletteOf(seed);
  const shape = SHAPES[Math.floor(r() * SHAPES.length)];
  const n = (x) => x.toFixed(1);
  let body = "";
  if (shape === "flower") {
    // A pom-pom of petals, like the geranium on the old Japanese stamp.
    const cx = 100;
    const cy = 130;
    for (let i = 0; i < 46; i++) {
      const ang = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 62;
      const x = cx + Math.cos(ang) * d;
      const y = cy + Math.sin(ang) * d;
      body += `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(r() * 360)})">${[0, 72, 144, 216, 288].map((p) => `<ellipse rx="5" ry="9" cy="-7" transform="rotate(${p})" fill="${a}"/>`).join("")}<circle r="2.4" fill="${b}"/></g>`;
    }
    body = `<g class="fx-sway" style="transform-origin:100px 130px">${body}</g>`;
  } else if (shape === "cube") {
    body = `<g class="fx-float"><ellipse cx="100" cy="196" rx="60" ry="14" fill="#000" opacity=".35" filter="url(#${id}s)"/>
      <path d="M100 70 L156 100 L156 164 L100 194 L44 164 L44 100 Z" fill="${a}"/>
      <path d="M100 70 L156 100 L100 130 L44 100 Z" fill="${b}"/>
      <path d="M100 130 L156 100 L156 164 L100 194 Z" fill="#000" opacity=".22"/>
      <circle cx="100" cy="132" r="70" fill="${b}" opacity=".35" filter="url(#${id}s)"/></g>`;
  } else if (shape === "rings") {
    for (let i = 0; i < 6; i++)
      body += `<circle class="fx-spin s${i % 2}" cx="100" cy="130" r="${16 + i * 16}" fill="none" stroke="${i % 2 ? a : b}" stroke-width="${n(5 + r() * 6)}" stroke-dasharray="${n(10 + r() * 40)} ${n(6 + r() * 18)}" style="transform-origin:100px 130px"/>`;
  } else if (shape === "sun") {
    body += `<g class="fx-spin s0" style="transform-origin:100px 170px">${Array.from({ length: 16 }, (_, i) => `<rect x="97" y="40" width="6" height="64" rx="3" fill="${b}" transform="rotate(${i * 22.5} 100 170)"/>`).join("")}</g><circle class="fx-pulse" cx="100" cy="170" r="58" fill="${a}" style="transform-origin:100px 170px"/>`;
    for (let i = 0; i < 4; i++) body += `<rect x="0" y="${182 + i * 16}" width="200" height="${7 - i}" fill="${bg}"/>`;
  } else if (shape === "stripes") {
    body += `<g transform="rotate(${n(-35 + r() * 70)} 100 130)"><g class="fx-slide">${Array.from({ length: 20 }, (_, i) => `<rect x="${(i - 6) * 26 - 100}" y="-140" width="${n(9 + r() * 9)}" height="560" fill="${i % 3 ? a : b}"/>`).join("")}</g></g>`;
  } else if (shape === "dots") {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 6; x++) {
        const big = r() > 0.72;
        const px = 20 + x * 32;
        const py = 20 + y * 32;
        body += `<circle class="${big ? "fx-pulse" : ""}" cx="${px}" cy="${py}" r="${big ? 11 : 4}" fill="${big ? a : b}" style="transform-origin:${px}px ${py}px;animation-delay:${n(-r() * 3)}s"/>`;
      }
  } else {
    let d = "";
    const k = 7;
    for (let i = 0; i <= k; i++) {
      const ang = (i / k) * Math.PI * 2;
      const rr = 52 + r() * 34;
      d += `${i ? "L" : "M"}${n(100 + Math.cos(ang) * rr)} ${n(130 + Math.sin(ang) * rr)} `;
    }
    body += `<path class="fx-spin s1" d="${d}Z" fill="${a}" stroke="${b}" stroke-width="8" stroke-linejoin="round" style="transform-origin:100px 130px"/>`;
  }
  return `<svg class="art" viewBox="0 0 200 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="${id}g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${a}" stop-opacity=".55"/></linearGradient>
    <filter id="${id}s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0"/></filter>
  </defs>
  <rect width="200" height="260" fill="${bg}"/><rect width="200" height="260" fill="url(#${id}g)"/>${body}
  <rect width="200" height="260" filter="url(#${id}n)" opacity=".5"/></svg>`;
}

/** Only covers from these hosts are trusted into an <img>. */
export function safeCover(url) {
  return typeof url === "string" && /^https:\/\/(books\.google\.com|books\.googleusercontent\.com|covers\.openlibrary\.org)\//.test(url) ? url : null;
}

export function coverOf(book) {
  if (safeCover(book.img)) return book.img;
  const hd = knownHd(book);
  if (hd) return hd;
  if (Number.isInteger(book.cover)) return `https://covers.openlibrary.org/b/id/${book.cover}-L.jpg?default=false`;
  // Imported books often only have an ISBN: Open Library has covers by ISBN too.
  if (typeof book.isbn === "string" && /^[\dX]{10,13}$/.test(book.isbn)) return `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg?default=false`;
  return null;
}

function coverImg(src) {
  const img = h("img", { alt: "", decoding: "async", draggable: false, referrerPolicy: "no-referrer" });
  const set = srcsetOf(src);
  if (set) {
    img.srcset = set;
    img.sizes = "(min-width: 700px) 420px, 75vw";
  }
  img.src = set ? sized(src, 720) : src;
  img.addEventListener("load", () => (img.naturalWidth < 10 ? img.remove() : img.classList.add("in")), { once: true });
  return img;
}

/** The picture: generated art underneath, the real cover fading in on top once it loads. */
export function picture(book) {
  const wrap = h("div", { class: "pic" }, svg(artSvg(book.seed)), h("span", { class: "pic-title", text: book.title }));
  const src = coverOf(book);
  let img = null;
  if (src) {
    img = coverImg(src);
    img.addEventListener("error", () => img.remove(), { once: true });
    wrap.append(img);
  }
  // No Google cover yet: look for a sharp one (by ISBN, or title and author), and swap it in.
  if (!book.noHd && !safeCover(book.img)?.startsWith("https://books.google") && book.title && knownHd(book) === undefined) {
    findHd(book).then((hd) => {
      if (!hd || !wrap.isConnected) return;
      const next = coverImg(hd);
      next.addEventListener("load", () => img?.remove(), { once: true });
      next.addEventListener("error", () => next.remove(), { once: true });
      wrap.append(next);
    });
  }
  return wrap;
}

/**
 * Light on the cover: a glint that sweeps across now and then (each book on its own rhythm),
 * and a soft hotspot that follows the tilt of your phone. Both only move (GPU).
 */
function shine(seed = 1) {
  const r = rng(seed + 7);
  return h(
    "span",
    { class: "shine", "aria-hidden": "true", vars: { "--shine-every": `${(5 + r() * 5).toFixed(1)}s`, "--shine-delay": `${(-r() * 6).toFixed(1)}s`, "--shine-angle": `${Math.round(100 + r() * 30)}deg` } },
    h("i", { class: "glint" }),
    h("i", { class: "hotspot" }),
  );
}

const FEEL = ["", "🫠", "😐", "🙂", "😍", "🤯"];
export const feelOf = (n) => FEEL[n] || "";

function denomination(book) {
  if (book.shelf === "reading") return h("span", { class: "denom" }, h("b", { text: String(Math.round((book.page / book.pages) * 100)) }), h("small", { text: "%" }));
  if (book.shelf === "want") return h("span", { class: "denom" }, h("b", { text: String(book.pages) }), h("small", { text: "PG" }));
  return h("span", { class: "denom" }, book.rating ? h("b", { class: "emo", text: feelOf(book.rating) }) : h("b", { text: "✓" }));
}

/** A finished pass gets a rubber stamp (and a hole punched through it). */
function postmark(book) {
  const d = book.finished ? new Date(book.finished) : new Date();
  const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase();
  return h(
    "span",
    { class: "postmark", "aria-hidden": "true" },
    h("span", { class: "pm-ring" }, h("small", { text: "READ ✓" }), h("b", { text: day }), h("small", { text: String(d.getFullYear()) })),
  );
}

// Ticket stock: bright card in arcade colours, never the same as the stage it sits on.
const STOCKS = ["#e7ff3d", "#ff6ad5", "#ffd60a", "#25c7ff", "#ff9b4a", "#b49bff", "#f6f1e6", "#7dffb0"];
function stockOf(seed, tone) {
  const near = { "#ff5a1f": "#ff9b4a", "#ffd60a": "#ffd60a" }[String(tone).toLowerCase()];
  const options = STOCKS.filter((c) => c !== near);
  return options[Math.abs(seed | 0) % options.length];
}

/** A barcode for the stub: static bars from the book's seed (pure decoration). */
function barcode(seed) {
  const r = rng(seed + 3);
  let x = 0;
  let bars = "";
  while (x < 96) {
    const w = 1 + Math.floor(r() * 3);
    bars += `<rect x="${x}" y="0" width="${w}" height="20"/>`;
    x += w + 1 + Math.floor(r() * 3);
  }
  return `<svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}
const serialOf = (seed) => String(Math.abs(seed | 0) % 1000000).padStart(6, "0");
const SHELF_WORD = { reading: "NOW PLAYING", want: "UP NEXT", read: "HIGH SCORE" };

/** Find this book on Amazon India: by ISBN when we have one, otherwise by title and author. */
export function amazonUrl(book) {
  const isbn = typeof book.isbn === "string" ? book.isbn.replace(/-/g, "") : "";
  const q = /^[\dX]{10,13}$/.test(isbn) ? isbn : [book.title, book.author].filter(Boolean).join(" ");
  return `https://www.amazon.in/s?k=${encodeURIComponent(q)}`;
}

/** A book as an arcade pass, front and back. */
export function bookStamp(book, { tone } = {}) {
  const [bg, a] = paletteOf(book.seed);
  const year = book.year ? String(book.year) : "";
  const stub = h(
    "div",
    { class: "tk-stub" },
    h("span", { class: "tk-serial" }, h("small", { text: "No." }), ` ${serialOf(book.seed)}`),
    h("span", { class: "tk-code", svg: barcode(book.seed) }),
    h("span", { class: "tk-shelf", text: SHELF_WORD[book.shelf] || "PASS" }),
  );
  const front = h(
    "div",
    { class: "face front" },
    h(
      "div",
      { class: "paper ticket" },
      h("i", { class: "tk-foil", "aria-hidden": "true" }),
      h("div", { class: "stamp-top" }, h("span", { class: "issuer" }, h("b", { text: "★ ADMIT ONE ★" }), h("small", { text: year ? `SHELFIE ARCADE · ${year}` : "SHELFIE ARCADE" })), denomination(book)),
      h(
        "div",
        { class: "win book-3d" },
        h("div", { class: "leaf" }, h("small", { text: "CHAPTER ONE" }), h("b", { text: book.title })),
        h("div", { class: "lid" }, picture(book), h("canvas", { class: "liquid", "aria-hidden": "true" }), shine(book.seed), h("span", { class: "pg", "aria-hidden": "true" })),
        h("div", { class: "book-fx" }),
      ),
      h("div", { class: "cap" }, h("b", { text: book.title }), h("small", { text: book.author || "Unknown author" })),
      stub,
      book.shelf === "read" ? postmark(book) : null,
      book.shelf === "read" ? h("i", { class: "tk-punch", "aria-hidden": "true" }) : null,
    ),
  );
  const facts = [
    ["PAGES", String(book.pages)],
    ["SHELF", book.shelf.toUpperCase()],
    book.shelf === "reading" ? ["ON PAGE", String(book.page)] : null,
    book.year ? ["PUBLISHED", String(book.year)] : null,
    book.cats ? ["GENRE", book.cats] : null,
    book.started ? ["STARTED", new Date(book.started).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })] : null,
    book.finished ? ["FINISHED", new Date(book.finished).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })] : null,
  ].filter(Boolean);
  const back = h(
    "div",
    { class: "face back" },
    h(
      "div",
      { class: "paper ticket back-side" },
      h("small", { class: "tk-terms", text: "THIS PASS ADMITS ONE READER · NO REFUNDS ON PLOT TWISTS" }),
      h("b", { class: "back-title", text: book.title }),
      h("small", { class: "back-by", text: book.author || "Unknown author" }),
      h("dl", { class: "facts" }, facts.map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
      book.blurb ? h("p", { class: "blurb", text: book.blurb }) : null,
      h("a", { class: "tk-buy", href: amazonUrl(book), target: "_blank", rel: "noopener noreferrer", "aria-label": `Find ${book.title} on Amazon` }, h("span", { text: "🛒" }), h("b", { text: "FIND ON AMAZON" }), h("small", { text: "↗" })),
      h("small", { class: "back-hint", text: "TAP TO FLIP BACK" }),
    ),
  );
  return h(
    "article",
    {
      class: `stamp ${book.shelf}`,
      "data-id": book.id,
      tabIndex: -1,
      "aria-label": `${book.title}${book.author ? ` by ${book.author}` : ""}${book.shelf === "reading" ? `, page ${book.page} of ${book.pages}` : ""}`,
      vars: { "--c1": a, "--cbg": bg, "--tone": tone || a, "--stock": stockOf(book.seed, tone) },
    },
    h("i", { class: "stamp-shadow", "aria-hidden": "true" }),
    h("div", { class: "flipper" }, front, back),
  );
}

/** The + stamp, always last in the pile. */
export function addStamp() {
  return h(
    "article",
    { class: "stamp add", "data-id": "add", tabIndex: -1, "aria-label": "Add a book" },
    h("i", { class: "stamp-shadow", "aria-hidden": "true" }),
    h(
      "div",
      { class: "flipper" },
      h(
        "div",
        { class: "face front" },
        h("div", { class: "paper ticket" }, h("small", { class: "add-coin", text: "INSERT COIN" }), h("span", { class: "plus", "aria-hidden": "true" }, h("i"), h("i")), h("b", { class: "add-word", text: "ADD A BOOK" }), h("small", { class: "add-sub", text: "TAP · OR PULL IT UP" })),
      ),
    ),
  );
}

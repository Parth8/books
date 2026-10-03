// Shelfie starts here. This file loads your shelves and builds the screen everyone sees first:
// the LCD and shelf tape at the top, and the pile of passes in the middle. Everything else is
// wired in from its own module (see docs/architecture.md for the map):
//
//   state.js      the live state, and the only place it's replaced
//   celebrate.js  commit(): save, back up, and celebrate what changed
//   reading.js    turning pages        dock.js      the macropad under the pile
//   stats.js      the Stats panel      adding.js    search and the starter stack
//   settings.js   the ME panel         accounts.js  accounts      backup.js  sync codes
//   import.js     Goodreads import     reset.js     the danger zone
//   onboarding.js the tour and tips    motion.js    motion controls
//   ambient.js    fidgets and visitors secrets.js   easter eggs on the keyboard and LCD
//
// Modules import each other freely (ES modules allow cycles), and the others run before this
// file's body. So the one rule: a module's top level may declare things and wire up its own
// elements, but anything that reads the state or another module's values runs from a function,
// called from the start-up section at the bottom of this file, once everything exists.

import { h, $, buzz, clamp, fmt, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { bookStamp, addStamp, liquidOf } from "../js/stamp.js";
import { createDeck } from "../js/deck.js";
import { createLiquid } from "../js/liquid.js";
import { createIsland } from "../js/island.js";
import { createHints } from "../js/hints.js";
import { burst, floatText, shockwave } from "../js/confetti.js";
import { sound, feel } from "../js/sfx.js";
import { tip, linkTips } from "../js/tips.js";
import { edisonString, startStutters } from "../js/lights.js";
import { makeGrain } from "../js/grain.js";
import { poke } from "../js/eggs.js";
import { Spring, Velocity, rubber, project } from "../js/physics.js";
import { account, setState, state } from "./state.js";
import { added, openAdd } from "./adding.js";
import { critters } from "./ambient.js";
import { applyIncoming, sync } from "./backup.js";
import { backupSoon, commit } from "./celebrate.js";
import { key, renderDock, start } from "./dock.js";
import { startMotion } from "./motion.js";
import { startOnboarding } from "./onboarding.js";
import { endScrub, nudge, scrub, showPageLabel, startScrub } from "./reading.js";
import { listenForKeys } from "./secrets.js";
import { renderFace } from "./settings.js";
import { prerenderStats, stats } from "./stats.js";

makeGrain();
setState(S.load(globalThis.localStorage));
export const island = createIsland();
/** Note that a tip or hint was seen: in your data, so every device and browser knows. */
function markGuide(key) {
  const next = S.markSeen(state, key);
  if (next === state) return;
  setState(S.save(globalThis.localStorage, next));
  backupSoon();
}
export const opensSoFar = (() => {
  try {
    return Number(localStorage.getItem("shelfie.visits")) || 0;
  } catch {
    return 0;
  }
})();
export const hints = createHints($("#hint-slot"), { seen: (k) => S.seen(state, k), mark: markGuide, active: () => opensSoFar < 3 });
// Tips only on your first visit, as each part appears (or again on request from How to use).
// The visit count is read before this open is counted, so the first visit is 0.
const firstVisit = (() => {
  try {
    return !opensSoFar && !state.toured;
  } catch {
    return true;
  }
})();
linkTips({ seen: (k) => S.seen(state, k), mark: markGuide, allowed: () => firstVisit });

export const SHELF = {
  reading: { label: "READING", tone: "#2b3bff", ink: "#ffffff", rgb: [43, 59, 255] },
  want: { label: "WANT", tone: "#ff5a1f", ink: "#0d0d0d", rgb: [255, 90, 31] },
  read: { label: "READ", tone: "#ffd60a", ink: "#0d0d0d", rgb: [255, 214, 10] },
};
export const ORDER = S.SHELVES;

export const STARTER = [
  { title: "Dune", author: "Frank Herbert", cover: 11481354, pages: 608, year: 1965, shelf: "reading", page: 212, cats: "Science fiction" },
  { title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", cover: 12986869, pages: 216, year: 1979, shelf: "reading", page: 40, cats: "Comedy" },
  { title: "Harry Potter and the Philosopher's Stone", author: "J. K. Rowling", cover: 15155833, pages: 302, year: 1997, shelf: "want", cats: "Fantasy" },
  { title: "The Hobbit", author: "J.R.R. Tolkien", cover: 14627509, pages: 310, year: 1937, shelf: "want", cats: "Fantasy" },
  { title: "Project Hail Mary", author: "Andy Weir", cover: 11200092, pages: 496, year: 2021, shelf: "want", cats: "Science fiction" },
  { title: "Nineteen Eighty-Four", author: "George Orwell", cover: 9267242, pages: 318, year: 1949, shelf: "want", cats: "Dystopia" },
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", cover: 10590366, pages: 185, year: 1925, shelf: "read", rating: 4, cats: "Classic" },
  { title: "Midnight Garden Club", author: "You, maybe", pages: 280, shelf: "want" },
];

export const book = (id) => state.books.find((b) => b.id === id);

/* ---------------- HUD: the LCD and the shelf tape ---------------- */

// The LCD cycles through your level and goals.
let lcdStep = 0;
function lcdLines() {
  const lp = S.levelProgress(state.xp);
  const y = new Date().getFullYear();
  const mon = new Date().toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  return [
    state.name ? `HI ${state.name.toUpperCase().slice(0, 12)} · LV${String(lp.level).padStart(2, "0")}` : `LV${String(lp.level).padStart(2, "0")} · ${fmt(state.xp)} XP`,
    `TODAY ${S.pagesOn(state)}/${state.goal} PG`,
    `${mon} ${S.finishedIn(state, "month")}/${state.goalMonth} BOOKS`,
    `${y} ${S.finishedIn(state, "year")}/${state.goalYear} BOOKS`,
  ];
}
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  lcdStep = (lcdStep + 1) % 4;
  const el = $("#lcd-text");
  el.textContent = lcdLines()[lcdStep];
  if (!prefersReducedMotion()) el.animate([{ transform: "translateY(8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "steps(4)" });
}, 3500);

export function renderHud() {
  const lp = S.levelProgress(state.xp);
  $("#lcd-text").textContent = lcdLines()[lcdStep];
  $("#lcd-xp").style.width = `${(lp.frac * 100).toFixed(1)}%`;
  const st = S.streak(state);
  $("#lcd-streak").textContent = `🔥${st}`;
  renderFace();
  $("#lcd").classList.toggle("lit", st > 0);
  $("#lcd").setAttribute("aria-label", `Level ${lp.level}, ${state.xp} XP, ${st}-day streak, ${S.pagesOn(state)} of ${state.goal} pages today. Open your stats and goals`);
  for (const t of tapeItems) t.querySelector("sup").textContent = String(S.shelf(state, t.dataset.shelf).length).padStart(2, "0");
}

export const tape = $("#tape");
const track = $("#tape-track");
const tapeItems = ORDER.map((id) =>
  h("button", { type: "button", role: "tab", class: "tape-item", "data-shelf": id, "aria-selected": "false" }, h("b", { text: SHELF[id].label }), h("sup", { text: "00" })),
);
track.append(...tapeItems);
let centers = [];
const measureTape = () => (centers = tapeItems.map((t) => t.offsetLeft + t.offsetWidth / 2));
const tapeX = new Spring(0, { stiffness: 170, damping: 22, onChange: (x) => paintTape(x) });

/** Fractional shelf index for a track offset. */
function fracAt(x) {
  const mid = tape.clientWidth / 2 - x;
  if (mid <= centers[0]) return 0;
  for (let k = 0; k < centers.length - 1; k++) if (mid <= centers[k + 1]) return k + (mid - centers[k]) / (centers[k + 1] - centers[k]);
  return centers.length - 1;
}
const xFor = (k) => tape.clientWidth / 2 - centers[k];

function paintTape(x) {
  track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
  const f = fracAt(x);
  tapeItems.forEach((t, k) => {
    const d = Math.min(1, Math.abs(f - k));
    t.style.opacity = String(1 - d * 0.62);
    t.style.transform = `scale(${(1 - d * 0.42).toFixed(3)})`;
  });
  // The stage colour flows between shelves as you drag.
  const a = Math.floor(f);
  const b = Math.min(ORDER.length - 1, a + 1);
  const t = f - a;
  const ca = SHELF[ORDER[a]].rgb;
  const cb = SHELF[ORDER[b]].rgb;
  const mix = ca.map((c, i) => Math.round(c + (cb[i] - c) * t));
  document.body.style.setProperty("--stage", `rgb(${mix.join(",")})`);
  document.body.style.setProperty("--stage-ink", SHELF[ORDER[Math.round(f)]].ink);
}

function placeTape(animate = true, velocity = 0) {
  measureTape();
  const k = ORDER.indexOf(shelf);
  if (animate) tapeX.to(xFor(k), velocity);
  else tapeX.jump(xFor(k));
  tapeItems.forEach((t, j) => {
    t.setAttribute("aria-selected", String(j === k));
    t.tabIndex = j === k ? 0 : -1;
  });
}

{
  const vel = new Velocity();
  let d = null;
  tape.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    d = { id: e.pointerId, x0: e.clientX, start: tapeX.value, moved: false };
    vel.reset(e.clientX, 0);
  });
  tape.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) tape.setPointerCapture(e.pointerId);
    d.moved = true;
    vel.add(e.clientX, 0);
    let x = d.start + dx;
    const lo = xFor(ORDER.length - 1);
    const hi = xFor(0);
    if (x > hi) x = hi + rubber(x - hi, 80);
    if (x < lo) x = lo + rubber(x - lo, 80);
    tapeX.jump(x);
  });
  const up = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const moved = d.moved;
    d = null;
    if (!moved) {
      const item = e.target.closest(".tape-item");
      if (item) switchShelf(item.dataset.shelf);
      return;
    }
    const v = vel.get().x;
    const k = clamp(Math.round(fracAt(tapeX.value + project(v, 0.994))), 0, ORDER.length - 1);
    hints.learn("tape");
    if (ORDER[k] !== shelf) switchShelf(ORDER[k], { velocity: v });
    else placeTape(true, v);
  };
  tape.addEventListener("pointerup", up);
  tape.addEventListener("pointercancel", up);
  track.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const k = clamp(ORDER.indexOf(shelf) + step, 0, ORDER.length - 1);
    switchShelf(ORDER[k]);
    tapeItems[k].focus();
  });
}
addEventListener("resize", () => placeTape(false));
// Focus can scroll an overflow:hidden box; the tape positions itself, so keep it pinned.
tape.addEventListener("scroll", () => (tape.scrollLeft = 0));

export let shelf = ORDER.find((s) => S.shelf(state, s).length) || "reading";

export function switchShelf(id, { velocity = 0, force = false } = {}) {
  if (id === shelf && !force) return placeTape(true, velocity);
  const dir = ORDER.indexOf(id) > ORDER.indexOf(shelf) ? 1 : -1;
  shelf = id;
  document.body.dataset.shelf = id;
  $("#stage-word").textContent = Array(6).fill(SHELF[id].label).join(" ");
  placeTape(true, velocity);
  feel("snap", "select");
  // Cards being dealt onto the new shelf: a quick run of ticks.
  const n = Math.min(6, S.shelf(state, id).length + 1);
  for (let i = 0; i < n; i++) setTimeout(() => sound("tick"), 90 + i * 60);
  setTimeout(() => sound("swoosh"), 40);
  renderShelf({ deal: dir });
}

/* ---------------- The pile ---------------- */

export const deckEl = $("#deck");
const keyOf = (b) => JSON.stringify([b.title, b.author, b.cover, b.img, b.pages, b.shelf, b.rating, b.finished]);

/** Builds a book's stamp from its latest version, when the pile needs it. */
const makeStamp = (id) => () => {
  const b = book(id);
  return b ? bookStamp(b, { tone: SHELF[b.shelf].tone }) : addStamp();
};

export function patchStamp(el, b) {
  if (b.shelf !== "reading") return;
  const pct = Math.round((b.page / b.pages) * 100);
  const d = el.querySelector(".denom b");
  if (d && d.textContent !== String(pct)) d.textContent = String(pct);
  el.setAttribute("aria-label", `${b.title}${b.author ? ` by ${b.author}` : ""}, page ${b.page} of ${b.pages}`);
}

/** `keep`: the book to show on top (a book you just added), instead of whatever was there. */
export function renderShelf({ deal = 0, keep = null } = {}) {
  const books = S.shelf(state, shelf);
  const items = books.map((b) => ({ id: b.id, key: keyOf(b), make: makeStamp(b.id) }));
  items.push({ id: "add", key: "add", make: () => addStamp() });
  deck.set(items, { deal, keep: keep && books.some((b) => b.id === keep) ? keep : null });
  // Page counts change in place, so the stamp (and its liquid) stays put.
  for (const b of books) {
    const el = deck.item(b.id)?.el;
    if (el) patchStamp(el, b);
  }
  renderHud();
}

export const deck = createDeck(deckEl, {
  canScrub: (id) => shelf === "reading" && !!book(id),
  canLift: (id) => !!book(id),
  onIndex: (id) => onTop(id),
  onScrubStart: (id) => startScrub(id),
  onScrub: (id, dy, vy) => scrub(id, dy, vy),
  onScrubEnd: (id, vy) => endScrub(id, vy),
  onScrubKey: (id, n) => nudge(id, n),
  onPull: (p) => {
    deckEl.style.setProperty("--pull", String(p));
    const step = Math.floor(p * 5);
    if (step !== pullStep) {
      pullStep = step;
      if (step > 0) feel("pull", "tick", p);
    }
  },
  onPullUp: () => {
    hints.learn("pull");
    feel("whoosh", "success");
    burst(deckEl, { count: 30, colors: ["#e7ff3d", "#ffffff"] });
    openAdd();
  },
  onTap: (id, el) => (id === "add" ? (feel("open", "light"), openAdd()) : flip(el)),
  onDoubleTap: (id, el) => pokeBook(id, el),
  onLift: (id, on) => {
    if (on) {
      hints.learn("hold");
      feel("pop", "heavy");
    }
    showZones(on);
  },
  zones: () => [...document.querySelectorAll(".zone.on")].map((el) => ({ id: el.dataset.zone, el })),
  onHover: (zid) => {
    if (zid) sound("snap");
    document.querySelectorAll(".zone").forEach((z) => z.classList.toggle("hot", z.dataset.zone === zid));
  },
  onDrop: (id, zid) => {
    feel(zid === "bin" ? "drop" : "thunk", zid === "bin" ? "warning" : "success");
    shockwave(document.querySelector(`.zone[data-zone="${zid}"]`) || deckEl, zid === "bin" ? "#ff2b2b" : "#e7ff3d");
    dropTo(id, zid);
  },
  onDrag: (f) => {
    deckEl.style.setProperty("--drag", f.toFixed(3));
    liquid?.slosh(f * 0.15);
  },
  onFlick: (vx) => {
    hints.learn("swipe");
    feel("swoosh", "light");
    setTimeout(() => sound("thunk"), 160);
    setTimeout(() => liquid?.slosh(clamp(vx / 2500, -1, 1)), 30);
  },
  onEdge: (which) => {
    feel("error", "warning");
    if (which === "end") island.say({ icon: "📮", title: "LAST ONE: THE + STAMP", sub: "Tap it or pull it up to add a book", tone: "pink", buzz: false });
  },
});
let pullStep = 0;

/**
 * Turn a pass over. Its back (and the 3D set-up a flip needs) only exists while it's turned or
 * turning: a back face on every card in the pile was GPU memory for nothing.
 */
export function flip(el, to = !el.classList.contains("flipped")) {
  clearTimeout(el._backTimer);
  if (to) {
    el.classList.add("has-back");
    void el.offsetWidth; // let the back exist before it turns
    el.classList.add("flipped");
  } else if (el.classList.contains("flipped")) {
    el.classList.remove("flipped");
    el._backTimer = setTimeout(() => el.classList.remove("has-back"), 850);
  }
  feel("flip", "light");
}

export let topId = null;
export let liquid = null;
let liquidEl = null;

let aliveTimer = 0;
function onTop(id) {
  if (topId !== id) deckEl.querySelectorAll(".stamp.flipped").forEach((s) => flip(s, false));
  topId = id;
  // The cover art's own shapes dance for a while when a stamp lands on top (SVG animations
  // are drawn by the CPU, so they rest after that; the cover keeps drifting on the GPU).
  deckEl.querySelectorAll(".stamp.alive").forEach((s) => s.classList.remove("alive"));
  const topEl = deck.top?.el;
  topEl?.classList.add("alive");
  clearTimeout(aliveTimer);
  aliveTimer = setTimeout(() => topEl?.classList.remove("alive"), 12000);
  const b = book(id);
  const canvas = deck.top?.el.querySelector("canvas.liquid");
  if (canvas !== liquidEl) {
    liquid?.destroy();
    liquid = null;
    liquidEl = null;
    if (b && b.shelf === "reading" && canvas) {
      liquidEl = canvas;
      liquid = createLiquid(canvas, { color: liquidOf(b.seed) });
      liquid.level(b.page / b.pages, true);
      liquid.splash(0.6);
      showPageLabel(b.page, b);
    }
  }
  const n = S.shelf(state, shelf).length;
  const idx = deck.index;
  $("#counter").textContent = id === "add" ? (n ? `${n} ${n === 1 ? "BOOK" : "BOOKS"} · ADD` : "EMPTY · ADD ONE") : `${String(idx + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`;
  deckEl.setAttribute("aria-label", b ? `${b.title}. ${idx + 1} of ${n} on ${SHELF[shelf].label}. Arrow keys flip, Enter turns the stamp over.` : "Add a book. Press Enter.");
  renderDock();
  offerHints();
}

function offerHints() {
  const b = book(topId);
  if (!b) hints.offer(state.books.length ? ["pull", "swipe", "tape", "stats"] : ["pull"]);
  else if (b.shelf === "reading") hints.offer(["scrub", "swipe", "poke", "hold", "tape", "stats"]);
  else hints.offer(["swipe", "hold", "poke", "tape", "stats"]);
}

/* ---------------- drop zones ---------------- */

function showZones(on) {
  document.body.classList.toggle("lifting", on);
  document.querySelectorAll(".zone").forEach((z) => z.classList.toggle("on", on && z.dataset.zone !== shelf));
}

function dropTo(id, zone) {
  const b = book(id);
  if (!b) return;
  if (zone === "bin") {
    const before = state;
    commit(S.removeBook(state, id));
    island.say({ icon: "🗑️", title: "REMOVED", sub: `${b.title} · tap to undo`, tone: "pink", action: () => undo(id, before) });
  } else {
    commit(S.moveBook(state, id, zone), $(`.zone[data-zone="${zone}"]`));
  }
  setTimeout(() => renderShelf(), 260);
}

function undo(id, before) {
  const b = before.books.find((x) => x.id === id);
  if (!b) return;
  // Put the book back as a fresh change, so it outranks its removal everywhere it synced to.
  const s = { ...state, books: [...state.books.filter((x) => x.id !== id), { ...b, touched: Date.now() }], gone: { ...state.gone } };
  delete s.gone[id];
  setState(S.save(globalThis.localStorage, s));
  backupSoon();
  renderShelf();
  island.say({ icon: "↩️", title: "BACK ON THE SHELF", tone: "lime", buzz: false });
}

/* ---------------- easter eggs ---------------- */

const pokes = new Map();
async function pokeBook(id, el) {
  const b = book(id);
  if (!b) return;
  hints.learn("poke");
  el.classList.remove("flipped");
  const n = pokes.get(id) || 0;
  pokes.set(id, n + 1);
  feel("sparkle", "celebrate");
  const res = await poke(b, el, n);
  const r = S.findEgg(state, id, res.egg);
  r.events.forEach((e) => e.type === "egg" && (e.label = res.label));
  if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, el.querySelector(".win"));
  else floatText(el.querySelector(".win"), res.label, "#ff6ad5");
}

listenForKeys();

/* ---------------- Start ---------------- */

document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && renderHud());

document.body.dataset.shelf = shelf;
$("#stage-word").textContent = Array(6).fill(SHELF[shelf].label).join(" ");
renderHud();
requestAnimationFrame(() => {
  placeTape(false);
  renderShelf({ deal: 1 });
});
// Another tab, or the installed app sharing this storage, saved: fold its changes in.
addEventListener("storage", (e) => {
  if (e.key !== S.KEY || !e.newValue) return;
  try {
    applyIncoming(JSON.parse(e.newValue));
  } catch {}
});

// Ask the browser to keep our storage even when space runs low (Chrome, Firefox, Safari 17+).
navigator.storage?.persist?.().catch(() => {});

if (sync.on) setTimeout(() => sync.now(), 400);

/* ---------------- start-up ---------------- */

startOnboarding();

// Hint that stats live below, once.
if (!hints.has("stats")) setTimeout(() => !stats.isOpen && stats.peek(), 2600);

prerenderStats();

startMotion();

// Edison bulbs over the shelf title and every panel title.
$(".hud").append(edisonString({ n: 7, sag: 14, seed: 11, cls: "over-title" }));
document.querySelectorAll(".panel-grab").forEach((g, i) => g.append(edisonString({ n: 5, sag: 10, seed: 23 + i * 7 })));
startStutters();

// Exposed for the browser tests.
globalThis.__shelfie = {
  critters,
  backupNow: () => (account?.on ? account.now() : sync.now()),
  get state() {
    return state;
  },
  get shelf() {
    return shelf;
  },
  get top() {
    return topId;
  },
  get pile() {
    return deck.ids();
  },
};

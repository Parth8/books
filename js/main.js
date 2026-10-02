// Shelfie: the screen. State lives in store.js; this file wires gestures to it and turns every
// change into motion.
//
//   top      LCD status (tap ×5 for a secret) and the shelf tape: drag it to switch shelves
//   middle   the pile of stamps (see deck.js for its gestures)
//   bottom   the dock, which changes with the stamp on top: a macropad with a page dial while
//            you're reading, START/SHUFFLE for your want pile, feeling keys for finished books
//   pullbar  pull up for stats

import { h, $, buzz, clamp, fmt, prefersReducedMotion } from "./util.js";
import * as S from "./store.js";
import { bookStamp, addStamp, feelOf, liquidOf } from "./stamp.js";
import { createDeck } from "./deck.js";
import { createLiquid } from "./liquid.js";
import { createKnob } from "./knob.js";
import { createPanel } from "./panel.js";
import { createIsland } from "./island.js";
import { poster } from "./poster.js";
import { createHints } from "./hints.js";
import { burst, rain, floatText } from "./confetti.js";
import { poke } from "./eggs.js";
import { searchBooks } from "./search.js";
import { Spring, Velocity, rubber, project } from "./physics.js";

let state = S.load(globalThis.localStorage);
const island = createIsland();
const hints = createHints($("#hint-slot"));

const SHELF = {
  reading: { label: "READING", tone: "#2b3bff", ink: "#ffffff", rgb: [43, 59, 255] },
  want: { label: "WANT", tone: "#ff5a1f", ink: "#0d0d0d", rgb: [255, 90, 31] },
  read: { label: "READ", tone: "#ffd60a", ink: "#0d0d0d", rgb: [255, 214, 10] },
};
const ORDER = S.SHELVES;

const STARTER = [
  { title: "Dune", author: "Frank Herbert", cover: 11481354, pages: 608, year: 1965, shelf: "reading", page: 212, cats: "Science fiction" },
  { title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", cover: 12986869, pages: 216, year: 1979, shelf: "reading", page: 40, cats: "Comedy" },
  { title: "Harry Potter and the Philosopher's Stone", author: "J. K. Rowling", cover: 15155833, pages: 302, year: 1997, shelf: "want", cats: "Fantasy" },
  { title: "The Hobbit", author: "J.R.R. Tolkien", cover: 14627509, pages: 310, year: 1937, shelf: "want", cats: "Fantasy" },
  { title: "Project Hail Mary", author: "Andy Weir", cover: 11200092, pages: 496, year: 2021, shelf: "want", cats: "Science fiction" },
  { title: "Nineteen Eighty-Four", author: "George Orwell", cover: 9267242, pages: 318, year: 1949, shelf: "want", cats: "Dystopia" },
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", cover: 10590366, pages: 185, year: 1925, shelf: "read", rating: 4, cats: "Classic" },
  { title: "Midnight Garden Club", author: "You, maybe", pages: 280, shelf: "want" },
];

const book = (id) => state.books.find((b) => b.id === id);

/* ============================================================
   Changes and celebrations
   ============================================================ */

function commit(result, at, { keepStats = false } = {}) {
  const before = state;
  state = result.state;
  S.save(globalThis.localStorage, state);
  const events = [...result.events];
  if (S.pagesOn(before) < state.goal && S.pagesOn(state) >= state.goal) events.push({ type: "goal" });
  celebrate(events, at);
  renderHud();
  if (stats.isOpen && !keepStats) renderStats();
  return result;
}

const posters = [];
let posterUp = false;
function queuePoster(p) {
  posters.push(p);
  if (!posterUp) nextPoster();
}
function nextPoster() {
  const p = posters.shift();
  if (!p) return (posterUp = false);
  posterUp = true;
  poster({ ...p, onDone: () => setTimeout(nextPoster, 120) });
}

function celebrate(events, at) {
  const xp = events.find((e) => e.type === "xp")?.amount || 0;
  if (xp && at) floatText(at, `+${xp} XP`, "#e7ff3d");
  const msgs = [];
  for (const e of events) {
    if (e.type === "starter") msgs.push({ icon: "📚", title: "STARTER STACK LOADED", sub: "Swipe through, drag a book up to read", tone: "pink" });
    if (e.type === "added") msgs.push({ icon: "📮", title: `ADDED TO ${SHELF[e.book.shelf].label}`, sub: e.book.title, tone: "pink" });
    if (e.type === "moved") msgs.push({ icon: e.shelf === "reading" ? "📖" : e.shelf === "want" ? "🔖" : "✅", title: `MOVED TO ${SHELF[e.shelf].label}`, sub: e.book.title, tone: e.shelf === "want" ? "sun" : "cyan" });
    if (e.type === "milestone") {
      msgs.push({ icon: { 25: "🌒", 50: "🌓", 75: "🌔" }[e.pct], title: `${e.pct}% THROUGH`, sub: e.book.title, tone: "lime" });
      burst(at || deckEl, { count: 50 + e.pct / 2 });
    }
    if (e.type === "finished")
      queuePoster({ kicker: "BOOK FINISHED", lines: ["DONE."], sub: e.book.title, tone: "#ffd60a", ink: "#0d0d0d", art: bookStamp({ ...e.book, shelf: "read", finished: new Date().toISOString() }), emoji: ["📚", "⭐", "🎉"] });
    if (e.type === "goal") queuePoster({ kicker: `${state.goal} PAGES TODAY`, lines: ["GOAL", "SMASHED."], sub: "Daily goal done. Anything more is a bonus.", tone: "#ff5a1f", ink: "#0d0d0d", emoji: ["🎯", "🔥"] });
    if (e.type === "streak") msgs.push({ icon: "🔥", title: `${e.days}-DAY STREAK`, sub: "Come back tomorrow to keep it", tone: "sun" });
    if (e.type === "level") queuePoster({ kicker: `NOW A ${e.title.toUpperCase()}`, lines: ["LEVEL", `${String(e.level).padStart(2, "0")}.`], sub: "Keep turning pages.", tone: "#2b3bff", ink: "#ffffff", emoji: ["🆙", "⚡"] });
    if (e.type === "badge") msgs.push({ icon: e.badge.emoji, title: `BADGE: ${e.badge.name.toUpperCase()}`, sub: e.badge.text, tone: "violet" });
    if (e.type === "egg" && e.fresh) msgs.push({ icon: "🥚", title: `EGG: ${e.label.toUpperCase()}`, sub: "New easter egg found", tone: "pink" });
  }
  if (!msgs.length && xp) {
    const p = S.pagesOn(state);
    msgs.push({ icon: "⚡", title: `${p}/${state.goal} PAGES TODAY`, sub: S.levelProgress(state.xp).title, tone: "lime", bar: Math.min(1, p / state.goal) });
  }
  if (msgs.length && xp) Object.assign(msgs[0], { value: xp, unit: " XP" });
  for (const m of msgs) island.say(m);
}

/* ============================================================
   HUD: the LCD and the shelf tape
   ============================================================ */

function renderHud() {
  const lp = S.levelProgress(state.xp);
  $("#lcd-text").textContent = `LV${String(lp.level).padStart(2, "0")} · ${fmt(state.xp)} XP`;
  $("#lcd-xp").style.width = `${(lp.frac * 100).toFixed(1)}%`;
  const st = S.streak(state);
  $("#lcd-streak").textContent = `🔥${st}`;
  $("#lcd").classList.toggle("lit", st > 0);
  $("#lcd").setAttribute("aria-label", `Level ${lp.level}, ${state.xp} XP, ${st}-day streak. Open your stats`);
  for (const t of tapeItems) t.querySelector("sup").textContent = String(S.shelf(state, t.dataset.shelf).length).padStart(2, "0");
}

const tape = $("#tape");
const track = $("#tape-track");
const tapeItems = ORDER.map((id) =>
  h("button", { type: "button", role: "tab", class: "tape-item", "data-shelf": id, "aria-selected": "false" }, h("b", { text: SHELF[id].label }), h("sup", { text: "00" })),
);
track.append(...tapeItems);
let centers = [];
const measureTape = () => (centers = tapeItems.map((t) => t.offsetLeft + t.offsetWidth / 2));
const tapeX = new Spring(0, { stiffness: 260, damping: 28, onChange: (x) => paintTape(x) });

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

let shelf = ORDER.find((s) => S.shelf(state, s).length) || "reading";

function switchShelf(id, { velocity = 0 } = {}) {
  if (id === shelf) return placeTape(true, velocity);
  const dir = ORDER.indexOf(id) > ORDER.indexOf(shelf) ? 1 : -1;
  shelf = id;
  document.body.dataset.shelf = id;
  $("#stage-word").textContent = Array(6).fill(SHELF[id].label).join(" ");
  placeTape(true, velocity);
  buzz(8);
  renderShelf({ deal: dir });
}

/* ============================================================
   The pile
   ============================================================ */

const deckEl = $("#deck");
const cache = new Map(); // id -> { key, el }
const keyOf = (b) => JSON.stringify([b.title, b.author, b.cover, b.img, b.pages, b.shelf, b.rating, b.finished]);
let addEl = addStamp();

function stampFor(b) {
  const k = keyOf(b);
  const hit = cache.get(b.id);
  if (hit && hit.key === k) {
    patchStamp(hit.el, b);
    return hit.el;
  }
  const el = bookStamp(b, { tone: SHELF[b.shelf].tone });
  cache.set(b.id, { key: k, el });
  return el;
}

function patchStamp(el, b) {
  if (b.shelf !== "reading") return;
  const pct = Math.round((b.page / b.pages) * 100);
  const d = el.querySelector(".denom b");
  if (d && d.textContent !== String(pct)) d.textContent = String(pct);
  el.setAttribute("aria-label", `${b.title}${b.author ? ` by ${b.author}` : ""}, page ${b.page} of ${b.pages}`);
}

function renderShelf({ deal = 0 } = {}) {
  const books = S.shelf(state, shelf);
  if (deal) {
    cache.clear();
    addEl = addStamp();
  }
  const items = books.map((b) => ({ id: b.id, el: stampFor(b) }));
  items.push({ id: "add", el: addEl });
  deck.set(items, { deal });
  renderHud();
}

const deck = createDeck(deckEl, {
  canScrub: (id) => shelf === "reading" && !!book(id),
  canLift: (id) => !!book(id),
  onIndex: (id) => onTop(id),
  onScrubStart: (id) => startScrub(id),
  onScrub: (id, dy, vy) => scrub(id, dy, vy),
  onScrubEnd: (id, vy) => endScrub(id, vy),
  onScrubKey: (id, n) => nudge(id, n),
  onPull: (p) => deckEl.style.setProperty("--pull", String(p)),
  onPullUp: () => {
    hints.learn("pull");
    openAdd();
  },
  onTap: (id, el) => (id === "add" ? openAdd() : flip(el)),
  onDoubleTap: (id, el) => pokeBook(id, el),
  onLift: (id, on) => {
    if (on) hints.learn("hold");
    showZones(on);
  },
  zones: () => [...document.querySelectorAll(".zone.on")].map((el) => ({ id: el.dataset.zone, el })),
  onHover: (zid) => document.querySelectorAll(".zone").forEach((z) => z.classList.toggle("hot", z.dataset.zone === zid)),
  onDrop: (id, zid) => dropTo(id, zid),
  onDrag: (f) => {
    deckEl.style.setProperty("--drag", f.toFixed(3));
    liquid?.slosh(f * 0.15);
  },
  onFlick: (vx) => {
    hints.learn("swipe");
    setTimeout(() => liquid?.slosh(clamp(vx / 2500, -1, 1)), 30);
  },
  onEdge: (which) => {
    if (which === "end") island.say({ icon: "📮", title: "LAST ONE: THE + STAMP", sub: "Tap it or pull it up to add a book", tone: "pink", buzz: false });
  },
});

function flip(el) {
  el.classList.toggle("flipped");
  buzz(6);
}

let topId = null;
let liquid = null;
let liquidEl = null;

function onTop(id) {
  if (topId !== id) deckEl.querySelectorAll(".stamp.flipped").forEach((s) => s.classList.remove("flipped"));
  topId = id;
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

/* ---------------- reading: scrub, dial, keys ---------------- */

let live = null; // { id, page, carry }
let saveTimer = 0;
let coast = 0;

function startScrub(id) {
  cancelAnimationFrame(coast);
  const b = book(id);
  live = { id, page: live?.id === id ? live.page : b.page, carry: 0 };
  deck.top?.el.classList.add("scrubbing");
}

function pxPerPage(b) {
  return clamp(300 / Math.min(b.pages, 50), 4, 30);
}

function scrub(id, dy, vy) {
  const b = book(id);
  if (!b || !live) return;
  const accel = 1 + Math.min(5, Math.abs(vy) / 700);
  live.carry += (dy / pxPerPage(b)) * accel;
  const whole = Math.trunc(live.carry);
  if (whole) {
    live.carry -= whole;
    setLive(b, live.page + whole);
    if (Math.abs(vy) > 1400) liquid?.splash(clamp(-vy / 6000, -0.6, 0.6), Math.random());
  }
}

function endScrub(id, vy) {
  const b = book(id);
  deck.top?.el.classList.remove("scrubbing");
  if (!b || !live) return;
  hints.learn("scrub");
  // A flick keeps turning pages for a moment.
  let v = vy;
  const step = () => {
    v *= 0.92;
    scrub(id, v / 60, v);
    if (Math.abs(v) > 120 && !prefersReducedMotion()) coast = requestAnimationFrame(step);
    else saveSoon(220);
  };
  if (Math.abs(v) > 300) coast = requestAnimationFrame(step);
  else saveSoon(220);
}

function nudge(id, n) {
  const b = book(id);
  if (!b) return;
  live = { id, page: live?.id === id ? live.page : b.page, carry: 0 };
  setLive(b, live.page + n);
  liquid?.splash(n > 0 ? 0.5 : -0.3, Math.random());
  saveSoon(600);
}

function setLive(b, page) {
  const p = clamp(page, 0, b.pages);
  if (!live || live.id !== b.id) live = { id: b.id, page: b.page, carry: 0 };
  if (p === live.page) return;
  if (p === b.pages || p === 0) buzz(15);
  else buzz(3);
  live.page = p;
  clearTimeout(saveTimer);
  liquid?.level(p / b.pages);
  showPageLabel(p, b);
  const el = deck.top?.el;
  const d = el?.querySelector(".denom b");
  if (d) d.textContent = String(Math.round((p / b.pages) * 100));
  updateScreen(b, p);
}

function showPageLabel(p, b) {
  const lbl = deck.top?.el.querySelector(".pg");
  if (!lbl) return;
  lbl.textContent = `P.${p}`;
  lbl.style.setProperty("--lvl", String(p / b.pages));
}

function saveSoon(ms) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!live) return;
    const b = book(live.id);
    const page = live.page;
    live = null;
    if (!b || b.page === page) return;
    const anchor = deck.top?.el.querySelector(".denom") || deckEl;
    const r = commit(S.setPage(state, b.id, page), anchor);
    if (r.events.some((e) => e.type === "finished" || e.type === "moved")) setTimeout(() => renderShelf(), 500);
    else {
      patchStamp(deck.top.el, book(b.id));
      renderDock();
    }
  }, ms);
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
    cache.delete(id);
    island.say({ icon: "🗑️", title: "REMOVED", sub: `${b.title} · tap to undo`, tone: "pink", action: () => undo(before) });
  } else {
    commit(S.moveBook(state, id, zone), $(`.zone[data-zone="${zone}"]`));
  }
  setTimeout(() => renderShelf(), 260);
}

function undo(before) {
  state = before;
  S.save(globalThis.localStorage, state);
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
  const res = await poke(b, el, n);
  const r = S.findEgg(state, id, res.egg);
  r.events.forEach((e) => e.type === "egg" && (e.label = res.label));
  if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, el.querySelector(".win"));
  else floatText(el.querySelector(".win"), res.label, "#ff6ad5");
}

/* ============================================================
   The dock
   ============================================================ */

const dock = $("#dock");

/** A chunky keycap. */
function key(label, cls, onPress, { aria, sub } = {}) {
  const b = h("button", { type: "button", class: `key ${cls}`, "aria-label": aria || null }, h("span", { class: "cap" }, h("b", { text: label }), sub ? h("small", { text: sub }) : null));
  b.addEventListener("click", (e) => {
    buzz(8);
    onPress(e);
  });
  return b;
}

/** The little LCD: lines of pixel text that type themselves out. */
function screen(lines) {
  const el = h("div", { class: "screen", role: "status" }, lines.map((l) => h("span", { class: "ln", text: "" })));
  [...el.children].forEach((ln, k) => typeTo(ln, lines[k]));
  return el;
}

function typeTo(el, text) {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  clearInterval(Number(el.dataset.timer || 0));
  if (prefersReducedMotion() || text.length > 48) return (el.textContent = text);
  let n = 0;
  const t = setInterval(() => {
    n += 2;
    el.textContent = text.slice(0, n) + (n < text.length ? "▌" : "");
    if (n >= text.length) clearInterval(t);
  }, 16);
  el.dataset.timer = String(t);
}

const bar = (frac, cells = 14) => "▓".repeat(Math.round(frac * cells)).padEnd(cells, "░");
const hoursLeft = (pages) => {
  const m = pages * 1.6;
  return m < 60 ? `${Math.max(1, Math.round(m))} MIN` : `${(m / 60).toFixed(1).replace(/\.0$/, "")} H`;
};

let screenEl = null;
let knob = null;

function readingLines(b, p) {
  return [`PG ${String(p).padStart(4, "0")} / ${String(b.pages).padStart(4, "0")}`, `${bar(p / b.pages)} ${Math.round((p / b.pages) * 100)}%`, p >= b.pages ? "LAST PAGE!" : `${hoursLeft(b.pages - p)} LEFT · TODAY ${S.pagesOn(state)}/${state.goal}`];
}

function updateScreen(b, p) {
  if (!screenEl || dock.dataset.mode !== "reading") return;
  readingLines(b, p).forEach((t, k) => {
    const ln = screenEl.children[k];
    ln.dataset.text = t;
    ln.textContent = t;
  });
  knob?.value(`Page ${p} of ${b.pages}`);
}

function renderDock() {
  const b = book(topId);
  const mode = !b ? (state.books.length ? "add" : "empty") : b.shelf;
  const sameBook = dock.dataset.mode === mode && dock.dataset.id === (b?.id || "") && mode !== "read";
  dock.dataset.mode = mode;
  dock.dataset.id = b?.id || "";
  if (sameBook && mode === "reading") return updateScreen(b, live?.id === b.id ? live.page : b.page);
  knob = null;
  let body;
  if (mode === "reading") {
    screenEl = screen(readingLines(b, b.page));
    knob = createKnob({
      label: `Page dial for ${b.title}`,
      onTurn: (n) => {
        const cur = book(topId);
        if (!cur) return;
        if (!live || live.id !== cur.id) live = { id: cur.id, page: cur.page, carry: 0 };
        setLive(cur, live.page + n);
        liquid?.splash(n > 0 ? 0.25 : -0.15, 0.85);
      },
      onRelease: () => saveSoon(500),
    });
    knob.value(`Page ${b.page} of ${b.pages}`);
    const plus = (n, cls) => key(`+${n}`, cls, (e) => nudgeKey(n, e), { aria: `Add ${n} pages` });
    body = [
      h("div", { class: "pad reading" }, screenEl, h("div", { class: "knob-well" }, knob.el, h("small", { text: "SPIN" })), h("div", { class: "keys" }, plus(1, "k-cream"), plus(5, "k-blue"), plus(10, "k-yellow"), plus(25, "k-red"))),
    ];
  } else if (mode === "want") {
    screenEl = screen([`NEXT UP?`, b.title.toUpperCase().slice(0, 28), `${b.pages} PAGES · ~${hoursLeft(b.pages)}`]);
    body = [
      h(
        "div",
        { class: "pad want" },
        screenEl,
        h(
          "div",
          { class: "keys two" },
          key("START", "k-blue wide", (e) => start(b.id, e.currentTarget), { sub: "READING ▶" }),
          key("🎲", "k-yellow", () => shuffle(), { aria: "Shuffle the pile", sub: "SHUFFLE" }),
        ),
      ),
    ];
  } else if (mode === "read") {
    const when = b.finished ? new Date(b.finished).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "";
    screenEl = screen([`FINISHED ${when}`, `${b.pages} PAGES`, "HOW DID IT FEEL?"]);
    body = [
      h(
        "div",
        { class: "pad read" },
        screenEl,
        h(
          "div",
          { class: "keys feel", role: "radiogroup", "aria-label": "How did it feel?" },
          [1, 2, 3, 4, 5].map((n) => {
            const k = key(feelOf(n), `k-glass${b.rating === n ? " on" : ""}`, (e) => rate(b.id, n, e.currentTarget), { aria: ["", "Meh", "Okay", "Good", "Loved it", "Mind blown"][n] });
            k.setAttribute("role", "radio");
            k.setAttribute("aria-checked", String(b.rating === n));
            return k;
          }),
        ),
        h("div", { class: "keys two" }, key("↺", "k-cream", (e) => start(b.id, e.currentTarget), { sub: "READ AGAIN" })),
      ),
    ];
  } else {
    screenEl = screen(mode === "empty" ? ["SHELVES EMPTY", "ADD A BOOK, OR", "LOAD A STARTER STACK"] : ["ADD A BOOK", "PULL THE + STAMP UP", "OR PRESS SEARCH"]);
    body = [
      h(
        "div",
        { class: "pad add" },
        screenEl,
        h(
          "div",
          { class: "keys two" },
          key("SEARCH", "k-blue wide", () => openAdd(), { sub: "FIND A BOOK" }),
          mode === "empty" ? key("⚡", "k-yellow", (e) => loadStarter(e.currentTarget), { aria: "Load a starter stack", sub: "STARTER" }) : key("📊", "k-cream", () => stats.open(), { aria: "Stats", sub: "STATS" }),
        ),
      ),
    ];
  }
  dock.replaceChildren(...body);
  if (!prefersReducedMotion()) dock.firstElementChild.animate([{ transform: "translateY(18px)", opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,1.4,.4,1)" });
}

function nudgeKey(n, e) {
  const cur = book(topId);
  if (!cur) return;
  if (!live || live.id !== cur.id) live = { id: cur.id, page: cur.page, carry: 0 };
  setLive(cur, live.page + n);
  liquid?.splash(0.35 + n / 40, Math.random());
  floatText(e.currentTarget, `+${n}`, "#e7ff3d");
  saveSoon(500);
}

function start(id, el) {
  commit(S.moveBook(state, id, "reading"), el);
  burst(el, { count: 50 });
  setTimeout(() => switchShelf("reading"), 450);
}

function rate(id, n, el) {
  commit(S.rateBook(state, id, n), el);
  burst(el, { count: 20 + n * 10, emoji: [feelOf(n)] });
  setTimeout(() => renderShelf(), 250);
}

function shuffle() {
  const pile = S.shelf(state, "want");
  if (pile.length < 2) return;
  const pick = pile[Math.floor(Math.random() * pile.length)];
  // Riffle: flick through quickly, landing on a random book.
  let k = 0;
  const target = S.shelf(state, "want").findIndex((b) => b.id === pick.id);
  deck.go(0);
  const step = () => {
    if (k >= target) return;
    k++;
    deck.go(k, { x: -900 });
    setTimeout(step, 110);
  };
  setTimeout(step, 150);
  burst(deckEl, { count: 30, emoji: ["🎲"] });
}

/* ============================================================
   Stats (pull up)
   ============================================================ */

const stats = createPanel($("#panel-stats"), {
  handles: [$("#pullbar")],
  onOpen: () => {
    hints.learn("stats");
    renderStats();
  },
  onProgress: (p) => document.body.style.setProperty("--panel", p.toFixed(3)),
});
$("#pullbar").addEventListener("click", () => stats.open());
// One tap opens your stats; keep tapping and something else happens.
let lcdTimer = 0;
$("#lcd").addEventListener("click", () => {
  clearTimeout(lcdTimer);
  if (lcdTaps()) return;
  lcdTimer = setTimeout(() => stats.open(), 320);
});
$("#panel-stats [data-close]").addEventListener("click", () => stats.close());

function renderStats() {
  const lp = S.levelProgress(state.xp);
  const today = S.pagesOn(state);
  const wk = S.week(state);
  const top = Math.max(state.goal, ...wk.map((d) => d.pages));
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  const tile = (cls, ...kids) => h("div", { class: `tile ${cls}` }, ...kids);
  const dial = goalDial(today);
  $("#stats-body").replaceChildren(
    h(
      "div",
      { class: "bento" },
      tile("t-level span2", h("small", { text: "LEVEL" }), h("b", { class: "huge", text: String(lp.level).padStart(2, "0") }), h("span", { class: "t-title", text: lp.title.toUpperCase() }), h("span", { class: "t-bar" }, h("i", { vars: { width: `${(lp.frac * 100).toFixed(1)}%` } })), h("small", { class: "t-foot", text: `${fmt(lp.into)} / ${fmt(lp.need)} XP TO LV${lp.level + 1}` })),
      tile("t-streak", h("small", { text: "STREAK" }), h("b", { class: "big", text: String(S.streak(state)).padStart(2, "0") }), h("span", { class: "t-foot", text: "🔥 DAYS IN A ROW" })),
      dial,
      tile(
        "t-week span2",
        h("small", { text: `THIS WEEK · ${fmt(wk.reduce((a, d) => a + d.pages, 0))} PAGES` }),
        h(
          "div",
          { class: "wbars" },
          wk.map((d, i) => h("span", { class: `wb${d.pages >= state.goal ? " hit" : ""}${i === 6 ? " today" : ""}`, vars: { "--h": `${Math.max(4, (d.pages / top) * 100)}%` } }, h("i"), h("small", { text: names[new Date(`${d.day}T12:00`).getDay()] }))),
        ),
      ),
      tile("t-books", h("small", { text: "BOOKS READ" }), h("b", { class: "big", text: String(S.finishedCount(state)).padStart(2, "0") })),
      tile("t-pages", h("small", { text: "PAGES READ" }), h("b", { class: "big", text: fmt(S.totalPages(state)) })),
      tile("t-eggs", h("small", { text: "EASTER EGGS" }), h("b", { class: "big", text: `🥚${state.eggs.length}` })),
      tile("t-xp", h("small", { text: "TOTAL XP" }), h("b", { class: "big", text: fmt(state.xp) })),
    ),
    h("h3", { class: "p-h", text: `BADGES ${Object.keys(state.badges).length}/${S.BADGES.length}` }),
    h(
      "div",
      { class: "badges" },
      S.BADGES.map((b) => {
        const got = state.badges[b.id];
        return h("div", { class: `mini${got ? " got" : ""}`, title: b.text }, h("div", { class: "mini-paper" }, h("span", { class: "mini-e", text: got ? b.emoji : "?" }), h("b", { text: b.name.toUpperCase() }), h("small", { text: b.text })));
      }),
    ),
    h(
      "div",
      { class: "keys two p-actions" },
      key("⬇", "k-cream", exportData, { sub: "BACK UP" }),
      (() => {
        const k = key("⬆", "k-cream", () => k.querySelector("input").click(), { sub: "RESTORE" });
        k.append(h("input", { type: "file", accept: "application/json,.json", hidden: true, on: { change: importData } }));
        return k;
      })(),
    ),
  );
  if (!prefersReducedMotion())
    [...$("#stats-body .bento").children].forEach((t, i) => t.animate([{ transform: "translateY(24px) scale(.94)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 520, delay: 40 * i, easing: "cubic-bezier(.2,1.3,.4,1)", fill: "backwards" }));
}

/** Today's ring, watch-face style. Drag round the ring to set your daily goal. */
function goalDial(today) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const svgEl = mk("svg", { viewBox: "0 0 120 120", class: "dial-svg", "aria-hidden": "true" });
  for (let t = 0; t < 60; t++) svgEl.append(mk("line", { x1: 60, y1: 6, x2: 60, y2: t % 5 ? 10 : 13, class: "tick", transform: `rotate(${t * 6} 60 60)` }));
  svgEl.append(mk("circle", { cx: 60, cy: 60, r: R, class: "trk" }));
  const arc = mk("circle", { cx: 60, cy: 60, r: R, class: "arc", "stroke-dasharray": C, transform: "rotate(-90 60 60)" });
  const handle = mk("circle", { cx: 60, cy: 60 - R, r: 7, class: "handle" });
  svgEl.append(arc, handle);
  const num = h("b", { class: "dial-n", text: String(today) });
  const of = h("small", { class: "dial-of" });
  const el = h("div", { class: "tile t-dial tile-dial", role: "slider", tabIndex: 0, "aria-label": "Daily page goal", "aria-valuemin": "5", "aria-valuemax": "200" }, svgEl, h("span", { class: "dial-in" }, num, of), h("small", { class: "t-foot", text: "TODAY · SPIN TO SET GOAL" }));
  let goal = state.goal;
  const paint = () => {
    const frac = Math.min(1, today / goal);
    arc.style.strokeDashoffset = String(C * (1 - frac));
    const a = (goal / 200) * 2 * Math.PI;
    handle.setAttribute("cx", String(60 + Math.sin(a) * R));
    handle.setAttribute("cy", String(60 - Math.cos(a) * R));
    of.textContent = `/ ${goal}`;
    el.setAttribute("aria-valuenow", String(goal));
    el.classList.toggle("done", today >= goal);
  };
  paint();
  let d = null;
  const at = (e) => {
    const r = svgEl.getBoundingClientRect();
    let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    if (a < 0) a += 2 * Math.PI;
    return clamp(Math.round(((a / (2 * Math.PI)) * 200) / 5) * 5, 5, 200);
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    d = e.pointerId;
    el.setPointerCapture(d);
    el.classList.add("grab");
  });
  el.addEventListener("pointermove", (e) => {
    if (d !== e.pointerId) return;
    const g = at(e);
    if (g !== goal) {
      goal = g;
      buzz(3);
      paint();
    }
  });
  const up = (e) => {
    if (d !== e.pointerId) return;
    d = null;
    el.classList.remove("grab");
    if (goal !== state.goal) {
      commit(S.setGoal(state, goal), null, { keepStats: true });
      island.say({ icon: "🎯", title: `GOAL: ${goal} PAGES A DAY`, tone: "lime", buzz: false });
    }
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("keydown", (e) => {
    const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
    if (!step) return;
    e.preventDefault();
    goal = clamp(goal + step, 5, 200);
    paint();
    commit(S.setGoal(state, goal), null, { keepStats: true });
  });
  return el;
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `shelfie-${S.dayKey()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const next = S.load({ getItem: () => text });
    if (!next.books.length && !next.xp) throw new Error("empty");
    state = next;
    S.save(globalThis.localStorage, state);
    renderShelf({ deal: 1 });
    renderStats();
    island.say({ icon: "✅", title: "SHELVES RESTORED", sub: `${state.books.length} books`, tone: "lime" });
  } catch {
    island.say({ icon: "🤔", title: "THAT FILE DIDN'T WORK", sub: "Pick a Shelfie backup (.json)", tone: "pink" });
  }
}

/* ============================================================
   Adding books (pull up the + stamp)
   ============================================================ */

const add = createPanel($("#panel-add"), {
  onOpen: () => {
    $("#q").value = "";
    $("#results").replaceChildren(suggestions());
    $("#source").textContent = "";
  },
  onClose: () => {
    if (!added.length) return;
    const where = book(added[added.length - 1])?.shelf;
    added = [];
    if (where && where !== shelf) switchShelf(where);
    else renderShelf();
  },
});
$("#panel-add [data-close]").addEventListener("click", () => add.close());
let added = [];
const openAdd = () => add.open();

function suggestions() {
  const picks = ["Fourth Wing", "Project Hail Mary", "Normal People", "Atomic Habits", "The Hobbit", "Tomorrow, and Tomorrow"];
  return h("div", { class: "suggest" }, h("small", { class: "p-label", text: "TRY" }), h("div", { class: "chips" }, picks.map((p) => h("button", { type: "button", class: "chip", text: p, on: { click: () => (($("#q").value = p), runSearch()) } }))));
}

let searchTimer = 0;
$("#q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 320);
});
$("#q").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  clearTimeout(searchTimer);
  runSearch();
  e.currentTarget.blur();
});

async function runSearch() {
  const q = $("#q").value.trim();
  const out = $("#results");
  if (q.length < 2) return out.replaceChildren(suggestions());
  out.replaceChildren(h("div", { class: "loading" }, h("i"), h("i"), h("i")));
  try {
    const { results, source } = await searchBooks(q);
    if ($("#q").value.trim() !== q) return;
    $("#source").textContent = results.length ? `RESULTS FROM ${source === "google" ? "GOOGLE BOOKS" : "OPEN LIBRARY"}` : "";
    if (!results.length) return out.replaceChildren(h("p", { class: "empty", text: `NOTHING FOR "${q.toUpperCase()}". TRY FEWER WORDS, OR TYPE IT IN BELOW.` }));
    out.replaceChildren(...results.map(row));
    if (!prefersReducedMotion()) [...out.children].forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(20px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: i * 30, easing: "cubic-bezier(.2,1.3,.4,1)", fill: "backwards" }));
  } catch (err) {
    if (err?.name === "AbortError" && $("#q").value.trim() !== q) return;
    out.replaceChildren(h("p", { class: "empty warn", text: navigator.onLine === false ? "YOU'RE OFFLINE. TYPE IT IN BELOW INSTEAD." : "SEARCH IS HAVING A MOMENT. TRY AGAIN, OR TYPE IT IN BELOW." }));
  }
}

const LEVELS = [
  { at: 70, shelf: "want" },
  { at: 155, shelf: "reading" },
  { at: 240, shelf: "read" },
];

/** A search result. Swipe it right to add it: further means a later shelf. Tap adds to Want. */
function row(r) {
  const seed = S.hash(`${r.title}|${r.author}`);
  const have = state.books.some((b) => (r.key && b.key === r.key) || (b.title === r.title && b.author === r.author));
  const thumb = h("div", { class: "thumb" }, bookStamp({ ...r, id: "x", seed, shelf: "want", pages: r.pages || 300, page: 0 }).querySelector(".pic"));
  const label = h("b", { class: "row-label", text: "WANT" });
  const slab = h("div", { class: "row-under", "aria-hidden": "true" }, label);
  const face = h(
    "div",
    { class: "row-face" },
    thumb,
    h("span", { class: "row-text" }, h("b", { text: r.title }), h("small", { text: [r.author, r.year, r.pages ? `${r.pages} PG` : null].filter(Boolean).join(" · ") })),
    h("span", { class: "row-go", "aria-hidden": "true", text: have ? "✓" : "→" }),
  );
  const el = h("div", { class: `row${have ? " have" : ""}`, role: "button", tabIndex: 0, "aria-label": have ? `${r.title}, already on your shelves` : `Add ${r.title} to Want. Swipe right for Reading or Read.` }, slab, face);
  if (have) return el;

  const doAdd = (to, v = 900) => {
    if (el.classList.contains("have")) return;
    el.classList.add("have");
    const res = commit(S.addBook(state, { ...r, pages: r.pages || 300, shelf: to, seed }), face.querySelector(".row-go"));
    added.push(res.events.find((e) => e.type === "added")?.book.id);
    el.dataset.to = to;
    label.textContent = `+ ${SHELF[to].label}`;
    burst(face.querySelector(".row-go"), { count: 30, power: 0.7 });
    const x = new Spring(currentX, { stiffness: 200, damping: 24, onChange: (val) => (face.style.transform = `translateX(${val}px)`) });
    x.to(el.clientWidth + 40, v);
    setTimeout(() => {
      face.querySelector(".row-go").textContent = "✓";
      x.to(0);
      el.setAttribute("aria-label", `${r.title}, added to ${SHELF[to].label}`);
    }, 520);
  };

  let currentX = 0;
  let level = -1;
  const vel = new Velocity();
  const spring = new Spring(0, {
    stiffness: 420,
    damping: 32,
    onChange: (v) => {
      currentX = v;
      face.style.transform = `translateX(${v}px)`;
    },
  });
  let d = null;
  el.addEventListener("pointerdown", (e) => {
    if (el.classList.contains("have")) return;
    d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: null };
    vel.reset(e.clientX, 0);
  });
  el.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      d.mode = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
      if (d.mode === "swipe") el.setPointerCapture(e.pointerId);
    }
    if (d.mode !== "swipe") return;
    vel.add(e.clientX, 0);
    const x = dx < 0 ? rubber(dx, 30) : dx > 280 ? 280 + rubber(dx - 280, 40) : dx;
    spring.jump(x);
    const lv = LEVELS.reduce((acc, l, k) => (x >= l.at ? k : acc), -1);
    if (lv !== level) {
      level = lv;
      el.dataset.level = String(lv);
      label.textContent = lv < 0 ? "WANT" : SHELF[LEVELS[lv].shelf].label;
      if (lv >= 0) {
        buzz(10);
        label.animate([{ transform: "scale(1.4)" }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,1.6,.4,1)" });
      }
    }
  });
  const up = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const mode = d.mode;
    d = null;
    if (mode === "scroll") return;
    if (!mode) return doAdd("want");
    if (level >= 0) {
      doAdd(LEVELS[level].shelf, vel.get().x);
      return;
    }
    spring.to(0, vel.get().x);
    el.dataset.level = "-1";
    level = -1;
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", () => {
    d = null;
    spring.to(0);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      doAdd("want");
    }
    if (e.key === "ArrowRight") doAdd("reading");
  });
  return el;
}

$("#m-add").addEventListener("click", (e) => {
  const title = $("#m-title").value.trim();
  if (!title) {
    $("#m-title").focus();
    $("#m-title").animate([{ transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "none" }], { duration: 300 });
    return;
  }
  const res = commit(S.addBook(state, { title, author: $("#m-author").value, pages: $("#m-pages").value, shelf: "want" }), e.currentTarget);
  added.push(res.events.find((x) => x.type === "added")?.book.id);
  $("#m-title").value = "";
  $("#m-author").value = "";
  add.close();
});

function loadStarter(el) {
  let s = state;
  const base = Date.now();
  STARTER.forEach((b, k) => {
    s = S.addBook(s, b).state;
    const nb = s.books[s.books.length - 1];
    // Starter books arrive part-read, without pretending you read those pages today.
    if (b.page) nb.page = nb.best = b.page;
    if (b.rating) nb.rating = b.rating;
    nb.touched = base - k;
  });
  s = { ...s, xp: state.xp + 50 };
  commit({ state: s, events: [{ type: "xp", amount: 50 }, { type: "starter" }] }, el);
  burst(deckEl, { count: 90 });
  shelf = "want";
  switchShelf("reading");
}

/* ============================================================
   Secrets
   ============================================================ */

let lcdTapTimes = [];
function lcdTaps() {
  const now = Date.now();
  lcdTapTimes = lcdTapTimes.filter((t) => now - t < 1600).concat(now);
  if (lcdTapTimes.length < 5) return false;
  lcdTapTimes = [];
  document.body.classList.add("party");
  setTimeout(() => document.body.classList.remove("party"), 4000);
  rain({ count: 220, emoji: ["📚", "🪩", "✨", "🦄"] });
  const r = S.findEgg(state, "app", "party");
  r.events.forEach((e) => e.type === "egg" && (e.label = "Party mode"));
  commit(r, $("#lcd"));
  return true;
}

addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (add.isOpen) add.close();
  else if (stats.isOpen) stats.close();
});

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
let kIdx = 0;
addEventListener("keydown", (e) => {
  kIdx = e.key === KONAMI[kIdx] ? kIdx + 1 : e.key === KONAMI[0] ? 1 : 0;
  if (kIdx < KONAMI.length) return;
  kIdx = 0;
  const r = S.findEgg(state, "app", "konami");
  r.events.forEach((e) => e.type === "egg" && (e.label = "Cheat code"));
  commit(r, $("#lcd"));
  rain({ count: 160, emoji: ["🎮", "👾", "🕹️"] });
});

/* ============================================================
   Start
   ============================================================ */

document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && renderHud());

document.body.dataset.shelf = shelf;
$("#stage-word").textContent = Array(6).fill(SHELF[shelf].label).join(" ");
renderHud();
requestAnimationFrame(() => {
  placeTape(false);
  renderShelf({ deal: 1 });
});
if (!state.seen) {
  state = { ...state, seen: true };
  S.save(globalThis.localStorage, state);
  setTimeout(() => island.say({ icon: "👋", title: "WELCOME TO SHELFIE", sub: "Everything here works with a swipe", tone: "pink" }), 900);
}
// Hint that stats live below, once.
if (!hints.has("stats")) setTimeout(() => !stats.isOpen && stats.peek(), 2600);

// Exposed for the browser tests.
globalThis.__shelfie = {
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

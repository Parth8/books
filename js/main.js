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
import { bookStamp, addStamp, feelOf, liquidOf, amazonUrl } from "./stamp.js";
import { createDeck } from "./deck.js";
import { createLiquid } from "./liquid.js";
import { createKnob } from "./knob.js";
import { createPanel } from "./panel.js";
import { createIsland } from "./island.js";
import { poster } from "./poster.js";
import { createHints } from "./hints.js";
import { burst, rain, floatText, pages as flutter, coins, shockwave, shake } from "./confetti.js";
import { sound, haptic, feel, fx } from "./sfx.js";
import { createSync, prettyCode } from "./sync.js";
import { createAccount, passwordProblem, strength, cleanLogin } from "./account.js";
import { startTutorial } from "./tutorial.js";
import { popup } from "./modal.js";
import { tip, holdTipsWhile, resetTips, linkTips } from "./tips.js";
import { createCritters, CRITTERS } from "./critters.js";
import { canInstall, showInstall, shouldOffer, markOffered, chaiCard } from "./home.js";
import { createLever } from "./lever.js";
import { edisonString, startStutters } from "./lights.js";
import { makeGrain } from "./grain.js";
import { createGyro, motionSupported, askMotion } from "./gyro.js";
import * as Q from "./quips.js";
import { fromGoodreads } from "./goodreads.js";
import { poke } from "./eggs.js";
import { searchBooks } from "./search.js";
import { Spring, Velocity, rubber, project } from "./physics.js";

makeGrain();
let state = S.load(globalThis.localStorage);
const island = createIsland();
/** Note that a tip or hint was seen: in your data, so every device and browser knows. */
function markGuide(key) {
  const next = S.markSeen(state, key);
  if (next === state) return;
  state = S.save(globalThis.localStorage, next);
  backupSoon();
}
const opensSoFar = (() => {
  try {
    return Number(localStorage.getItem("shelfie.visits")) || 0;
  } catch {
    return 0;
  }
})();
const hints = createHints($("#hint-slot"), { seen: (k) => S.seen(state, k), mark: markGuide, active: () => opensSoFar < 3 });
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

// Changes go to whichever backup is on: your account, or (without one) a sync code.
let account = null;
const panelsUp = new Map(); // how far each panel is open (see panelProgress)
let syncRef = null; // the sync-code engine, once it exists (the HUD draws before it does)
function backupSoon() {
  if (account?.on) account.soon();
  else syncRef?.soon(); // (syncRef: this can run while the app is still starting up)
}

function commit(result, at, { keepStats = false } = {}) {
  const before = state;
  state = result.state;
  state = S.save(globalThis.localStorage, state);
  const events = [...result.events];
  celebrate(events, at);
  renderHud();
  statsDirty = true;
  if (stats.isOpen && !keepStats) renderStats();
  else prerenderStats();
  backupSoon();
  void before;
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
  (p.sounds || ["fanfare"]).forEach((name, i) => setTimeout(() => sound(name), i * 380));
  haptic("celebrate");
  poster({ ...p, onDone: () => setTimeout(nextPoster, 120) });
}

const MONTH = () => new Date().toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
let combo = { n: 0, t: 0 };

/**
 * Now and then, reading pays out: a jackpot. About one page session in twelve, never twice in ten
 * minutes, so it stays a surprise.
 */
function maybeJackpot(anchor) {
  // Remembered on the device, so reopening the app can't be used to farm jackpots.
  let last = 0;
  try {
    last = Number(localStorage.getItem("shelfie.jackpot") || 0);
  } catch {}
  if (Date.now() - last < 600_000 || Math.random() > 1 / 12) return;
  try {
    localStorage.setItem("shelfie.jackpot", String(Date.now()));
  } catch {}
  const amount = [25, 25, 50, 50, 77, 100][Math.floor(Math.random() * 6)];
  setTimeout(() => commit(S.jackpot(state, amount), anchor), 700);
}

function celebrate(events, at) {
  if (events.some((e) => ["finished", "goal", "level", "imported", "jackpot", "badge"].includes(e.type))) lightsChase();
  const jp = events.find((e) => e.type === "jackpot");
  if (jp) {
    feel("fanfare", "celebrate");
    queuePoster({ lines: ["JACK", "POT!"], kicker: "🎰 BONUS ROUND", sub: `+${jp.amount} XP for reading. Lucky you${state.name ? `, ${state.name}` : ""}.`, tone: "#ffd60a", ink: "#0d0d0d", emoji: ["🪙", "⭐", "🎰"] });
  }
  const xp = events.find((e) => e.type === "xp")?.amount || 0;
  if (xp && at) {
    floatText(at, `+${xp} XP`, "#e7ff3d");
    coins(at, Math.min(30, 6 + Math.round(xp / 4)));
    sound("coin");
  }
  // Reading in bursts builds a combo: each log within 90 seconds of the last ramps it up.
  if (events.some((e) => e.type === "xp") && events.some((e) => e.type === "xp" && e.amount > 0) && !events.some((e) => e.type === "added" || e.type === "egg" || e.type === "starter")) {
    const now = Date.now();
    combo = now - combo.t < 90000 ? { n: combo.n + 1, t: now } : { n: 1, t: now };
    if (combo.n >= 2) showCombo(combo.n);
    if (combo.n === 5)
      setTimeout(() => {
        const r = S.findEgg(state, "app", "combo5");
        r.events.forEach((e) => e.type === "egg" && (e.label = "Combo ×5"));
        if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, $("#stage"));
      }, 1600);
  }
  const msgs = [];
  for (const e of events) {
    if (e.type === "imported" && e.added) msgs.push({ icon: "🧳", title: "LIBRARY IMPORTED", sub: `${fmt(e.added)} books moved in`, tone: "pink" });
    if (e.type === "starter") msgs.push({ icon: "📚", title: "STARTER STACK LOADED", sub: "Swipe through, drag a book up to read", tone: "pink" });
    if (e.type === "added") msgs.push({ icon: "📮", title: `ADDED TO ${SHELF[e.book.shelf].label}`, sub: `${e.book.title} · ${Q.added(state.name)}`, tone: "pink" });
    if (e.type === "moved") msgs.push({ icon: e.shelf === "reading" ? "📖" : e.shelf === "want" ? "🔖" : "✅", title: `MOVED TO ${SHELF[e.shelf].label}`, sub: e.book.title, tone: e.shelf === "want" ? "sun" : "cyan" });
    if (e.type === "milestone") {
      msgs.push({ icon: { 25: "🌒", 50: "🌓", 75: "🌔" }[e.pct], title: `${e.pct}% THROUGH`, sub: e.book.title, tone: "lime" });
      burst(at || deckEl, { count: 50 + e.pct / 2 });
    }
    if (e.type === "finished") {
      queuePoster({ kicker: "BOOK FINISHED", lines: ["DONE."], sub: `${e.book.title}. ${Q.finished(state.name)}`, tone: "#ffd60a", ink: "#0d0d0d", art: bookStamp({ ...e.book, shelf: "read", finished: new Date().toISOString() }), emoji: ["📚", "⭐", "🎉"], sounds: ["stamp", "fanfare"] });
      shockwave(at || deckEl, "#ffd60a");
      shake($("#stage"), 10);
    }
    if (e.type === "goal" && e.period === "day") queuePoster({ kicker: `${e.target} PAGES TODAY`, lines: ["GOAL", "SMASHED."], sub: "Daily goal done. Anything more is a bonus.", tone: "#ff5a1f", ink: "#0d0d0d", emoji: ["🎯", "🔥"], sounds: ["levelup"] });
    if (e.type === "goal" && e.period === "month") queuePoster({ kicker: `${e.target} ${e.target === 1 ? "BOOK" : "BOOKS"} IN ${MONTH()}`, lines: ["MONTH", "CRUSHED."], sub: "Monthly goal done. Look at you.", tone: "#ff6ad5", ink: "#0d0d0d", emoji: ["🗓️", "💥", "📚"], sounds: ["fanfare"] });
    if (e.type === "goal" && e.period === "year") queuePoster({ kicker: `${e.target} BOOKS IN ${new Date().getFullYear()}`, lines: ["YEAR", "GOAL.", "DONE."], sub: "You hit your reading goal for the whole year.", tone: "#25c7ff", ink: "#0d0d0d", emoji: ["👑", "🏆", "📚", "✨"], sounds: ["fanfare", "levelup"] });
    if (e.type === "streak") msgs.push({ icon: "🔥", title: `${e.days}-DAY STREAK`, sub: "Come back tomorrow to keep it", tone: "sun" });
    if (e.type === "level") queuePoster({ kicker: `NOW A ${e.title.toUpperCase()}`, lines: ["LEVEL", `${String(e.level).padStart(2, "0")}.`], sub: "Keep turning pages.", tone: "#2b3bff", ink: "#ffffff", emoji: ["🆙", "⚡"], sounds: ["levelup"] });
    if (e.type === "badge") {
      msgs.push({ icon: e.badge.emoji, title: `BADGE: ${e.badge.name.toUpperCase()}`, sub: e.badge.text, tone: "violet" });
      setTimeout(() => feel("sparkle", "success"), 400);
    }
    if (e.type === "egg" && e.fresh) msgs.push({ icon: "🥚", title: `EGG: ${e.label.toUpperCase()}`, sub: "New easter egg found", tone: "pink" });
  }
  if (!msgs.length && xp) {
    const p = S.pagesOn(state);
    msgs.push({ icon: "⚡", title: `${p}/${state.goal} PAGES TODAY`, sub: Q.pages(state.name, xp), tone: "lime", bar: Math.min(1, p / state.goal) });
  }
  if (msgs.length && xp) Object.assign(msgs[0], { value: xp, unit: " XP" });
  for (const m of msgs) island.say(m);
  if (events.some((e) => e.type === "milestone")) feel("levelup", "success");
}

/** "x3 COMBO" sticker that slaps onto the stage and fades. */
function showCombo(n) {
  sound("combo", n);
  haptic(n >= 5 ? "celebrate" : "success");
  const el = h("div", { class: `combo${n >= 5 ? " hot" : ""}`, "aria-hidden": "true" }, h("b", { text: `×${n}` }), h("small", { text: n >= 5 ? "ON FIRE" : "COMBO" }));
  if (n === 3 || n === 6) island.say({ icon: "⚡", title: Q.combo(state.name, n).toUpperCase(), tone: "lime", buzz: false });
  $("#stage").append(el);
  burst(el, { count: 10 + n * 6, emoji: n >= 5 ? ["🔥"] : null });
  const done = () => el.remove();
  if (prefersReducedMotion()) return setTimeout(done, 1200);
  el.animate([{ transform: "scale(3) rotate(-20deg)", opacity: 0 }, { transform: "scale(1) rotate(-8deg)", opacity: 1, offset: 0.25 }, { transform: "scale(1.06) rotate(-6deg)", opacity: 1, offset: 0.8 }, { transform: "scale(0.8) rotate(-8deg) translateY(-30px)", opacity: 0 }], { duration: 1500, easing: "cubic-bezier(.2,1.4,.4,1)" }).finished.then(done, done);
}

/* ============================================================
   HUD: the LCD and the shelf tape
   ============================================================ */

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

function renderHud() {
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

const tape = $("#tape");
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

let shelf = ORDER.find((s) => S.shelf(state, s).length) || "reading";

function switchShelf(id, { velocity = 0 } = {}) {
  if (id === shelf) return placeTape(true, velocity);
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

/* ============================================================
   The pile
   ============================================================ */

const deckEl = $("#deck");
const keyOf = (b) => JSON.stringify([b.title, b.author, b.cover, b.img, b.pages, b.shelf, b.rating, b.finished]);

/** Builds a book's stamp from its latest version, when the pile needs it. */
const makeStamp = (id) => () => {
  const b = book(id);
  return b ? bookStamp(b, { tone: SHELF[b.shelf].tone }) : addStamp();
};

function patchStamp(el, b) {
  if (b.shelf !== "reading") return;
  const pct = Math.round((b.page / b.pages) * 100);
  const d = el.querySelector(".denom b");
  if (d && d.textContent !== String(pct)) d.textContent = String(pct);
  el.setAttribute("aria-label", `${b.title}${b.author ? ` by ${b.author}` : ""}, page ${b.page} of ${b.pages}`);
}

/** `keep`: the book to show on top (a book you just added), instead of whatever was there. */
function renderShelf({ deal = 0, keep = null } = {}) {
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

const deck = createDeck(deckEl, {
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
function flip(el, to = !el.classList.contains("flipped")) {
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

let topId = null;
let liquid = null;
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
  if (p === b.pages || p === 0) feel("thunk", "medium");
  else feel("page", "tick");
  // A few pages flutter off the stamp as you read forwards.
  if (p > live.page && Math.random() < 0.5) flutter(deck.top?.el.querySelector(".win") || deckEl, { count: 1 + Math.min(3, p - live.page) });
  const crossed = [25, 50, 75].find((m) => (live.page / b.pages) * 100 < m && (p / b.pages) * 100 >= m);
  if (crossed) {
    feel("snap", "medium");
    shockwave(deck.top?.el.querySelector(".denom") || deckEl, "#e7ff3d");
  }
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
  lbl.parentElement.style.setProperty("--lvl", String(p / b.pages)); // (on the lid: the page label and the ripple both ride the level)
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
    if (page > b.page) maybeJackpot(anchor);
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
  state = S.save(globalThis.localStorage, s);
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

/* ============================================================
   The dock
   ============================================================ */

const dock = $("#dock");

/** A chunky keycap. */
function key(label, cls, onPress, { aria, sub } = {}) {
  const b = h("button", { type: "button", class: `key ${cls}`, "aria-label": aria || null }, h("span", { class: "cap" }, h("b", { text: label }), sub ? h("small", { text: sub }) : null));
  b.addEventListener("pointerdown", () => feel("click", "medium"));
  b.addEventListener("click", (e) => {
    if (e.detail === 0) feel("click", "medium"); // keyboard press
    sparkKey(b);
    onPress(e);
  });
  return b;
}

/** A keycap throws a few sparks when pressed. */
function sparkKey(el) {
  const colors = { "k-blue": ["#2b3bff", "#ffffff"], "k-yellow": ["#ffd60a", "#ffffff"], "k-red": ["#ff3b30", "#ffffff"] };
  const c = Object.entries(colors).find(([k]) => el.classList.contains(k))?.[1] || ["#e7ff3d", "#ffffff"];
  burst(el, { count: 10, colors: c, kinds: ["dot", "star"], power: 0.55 });
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

/** Fairy lights strung across the top of the macropad. */
const fairy = (() => {
  const n = 13;
  const colors = ["#e7ff3d", "#ff6ad5", "#25c7ff", "#ff5a1f", "#ffd60a"];
  const sag = (t) => 4 + Math.sin(t * Math.PI) * 12; // the wire droops in the middle
  const path = `M0 4 ${Array.from({ length: 21 }, (_, i) => `L${(i / 20) * 100} ${sag(i / 20).toFixed(1)}`).join(" ")}`;
  const el = h("div", { class: "fairy", "aria-hidden": "true" }, h("span", { svg: `<svg viewBox="0 0 100 26" preserveAspectRatio="none"><path d="${path}" vector-effect="non-scaling-stroke"/></svg>` }));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    el.append(h("i", { vars: { "--x": `${t * 100}%`, "--y": `${sag(t) + 1}px`, "--c": colors[i % colors.length], "--d": `${(1.6 + ((i * 7) % 5) * 0.45).toFixed(2)}s`, "--delay": `${-((i * 13) % 9) * 0.3}s`, "--n": i } }));
  }
  return el;
})();
/** On big moments the lights chase. */
function lightsChase() {
  if (prefersReducedMotion()) return;
  fairy.classList.remove("chase");
  void fairy.offsetWidth;
  fairy.classList.add("chase");
  clearTimeout(lightsChase.t);
  lightsChase.t = setTimeout(() => fairy.classList.remove("chase"), 3200);
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
        sound("detent");
        setLive(cur, live.page + n);
        liquid?.splash(n > 0 ? 0.25 : -0.15, 0.85);
      },
      onRelease: () => saveSoon(500),
    });
    knob.value(`Page ${b.page} of ${b.pages}`);
    const plus = (n, cls) => key(`+${n}`, cls, (e) => nudgeKey(n, e), { aria: `Add ${n} pages` });
    body = [
      h("div", { class: "pad reading" }, screenEl, h("div", { class: "knob-well" }, knob.el, h("small", { text: "SPIN" })), h("div", { class: "keys round" }, plus(1, "k-cream"), plus(5, "k-blue"), plus(10, "k-yellow"), plus(25, "k-red"))),
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
          { class: "keys three" },
          (() => {
            const k = key("START", "k-blue wide", (e) => start(b.id, e.currentTarget), { sub: "READING" });
            k.querySelector("b").append(h("i", { class: "play-tri", "aria-hidden": "true" }));
            return k;
          })(),
          key("🛒", "k-pink", () => window.open(amazonUrl(b), "_blank", "noopener,noreferrer"), { aria: `Find ${b.title} on Amazon`, sub: "GET IT" }),
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
    screenEl = screen(mode === "empty" ? [state.name ? `HI ${state.name.toUpperCase().slice(0, 14)}!` : "SHELVES EMPTY", "SEARCH, IMPORT FROM", "GOODREADS, OR TRY A DEMO"] : ["ADD A BOOK", "PULL THE + STAMP UP", "OR PRESS SEARCH"]);
    body = [
      h(
        "div",
        { class: "pad add" },
        screenEl,
        h(
          "div",
          { class: mode === "empty" ? "keys three" : "keys two" },
          key("SEARCH", "k-blue wide", () => openAdd(), { sub: "FIND A BOOK" }),
          // Goodreads is a first-day thing: offered here only while the library is empty
          // (afterwards it lives in You → Library).
          mode === "empty"
            ? key("🧳", "k-pink", () => openImport(), { aria: "Import from Goodreads", sub: "GOODREADS" })
            : key("✍️", "k-cream", () => openAdd({ manual: true }), { aria: "Type a book in by hand", sub: "BY HAND" }),
          mode === "empty" ? key("⚡", "k-yellow", (e) => loadStarter(e.currentTarget), { aria: "Load a starter stack", sub: "DEMO" }) : null,
        ),
      ),
    ];
  }
  dock.replaceChildren(...body, fairy);
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
    feel("open", "medium");
    if (statsDirty) renderStats();
    else if (!prefersReducedMotion()) $("#stats-body").querySelectorAll("[data-n]").forEach((el) => countUp(el));
  },
  onClose: () => feel("close", "light"),
  onProgress: (p) => panelProgress("stats", p),
});
// Build the stats as soon as a finger lands on the bar, so nothing heavy happens mid-swipe.
let statsDirty = true;
$("#pullbar").addEventListener("pointerdown", () => statsDirty && !stats.isOpen && renderStats(), { passive: true });
/** Build the stats while nothing else is happening, so pulling them up is pure motion. */
let prerenderTimer = 0;
function prerenderStats() {
  clearTimeout(prerenderTimer);
  prerenderTimer = setTimeout(() => {
    const go = () => statsDirty && !stats.isOpen && !deck.dragging && renderStats({ quiet: true });
    if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 4000 });
    else go();
  }, 2500);
}
$("#pullbar").addEventListener("click", () => stats.open());

/**
 * While a panel is up, everything behind it holds still (the liquid, the marquee, the drift),
 * so the panel itself gets the whole frame budget: no jank on the way up or down.
 */
function panelProgress(name, p) {
  panelsUp.set(name, p);
  const up = [...panelsUp.values()].some((v) => v > 0.02);
  if (up === document.body.classList.contains("panel-up")) return;
  document.body.classList.toggle("panel-up", up);
  if (!up) liquid?.wake?.();
}

const mePanel = createPanel($("#panel-me"), {
  onOpen: () => {
    feel("open", "medium");
    checkAccounts();
  },
  onClose: () => feel("close", "light"),
  onProgress: (p) => panelProgress("me", p),
});
$("#me").addEventListener("click", () => {
  renderMe(); // built before it moves
  mePanel.open();
});
$("#panel-me [data-close]").addEventListener("click", () => mePanel.close());
/**
 * After an account change, redraw only the parts of You that depend on it (never the whole
 * panel: a lever you're holding mustn't vanish under your finger).
 */
function refreshMe() {
  if (!mePanel.isOpen) return;
  $("#me-safe")?.replaceWith(safeSection());
  if (!document.querySelector(".lever.held")) $("#me-levers")?.replaceWith(leversSection());
  $("#me-title").textContent = state.name ? state.name.toUpperCase().slice(0, 14) : "YOU";
  const who = $(".me-name");
  if (who) who.textContent = state.name || "Anonymous reader";
  const handle = $("#me-handle");
  if (handle) handle.textContent = handleText();
}
// One tap opens your stats; keep tapping and something else happens.
let lcdTimer = 0;
$("#lcd").addEventListener("click", () => {
  clearTimeout(lcdTimer);
  if (lcdTaps()) return;
  lcdTimer = setTimeout(() => stats.open(), 320);
});
$("#panel-stats [data-close]").addEventListener("click", () => stats.close());

function renderStats({ quiet = false } = {}) {
  const lp = S.levelProgress(state.xp);
  const wk = S.week(state);
  const top = Math.max(state.goal, ...wk.map((d) => d.pages));
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  const tile = (cls, ...kids) => h("div", { class: `tile ${cls}` }, ...kids);
  const num = (n, cls = "big") => h("b", { class: cls, "data-n": String(n), text: fmt(n) });
  const year = new Date().getFullYear();
  fill($("#stats-body"),
    h(
      "div",
      { class: "bento" },
      tile("t-level span2", h("small", { text: "LEVEL" }), h("b", { class: "huge", "data-n": String(lp.level), "data-pad": "2", text: String(lp.level).padStart(2, "0") }), h("span", { class: "t-title", text: lp.title.toUpperCase() }), h("span", { class: "t-bar" }, h("i", { vars: { width: `${(lp.frac * 100).toFixed(1)}%` } })), h("small", { class: "t-foot", text: `${fmt(lp.into)} / ${fmt(lp.need)} XP TO LV${lp.level + 1}` })),
    ),
    h("h3", { class: "p-h", text: "GOALS" }),
    h("p", { class: "p-note", text: "SPIN A RING TO SET THE GOAL" }),
    h(
      "div",
      { class: "bento" },
      goalDial({ kind: "day", label: "TODAY", unit: "PAGES", value: S.pagesOn(state), target: state.goal, cls: "t-dial-day" }),
      goalDial({ kind: "month", label: new Date().toLocaleDateString("en-GB", { month: "long" }).toUpperCase(), unit: "BOOKS", value: S.finishedIn(state, "month"), target: state.goalMonth, cls: "t-dial-month" }),
      goalDial({ kind: "year", label: String(year), unit: "BOOKS", value: S.finishedIn(state, "year"), target: state.goalYear, cls: "t-dial-year span2", wide: true }),
    ),
    h("h3", { class: "p-h", text: "NUMBERS" }),
    h(
      "div",
      { class: "bento" },
      tile("t-streak", h("small", { text: "STREAK" }), num(S.streak(state)), h("span", { class: "t-foot", text: "🔥 DAYS IN A ROW" })),
      tile("t-books", h("small", { text: "BOOKS READ" }), num(S.finishedCount(state)), h("span", { class: "t-foot", text: "ALL TIME" })),
      tile(
        "t-week span2",
        h("small", { text: `THIS WEEK · ${fmt(wk.reduce((a, d) => a + d.pages, 0))} PAGES` }),
        h(
          "div",
          { class: "wbars" },
          wk.map((d, i) => h("span", { class: `wb${d.pages >= state.goal ? " hit" : ""}${i === 6 ? " today" : ""}`, vars: { "--h": `${Math.max(4, (d.pages / top) * 100)}%`, "--i": i } }, h("i"), h("small", { text: names[new Date(`${d.day}T12:00`).getDay()] }))),
        ),
      ),
      tile("t-pages", h("small", { text: "PAGES READ" }), num(S.totalPages(state)), h("span", { class: "t-foot", text: `${fmt(S.pagesIn(state, "month"))} THIS MONTH` })),
      tile("t-xp", h("small", { text: "TOTAL XP" }), num(state.xp)),
      tile("t-eggs span2", h("small", { text: "EASTER EGGS FOUND" }), num(state.eggs.length), h("span", { class: "t-foot", text: "DOUBLE-TAP COVERS. TAP THE SCREEN UP TOP 5×. KONAMI." })),
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
  );
  statsDirty = false;
  if (!quiet && !prefersReducedMotion()) {
    // Only what's on screen first rises in (after the panel has mostly arrived), and numbers roll up.
    [...$("#stats-body").querySelectorAll(".tile")].slice(0, 5).forEach((t, i) => t.animate([{ transform: "translateY(18px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 160 + 70 * i, easing: "cubic-bezier(.22,1.2,.36,1)", fill: "backwards" }));
    $("#stats-body").querySelectorAll("[data-n]").forEach((el) => countUp(el));
  }
}

/** Numbers roll up from zero when the stats open. */
function countUp(el) {
  const to = Number(el.dataset.n);
  const pad = Number(el.dataset.pad || 0);
  if (!Number.isFinite(to) || to <= 0) return;
  const t0 = performance.now();
  const dur = 700 + Math.min(600, to * 3);
  const step = (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / dur));
    const v = Math.round(to * (1 - Math.pow(1 - k, 4)));
    el.textContent = pad ? String(v).padStart(pad, "0") : fmt(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function toggleKey(emoji, label, pref) {
  const k = key(emoji, `k-cream toggle${fx[pref] ? " on" : ""}`, () => {
    fx.set(pref, !fx[pref]);
    k.classList.toggle("on", fx[pref]);
    k.setAttribute("aria-pressed", String(fx[pref]));
    k.querySelector("small").textContent = `${label} ${fx[pref] ? "ON" : "OFF"}`;
    if (fx[pref]) feel("pop", "success");
  }, { sub: `${label} ${fx[pref] ? "ON" : "OFF"}`, aria: label.toLowerCase() });
  k.setAttribute("aria-pressed", String(fx[pref]));
  return k;
}

/**
 * A goal ring, watch-face style: the arc is your progress, the handle is the goal. Drag the
 * ring round (or use the arrow keys) to set it.
 */
function goalDial({ kind, label, unit, value, target, cls, wide = false }) {
  const [lo, hi] = S.GOAL_LIMITS[kind];
  const step = kind === "day" ? 5 : 1;
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
  const num = h("b", { class: "dial-n", text: String(value) });
  const of = h("small", { class: "dial-of" });
  const foot = h("small", { class: "t-foot" });
  const el = h(
    "div",
    { class: `tile t-dial tile-dial ${cls}`, role: "slider", tabIndex: 0, "aria-label": `${label} goal, ${unit.toLowerCase()}`, "aria-valuemin": String(lo), "aria-valuemax": String(hi), "data-kind": kind },
    h("div", { class: "dial-wrap" }, svgEl, h("span", { class: "dial-in" }, num, of)),
    h("div", { class: "dial-side" }, h("small", { class: "dial-label", text: label }), wide ? h("b", { class: "big", text: `${value}/${target}` }) : null, foot),
  );
  let goal = target;
  const paint = () => {
    const frac = Math.min(1, value / goal);
    arc.style.strokeDashoffset = String(C * (1 - frac));
    const a = ((goal - lo) / (hi - lo)) * 2 * Math.PI * 0.97;
    handle.setAttribute("cx", String(60 + Math.sin(a) * R));
    handle.setAttribute("cy", String(60 - Math.cos(a) * R));
    of.textContent = `/ ${goal}`;
    const left = Math.max(0, goal - value);
    const u = left === 1 ? unit.replace(/S$/, "") : unit;
    foot.textContent = left ? `${left} ${u} TO GO` : `GOAL DONE ✓`;
    if (wide) el.querySelector(".big").textContent = `${value}/${goal}`;
    el.setAttribute("aria-valuenow", String(goal));
    el.setAttribute("aria-valuetext", `${value} of ${goal} ${unit.toLowerCase()}`);
    el.classList.toggle("done", value >= goal);
  };
  paint();
  let d = null;
  const at = (e) => {
    const r = svgEl.getBoundingClientRect();
    let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    if (a < 0) a += 2 * Math.PI;
    const raw = lo + (a / (2 * Math.PI * 0.97)) * (hi - lo);
    return clamp(Math.round(raw / step) * step, lo, hi);
  };
  const save = () => {
    if (goal === { day: state.goal, month: state.goalMonth, year: state.goalYear }[kind]) return;
    commit(S.setGoal(state, goal, kind), null, { keepStats: true });
    feel("snap", "success");
    island.say({ icon: "🎯", title: `${label} GOAL: ${goal} ${unit}`, tone: "lime", buzz: false });
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    d = e.pointerId;
    el.setPointerCapture(d);
    el.classList.add("grab");
    feel("pop", "light");
  });
  el.addEventListener("pointermove", (e) => {
    if (d !== e.pointerId) return;
    const g = at(e);
    if (g !== goal) {
      goal = g;
      feel("detent", "tick");
      paint();
    }
  });
  const up = (e) => {
    if (d !== e.pointerId) return;
    d = null;
    el.classList.remove("grab");
    save();
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("keydown", (e) => {
    const k = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[e.key];
    if (!k) return;
    e.preventDefault();
    goal = clamp(goal + k, lo, hi);
    feel("detent", "tick");
    paint();
    save();
  });
  return el;
}

/* ---------------- reset ---------------- */

async function resetFlow() {
  // The lever was the "are you sure?". With a backup, say what to reset; then type to confirm.
  const cloud = account?.on ? "account" : sync.on ? "sync" : null;
  let scope = "phone";
  if (cloud) {
    scope = await popup({
      tone: "orange",
      icon: "🧨",
      title: "RESET WHAT?",
      text: cloud === "account" ? `Your books are on this phone and backed up to your account (${account.user}).` : "Your books are on this phone and synced to your other devices with a code.",
      actions: [
        { id: "cancel", label: "CANCEL", cancel: true },
        { id: "phone", label: "JUST THIS PHONE" },
        { id: "all", label: cloud === "account" ? "PHONE + BACKUP" : "EVERY DEVICE", primary: true },
      ],
    });
    if (scope !== "phone" && scope !== "all") return;
  }
  const what =
    scope === "all"
      ? cloud === "account"
        ? "Every book, page, goal, XP, badge and sticker, on this phone and in your account backup. Your other devices empty too when they next sync. You stay logged in."
        : "Every book, page, goal, XP, badge and sticker, here and on every device linked with your sync code."
      : cloud === "account"
        ? "Everything on this phone, and you'll be logged out here. Your account backup stays: log in again any time to bring it back."
        : cloud === "sync"
          ? "Everything on this phone, and sync is switched off here. Your other devices keep their copy."
          : "Every book, page, goal, XP, badge and sticker on this phone. There's no backup, so it can't come back.";
  const res = await popup({
    tone: "danger",
    danger: true,
    icon: "⚠",
    title: "THIS CAN'T BE UNDONE",
    body: h(
      "div",
      { class: "danger-body" },
      h("p", { class: "danger-text", text: `Once it's deleted, it's gone for good. ${what}` }),
      h("p", { class: "pop-text" }, "To reset, type ", h("b", { class: "danger-word", text: "reset" }), " below."),
    ),
    input: { placeholder: "type reset", max: 12, label: "Type reset to confirm", match: (v) => v.trim().toLowerCase() === "reset" },
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "reset", label: "DELETE IT", primary: true, danger: true },
    ],
    sound: "error",
  });
  if (res.id !== "reset") return;
  mePanel.close();
  stats.close();
  if (scope === "all") {
    // Mark the reset and send it up before anything else, so every copy empties.
    state = { ...S.reset(), toured: true, name: state.name, nameAt: state.nameAt };
    try {
      localStorage.setItem(S.KEY, JSON.stringify(state));
    } catch {}
    island.say({ icon: "🧹", title: "RESETTING EVERYWHERE…", tone: "violet", buzz: false });
    await (cloud === "account" ? account.now() : sync.now()).catch(() => {});
    return wipeDevice({ reset: true, keepLink: true });
  }
  if (account?.on) await account.logout().catch(() => {});
  wipeDevice({ reset: true });
}

/**
 * Gone: this device's shelves, sync link, tour and tips. Sound/haptic preferences stay.
 * A reset (`reset: true`) also marks the moment, so an older copy synced from elsewhere can't
 * bring the books back. Clearing after logging out doesn't: logging in again brings them back.
 */
function wipeDevice({ reset = false, keepLink = false } = {}) {
  if (!keepLink) sync.disable();
  try {
    // You already know the gestures, so the tour stays seen; the name and import offer come back.
    const keep = new Set(["shelfie.fx", TOUR, ...(keepLink ? ["shelfie.sync"] : [])]);
    for (const k of Object.keys(localStorage)) if (k === S.KEY || k.startsWith(`${S.KEY}.`) || (k.startsWith("shelfie.") && !keep.has(k))) localStorage.removeItem(k);
    // Reset everywhere: the reset state already went up; keep exactly that one.
    // You still know your way around: the tour and tips you've seen stay seen.
    const next = keepLink ? state : { ...(reset ? S.reset() : S.empty()), toured: true, guide: state.guide };
    localStorage.setItem(S.KEY, JSON.stringify(next));
    sessionStorage.setItem("shelfie.fresh", "1");
  } catch {}
  stats.close();
  feel("drop", "error");
  // A light sweep (not a heavy shake of the whole page), then a fresh start.
  rain({ count: 50, emoji: ["💨", "🧹"] });
  setTimeout(() => location.reload(), 1100);
}

/* ---------------- Goodreads import ---------------- */

const imp = createPanel($("#panel-import"), {
  onProgress: (p) => panelProgress("import", p),
  onOpen: () => {
    feel("open", "medium");
    showImportStart();
  },
  onClose: () => feel("close", "light"),
});
$("#panel-import [data-close]").addEventListener("click", () => imp.close());
function openImport() {
  if (stats.isOpen) stats.close();
  if (add.isOpen) add.close();
  setTimeout(() => imp.open(), 200);
}

/** replaceChildren, skipping the null / false left by optional parts. */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
}

function showImportStart(error = "") {
  const file = h("input", { type: "file", accept: ".csv,text/csv", hidden: true, id: "gr-file", on: { change: (e) => e.target.files?.[0] && readExport(e.target.files[0]) } });
  const drop = h("label", { class: "gr-drop", for: "gr-file" }, h("span", { class: "gr-drop-icon", text: "📄" }), h("b", { text: "PICK YOUR EXPORT" }), h("small", { text: "goodreads_library_export.csv" }), file);
  drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("over")));
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) readExport(f);
  });
  const step = (n, title, text, extra = null) => h("li", { class: "gr-step" }, h("span", { class: "gr-n", text: String(n) }), h("div", {}, h("b", { text: title }), h("p", { text }), extra));
  fill($("#import-body"),
    h("p", { class: "gr-lede", text: "Three steps, a couple of minutes. Your reading history, ratings and dates come with you." }),
    h(
      "ol",
      { class: "gr-steps" },
      step(1, "OPEN GOODREADS IN A BROWSER", "The export lives on the website (not the Goodreads app). Sign in, then open My Books → Import and export.", h("a", { class: "gr-link", href: "https://www.goodreads.com/review/import", target: "_blank", rel: "noopener noreferrer", text: "OPEN GOODREADS EXPORT ↗" })),
      step(2, "TAP “EXPORT LIBRARY”", "Goodreads prepares a file. Big libraries can take a few minutes; refresh that page until the download link appears."),
      step(3, "PICK THE FILE HERE", "It's called goodreads_library_export.csv, usually in Downloads (or Files → Downloads on iPhone)."),
    ),
    drop,
    error ? h("p", { class: "gr-error", role: "alert", text: error }) : null,
    h("p", { class: "p-note", text: "🔒 THE FILE IS READ ON YOUR DEVICE AND NEVER UPLOADED." }),
  );
}

async function readExport(fileObj) {
  if (fileObj.size > 15 * 1024 * 1024) return showImportStart("That file is bigger than a Goodreads export should be (15 MB max).");
  let parsed;
  try {
    parsed = fromGoodreads(await fileObj.text());
  } catch (err) {
    feel("error", "error");
    return showImportStart(String(err.message || err));
  }
  const { books, counts } = parsed;
  if (!books.length) return showImportStart("No books found in that file.");
  feel("sparkle", "success");
  let ratings = true;
  const total = h("b", { class: "gr-total", "data-n": String(books.length), text: fmt(books.length) });
  const stat = (n, label, cls) => h("span", { class: `gr-stat ${cls}` }, h("b", { text: fmt(n) }), h("small", { text: label }));
  const already = books.filter((b) => state.books.some((x) => (b.isbn && x.isbn === b.isbn) || x.title.toLowerCase() === b.title.toLowerCase())).length;
  const toggle = h("button", { type: "button", class: "gr-toggle on", "aria-pressed": "true", text: "✓ BRING MY STAR RATINGS (AS FEELINGS)" });
  toggle.addEventListener("click", () => {
    ratings = !ratings;
    toggle.classList.toggle("on", ratings);
    toggle.setAttribute("aria-pressed", String(ratings));
    toggle.textContent = `${ratings ? "✓" : "○"} BRING MY STAR RATINGS (AS FEELINGS)`;
    feel("snap", "select");
  });
  const go = key("BRING THEM IN", "k-lime wide", () => doImport(books, ratings), { sub: `${fmt(books.length - already)} BOOKS` });
  fill($("#import-body"),
    h("div", { class: "gr-found" }, h("small", { text: "FOUND IN YOUR EXPORT" }), total, h("span", { text: books.length === 1 ? "BOOK" : "BOOKS" })),
    h("div", { class: "gr-stats" }, stat(counts.read, "READ", "read"), stat(counts.reading, "READING", "reading"), stat(counts.want, "WANT", "want")),
    already ? h("p", { class: "p-note", text: `${already} ALREADY ON YOUR SHELVES WILL BE SKIPPED.` }) : null,
    h("p", { class: "sync-text", text: "Read books keep their finish dates, so this year's count and your yearly goal are right straight away. Custom shelves land on Want. Covers come from Open Library by ISBN." }),
    toggle,
    h("div", { class: "keys one" }, go),
  );
  if (!prefersReducedMotion()) countUp(total);
}

function doImport(books, ratings) {
  const input = ratings ? books : books.map((b) => ({ ...b, rating: 0 }));
  const r = S.importBooks(state, input);
  const ev = r.events.find((e) => e.type === "imported");
  imp.close();
  commit(r, deckEl);
  if (!ev?.added) return island.say({ icon: "🤷", title: "NOTHING NEW", sub: "Every book was already on your shelves", tone: "sun" });
  queuePoster({
    kicker: `${fmt(ev.added)} BOOKS · ${fmt(ev.counts.read)} READ`,
    lines: ["WELCOME", state.name ? `HOME, ${state.name.toUpperCase().slice(0, 10)}.` : "HOME."],
    sub: ev.skipped ? `${ev.skipped} already here, skipped.` : "Your whole library, moved in.",
    tone: "#ff6ad5",
    ink: "#0d0d0d",
    emoji: ["📚", "🧳", "🏠", "⭐"],
    sounds: ["fanfare", "levelup"],
  });
  const where = ev.counts.reading ? "reading" : ev.counts.read ? "read" : "want";
  setTimeout(() => (where !== shelf ? switchShelf(where) : renderShelf({ deal: 1 })), 300);
}

/* ---------------- sync ---------------- */

const apiBase = (document.querySelector('meta[name="api-base"]')?.content || "").trim().replace(/\/$/, "");
let linking = false;
let revealCode = false;

const sync = (syncRef = createSync({
  base: apiBase,
  get: () => state,
  put: (next) => applyIncoming(next),
  merge: S.merge,
  onStatus: () => {
    if (mePanel.isOpen) {
      $("#sync-tile")?.replaceWith(syncTile());
      $("#safe-strip")?.replaceWith(safeStrip());
    }
    $("#lcd").classList.toggle("synced", sync.on && sync.status.state === "idle");
  },
}));

/** A copy arrived (another tab, or sync): fold it in and redraw if anything changed. */
function applyIncoming(next) {
  const merged = S.merge(state, next);
  if (JSON.stringify(merged) === JSON.stringify(S.merge(state, state))) return;
  const wasEmpty = !S.shelf(state, shelf).length;
  state = S.save(globalThis.localStorage, merged);
  renderHud();
  if (deck.dragging || live) return;
  // Books arriving on an empty shelf get dealt in, so you see them straight away.
  if (wasEmpty && S.shelf(state, shelf).length) renderShelf({ deal: 1 });
  else renderShelf();
}

const ago = (t) => {
  if (!t) return "NOT YET";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "JUST NOW";
  if (s < 3600) return `${Math.round(s / 60)} MIN AGO`;
  if (s < 86400) return `${Math.round(s / 3600)} H AGO`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
};

function syncTile() {
  const st = sync.status;
  const body = [];
  if (!apiBase) body.push(h("p", { class: "sync-text", text: "Sync needs Shelfie's Worker. Set api-base in index.html." }));
  else if (!sync.on && !linking) {
    body.push(
      h("p", { class: "sync-text", text: "Right now your shelves live only in this browser. On iPhone, Safari and the home-screen app each keep a separate copy, and either can be cleared by the phone." }),
      h("p", { class: "sync-text", text: "Sync keeps one copy everywhere, encrypted on your device with a code only you hold." }),
      h(
        "div",
        { class: "keys two" },
        key("ON", "k-blue wide", async () => {
          await sync.enable();
          revealCode = true;
          renderSyncTile();
          feel("levelup", "success");
          burst($("#sync-tile"), { count: 60 });
        }, { sub: "TURN ON SYNC" }),
        key("🔑", "k-cream", () => {
          linking = true;
          renderSyncTile();
          setTimeout(() => $("#sync-code")?.focus(), 50);
        }, { sub: "I HAVE A CODE" }),
      ),
    );
  } else if (!sync.on && linking) {
    const input = h("input", { id: "sync-code", type: "text", inputmode: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", "aria-label": "Sync code" });
    const msg = h("p", { class: "sync-text warn", role: "alert" });
    const go = async () => {
      msg.textContent = "LINKING…";
      try {
        await sync.link(input.value);
        linking = false;
        renderSyncTile();
        feel("fanfare", "celebrate");
        rain({ count: 120, emoji: ["🔗", "📚"] });
        island.say({ icon: "🔗", title: "LINKED", sub: `${state.books.length} books on this shelf now`, tone: "lime" });
      } catch (err) {
        feel("error", "error");
        msg.textContent = String(err.message || err).toUpperCase();
      }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
    body.push(
      h("p", { class: "sync-text", text: "Type or paste the code from your other device (Stats → Sync & backup)." }),
      h("label", { class: "lcd-input" }, h("span", { "aria-hidden": "true", text: "🔑" }), input),
      msg,
      h("div", { class: "keys two" }, key("LINK", "k-blue wide", go, { sub: "MERGE THE SHELVES" }), key("✕", "k-cream", () => ((linking = false), renderSyncTile()), { sub: "CANCEL" })),
    );
  } else {
    const code = sync.code;
    const shown = revealCode ? prettyCode(code) : `${code.slice(0, 4)}-••••-••••-••••-••••-••••`;
    const state_ = st.state === "syncing" ? "SYNCING…" : st.state === "error" ? `⚠ ${st.error}`.toUpperCase() : `SYNCED ${ago(st.at)}`;
    body.push(
      h("p", { class: "sync-status" + (st.state === "error" ? " warn" : ""), text: state_ }),
      h("small", { class: "p-label", text: "YOUR SYNC CODE" }),
      h("button", { type: "button", class: "sync-code", "aria-label": revealCode ? `Sync code ${code.split("").join(" ")}. Tap to hide` : "Show sync code", on: { click: () => ((revealCode = !revealCode), renderSyncTile(), feel("flip", "light")) } }, shown),
      h("p", { class: "sync-text", text: "Treat it like a password: anyone with it can see and change your shelves. To use them in the home-screen app or on another device, open Stats there → I have a code." }),
      h(
        "div",
        { class: "keys three" },
        key("⧉", "k-cream", async () => {
          try {
            await navigator.clipboard.writeText(prettyCode(code));
            island.say({ icon: "📋", title: "CODE COPIED", sub: "Paste it in the other app", tone: "lime", buzz: false });
            feel("pop", "success");
          } catch {
            revealCode = true;
            renderSyncTile();
          }
        }, { sub: "COPY" }),
        key("↻", "k-blue", () => sync.now(), { sub: "SYNC NOW" }),
        key("⏻", "k-red", () => {
          if (!confirm("Turn off sync on this device? Your shelves stay here; the synced copy stays for your other devices.")) return;
          sync.disable();
          revealCode = false;
          renderSyncTile();
        }, { sub: "TURN OFF" }),
      ),
    );
  }
  return h("div", { class: "tile t-sync span2", id: "sync-tile" }, h("small", { text: sync.on ? "🔒 END-TO-END ENCRYPTED SYNC: ON" : "🔒 END-TO-END ENCRYPTED SYNC" }), ...body);
}

function renderSyncTile() {
  $("#sync-tile")?.replaceWith(syncTile());
}

/* ---------------- accounts ---------------- */

// null until we've asked the Worker; then true or false.
let accountsUp = null;
async function checkAccounts() {
  if (accountsUp !== null || !apiBase) return accountsUp;
  try {
    const r = await fetch(`${apiBase}/api/health`, { credentials: "omit", cache: "no-store" });
    accountsUp = !!(await r.json())?.accounts;
  } catch {
    return null; // try again next time
  }
  refreshMe();
  return accountsUp;
}

account = createAccount({
  base: apiBase,
  get: () => state,
  put: (next) => applyIncoming(next),
  merge: S.merge,
  onStatus: () => {
    renderAccountTile();
    $("#lcd").classList.toggle("synced", (account?.on && account.status.state === "idle") || (sync.on && sync.status.state === "idle"));
  },
  onSignedOut: () => island.say({ icon: "🔒", title: "LOGGED OUT", sub: "Your session ended. Log in again to keep backing up.", tone: "violet" }),
  // A device that was reset remembers when, so an older synced copy can't undo the reset. But
  // logging in means "bring my account's books here": forget the marker first, or the merge
  // would empty the account. Books added since the reset are kept.
  onJoin: () => {
    if (!state.resetAt) return;
    state = { ...state, resetAt: 0 };
    try {
      localStorage.setItem(S.KEY, JSON.stringify(state));
    } catch {}
  },
});

function renderAccountTile() {
  if (mePanel.isOpen) {
    $("#account-tile")?.replaceWith(accountTile());
    $("#safe-strip")?.replaceWith(safeStrip());
  }
}

function accountTile() {
  const st = account.status;
  if (accountsUp === false && !account.on) return null;
  const body = [];
  if (!account.on) {
    body.push(
      h("p", { class: "sync-text", text: "Back up your shelves and open them on any device: phone, laptop, the home-screen app. Encrypted on this device with your password, so not even Shelfie can read your books, and your password never leaves your phone." }),
      h(
        "div",
        { class: "keys two" },
        key("SIGN UP", "k-lime wide", () => signupFlow(), { sub: "FREE, NO EMAIL NEEDED", aria: "Create an account" }),
        key("🔐", "k-cream", () => loginFlow(), { sub: "LOG IN", aria: "Log in" }),
      ),
      h("button", { type: "button", class: "link-btn", text: "FORGOT YOUR PASSWORD?", on: { click: () => recoverFlow() } }),
    );
  } else {
    const line = st.state === "syncing" ? "BACKING UP…" : st.state === "error" ? `⚠ ${st.error}`.toUpperCase() : `BACKED UP ${ago(st.at)}`;
    body.push(
      h("p", { class: "acct-who" }, h("span", { text: "👤" }), h("b", { text: account.user })),
      h("p", { class: "sync-status" + (st.state === "error" ? " warn" : ""), text: line }),
      h(
        "div",
        { class: "keys three" },
        key("↻", "k-blue", () => account.now(), { sub: "SYNC NOW", aria: "Back up now" }),
        key("🔑", "k-cream", () => passwordFlow(), { sub: "PASSWORD", aria: "Change password" }),
        key("⏻", "k-cream", () => logoutFlow(), { sub: "LOG OUT", aria: "Log out" }),
      ),
      h(
        "div",
        { class: "acct-more" },
        h("button", { type: "button", class: "link-btn", text: "NEW RECOVERY CODE", on: { click: () => newRecoveryFlow() } }),
        h("button", { type: "button", class: "link-btn", text: "CHANGE USERNAME", on: { click: () => renameFlow() } }),
        h("button", { type: "button", class: "link-btn", text: "LOG OUT EVERYWHERE", on: { click: () => logoutFlow({ all: true }) } }),
      ),
    );
  }
  return h("div", { class: `tile t-account span2${account.on ? " on" : ""}`, id: "account-tile" }, h("small", { text: account.on ? "🔒 YOUR ACCOUNT · END-TO-END ENCRYPTED" : "🔒 ACCOUNT · END-TO-END ENCRYPTED" }), ...body);
}

/** The strength bar under a new password. */
function meter() {
  const el = h("div", { class: "pw-meter", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("small", { text: "" }));
  const words = ["TOO WEAK", "WEAK", "OKAY", "GOOD", "STRONG"];
  el.update = (pw) => {
    const n = pw ? strength(pw) : -1;
    el.dataset.n = String(n);
    el.querySelector("small").textContent = n < 0 ? "10+ CHARACTERS. A FEW RANDOM WORDS WORK GREAT." : words[n];
  };
  el.update("");
  return el;
}

const LOGIN_FIELD = { name: "login", placeholder: "Username or email", autocomplete: "username", label: "Username or email", max: 254, inputmode: "email" };

async function signupFlow() {
  if (!(await checkAccounts())) return notReady();
  const m = meter();
  const res = await popup({
    tone: "lime",
    icon: "🔐",
    title: "MAKE AN ACCOUNT",
    text: "Pick a username (or use your email; we never send you anything). Your password locks your shelves on this device before anything is backed up.",
    after: m,
    fields: [LOGIN_FIELD, { name: "password", type: "password", placeholder: "Password", autocomplete: "new-password", label: "New password" }, { name: "again", type: "password", placeholder: "Password again", autocomplete: "new-password", label: "Password again", enter: "done" }],
    onInput: (v) => m.update(v.password),
    actions: [
      { id: "cancel", label: "NOT NOW", cancel: true },
      { id: "go", label: "CREATE", primary: true, busy: "LOCKING…" },
    ],
    submit: async (v) => {
      const login = cleanLogin(v.login);
      if (!login) throw new Error("Use a username (3 to 32 letters, numbers, dots, dashes or underscores) or an email address.");
      const problem = passwordProblem(v.password, login);
      if (problem) throw new Error(problem);
      if (v.password !== v.again) throw new Error("The two passwords don't match.");
      return account.signup(login, v.password);
    },
  });
  if (res.id !== "go") return;
  if (sync.on) sync.disable(); // the account takes over from the sync code
  feel("levelup", "success");
  rain({ count: 120, emoji: ["🔐", "📚", "✨"] });
  await showRecovery(res.result);
  island.say({ icon: "🔐", title: "ACCOUNT MADE", sub: `${state.books.length} books backed up, encrypted`, tone: "lime" });
  refreshMe();
}

/** The recovery code, once. Confirmed by typing its last four characters. */
async function showRecovery(code) {
  const last = code.slice(-4);
  const copy = h("button", { type: "button", class: "install-go quiet", text: "⧉ COPY" });
  const save = h("button", { type: "button", class: "install-go quiet", text: "💾 SAVE AS FILE" });
  save.addEventListener("click", () => {
    const blob = new Blob([`Shelfie recovery code for ${account?.user || "your account"}\n\n${code}\n\nKeep it somewhere safe. With your username, it sets a new password if you forget yours.\n`], { type: "text/plain" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "shelfie-recovery-code.txt" });
    document.body.append(a);
    a.click();
    a.remove();
    save.textContent = "SAVED ✓";
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "COPIED ✓ NOW PASTE IT SOMEWHERE SAFE";
    } catch {
      copy.textContent = "WRITE IT DOWN INSTEAD";
    }
  });
  await popup({
    tone: "yellow",
    icon: "🛟",
    title: "YOUR RECOVERY CODE",
    body: h(
      "div",
      { class: "danger-body" },
      h("p", { class: "pop-text", text: "If you ever forget your password, this code is the only way back in. We can't reset it for you: we can't read your account, that's the point." }),
      h("p", { class: "recovery-code", text: code }),
      h("div", { class: "install-actions two" }, copy, save),
      h("p", { class: "pop-text", text: "Keep it in your password manager, notes, or that file. To make sure you've got it, type the last 4 characters of the code above. (Lose it later? Make a new one any time in You → Account.)" }),
    ),
    input: { placeholder: "Last 4 characters", max: 4, label: "Last four characters of the recovery code", capitalize: "characters", match: (v) => v.trim().toUpperCase() === last },
    actions: [{ id: "ok", label: "I'VE SAVED IT", primary: true }],
    dismissable: false,
  });
}

async function loginFlow() {
  if (!(await checkAccounts())) return notReady();
  const res = await popup({
    tone: "cyan",
    icon: "👋",
    title: "WELCOME BACK",
    text: "Log in and your shelves join the ones on this device (nothing here is lost).",
    fields: [LOGIN_FIELD, { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "go" }],
    actions: [
      { id: "forgot", label: "FORGOT?" },
      { id: "go", label: "LOG IN", primary: true, busy: "UNLOCKING…" },
    ],
    submit: (v) => account.login(v.login, v.password),
  });
  if (res.id === "forgot") return recoverFlow();
  if (res.id !== "go") return;
  if (sync.on) sync.disable();
  feel("fanfare", "celebrate");
  rain({ count: 100, emoji: ["📚", "🔓"] });
  island.say({ icon: "🔓", title: `HI ${account.user.split("@")[0].toUpperCase().slice(0, 14)}`, sub: `${state.books.length} books on your shelves`, tone: "lime" });
  refreshMe();
}

async function recoverFlow() {
  if (!(await checkAccounts())) return notReady();
  const m = meter();
  const res = await popup({
    tone: "orange",
    icon: "🛟",
    title: "FORGOT YOUR PASSWORD?",
    text: "Use the recovery code you saved when you made your account, and pick a new password. Other devices will be logged out.",
    after: m,
    fields: [
      LOGIN_FIELD,
      { name: "code", placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", label: "Recovery code", capitalize: "characters", max: 40 },
      { name: "password", type: "password", placeholder: "New password", autocomplete: "new-password", label: "New password" },
      { name: "again", type: "password", placeholder: "New password again", autocomplete: "new-password", label: "New password again", enter: "done" },
    ],
    onInput: (v) => m.update(v.password),
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "RESET IT", primary: true, busy: "UNLOCKING…" },
    ],
    submit: async (v) => {
      if (v.password !== v.again) throw new Error("The two passwords don't match.");
      return account.recover(v.login, v.code, v.password);
    },
  });
  if (res.id !== "go") return;
  if (sync.on) sync.disable();
  feel("fanfare", "celebrate");
  island.say({ icon: "🛟", title: "NEW PASSWORD SET", sub: "Your recovery code still works", tone: "lime" });
  refreshMe();
}

async function passwordFlow() {
  const m = meter();
  const res = await popup({
    tone: "lime",
    icon: "🔑",
    title: "CHANGE PASSWORD",
    text: "Your other devices will be logged out. Your recovery code stays the same.",
    after: m,
    fields: [
      { name: "user", type: "text", value: account.user, autocomplete: "username", label: "Username", max: 254 },
      { name: "old", type: "password", placeholder: "Current password", autocomplete: "current-password", label: "Current password" },
      { name: "password", type: "password", placeholder: "New password", autocomplete: "new-password", label: "New password" },
      { name: "again", type: "password", placeholder: "New password again", autocomplete: "new-password", label: "New password again", enter: "done" },
    ],
    onInput: (v) => m.update(v.password),
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "CHANGE IT", primary: true, busy: "LOCKING…" },
    ],
    submit: async (v) => {
      if (v.password !== v.again) throw new Error("The two passwords don't match.");
      return account.changePassword(v.old, v.password);
    },
  });
  if (res.id === "go") island.say({ icon: "🔑", title: "PASSWORD CHANGED", sub: "Other devices were logged out", tone: "lime" });
}

async function logoutFlow({ all = false } = {}) {
  const choice = await popup({
    tone: "cream",
    icon: "⏻",
    title: all ? "LOG OUT EVERYWHERE?" : "LOG OUT?",
    text: all
      ? "Every device logs out, including this one. Your backup stays safe in your account."
      : "Your backup stays safe in your account. On a phone that isn't yours, clear this device too.",
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "clear", label: "LOG OUT & CLEAR" },
      { id: "out", label: "LOG OUT", primary: true },
    ],
  });
  if (choice !== "out" && choice !== "clear") return;
  await account.logout({ all });
  if (choice === "clear") return wipeDevice();
  island.say({ icon: "👋", title: "LOGGED OUT", sub: "Your shelves are still on this device", tone: "violet" });
  refreshMe();
}

async function deleteFlow() {
  const res = await popup({
    tone: "danger",
    danger: true,
    icon: "⚠",
    title: "DELETE YOUR ACCOUNT?",
    body: h(
      "div",
      { class: "danger-body" },
      h("p", { class: "danger-text", text: "This deletes your account and its backup for good. It can't be undone, and not even we can bring it back." }),
      h("p", { class: "pop-text", text: "Your shelves stay on this device. Enter your password to confirm." }),
    ),
    fields: [
      { name: "user", type: "text", value: account.user, autocomplete: "username", label: "Username", max: 254 },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "KEEP IT", cancel: true },
      { id: "go", label: "DELETE IT", primary: true, danger: true, busy: "DELETING…" },
    ],
    sound: "error",
    submit: (v) => account.deleteAccount(v.password),
  });
  if (res.id !== "go") return;
  feel("drop", "error");
  shake(document.body, 10);
  island.say({ icon: "🗑️", title: "ACCOUNT DELETED", sub: "Your shelves are still on this device", tone: "violet" });
  refreshMe();
}

/* ---------------- the ME panel ---------------- */

/** One tappable row: an icon, what it does, and a line saying what happens. */
function meRow(icon, title, text, onClick, { aria, tone = "", extra = null } = {}) {
  const b = h("button", { type: "button", class: `me-row${tone ? ` tone-${tone}` : ""}`, "aria-label": aria || title }, h("span", { class: "me-row-icon", "aria-hidden": "true", text: icon }), h("span", { class: "me-row-text" }, h("b", { text: title }), h("small", { text })), h("span", { class: "me-row-go", "aria-hidden": "true", text: "›" }), extra);
  b.addEventListener("click", (e) => {
    feel("click", "light");
    onClick(e);
  });
  return b;
}

/** A switch row for a preference. */
function switchRow(icon, title, text, pref) {
  const sw = h("span", { class: `switch${fx[pref] ? " on" : ""}`, "aria-hidden": "true" }, h("i"));
  const b = h("button", { type: "button", class: "me-row", role: "switch", "aria-checked": String(fx[pref]), "aria-label": title }, h("span", { class: "me-row-icon", "aria-hidden": "true", text: icon }), h("span", { class: "me-row-text" }, h("b", { text: title }), h("small", { text })), sw);
  b.addEventListener("click", () => {
    fx.set(pref, !fx[pref]);
    sw.classList.toggle("on", fx[pref]);
    b.setAttribute("aria-checked", String(fx[pref]));
    feel(fx[pref] ? "snap" : "click", "select");
  });
  return b;
}

/** Motion controls: switching on asks permission (in the tap), and shows the moves. */
function motionRow() {
  const sw = h("span", { class: `switch${fx.motion ? " on" : ""}`, "aria-hidden": "true" }, h("i"));
  const b = h("button", { type: "button", class: "me-row", role: "switch", "aria-checked": String(fx.motion), "aria-label": "MOTION CONTROLS" }, h("span", { class: "me-row-icon", "aria-hidden": "true", text: "📳" }), h("span", { class: "me-row-text" }, h("b", { text: "MOTION CONTROLS" }), h("small", { text: "Turn the phone sideways and back for the next book, twist for the next shelf, tip the top towards you to add. Tilt to play with the light." })), sw);
  b.addEventListener("click", () => {
    if (fx.motion) {
      fx.set("motion", false);
      gyro.stop();
      sw.classList.remove("on");
      b.setAttribute("aria-checked", "false");
      feel("click", "select");
      return;
    }
    motionInvite({ fromSettings: true });
  });
  return b;
}

/** Where your books are, in two plain lines. */
function safeStrip() {
  const n = state.books.length;
  const cloud = account?.on
    ? account.status.state === "error"
      ? ["⚠️", "BACKUP NEEDS ATTENTION", account.status.error, "warn"]
      : ["☁️", "BACKED UP TO YOUR ACCOUNT", account.status.state === "syncing" ? "Saving…" : `Encrypted · ${ago(account.status.at).toLowerCase()}`, "ok"]
    : sync.on
      ? ["🔗", "SYNCED WITH A CODE", `Encrypted · ${ago(sync.status.at).toLowerCase()}`, "ok"]
      : ["☁️", "NOT BACKED UP YET", "If this phone is lost or cleared, so are your books.", "warn"];
  const line = (icon, title, text, cls) => h("div", { class: `safe-line ${cls}` }, h("span", { class: "safe-dot", "aria-hidden": "true" }), h("span", { class: "safe-icon", "aria-hidden": "true", text: icon }), h("span", {}, h("b", { text: title }), h("small", { text })));
  return h("div", { class: "safe-strip", id: "safe-strip" }, line("📱", "ON THIS PHONE", `${fmt(n)} book${n === 1 ? "" : "s"} · always here, works offline`, "ok"), line(...cloud));
}

function renderMe() {
  const lp = S.levelProgress(state.xp);
  $("#me-title").textContent = state.name ? state.name.toUpperCase().slice(0, 14) : "YOU";
  const restore = h("input", { type: "file", accept: "application/json,.json", hidden: true, on: { change: importData } });
  fill(
    $("#me-body"),
    avatarPicker(),
    h(
      "div",
      { class: "me-id" },
      h("b", { class: "me-name", text: state.name || "Anonymous reader" }),
      h("span", { class: "me-handle", id: "me-handle" }, handleText()),
      h("small", { text: `LV${String(lp.level).padStart(2, "0")} · ${lp.title.toUpperCase()}` }),
      h(
        "div",
        { class: "me-id-links" },
        h("button", { type: "button", class: "link-btn", text: state.name ? "CHANGE NAME" : "ADD YOUR NAME", on: { click: () => askName({ edit: true }).then(refreshMe) } }),
        account?.on ? h("button", { type: "button", class: "link-btn", text: "CHANGE USERNAME", on: { click: () => renameFlow() } }) : null,
      ),
    ),

    h("h3", { class: "p-h", text: "YOUR BOOKS ARE SAFE" }),
    safeSection(),

    h("h3", { class: "p-h", text: "LIBRARY" }),
    h(
      "div",
      { class: "me-rows" },
      meRow("🧳", "IMPORT FROM GOODREADS", "Your whole library: read (with dates and ratings), reading, want to read.", () => {
        mePanel.close();
        setTimeout(openImport, 300);
      }),
      meRow("💾", "SAVE A COPY", "Download a file with everything. Handy for safekeeping; no account needed.", exportData, { aria: "Save a copy of your shelves to a file" }),
      meRow("📂", "RESTORE A COPY", "Pick a saved file. Its books are added; nothing here is deleted.", () => restore.click(), { aria: "Restore shelves from a file", extra: restore }),
    ),

    h("h3", { class: "p-h", text: "SETTINGS" }),
    h(
      "div",
      { class: "me-rows" },
      switchRow("🔊", "SOUND", "Clicks, pops and fanfares. Follows the iPhone silent switch.", "sound"),
      switchRow("📳", "HAPTICS", "Little taps you can feel.", "haptics"),
      switchRow("🦙", "VISITORS", "Animals that wander by now and then.", "visitors"),
      motionSupported() ? motionRow() : null,
      meRow("?", "HOW TO USE", "Replay the tour, or bring the explainer pop-ups back.", () => {
        mePanel.close();
        setTimeout(helpFlow, 320);
      }),
      canInstall() ? meRow("📲", "ADD TO HOME SCREEN", "Opens full-screen like an app. Two taps.", () => showInstall({ name: state.name }), { aria: "Add Shelfie to your home screen" }) : null,
    ),

    h("h3", { class: "p-h danger", text: "DANGER ZONE" }),
    leversSection(),
    chaiCard(state.name),
  );
}

function safeSection() {
  return h(
    "div",
    { id: "me-safe" },
    safeStrip(),
    accountTile(),
    // Sync codes: for anyone already using one, or while accounts aren't available.
    account?.on ? null : sync.on || accountsUp !== true ? syncTile() : null,
  );
}

function leversSection() {
  return h(
    "div",
    { class: "levers", id: "me-levers" },
    createLever({ label: "RESET", sub: "WIPE BOOKS, PAGES, XP", onPull: () => resetFlow() }),
    account?.on ? createLever({ label: "DELETE ACCOUNT", sub: "AND ITS BACKUP", tone: "violet", onPull: () => deleteFlow() }) : null,
  );
}

/** The face on the avatar button: your animal, or your initial, or a stand-in. */
function faceOf() {
  const animal = CRITTERS.find((c) => c.id === state.avatar);
  if (animal) return animal.e;
  const c = [...(state.name || "")][0];
  return c ? c.toUpperCase() : "👤";
}

/** "@username" when you're logged in. */
function handleText() {
  return account?.on ? `@${account.user}` : "NOT LOGGED IN";
}

/**
 * Your profile animal: a carousel of the visitors. Slide through them (or use the arrows);
 * whichever lands in the middle says hello in its own voice, and becomes you.
 */
function avatarPicker() {
  const options = [{ id: "", e: [...(state.name || "")][0]?.toUpperCase() || "👤", name: state.name ? "YOUR INITIAL" : "NO ANIMAL" }, ...CRITTERS.map((c) => ({ ...c, name: c.id.toUpperCase() }))];
  const label = h("small", { class: "ava-name", "aria-live": "polite" });
  const items = options.map((o, i) => h("button", { type: "button", class: `ava${o.id === state.avatar ? " on" : ""}`, "aria-label": `Be the ${o.id || "plain"} avatar`, "data-i": String(i) }, h("span", { text: o.e })));
  const strip = h("div", { class: "ava-strip", role: "listbox", "aria-label": "Choose your animal" }, items);
  let current = Math.max(0, options.findIndex((o) => o.id === (state.avatar || "")));
  label.textContent = options[current].name;

  // While sliding, the one in the middle grows (just a scale on a dozen small items).
  const lens = () => {
    const mid = strip.scrollLeft + strip.clientWidth / 2;
    for (const it of items) {
      const d = Math.min(1, Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid) / 140);
      it.style.transform = `scale(${(1.25 - d * 0.55).toFixed(3)})`;
      it.style.opacity = String((1 - d * 0.55).toFixed(2));
    }
  };
  const nearest = () => {
    const mid = strip.scrollLeft + strip.clientWidth / 2;
    let best = 0;
    items.forEach((it, i) => {
      if (Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid) < Math.abs(items[best].offsetLeft + items[best].offsetWidth / 2 - mid)) best = i;
    });
    return best;
  };
  const choose = (i) => {
    if (i === current) return;
    current = i;
    const o = options[i];
    label.textContent = o.name;
    items.forEach((it, j) => it.classList.toggle("on", j === i));
    commit(S.setAvatar(state, o.id), null, { keepStats: true });
    renderFace();
    feel(o.sound || "pop", "select");
    if (!prefersReducedMotion()) items[i].firstChild.animate([{ transform: "none" }, { transform: "translateY(-14px) rotate(-8deg)" }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.3,1.6,.5,1)" });
  };
  const go = (i, smooth = true) => {
    const it = items[Math.max(0, Math.min(items.length - 1, i))];
    strip.scrollTo({ left: it.offsetLeft + it.offsetWidth / 2 - strip.clientWidth / 2, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  };
  let settleTimer = 0;
  strip.addEventListener("scroll", () => {
    requestAnimationFrame(lens);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => choose(nearest()), 140);
  }, { passive: true });
  items.forEach((it, i) => it.addEventListener("click", () => (i === current ? feel(options[i].sound || "pop", "select") : go(i))));
  strip.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") (e.preventDefault(), go(current + 1));
    if (e.key === "ArrowLeft") (e.preventDefault(), go(current - 1));
  });
  // Start centred on your animal (once it's on the page).
  requestAnimationFrame(() => {
    go(current, false);
    lens();
  });
  const arrow = (dir) => h("button", { type: "button", class: `ava-arrow ${dir < 0 ? "prev" : "next"}`, "aria-label": dir < 0 ? "Previous animal" : "Next animal", text: dir < 0 ? "‹" : "›", on: { click: () => go(current + dir) } });
  return h("div", { class: "ava-picker" }, arrow(-1), strip, arrow(1), label);
}

async function renameFlow() {
  const res = await popup({
    tone: "cyan",
    icon: "🏷️",
    title: "NEW USERNAME",
    text: `You log in as @${account.user}. Pick a new username (or use an email). Your books, backup and password stay the same.`,
    fields: [
      { name: "login", placeholder: "New username or email", autocomplete: "username", label: "New username or email", max: 254, inputmode: "email" },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "CHANGE IT", primary: true, busy: "CHANGING…" },
    ],
    submit: (v) => account.rename(v.login, v.password),
  });
  if (res.id !== "go") return;
  feel("levelup", "success");
  island.say({ icon: "🏷️", title: `YOU'RE @${account.user.toUpperCase().slice(0, 16)}`, sub: "Log in with this from now on", tone: "lime" });
  refreshMe();
}
function renderFace() {
  const f = faceOf();
  if ($("#me-face").textContent !== f) $("#me-face").textContent = f;
  // A small badge on the avatar while a real library has no backup.
  $("#me").classList.toggle("warn", !account?.on && !syncRef?.on && state.books.length >= 5);
}

async function newRecoveryFlow() {
  const res = await popup({
    tone: "yellow",
    icon: "🛟",
    title: "NEW RECOVERY CODE",
    text: "Lost your recovery code? Make a new one. The old one stops working. Enter your password to confirm.",
    fields: [
      { name: "user", type: "text", value: account.user, autocomplete: "username", label: "Username", max: 254 },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "MAKE ONE", primary: true, busy: "MAKING…" },
    ],
    submit: (v) => account.newRecovery(v.password),
  });
  if (res.id !== "go") return;
  await showRecovery(res.result);
  island.say({ icon: "🛟", title: "NEW CODE SAVED", sub: "The old one no longer works", tone: "lime" });
}

function notReady() {
  popup({ tone: "cream", icon: "🚧", title: "ACCOUNTS ARE COMING", text: "Accounts aren't switched on yet (or the server can't be reached right now). Your shelves are safe on this device; a sync code works in the meantime." });
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
    const copy = S.load({ getItem: () => text });
    if (!copy.books.length && !copy.xp) throw new Error("empty");
    const before = state.books.length;
    state = S.restore(state, copy);
    try {
      localStorage.setItem(S.KEY, JSON.stringify(state)); // as is: no merge with an older reset on disk
    } catch {}
    statsDirty = true;
    renderShelf({ deal: 1 });
    renderHud();
    refreshMe();
    backupSoon();
    feel("fanfare", "success");
    island.say({ icon: "✅", title: "COPY RESTORED", sub: `${fmt(state.books.length - before)} books added · ${fmt(state.books.length)} in all`, tone: "lime" });
  } catch {
    island.say({ icon: "🤔", title: "THAT FILE DIDN'T WORK", sub: "Pick a Shelfie copy (.json)", tone: "pink" });
  }
  e.target.value = "";
}

/* ============================================================
   Adding books (pull up the + stamp)
   ============================================================ */

// Books you add land on the shelf you were looking at when you opened search.
let addShelf = "want";
function drawLegend() {
  const lab = (to, text) => h("span", { class: `lg ${to}` }, text);
  $("#legend").replaceChildren(lab(addShelf, `TAP → ${SHELF[addShelf].label}`), h("span", { class: "lg-or", text: "OR SWIPE" }), lab("want", "→ WANT"), lab("reading", "→→ READING"), lab("read", "→→→ READ"));
  $("#m-add").querySelector("span").textContent = `ADD TO ${SHELF[addShelf].label}`;
  $("#add-title").textContent = `ADD TO ${SHELF[addShelf].label}`;
}

const add = createPanel($("#panel-add"), {
  onProgress: (p) => panelProgress("add", p),
  onOpen: () => {
    addShelf = shelf;
    drawLegend();
    feel("open", "medium");
    $("#q").value = "";
    $("#results").replaceChildren(suggestions());
    $("#source").textContent = "";
  },
  onClose: () => {
    feel("close", "light");
    if (!added.length) return;
    // Show what you just added: on top of its shelf, straight away.
    const last = added[added.length - 1];
    const where = book(last)?.shelf;
    added = [];
    if (where && where !== shelf) switchShelf(where);
    else renderShelf({ keep: last });
    setTimeout(() => {
      feel("stamp", "success");
      const el = deck.top?.el;
      if (el && !prefersReducedMotion()) el.animate([{ transform: "translateY(-40px) scale(1.08) rotate(-4deg)", opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: 650, easing: "cubic-bezier(.22,1.3,.36,1)", composite: "add" });
    }, 120);
  },
});
$("#panel-add [data-close]").addEventListener("click", () => add.close());
let added = [];
function openAdd({ manual = false } = {}) {
  add.open();
  const form = $("#panel-add .manual");
  form.open = manual;
  if (manual) setTimeout(() => $("#m-title").focus({ preventScroll: true }), 320);
}

function suggestions() {
  return h("div", {}, suggestionChips());
}
function suggestionChips() {
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
  const thumb = h("div", { class: "thumb" }, bookStamp({ ...r, id: "x", seed, shelf: "want", pages: r.pages || 300, page: 0, noHd: true }).querySelector(".pic"));
  const label = h("b", { class: "row-label", text: "WANT" });
  const slab = h("div", { class: "row-under", "aria-hidden": "true" }, label);
  const face = h(
    "div",
    { class: "row-face" },
    thumb,
    h("span", { class: "row-text" }, h("b", { text: r.title }), h("small", { text: [r.author, r.year, r.pages ? `${r.pages} PG` : null].filter(Boolean).join(" · ") })),
    h("span", { class: "row-go", "aria-hidden": "true", text: have ? "✓" : "→" }),
  );
  const el = h("div", { class: `row${have ? " have" : ""}`, role: "button", tabIndex: 0, "aria-label": have ? `${r.title}, already on your shelves` : `Add ${r.title} to ${SHELF[addShelf].label.toLowerCase()}. Swipe right for want, further for reading, further still for read.` }, slab, face);
  if (have) return el;

  const doAdd = (to, v = 900) => {
    if (el.classList.contains("have")) return;
    el.classList.add("have");
    const res = commit(S.addBook(state, { ...r, pages: r.pages || 300, shelf: to, seed }), face.querySelector(".row-go"));
    added.push(res.events.find((e) => e.type === "added")?.book.id);
    el.dataset.to = to;
    label.textContent = `+ ${SHELF[to].label}`;
    feel("pop", "success");
    burst(face.querySelector(".row-go"), { count: 40, power: 0.8 });
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
        feel("snap", "select");
        label.animate([{ transform: "scale(1.4)" }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,1.6,.4,1)" });
      }
    }
  });
  const up = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const mode = d.mode;
    d = null;
    if (mode === "scroll") return;
    if (!mode) return doAdd(addShelf);
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
      doAdd(addShelf);
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
  const res = commit(S.addBook(state, { title, author: $("#m-author").value, pages: $("#m-pages").value, shelf: addShelf }), e.currentTarget);
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
  if (document.querySelector(".pop, .tour")) return;
  if (add.isOpen) add.close();
  else if (imp.isOpen) imp.close();
  else if (mePanel.isOpen) mePanel.close();
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

/* ---------------- first run: the tutorial ---------------- */

/* ---------------- first run: tour → name → bring your books ---------------- */

const TOUR = "shelfie.tour";
const touring = () => !!document.querySelector(".tour");
const popping = () => !!document.querySelector(".pop");

function tutorialDone(finished) {
  try {
    localStorage.setItem(TOUR, "1");
  } catch {}
  const first = !state.toured;
  if (first) state = S.save(globalThis.localStorage, { ...state, toured: true, seen: true });
  // The tour had you practise swiping and turning pages: no need to hint at them again.
  if (finished) ["swipe", "scrub"].forEach((k) => hints.learn(k));
  backupSoon();
  if (first) setTimeout(onboard, finished ? 900 : 300);
}

/** After the first tour: ask for a name, then offer Goodreads (or a sync code). */
async function onboard() {
  if (!state.name) await askName();
  if (!account?.on && (await checkAccounts())) await safeStep();
  if (state.books.length < 3) await bringBooks();
  setTimeout(introTips, 600);
}

async function askName({ edit = false } = {}) {
  const res = await popup({
    tone: "lime",
    icon: "👋",
    title: edit ? "WHAT SHOULD WE CALL YOU?" : "HEY, WHO'S READING?",
    text: "Just a first name or a nickname, to make things friendlier. It stays on your device (and in your encrypted sync, if you turn it on).",
    input: { placeholder: "Your name", max: 24, value: state.name, capitalize: "words", label: "Your first name or nickname" },
    actions: [
      { id: "skip", label: edit ? "CANCEL" : "SKIP", cancel: true },
      { id: "ok", label: "THAT'S ME", primary: true },
    ],
  });
  if (res.id !== "ok" || !S.cleanName(res.value)) {
    if (!edit) island.say({ icon: "🕶️", title: "ANONYMOUS READER", sub: Q.goodbyeNoName(), tone: "violet" });
    return;
  }
  commit(S.setName(state, res.value), $("#lcd"));
  feel("levelup", "success");
  rain({ count: 90, emoji: ["👋", "✨"] });
  island.say({ icon: "👋", title: `HI, ${state.name.toUpperCase()}!`, sub: Q.hello(state.name), tone: "lime" });
}

/** Onboarding: where your books live, and how to keep them. */
async function safeStep() {
  const choice = await popup({
    tone: "cyan",
    icon: "🛟",
    title: "KEEP YOUR BOOKS SAFE",
    body: h(
      "div",
      { class: "explain" },
      h("p", { class: "explain-row" }, h("span", { text: "📱" }), h("span", { text: "Your books live on this phone. Shelfie works offline and stays fast." })),
      h("p", { class: "explain-row" }, h("span", { text: "☁️" }), h("span", { text: "A free account backs them up, encrypted on your phone first: not even we can read them." })),
      h("p", { class: "explain-row" }, h("span", { text: "🔁" }), h("span", { text: "New phone? Log in and everything comes back. Forgot your password? Your recovery code gets you in." })),
    ),
    actions: [
      { id: "later", label: "LATER", cancel: true },
      { id: "login", label: "LOG IN" },
      { id: "signup", label: "SIGN UP", primary: true },
    ],
  });
  if (choice === "signup") await signupFlow();
  if (choice === "login") await loginFlow();
}

async function bringBooks() {
  const choice = await popup({
    tone: "pink",
    icon: "🧳",
    title: "BRING YOUR BOOKS?",
    text: "Coming from Goodreads? Import your whole library: what you've read (with dates and ratings), what you're reading, and your want-to-read. Already have a Shelfie account? Log in and your shelves come with you.",
    actions: [
      { id: "later", label: "START FRESH", cancel: true },
      ...(account?.on || accountsUp !== true ? [] : [{ id: "sync", label: "LOG IN" }]),
      { id: "gr", label: "GOODREADS", primary: true },
    ],
  });
  if (choice === "gr") openImport();
  if (choice === "sync") loginFlow();
}

async function helpFlow() {
  feel("open", "light");
  const what = await popup({
    tone: "yellow",
    icon: "?",
    title: "HOW CAN WE HELP?",
    text: "Replay the gesture tour, or bring the explainer pop-ups back as you go.",
    actions: [
      { id: "tips", label: "POP-UPS AGAIN" },
      { id: "tour", label: "PLAY THE TOUR", primary: true },
    ],
  });
  if (what === "tour") startTutorial({ onDone: tutorialDone });
  if (what === "tips") {
    resetTips();
    hints.reset?.();
    introTips();
  }
}

let toured = !!state.toured;
try {
  toured ||= !!localStorage.getItem(TOUR);
} catch {}
if (!toured) setTimeout(() => startTutorial({ onDone: tutorialDone }), 700);
else if (sessionStorage.getItem("shelfie.fresh")) {
  // Just reset: a clean slate, so say hello again.
  sessionStorage.removeItem("shelfie.fresh");
  setTimeout(() => {
    island.say({ icon: "🧹", title: "FRESH START", sub: "Squeaky clean shelves", tone: "lime", buzz: false });
    onboard();
  }, 900);
} else setTimeout(() => {
  island.say({ icon: "📚", title: Q.greeting(state.name).toUpperCase(), sub: S.pagesOn(state) ? `${S.pagesOn(state)}/${state.goal} pages today` : "Ready when you are", tone: "lime", buzz: false });
  introTips();
}, 900);

/* ---------------- explainer pop-ups ---------------- */

holdTipsWhile(() => touring() || popping() || add.isOpen || deck.dragging || posterUp || !!document.querySelector(".tour"));

/** The tips that make sense for what's on screen right now. Each shows once. */
function introTips() {
  if (stats.isOpen) return;
  const b = book(topId);
  if (b) tip({ id: "stamp", el: () => deck.top?.el, tone: "lime", title: "THIS IS A BOOK", text: b.shelf === "reading" ? "Drag it UP to turn pages (down to go back). Swipe sideways to flip through your books. Tap to flip the stamp over. Hold it to move it to another shelf." : "Swipe sideways to flip through. Tap to flip the stamp over. Hold it, then drop it on a shelf to move it." });
  else tip({ id: "addstamp", el: () => deck.top?.el, tone: "lime", title: "YOUR FIRST BOOK", text: "This + stamp is always last on every shelf. Tap it (or pull it up) to search for a book." });
  if (b?.shelf === "reading") tip({ id: "pad", el: () => $(".pad.reading"), tone: "cyan", title: "YOUR PAGE DECK", text: "Spin the dial, or tap +1 +5 +10 +25, to log pages. The green screen shows where you are and what's left." });
  if (b?.shelf === "want") tip({ id: "padwant", el: () => $(".pad.want"), tone: "orange", title: "WANT TO READ", text: "START moves this book to Reading. 🎲 SHUFFLE picks one for you." });
  if (b?.shelf === "read") tip({ id: "padread", el: () => $(".pad.read"), tone: "yellow", title: "FINISHED", text: "Tap a face to say how it felt. ↺ starts it again." });
  tip({ id: "tape", el: () => $("#tape"), tone: "pink", title: "YOUR SHELVES", text: "Drag the big word sideways (or tap the next one) to switch between READING, WANT and READ." });
  tip({ id: "lcd", el: () => $("#lcd"), tone: "lime", title: "STATUS SCREEN", text: "Level, XP, streak and your goals take turns here. Tap it for your stats." });
  tip({ id: "pull", el: () => $("#pullbar"), tone: "cyan", title: "PULL ME UP", text: "Stats, daily / monthly / yearly goals, stickers, sync, Goodreads import and settings live down here." });
}

/* ---------------- home screen ---------------- */

// Counted per device: the offer comes on a later visit, never on the first one.
let visits = 0;
try {
  visits = Number(localStorage.getItem("shelfie.visits") || 0) + 1;
  localStorage.setItem("shelfie.visits", String(visits));
} catch {}
if (visits >= 2 && state.toured)
  setTimeout(() => {
    if (!shouldOffer() || touring() || popping() || stats.isOpen || add.isOpen || imp.isOpen || posterUp || document.querySelector(".tip")) return;
    markOffered();
    showInstall({ name: state.name });
  }, 6000);

/* ---------------- idle fidgets ---------------- */

// While the app is open and you're just looking, it doesn't freeze: every so often something
// does a little something. Each one is a short, composited animation, so it costs next to nothing.
let lastInput = performance.now();
for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, () => (lastInput = performance.now()), { capture: true, passive: true });
const FIDGETS = [
  () => {
    const el = deck.top?.el;
    if (!el || el.classList.contains("flipped")) return;
    el.querySelector(".face.front")?.animate(
      [{ transform: "none" }, { transform: "rotate(-3deg) translateY(-6px)" }, { transform: "rotate(2deg)" }, { transform: "none" }],
      { duration: 900, easing: "cubic-bezier(.3,1.4,.5,1)" },
    );
  },
  () => {
    const r = $(".dock .knob-ring");
    if (!r) return;
    r.classList.remove("fidget");
    void r.offsetWidth;
    r.classList.add("fidget");
  },
  () => {
    const w = $("#tape [aria-selected='true']");
    w?.animate([{ transform: "none" }, { transform: "translateY(-8px) rotate(-2deg)" }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(.3,1.5,.5,1)" });
  },
  () => liquid?.splash(0.25, Math.random()),
  () => [...$("#dock").querySelectorAll(".key")].slice(0, 4).forEach((k, i) =>
    k.animate([{ transform: "none" }, { transform: "translateY(-5px)" }, { transform: "none" }], { duration: 420, delay: i * 70, easing: "ease-out" }),
  ),
];
let fidgetN = 0;
setInterval(() => {
  if (prefersReducedMotion() || document.visibilityState !== "visible") return;
  if (performance.now() - lastInput < 9000 || deck.dragging || touring() || popping() || stats.isOpen || add.isOpen || imp.isOpen || posterUp) return;
  if (Math.random() < 0.35) return; // not like clockwork
  FIDGETS[fidgetN++ % FIDGETS.length]();
  // Now and then, after a longer quiet spell, a line from the island.
  if (performance.now() - lastInput > 45000 && Math.random() < 0.25) island.say({ icon: "📖", title: Q.greeting(state.name).toUpperCase(), sub: "Still here when you're ready", tone: "lime", buzz: false });
}, 6000);

/* ---------------- visitors ---------------- */

const critters = createCritters({
  host: $("#stage"),
  canShow: () => fx.visitors && !touring() && !popping() && !stats.isOpen && !add.isOpen && !imp.isOpen && !deck.dragging && !posterUp && !document.querySelector(".tip"),
  name: () => state.name,
  onPet: (c, el) => {
    const r = S.findEgg(state, "app", `critter-${c.id}`);
    r.events.forEach((e) => e.type === "egg" && (e.label = `Petted the ${c.id}`));
    if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, el);
  },
});

// Hint that stats live below, once.
if (!hints.has("stats")) setTimeout(() => !stats.isOpen && stats.peek(), 2600);

prerenderStats();

/* ---------------- motion controls ---------------- */

const stageBg = $(".stage-bg");
/**
 * The tilt of the phone, -1..1 each way: the pile drifts, the room shifts the other way, the bulbs
 * swing and the light on the cover slides. All of it is 2D transforms on elements that already have
 * their own layer, so the GPU just moves pictures about; nothing is re-laid out or repainted.
 */
let swung = 0;
function applyTilt(x, y) {
  deckEl.style.translate = `${(x * 10).toFixed(1)}px ${(y * 6).toFixed(1)}px`;
  deckEl.style.rotate = `${(x * 1.5).toFixed(2)}deg`;
  stageBg.style.translate = `${(-x * 16).toFixed(1)}px ${(-y * 10).toFixed(1)}px`;
  fairy.style.rotate = `${(x * 2.5).toFixed(2)}deg`;
  // The bulbs swing in steps (their own transition smooths it): restyling every bulb every frame
  // was one of the costs of tilting.
  const sw = Math.round(-x * 6) * 2;
  if (sw !== swung) {
    swung = sw;
    for (const e of document.querySelectorAll(".edison")) e.style.setProperty("--swing", `${sw}deg`);
  }
  const spot = deck.top?.el.querySelector(".hotspot");
  if (spot) spot.style.transform = `translate(${(x * 45).toFixed(1)}%, ${(y * 40).toFixed(1)}%)`;
}

const motionUsed = new Set();
/** A gesture made with the whole phone. */
function motionGesture(name) {
  const say = (icon, title) => {
    // The first couple of times, say what just happened.
    const n = (motionUsed.has(name) ? 1 : 0) + Number(localStorage.getItem(`shelfie.mo.${name}`) || 0);
    motionUsed.add(name);
    if (n < 2) {
      island.say({ icon, title, tone: "lime", buzz: false });
      try {
        localStorage.setItem(`shelfie.mo.${name}`, String(n + 1));
      } catch {}
    }
  };
  if (name === "next" || name === "prev") {
    const to = deck.index + (name === "next" ? 1 : -1);
    if (to < 0 || to >= deck.ids().length) return feel("error", "warning");
    feel("swoosh", "medium");
    deck.go(to, { x: name === "next" ? -900 : 900 });
    say("📳", name === "next" ? "FLICK! NEXT BOOK" : "FLICK! BACK ONE");
  } else if (name === "shelfNext" || name === "shelfPrev") {
    const k = ORDER.indexOf(shelf);
    const to = ORDER[(k + (name === "shelfNext" ? 1 : ORDER.length - 1)) % ORDER.length];
    switchShelf(to);
    say("🎡", `TWIST! ${SHELF[to].label}`);
  } else if (name === "add") {
    feel("pop", "success");
    openAdd();
    say("🚀", "FLICK UP! ADD A BOOK");
  }
}

const gyro = createGyro({
  onTilt: applyTilt,
  onGesture: motionGesture,
  tilt: () => !prefersReducedMotion(),
  canGesture: () =>
    document.visibilityState === "visible" && !deck.dragging && !touring() && !popping() && !stats.isOpen && !add.isOpen && !imp.isOpen && !mePanel.isOpen && !posterUp && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || ""),
});

/** Turn motion on. Must run inside a tap (iPhone asks permission). */
async function enableMotion() {
  const ok = await askMotion();
  if (!ok) throw new Error("Motion was blocked. On iPhone: Settings → Apps → Safari → Motion & Orientation Access, then try again.");
  fx.set("motion", true);
  gyro.start();
  feel("levelup", "success");
  return true;
}

/** The guide: three moves, drawn as little animated phones. */
function motionGuide() {
  const move = (cls, title, text) => h("div", { class: "mo-row" }, h("span", { class: `mo-phone ${cls}`, "aria-hidden": "true" }, h("i")), h("span", {}, h("b", { text: title }), h("small", { text })));
  return h(
    "div",
    { class: "mo-guide" },
    move("flick", "FLICK SIDEWAYS", "Turn the phone quickly to face right and back, like turning a page: next book. Left: back one."),
    move("twist", "TWIST", "Turn it like a steering wheel: the next shelf (or the one before)."),
    move("lift", "FLICK UP", "Tip the top edge quickly towards you and back: add a book."),
    move("tilt", "TILT", "Just tilt: the pile leans, the lights swing, the cover catches the light."),
  );
}

async function motionInvite({ fromSettings = false } = {}) {
  try {
    localStorage.setItem("shelfie.motionAsked", "1");
  } catch {}
  const res = await popup({
    tone: "lime",
    icon: "📳",
    title: fromSettings ? "MOTION CONTROLS" : "NEW: MOVE YOUR PHONE",
    text: "Shelfie can feel your phone move. Nothing about it is stored or sent anywhere.",
    body: motionGuide(),
    actions: [
      { id: "later", label: fromSettings ? "CANCEL" : "NOT NOW", cancel: true },
      { id: "on", label: "TURN IT ON", primary: true, busy: "ASKING…" },
    ],
    submit: () => enableMotion(),
  });
  if (res === "on" || res?.id === "on") island.say({ icon: "📳", title: "MOTION ON", sub: "Flick, twist, tip, tilt", tone: "lime" });
  refreshMe();
}

if (motionSupported()) {
  if (fx.motion) {
    // iPhone needs the permission call inside a tap: the first touch of this visit starts it.
    const kick = async () => {
      removeEventListener("pointerdown", kick, true);
      if (await askMotion()) gyro.start();
    };
    addEventListener("pointerdown", kick, true);
  } else if (opensSoFar >= 1 && !localStorage.getItem("shelfie.motionAsked")) {
    // Once, on a later visit: show it off.
    setTimeout(() => {
      if (touring() || popping() || stats.isOpen || add.isOpen || imp.isOpen || mePanel.isOpen || posterUp || document.querySelector(".tip")) return;
      motionInvite();
    }, 9000);
  }
}

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

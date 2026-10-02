// Everything the app knows lives here: your books, your reading log and your XP.
// Plain data, saved on your own device. No account, no server.
//
// Every change goes through a function that returns { state, events }. Events are what the
// screen celebrates: XP gained, a level up, a new badge, a milestone, a finished book.
// None of this touches the DOM, so it runs (and is tested) in Node too.

export const SHELVES = ["reading", "want", "read"];
export const KEY = "shelf.v1";

export const XP = { page: 1, add: 20, start: 10, finish: 100, egg: 15, rate: 10 };
const MILESTONES = [25, 50, 75];

export const TITLES = [
  "Fresh Spine",
  "Page Turner",
  "Bookworm",
  "Chapter Chaser",
  "Plot Twister",
  "Spine Cracker",
  "Lore Keeper",
  "Library Legend",
  "Literary Final Boss",
];

export const BADGES = [
  { id: "first-add", emoji: "📚", name: "Collector", text: "Added your first book", test: (s) => s.books.length >= 1 },
  { id: "five-add", emoji: "🗄️", name: "Hoarder", text: "Five books on your shelves", test: (s) => s.books.length >= 5 },
  { id: "first-finish", emoji: "🏁", name: "The End", text: "Finished a book", test: (s) => finishedCount(s) >= 1 },
  { id: "five-finish", emoji: "🏆", name: "High Five", text: "Finished five books", test: (s) => finishedCount(s) >= 5 },
  { id: "pages-100", emoji: "💯", name: "Century", text: "100 pages read", test: (s) => totalPages(s) >= 100 },
  { id: "pages-1000", emoji: "🚀", name: "Kilopage", text: "1,000 pages read", test: (s) => totalPages(s) >= 1000 },
  { id: "streak-3", emoji: "🔥", name: "On Fire", text: "3-day reading streak", test: (s, now) => streak(s, now) >= 3 },
  { id: "streak-7", emoji: "☄️", name: "Unstoppable", text: "7-day reading streak", test: (s, now) => streak(s, now) >= 7 },
  { id: "goal", emoji: "🎯", name: "Bullseye", text: "Hit your daily goal", test: (s, now) => pagesOn(s, now) >= s.goal },
  { id: "binge", emoji: "🌊", name: "Binge Reader", text: "100 pages in one day", test: (s, now) => pagesOn(s, now) >= 100 },
  { id: "owl", emoji: "🦉", name: "Night Owl", text: "Read between midnight and 4 AM", test: (s, now) => s._owl === dayKey(now) },
  { id: "eggs-3", emoji: "🥚", name: "Egg Hunter", text: "Found 3 easter eggs", test: (s) => s.eggs.length >= 3 },
  { id: "eggs-10", emoji: "🐣", name: "Egg Whisperer", text: "Found 10 easter eggs", test: (s) => s.eggs.length >= 10 },
];

export function empty() {
  return { v: 1, books: [], log: {}, xp: 0, goal: 20, badges: {}, eggs: [], seen: false };
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(now = new Date()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function prevDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12));
}

/* ---------------- reading the state ---------------- */

export const levelOf = (xp) => Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2);
/** XP needed to reach a level: 0, 100, 300, 600, 1000… */
export const levelFloor = (n) => 50 * n * (n - 1);
export const titleOf = (level) => TITLES[Math.min(level, TITLES.length) - 1];

export function levelProgress(xp) {
  const level = levelOf(xp);
  const lo = levelFloor(level);
  const hi = levelFloor(level + 1);
  return { level, title: titleOf(level), into: xp - lo, need: hi - lo, frac: (xp - lo) / (hi - lo) };
}

export const pagesOn = (s, now = new Date()) => s.log[dayKey(now)] || 0;
export const totalPages = (s) => Object.values(s.log).reduce((a, b) => a + b, 0);
export const finishedCount = (s) => s.books.filter((b) => b.shelf === "read").length;
export const shelf = (s, name) => s.books.filter((b) => b.shelf === name).sort((a, b) => (b.touched || 0) - (a.touched || 0));

/** Days in a row with pages read, ending today (or yesterday, if today hasn't started yet). */
export function streak(s, now = new Date()) {
  let key = dayKey(now);
  if (!s.log[key]) key = prevDay(key);
  let n = 0;
  while (s.log[key] > 0) {
    n++;
    key = prevDay(key);
  }
  return n;
}

/** The last 7 days, oldest first, for the little bar chart. */
export function week(s, now = new Date()) {
  const out = [];
  let key = dayKey(now);
  for (let i = 0; i < 7; i++) {
    out.unshift({ day: key, pages: s.log[key] || 0 });
    key = prevDay(key);
  }
  return out;
}

/* ---------------- changing the state ---------------- */

function clone(s) {
  return { ...s, books: s.books.map((b) => ({ ...b })), log: { ...s.log }, badges: { ...s.badges }, eggs: [...s.eggs] };
}

/** XP, level-ups and new badges, shared by every change. */
function finish(before, s, events, now) {
  const gained = s.xp - before.xp;
  if (gained > 0) events.unshift({ type: "xp", amount: gained });
  const lv0 = levelOf(before.xp);
  const lv1 = levelOf(s.xp);
  if (lv1 > lv0) events.push({ type: "level", level: lv1, title: titleOf(lv1) });
  const s0 = streak(before, now);
  const s1 = streak(s, now);
  if (s1 > s0 && s1 >= 2) events.push({ type: "streak", days: s1 });
  for (const b of BADGES) {
    if (s.badges[b.id] || !b.test(s, now)) continue;
    s.badges[b.id] = now.toISOString();
    events.push({ type: "badge", badge: b });
  }
  return { state: s, events };
}

let idSeed = 0;
const newId = () => `b${Date.now().toString(36)}${(idSeed++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function addBook(state, input, now = new Date()) {
  const s = clone(state);
  const pages = clampInt(input.pages, 1, 5000, 300);
  const where = SHELVES.includes(input.shelf) ? input.shelf : "want";
  const book = {
    id: newId(),
    title: String(input.title || "Untitled").trim().slice(0, 140) || "Untitled",
    author: String(input.author || "").trim().slice(0, 100),
    pages,
    page: where === "read" ? pages : 0,
    best: where === "read" ? pages : 0,
    shelf: where,
    cover: Number.isInteger(input.cover) ? input.cover : null,
    img: typeof input.img === "string" && /^https:\/\/(books\.google\.com|books\.googleusercontent\.com)\//.test(input.img) ? input.img.slice(0, 400) : null,
    key: typeof input.key === "string" ? input.key.slice(0, 40) : null,
    cats: typeof input.cats === "string" ? input.cats.slice(0, 40) : null,
    blurb: typeof input.blurb === "string" ? input.blurb.slice(0, 280) : null,
    year: Number.isInteger(input.year) ? input.year : null,
    seed: input.seed ?? hash(`${input.title}|${input.author}`),
    rating: 0,
    added: now.toISOString(),
    started: where === "reading" ? now.toISOString() : null,
    finished: where === "read" ? now.toISOString() : null,
    touched: now.getTime(),
  };
  s.books.push(book);
  s.xp += XP.add;
  return finish(state, s, [{ type: "added", book }], now);
}

/**
 * Log reading by moving a book's bookmark. XP and the reading log only count pages past the
 * furthest you've ever reached, so scrolling the wheel back and forth can't farm XP.
 */
export function setPage(state, id, page, now = new Date()) {
  const s = clone(state);
  const b = s.books.find((x) => x.id === id);
  if (!b) return { state, events: [] };
  const to = clampInt(page, 0, b.pages, b.page);
  const fresh = Math.max(0, to - b.best);
  const events = [];
  const pct0 = (b.best / b.pages) * 100;
  b.page = to;
  b.touched = now.getTime();
  if (fresh > 0) {
    b.best = to;
    const today = dayKey(now);
    s.log[today] = (s.log[today] || 0) + fresh;
    s.xp += fresh * XP.page;
    if (now.getHours() < 4) s._owl = today;
    const pct1 = (to / b.pages) * 100;
    for (const m of MILESTONES) if (pct0 < m && pct1 >= m && to < b.pages) events.push({ type: "milestone", pct: m, book: b });
  }
  if (to > 0 && b.shelf === "want") {
    b.shelf = "reading";
    b.started = now.toISOString();
    events.push({ type: "moved", shelf: "reading", book: b });
  }
  if (to === b.pages && b.shelf !== "read") {
    b.shelf = "read";
    b.finished = now.toISOString();
    s.xp += XP.finish;
    events.push({ type: "finished", book: b });
  }
  return finish(state, s, events, now);
}

export function moveBook(state, id, where, now = new Date()) {
  if (!SHELVES.includes(where)) return { state, events: [] };
  const s = clone(state);
  const b = s.books.find((x) => x.id === id);
  if (!b || b.shelf === where) return { state, events: [] };
  const events = [{ type: "moved", shelf: where, book: b }];
  b.shelf = where;
  b.touched = now.getTime();
  if (where === "reading") {
    b.started ||= now.toISOString();
    if (b.page >= b.pages) b.page = 0;
    s.xp += XP.start;
  }
  if (where === "read") {
    b.finished = now.toISOString();
    const fresh = Math.max(0, b.pages - b.best);
    b.page = b.best = b.pages;
    if (fresh > 0) {
      const today = dayKey(now);
      s.log[today] = (s.log[today] || 0) + fresh;
      s.xp += fresh * XP.page;
    }
    s.xp += XP.finish;
    events.push({ type: "finished", book: b });
  }
  return finish(state, s, events, now);
}

export function rateBook(state, id, stars, now = new Date()) {
  const s = clone(state);
  const b = s.books.find((x) => x.id === id);
  if (!b) return { state, events: [] };
  const first = !b.rating;
  b.rating = clampInt(stars, 0, 5, 0);
  if (first && b.rating) s.xp += XP.rate;
  return finish(state, s, [], now);
}

export function removeBook(state, id) {
  const s = clone(state);
  s.books = s.books.filter((b) => b.id !== id);
  return { state: s, events: [{ type: "removed", id }] };
}

/** An easter egg, found. Each egg pays out once per book. */
export function findEgg(state, id, egg, now = new Date()) {
  const tag = `${id}:${egg}`;
  if (state.eggs.includes(tag)) return { state, events: [{ type: "egg", egg, fresh: false }] };
  const s = clone(state);
  s.eggs.push(tag);
  s.xp += XP.egg;
  return finish(state, s, [{ type: "egg", egg, fresh: true }], now);
}

export function setGoal(state, goal) {
  return { state: { ...clone(state), goal: clampInt(goal, 1, 500, state.goal) }, events: [] };
}

/* ---------------- saving ---------------- */

export function load(storage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !Array.isArray(data.books)) return empty();
    return { ...empty(), ...data };
  } catch {
    return empty();
  }
}

export function save(storage, state) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/* ---------------- helpers ---------------- */

export function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Small, stable string hash (FNV-1a), so a book's art is the same every time. */
export function hash(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

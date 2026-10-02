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
  { id: "month-goal", emoji: "🗓️", name: "Month Maestro", text: "Hit a monthly book goal", test: (s, now) => finishedIn(s, "month", now) >= s.goalMonth },
  { id: "year-goal", emoji: "👑", name: "Year Legend", text: "Hit your yearly book goal", test: (s, now) => finishedIn(s, "year", now) >= s.goalYear },
  { id: "migrant", emoji: "🧳", name: "Moved In", text: "Brought your Goodreads library", test: (s) => s.eggs.includes("app:goodreads") },
  { id: "zoo", emoji: "🦙", name: "Zookeeper", text: "Petted 3 passing critters", test: (s) => s.eggs.filter((e) => e.startsWith("app:critter-")).length >= 3 },
  { id: "combo", emoji: "⚡", name: "Combo Breaker", text: "Hit a ×5 reading combo", test: (s) => s.eggs.includes("app:combo5") },
  { id: "five-star", emoji: "🤯", name: "Mind Blown", text: "Gave a book the top feeling", test: (s) => s.books.some((b) => b.rating === 5) },
  { id: "named", emoji: "👋", name: "Hello, You", text: "Told Shelfie your name", test: (s) => !!s.name },
];

export function empty() {
  // goal: pages a day. goalMonth and goalYear: books finished. gone: removed book ids, so a
  // removal survives syncing with a copy that still has the book.
  // name: what to call you (a first name or nickname, nothing else). toured: the tour was seen,
  // so a newly linked device skips it.
  return { v: 1, books: [], log: {}, xp: 0, goal: 20, goalMonth: 2, goalYear: 24, goalsAt: 0, badges: {}, eggs: [], gone: {}, seen: false, toured: false, name: "", nameAt: 0, resetAt: 0 };
}

/** A first name or nickname: printable, trimmed, at most 24 characters. */
export function cleanName(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
}

export function setName(state, name, now = new Date()) {
  return { state: { ...clone(state), name: cleanName(name), nameAt: now.getTime() }, events: [] };
}

/** ISBN-10 or ISBN-13 digits (an X allowed at the end of an ISBN-10), else null. */
export function cleanIsbn(raw) {
  const d = String(raw || "").toUpperCase().replace(/[^0-9X]/g, "");
  if (/^\d{13}$/.test(d) || /^\d{9}[\dX]$/.test(d)) return d;
  return null;
}

export const GOAL_LIMITS = { day: [5, 200], month: [1, 31], year: [1, 365] };

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

/** Books finished this calendar month or year (local time). */
export function finishedIn(s, period, now = new Date()) {
  const d = new Date(now);
  return s.books.filter((b) => {
    if (b.shelf !== "read" || !b.finished) return false;
    const f = new Date(b.finished);
    return f.getFullYear() === d.getFullYear() && (period === "year" || f.getMonth() === d.getMonth());
  }).length;
}

/** Pages read this calendar month or year. */
export function pagesIn(s, period, now = new Date()) {
  const key = dayKey(now).slice(0, period === "year" ? 4 : 7);
  return Object.entries(s.log).reduce((a, [k, v]) => (k.startsWith(key) ? a + v : a), 0);
}
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
  return { ...s, books: s.books.map((b) => ({ ...b })), log: { ...s.log }, badges: { ...s.badges }, eggs: [...s.eggs], gone: { ...(s.gone || {}) } };
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
  // Goals crossed by this change.
  if (pagesOn(before, now) < s.goal && pagesOn(s, now) >= s.goal) events.push({ type: "goal", period: "day", target: s.goal });
  for (const period of ["month", "year"]) {
    const target = period === "month" ? s.goalMonth : s.goalYear;
    if (finishedIn(before, period, now) < target && finishedIn(s, period, now) >= target) events.push({ type: "goal", period, target });
  }
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
    isbn: cleanIsbn(input.isbn),
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
  b.touched = now.getTime();
  if (first && b.rating) s.xp += XP.rate;
  return finish(state, s, [], now);
}

export function removeBook(state, id, now = new Date()) {
  const s = clone(state);
  s.books = s.books.filter((b) => b.id !== id);
  s.gone[id] = now.getTime();
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

/** kind: "day" (pages), "month" or "year" (books). */
export function setGoal(state, goal, kind = "day", now = new Date()) {
  const field = { day: "goal", month: "goalMonth", year: "goalYear" }[kind];
  if (!field) return { state, events: [] };
  const [lo, hi] = GOAL_LIMITS[kind];
  return { state: { ...clone(state), [field]: clampInt(goal, lo, hi, state[field]), goalsAt: now.getTime() }, events: [] };
}

/* ---------------- syncing ---------------- */

/**
 * Combine two copies of the shelves (this device and the synced one) without losing anything:
 * each book keeps its most recently changed version, removals win over older copies, the
 * reading log keeps the larger count for each day, and badges and eggs are pooled.
 */
export function merge(a, b) {
  a = normalise(a);
  b = normalise(b);
  // A reset wins over anything from before it (another tab still holding the old shelves).
  const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
  if ((a.resetAt || 0) < resetAt) a = { ...empty(), resetAt };
  if ((b.resetAt || 0) < resetAt) b = { ...empty(), resetAt };
  const gone = { ...a.gone };
  for (const [id, t] of Object.entries(b.gone)) gone[id] = Math.max(gone[id] || 0, t);
  const books = new Map();
  for (const x of [...a.books, ...b.books]) {
    const have = books.get(x.id);
    if (!have) books.set(x.id, { ...x });
    else {
      const newer = (x.touched || 0) > (have.touched || 0) ? x : have;
      books.set(x.id, { ...newer, best: Math.max(have.best || 0, x.best || 0) });
    }
  }
  const kept = [...books.values()].filter((x) => !(gone[x.id] >= (x.touched || 0))).sort((x, y) => (x.id < y.id ? -1 : 1));
  const log = { ...a.log };
  for (const [k, v] of Object.entries(b.log)) log[k] = Math.max(log[k] || 0, v);
  const badges = { ...b.badges };
  for (const [k, v] of Object.entries(a.badges)) badges[k] = !badges[k] || v < badges[k] ? v : badges[k];
  const goals = (b.goalsAt || 0) > (a.goalsAt || 0) ? b : a;
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1)));
  return {
    ...empty(),
    books: kept,
    log: sorted(log),
    xp: Math.max(a.xp, b.xp),
    goal: goals.goal,
    goalMonth: goals.goalMonth,
    goalYear: goals.goalYear,
    goalsAt: goals.goalsAt || 0,
    badges: sorted(badges),
    eggs: [...new Set([...a.eggs, ...b.eggs])].sort(),
    gone: sorted(gone),
    seen: a.seen || b.seen,
    toured: !!(a.toured || b.toured),
    resetAt,
    ...((b.nameAt || 0) > (a.nameAt || 0) ? { name: b.name || "", nameAt: b.nameAt } : { name: a.name || b.name || "", nameAt: a.nameAt || b.nameAt || 0 }),
    ...(a._owl || b._owl ? { _owl: [a._owl, b._owl].filter(Boolean).sort().pop() } : {}),
  };
}

/** Fill in anything an older copy is missing. */
export function normalise(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.books)) return empty();
  const s = { ...empty(), ...data };
  s.books = s.books.filter((b) => b && typeof b.id === "string" && typeof b.title === "string");
  for (const k of ["log", "badges", "gone"]) if (!s[k] || typeof s[k] !== "object" || Array.isArray(s[k])) s[k] = {};
  if (!Array.isArray(s.eggs)) s.eggs = [];
  if (!Number.isFinite(s.xp)) s.xp = 0;
  s.name = cleanName(s.name);
  return s;
}

/** Everything gone, for a fresh start. Marked, so other open tabs follow instead of restoring. */
export function reset(now = new Date()) {
  return { ...empty(), resetAt: now.getTime() };
}

/* ---------------- importing ---------------- */

const sameBook = (a, b) =>
  (a.isbn && b.isbn && a.isbn === b.isbn) || (a.title.toLowerCase().replace(/\W+/g, "") === b.title.toLowerCase().replace(/\W+/g, "") && (a.author || "").toLowerCase().replace(/\W+/g, "") === (b.author || "").toLowerCase().replace(/\W+/g, ""));

/**
 * Bring in many books at once (a Goodreads export). Each input may carry its own shelf,
 * rating (1..5), and added / finished dates. Books already on the shelves are skipped. Pages
 * from the past aren't added to today's reading log (that would fake a streak), but there's a
 * welcome-home XP bonus: 10 per book, up to 1,000.
 */
export function importBooks(state, inputs, now = new Date(), { source = "goodreads" } = {}) {
  const s = clone(state);
  let added = 0;
  let skipped = 0;
  const counts = { reading: 0, want: 0, read: 0 };
  const base = now.getTime();
  for (const [k, input] of inputs.entries()) {
    const title = String(input.title || "").trim().slice(0, 140);
    if (!title) {
      skipped++;
      continue;
    }
    const probe = { title, author: String(input.author || "").trim().slice(0, 100), isbn: cleanIsbn(input.isbn) };
    if (s.books.some((b) => sameBook(b, probe))) {
      skipped++;
      continue;
    }
    const where = SHELVES.includes(input.shelf) ? input.shelf : "want";
    const pages = clampInt(input.pages, 1, 5000, 300);
    const date = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString() : null);
    const addedAt = date(input.added) || now.toISOString();
    const finished = where === "read" ? date(input.finished) || addedAt : null;
    s.books.push({
      id: newId(),
      title,
      author: probe.author,
      pages,
      page: where === "read" ? pages : 0,
      best: where === "read" ? pages : 0,
      shelf: where,
      cover: null,
      img: null,
      key: typeof input.key === "string" ? input.key.slice(0, 40) : null,
      cats: null,
      blurb: null,
      isbn: probe.isbn,
      year: Number.isInteger(input.year) ? input.year : null,
      seed: hash(`${title}|${probe.author}`),
      rating: where === "read" ? clampInt(input.rating, 0, 5, 0) : 0,
      added: addedAt,
      started: where === "reading" ? addedAt : null,
      finished,
      // Older activity sorts lower; the import order breaks ties.
      touched: Date.parse(finished || addedAt) || base - k,
    });
    counts[where]++;
    added++;
  }
  if (added) {
    s.xp += Math.min(1000, added * 10);
    if (!s.eggs.includes(`app:${source}`)) s.eggs.push(`app:${source}`);
  }
  return finish(state, s, [{ type: "imported", added, skipped, counts, source }], now);
}

/* ---------------- saving ---------------- */

export function load(storage) {
  let raw = null;
  try {
    raw = storage?.getItem(KEY);
    if (!raw) return empty();
    return normalise(JSON.parse(raw));
  } catch {
    // Never let a damaged copy be silently replaced: keep it aside first.
    try {
      if (raw) storage.setItem(`${KEY}.damaged.${Date.now()}`, raw);
    } catch {}
    return empty();
  }
}

/**
 * Save, without clobbering a copy another tab (or the installed app sharing this storage)
 * wrote in the meantime: what's on disk is merged in first. Returns the state actually saved.
 */
export function save(storage, state) {
  try {
    const raw = storage?.getItem(KEY);
    const merged = raw ? merge(JSON.parse(raw), state) : state;
    storage?.setItem(KEY, JSON.stringify(merged));
    return merged;
  } catch {
    try {
      storage?.setItem(KEY, JSON.stringify(state));
    } catch {}
    return state;
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

// Shelfie: the screen. State lives in store.js; this file draws it and turns every change into
// a little celebration.

import { h, $, $$, buzz, clamp, fmt, play, prefersReducedMotion, SPRING } from "./util.js";
import * as S from "./store.js";
import { bookArt, tiltable } from "./cover.js";
import { createIsland } from "./island.js";
import { createTabs } from "./tabs.js";
import { createWheel } from "./wheel.js";
import { createDeck } from "./swipe.js";
import { burst, rain, floatText } from "./confetti.js";
import { poke, themedEgg } from "./eggs.js";
import { searchBooks } from "./search.js";
import { sheet } from "./sheet.js";

let state = S.load(globalThis.localStorage);
const island = createIsland();

const SHELF_META = {
  reading: { label: "Reading", emoji: "📖", tone: "#ff3d7f" },
  want: { label: "Want", emoji: "✨", tone: "#c6ff3d" },
  read: { label: "Read", emoji: "🏆", tone: "#2de2ff" },
};

const STARTER = [
  { title: "Dune", author: "Frank Herbert", cover: 11481354, pages: 608, year: 1965, shelf: "reading", page: 212 },
  { title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", cover: 12986869, pages: 216, year: 1979, shelf: "reading", page: 40 },
  { title: "Harry Potter and the Philosopher's Stone", author: "J. K. Rowling", cover: 15155833, pages: 302, year: 1997, shelf: "want" },
  { title: "The Hobbit", author: "J.R.R. Tolkien", cover: 14627509, pages: 310, year: 1937, shelf: "want" },
  { title: "Project Hail Mary", author: "Andy Weir", cover: 11200092, pages: 496, year: 2021, shelf: "want" },
  { title: "Nineteen Eighty-Four", author: "George Orwell", cover: 9267242, pages: 318, year: 1949, shelf: "want" },
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", cover: 10590366, pages: 185, year: 1925, shelf: "read", rating: 4 },
  { title: "Midnight Garden Club", author: "You, maybe", pages: 280, shelf: "want" },
];

/* ============================================================
   Changes and celebrations
   ============================================================ */

function commit(result, at) {
  const before = state;
  state = result.state;
  S.save(globalThis.localStorage, state);
  const events = [...result.events];
  const today0 = S.pagesOn(before);
  const today1 = S.pagesOn(state);
  if (today0 < state.goal && today1 >= state.goal) events.push({ type: "goal" });
  celebrate(events, at);
  render();
  return result;
}

function celebrate(events, at) {
  const xp = events.find((e) => e.type === "xp")?.amount || 0;
  if (xp && at) floatText(at, `+${xp} XP`);
  const msgs = [];
  for (const e of events) {
    if (e.type === "starter") msgs.push({ icon: "📚", title: "Starter stack loaded", sub: "Tap Dune, then poke its cover", tone: "pink" });
    if (e.type === "added") msgs.push({ icon: "📚", title: "On the shelf", sub: e.book.title, tone: "pink" });
    if (e.type === "moved" && e.shelf === "reading") msgs.push({ icon: "📖", title: "Now reading", sub: e.book.title, tone: "pink" });
    if (e.type === "moved" && e.shelf === "want") msgs.push({ icon: "✨", title: "Saved for later", sub: e.book.title, tone: "lime" });
    if (e.type === "milestone") {
      msgs.push({ icon: { 25: "🌒", 50: "🌓", 75: "🌔" }[e.pct], title: `${e.pct}% through`, sub: e.book.title, tone: "lime" });
      if (at) burst(at, { count: 40 + e.pct / 2 });
    }
    if (e.type === "finished") {
      msgs.push({ icon: "🏁", title: "Book finished!", sub: e.book.title, tone: "cyan", big: true });
      rain({ count: 220, emoji: ["📚", "🎉", "⭐", "🏆"] });
    }
    if (e.type === "goal") {
      msgs.push({ icon: "🎯", title: "Daily goal smashed", sub: `${state.goal} pages today`, tone: "lime", big: true });
      burst(at || $("#goal"), { count: 90, emoji: ["🎯", "✅"] });
    }
    if (e.type === "streak") msgs.push({ icon: "🔥", title: `${e.days}-day streak`, sub: "Come back tomorrow to keep it", tone: "sun" });
    if (e.type === "level") {
      msgs.push({ icon: "🆙", title: `Level ${e.level}`, sub: `You're a ${e.title} now`, tone: "violet", big: true });
      rain({ count: 160, emoji: ["🆙", "⚡"] });
      bump($("#level"));
    }
    if (e.type === "badge") {
      msgs.push({ icon: e.badge.emoji, title: `Badge: ${e.badge.name}`, sub: e.badge.text, tone: "sun" });
      if (!events.some((x) => x.type === "level" || x.type === "finished")) burst(at || island.el, { count: 50 });
    }
    if (e.type === "egg" && e.fresh) msgs.push({ icon: "🥚", title: `Easter egg: ${e.label}`, sub: "New egg found", tone: "pink" });
  }
  if (!msgs.length && xp) {
    const p = S.pagesOn(state);
    msgs.push({ icon: "⚡", title: `${p} / ${state.goal} pages today`, sub: S.levelProgress(state.xp).title, tone: "lime", bar: Math.min(1, p / state.goal) });
  }
  if (msgs.length && xp) Object.assign(msgs[0], { value: xp, unit: " XP" });
  for (const m of msgs) island.say(m);
}

const bump = (el) => play(el, [{ transform: "scale(1)" }, { transform: "scale(1.35) rotate(-6deg)" }, { transform: "none" }], { duration: 560, easing: SPRING });

/* ============================================================
   Header, stats, badges
   ============================================================ */

function greeting() {
  const hr = new Date().getHours();
  if (hr < 4) return "Night owl mode 🦉";
  if (hr < 12) return "Morning, bookworm ☀️";
  if (hr < 17) return "Afternoon read? 📖";
  if (hr < 21) return "Evening chapter 🌆";
  return "One more chapter? 🌙";
}

let lastStreak = null;
function renderTop() {
  $("#greet").textContent = greeting();
  const lp = S.levelProgress(state.xp);
  $("#lvl-n").textContent = lp.level;
  $("#level").setAttribute("aria-label", `Level ${lp.level}, ${lp.title}. Open your stats`);
  $("#lvl-bar").style.strokeDashoffset = String(97.4 * (1 - lp.frac));
  $("#xp-title").textContent = `Lv ${lp.level} · ${lp.title}`;
  $("#xp-fill").style.width = `${(lp.frac * 100).toFixed(1)}%`;
  $("#xp-num").textContent = `${fmt(lp.into)} / ${fmt(lp.need)} XP`;
  const st = S.streak(state);
  $("#streak-n").textContent = st;
  $("#streak").classList.toggle("lit", st > 0);
  $("#streak").setAttribute("aria-label", `${st}-day reading streak`);
  if (lastStreak != null && st > lastStreak) bump($("#streak"));
  lastStreak = st;
}

function renderStats() {
  const today = S.pagesOn(state);
  const frac = Math.min(1, today / state.goal);
  $("#goal-n").textContent = today;
  $("#goal-of").textContent = `/ ${state.goal}`;
  $("#goal-bar").style.strokeDashoffset = String(169.6 * (1 - frac));
  $("#goal").classList.toggle("done", today >= state.goal);
  $("#goal").setAttribute("aria-label", `${today} of ${state.goal} pages today. Change your goal`);
  const wk = S.week(state);
  const top = Math.max(state.goal, ...wk.map((d) => d.pages));
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  $("#week").replaceChildren(
    ...wk.map((d, i) =>
      h(
        "span",
        { class: `wbar${d.pages >= state.goal ? " hit" : ""}${i === 6 ? " today" : ""}`, vars: { "--h": `${Math.max(4, (d.pages / top) * 100)}%` }, title: `${d.pages} pages` },
        h("i"),
        h("small", { text: names[new Date(`${d.day}T12:00`).getDay()] }),
      ),
    ),
  );
  const sum = wk.reduce((a, d) => a + d.pages, 0);
  $("#week-label").textContent = `${fmt(sum)} this week`;
  $("#tot-books").textContent = fmt(S.finishedCount(state));
  $("#tot-pages").textContent = fmt(S.totalPages(state));
}

function renderBadges() {
  const got = S.BADGES.filter((b) => state.badges[b.id]);
  const strip = $("#badge-strip");
  strip.replaceChildren(
    ...got.map((b) => h("span", { class: "badge got", title: `${b.name}: ${b.text}` }, h("span", { class: "be", text: b.emoji }), h("small", { text: b.name }))),
    h("span", { class: "badge locked" }, h("span", { class: "be", text: "🔒" }), h("small", { text: `${S.BADGES.length - got.length} to go` })),
  );
}

/* ============================================================
   The carousel
   ============================================================ */

const track = $("#track");
const tabs = createTabs(
  $("#tabs"),
  S.SHELVES.map((id) => ({ id, ...SHELF_META[id] })),
  { onChange: (id) => renderShelf(id, { switching: true }) },
);

function cardFor(book) {
  const art = bookArt(book);
  const pct = Math.round((book.page / book.pages) * 100);
  let foot;
  if (book.shelf === "reading") {
    foot = h(
      "div",
      { class: "card-foot" },
      h("div", { class: "prog" }, h("i", { vars: { "--p": `${pct}%` } })),
      h(
        "div",
        { class: "card-row" },
        h("span", { class: "card-sub", text: `p. ${book.page} of ${book.pages} · ${pct}%` }),
        h("button", { type: "button", class: "pill plus", "data-act": "plus", "aria-label": `Log 10 pages of ${book.title}`, text: "+10" }),
      ),
    );
  } else if (book.shelf === "want") {
    foot = h(
      "div",
      { class: "card-foot" },
      h(
        "div",
        { class: "card-row" },
        h("span", { class: "card-sub", text: `${book.pages} pages${book.year ? ` · ${book.year}` : ""}` }),
        h("button", { type: "button", class: "pill go", "data-act": "start", "aria-label": `Start reading ${book.title}`, text: "Start ▸" }),
      ),
    );
  } else {
    foot = h(
      "div",
      { class: "card-foot" },
      h(
        "div",
        { class: "card-row" },
        h("span", { class: "stars sm", "aria-label": book.rating ? `${book.rating} stars` : "Not rated" }, [1, 2, 3, 4, 5].map((n) => h("i", { class: n <= book.rating ? "on" : "", text: "★" }))),
        h("span", { class: "card-sub", text: book.finished ? new Date(book.finished).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "" }),
      ),
    );
  }
  const card = h(
    "article",
    { class: `card ${book.shelf}`, "data-id": book.id, vars: { "--c1": art.style.getPropertyValue("--c1"), "--c2": art.style.getPropertyValue("--c2") } },
    h(
      "div",
      { class: "card-in" },
      h("i", { class: "card-glow", "aria-hidden": "true" }),
      h("button", { type: "button", class: "card-open", "aria-label": `${book.title}${book.author ? ` by ${book.author}` : ""}. Open` }, art),
      h("h3", { class: "card-title", text: book.title }),
      h("p", { class: "card-author", text: book.author || "Unknown author" }),
      foot,
      book.shelf === "read" ? h("span", { class: "done-stamp", "aria-hidden": "true", text: "DONE" }) : null,
    ),
  );
  tiltable(card.querySelector(".card-open"));
  return card;
}

function addCard() {
  return h(
    "article",
    { class: "card add", "data-id": "add" },
    h(
      "div",
      { class: "card-in" },
      h(
        "button",
        { type: "button", class: "add-btn", "aria-label": "Add a book" },
        h("span", { class: "add-ring", "aria-hidden": "true" }),
        h("span", { class: "add-plus", "aria-hidden": "true", text: "+" }),
        h("b", { text: "Add a book" }),
        h("small", { text: "Search millions of titles" }),
      ),
    ),
  );
}

let shownShelf = null;
let order = [];
const cardCache = new Map(); // id -> { key, el }: unchanged books keep their card (and loaded cover)
const cardKey = (b) => JSON.stringify([b.title, b.author, b.cover, b.pages, b.shelf, b.rating, b.finished]);

/** Small changes (a page logged) update the card in place, so its bar can glide. */
function patchCard(el, book) {
  if (book.shelf !== "reading") return;
  const pct = Math.round((book.page / book.pages) * 100);
  el.querySelector(".prog i")?.style.setProperty("--p", `${pct}%`);
  const sub = el.querySelector(".card-sub");
  if (sub) sub.textContent = `p. ${book.page} of ${book.pages} · ${pct}%`;
}

async function renderShelf(name = tabs.current, { switching = false, focusId = null } = {}) {
  let books = S.shelf(state, name);
  const changed = shownShelf !== name;
  const fresh = switching || changed;
  const prevScroll = track.scrollLeft;
  shownShelf = name;
  document.body.dataset.shelf = name;
  const animate = fresh && !prefersReducedMotion();

  if (fresh) cardCache.clear();
  else {
    // Keep cards where they are while you're looking at them; re-sort on the next visit.
    const pos = new Map(order.map((id, i) => [id, i]));
    books.sort((a, b) => (pos.get(a.id) ?? -1) - (pos.get(b.id) ?? -1));
  }
  order = books.map((b) => b.id);

  if (animate && track.children.length) {
    await Promise.all(
      $$(".card-in", track).map((el, i) => play(el, [{ transform: "none", opacity: 1 }, { transform: "translateY(30px) scale(0.85)", opacity: 0 }], { duration: 180, delay: i * 20, easing: "ease-in", fill: "forwards" })),
    );
    if (shownShelf !== name) return; // switched again mid-animation
  }
  const els = books.map((b) => {
    const key = cardKey(b);
    const hit = cardCache.get(b.id);
    if (hit && hit.key === key) {
      patchCard(hit.el, b);
      return hit.el;
    }
    const el = cardFor(b);
    cardCache.set(b.id, { key, el });
    return el;
  });
  for (const id of cardCache.keys()) if (!order.includes(id)) cardCache.delete(id);
  track.replaceChildren(...els, addCard());
  if (fresh) track.scrollLeft = 0;
  else track.scrollLeft = prevScroll;
  if (focusId) {
    const card = track.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
    if (card) track.scrollLeft = card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
  }
  centred = -1;
  paintCarousel();
  if (animate) {
    $$(".card-in", track).forEach((el, i) =>
      el.animate([{ transform: "translateY(60px) scale(0.7) rotate(-4deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 760, delay: 60 + i * 70, easing: SPRING, fill: "backwards" }),
    );
  }
  renderUnder();
}

// Cards curve away from the middle one, like a fanned hand.
let raf = 0;
let centred = -1;
function paintCarousel() {
  raf = 0;
  const mid = track.scrollLeft + track.clientWidth / 2;
  const cards = track.children;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const w = c.offsetWidth || 1;
    const d = clamp((c.offsetLeft + w / 2 - mid) / (w * 0.9), -2.5, 2.5);
    const a = Math.abs(d);
    c.style.transform = `perspective(1100px) translateZ(${(-a * 90).toFixed(1)}px) rotateY(${(-d * 24).toFixed(2)}deg) translateY(${(a * 14).toFixed(1)}px)`;
    c.style.opacity = String(Math.max(0.25, 1 - a * 0.32));
    c.style.zIndex = String(100 - Math.round(a * 10));
    if (a < bestD) {
      bestD = a;
      best = i;
    }
  }
  for (let i = 0; i < cards.length; i++) cards[i].classList.toggle("alive", i === best);
  if (best !== centred) {
    if (centred !== -1) buzz(4);
    centred = best;
    dots(cards.length, best);
  }
}
track.addEventListener("scroll", () => (raf ||= requestAnimationFrame(paintCarousel)), { passive: true });
addEventListener("resize", () => (raf ||= requestAnimationFrame(paintCarousel)));

function dots(n, on) {
  const root = $("#dots");
  if (root.children.length !== n) root.replaceChildren(...Array.from({ length: n }, (_, i) => h("i", { class: i === n - 1 ? "plus" : "" })));
  [...root.children].forEach((d, i) => d.classList.toggle("on", i === on));
}

track.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  // A tap on a side card brings it to the middle first.
  const i = [...track.children].indexOf(card);
  if (i !== centred && !e.target.closest("[data-act]")) {
    track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    return;
  }
  if (card.dataset.id === "add") return openAdd();
  const book = state.books.find((b) => b.id === card.dataset.id);
  if (!book) return;
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "plus") {
    const btn = e.target.closest("[data-act]");
    bump(btn);
    commit(S.setPage(state, book.id, book.page + 10), btn);
    return;
  }
  if (act === "start") return commit(S.moveBook(state, book.id, "reading"), e.target);
  openBook(book.id, card.querySelector(".book"));
});

function renderUnder() {
  const root = $("#under");
  const name = shownShelf;
  const items = [];
  if (!state.books.length) {
    items.push(
      h("p", { class: "hint", text: "Your shelves are empty. Tap the + card to add a book, or:" }),
      h("button", { type: "button", class: "btn hot", id: "starter", on: { click: loadStarter } }, "⚡ Load a starter stack"),
    );
  } else if (name === "want" && S.shelf(state, "want").length) {
    items.push(h("button", { type: "button", class: "btn lime wiggle", id: "pick", on: { click: openPick } }, "🎲 Pick my next read"));
  } else if (name === "reading" && S.shelf(state, "reading").length) {
    items.push(h("p", { class: "hint", text: "Tap a book to log pages. Poke a cover for a surprise 👀" }));
  } else if (name === "read" && S.shelf(state, "read").length) {
    const pages = S.shelf(state, "read").reduce((a, b) => a + b.pages, 0);
    const n = S.finishedCount(state);
    items.push(h("p", { class: "hint", text: `${n} ${n === 1 ? "book" : "books"}, ${fmt(pages)} pages conquered 💪` }));
  } else {
    items.push(h("p", { class: "hint", text: name === "read" ? "Finish a book and it lands here, with confetti." : name === "want" ? "Books you want to read go here." : "Nothing on the go. Start something from your Want pile." }));
  }
  root.replaceChildren(...items);
}

function loadStarter(e) {
  let s = state;
  const ids = [];
  for (const b of STARTER) {
    const r = S.addBook(s, b);
    s = r.state;
    const book = s.books[s.books.length - 1];
    // Starter books arrive part-read, without pretending you read those pages today.
    if (b.page) book.page = book.best = b.page;
    if (b.rating) book.rating = b.rating;
    book.touched -= ids.length;
    ids.push(book.id);
  }
  s = { ...s, xp: state.xp + 50 };
  commit({ state: s, events: [{ type: "xp", amount: 50 }, { type: "starter" }] }, e?.target);
  burst(track, { count: 80 });
  renderShelf(tabs.current, { switching: true });
}

/* ============================================================
   A book, up close
   ============================================================ */

const bookSheet = sheet($("#sheet-book"), { onClose: () => renderShelf(tabs.current) });
let openId = null;
let pokes = 0;

function openBook(id, fromArt) {
  openId = id;
  pokes = 0;
  drawBook();
  bookSheet.show();
  // The cover flies from the card into the sheet.
  const to = $("#book-body .bk-art .book");
  if (fromArt && to && !prefersReducedMotion()) {
    requestAnimationFrame(() => {
      const a = fromArt.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      if (!b.width) return;
      to.animate(
        [
          { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`, transformOrigin: "top left" },
          { transform: "none", transformOrigin: "top left" },
        ],
        { duration: 700, easing: SPRING },
      );
    });
  }
}

function drawBook() {
  const book = state.books.find((b) => b.id === openId);
  const body = $("#book-body");
  if (!book) return body.replaceChildren();
  const art = bookArt(book, { size: "lg" });
  art.classList.add("alive");
  const artWrap = h("button", { type: "button", class: "bk-art", "aria-label": "Poke the cover" }, art);
  tiltable(artWrap, art);
  const eggs = state.eggs.filter((t) => t.startsWith(`${book.id}:`)).length;
  const theme = themedEgg(book);
  const pokeBtn = h("button", { type: "button", class: "pill poke", "aria-label": "Poke the cover for a surprise" }, `✨ Poke it`, h("small", { text: eggs ? ` · ${eggs} found` : theme ? " · there's a secret" : "" }));

  const doPoke = async () => {
    const res = await poke(book, art, pokes++);
    const r = S.findEgg(state, book.id, res.egg);
    r.events.forEach((e) => e.type === "egg" && (e.label = res.label));
    if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, artWrap);
    else floatText(artWrap, res.label, "#ff6bd6");
    const n = state.eggs.filter((t) => t.startsWith(`${book.id}:`)).length;
    pokeBtn.querySelector("small").textContent = n ? ` · ${n} found` : "";
  };
  artWrap.addEventListener("click", doPoke);
  pokeBtn.addEventListener("click", doPoke);

  const seg = h(
    "div",
    { class: "seg small", role: "radiogroup", "aria-label": "Shelf" },
    S.SHELVES.map((id) =>
      h(
        "button",
        { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(book.shelf === id), vars: { "--tone": SHELF_META[id].tone }, on: { click: (e) => moveTo(id, e.currentTarget) } },
        `${SHELF_META[id].emoji} ${SHELF_META[id].label}`,
      ),
    ),
  );

  const parts = [
    h("div", { class: "bk-hero" }, artWrap, pokeBtn),
    h("h2", { class: "bk-title", id: "bk-title", text: book.title }),
    h("p", { class: "bk-by", text: [book.author, book.year].filter(Boolean).join(" · ") || "Unknown author" }),
    seg,
  ];
  parts.push(book.shelf === "read" ? finishedPanel(book) : tracker(book));
  parts.push(removeButton(book));
  body.replaceChildren(...parts);
}

function moveTo(id, el) {
  const book = state.books.find((b) => b.id === openId);
  if (!book || book.shelf === id) return;
  commit(S.moveBook(state, book.id, id), el);
  drawBook();
}

/** The page tracker: a big number, a scroll wheel, quick-add buttons and a slider, all in sync. */
function tracker(book) {
  let page = book.page;
  let saveTimer = 0;
  const big = h("b", { class: "bk-page", text: String(page) });
  const pct = h("span", { class: "bk-pct" });
  const left = h("span", { class: "bk-left" });
  const fill = h("i");
  const slider = h("input", { type: "range", min: "0", max: String(book.pages), value: String(page), class: "slider", "aria-label": "Page you're on" });

  const show = (v, from) => {
    page = v;
    big.textContent = String(v);
    const p = Math.round((v / book.pages) * 100);
    pct.textContent = `${p}%`;
    const rest = book.pages - v;
    left.textContent = rest ? `${rest} pages to go · about ${eta(rest)}` : "Last page! 🎉";
    fill.style.setProperty("--p", `${(v / book.pages) * 100}%`);
    slider.style.setProperty("--p", `${(v / book.pages) * 100}%`);
    if (from !== "slider") slider.value = String(v);
    if (from !== "wheel") wheel.set(v, from === "quick");
    if (from) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, from === "quick" ? 450 : 650);
    }
  };
  const save = () => {
    const cur = state.books.find((b) => b.id === book.id);
    if (!cur || cur.page === page) return;
    const was = cur.shelf;
    const r = commit(S.setPage(state, book.id, page), big);
    if (r.events.some((e) => e.type === "milestone")) bump(big);
    const now = state.books.find((b) => b.id === book.id);
    if (now && now.shelf !== was && now.shelf === "read") setTimeout(drawBook, 400);
    else if (now && now.shelf !== was) drawBook();
  };

  const wheel = createWheel({ max: book.pages, value: page, label: `Page, of ${book.pages}`, onInput: (v) => show(v, "wheel") });
  slider.addEventListener("input", () => show(Number(slider.value), "slider"));
  const quick = h(
    "div",
    { class: "quick" },
    [1, 5, 10, 25].map((n) =>
      h("button", { type: "button", class: "pill q", "aria-label": `Add ${n} pages`, on: { click: (e) => (bump(e.currentTarget), show(Math.min(book.pages, page + n), "quick")) } }, `+${n}`),
    ),
    h("button", { type: "button", class: "pill q done", "aria-label": "Finished it", on: { click: () => show(book.pages, "quick") } }, "🏁 Finished it"),
  );

  const panel = h(
    "div",
    { class: "tracker" },
    h("div", { class: "bk-now" }, h("span", { class: "bk-on", text: "I'm on page" }), big, h("span", { class: "bk-of", text: `of ${book.pages}` }), pct),
    h("div", { class: "bk-bar" }, fill),
    h("div", { class: "bk-pick" }, wheel.el, quick),
    slider,
    left,
  );
  show(page);
  return panel;
}

const eta = (pages) => {
  const min = pages * 1.6;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const hrs = min / 60;
  return hrs < 10 ? `${hrs.toFixed(1).replace(/\.0$/, "")} h` : `${Math.round(hrs)} h`;
};

function finishedPanel(book) {
  const stars = h(
    "div",
    { class: "stars big", role: "radiogroup", "aria-label": "Your rating" },
    [1, 2, 3, 4, 5].map((n) =>
      h("button", {
        type: "button",
        role: "radio",
        class: n <= book.rating ? "on" : "",
        "aria-checked": String(n === book.rating),
        "aria-label": `${n} star${n > 1 ? "s" : ""}`,
        text: "★",
        on: {
          click: (e) => {
            commit(S.rateBook(state, book.id, n), e.currentTarget);
            [...stars.children].forEach((s, i) => {
              s.classList.toggle("on", i < n);
              s.setAttribute("aria-checked", String(i + 1 === n));
              if (i < n) play(s, [{ transform: "scale(1)" }, { transform: "scale(1.6) rotate(20deg)" }, { transform: "none" }], { duration: 480, delay: i * 60, easing: SPRING });
            });
            if (n === 5) burst(e.currentTarget, { count: 50, kinds: ["star"], colors: ["#ffd23d", "#ffb81f", "#fff3b0"] });
          },
        },
      }),
    ),
  );
  const when = book.finished ? new Date(book.finished).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  return h(
    "div",
    { class: "finished" },
    h("p", { class: "fin-line" }, "🏆 Finished", when ? ` on ${when}` : "", ` · ${book.pages} pages`),
    h("p", { class: "fin-ask", text: book.rating ? "Your rating" : "How was it?" }),
    stars,
    h("button", { type: "button", class: "btn ghost", on: { click: (e) => moveTo("reading", e.currentTarget) } }, "🔁 Read it again"),
  );
}

function removeButton(book) {
  let armed = false;
  const btn = h("button", { type: "button", class: "btn danger" }, "Remove from shelves");
  btn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      btn.textContent = "Tap again to remove";
      btn.classList.add("armed");
      setTimeout(() => {
        armed = false;
        btn.textContent = "Remove from shelves";
        btn.classList.remove("armed");
      }, 3000);
      return;
    }
    commit(S.removeBook(state, book.id));
    bookSheet.close();
  });
  return btn;
}

/* ============================================================
   Adding books
   ============================================================ */

let addTo = "want";
let lastAdded = null;
const addSheet = sheet($("#sheet-add"), {
  onClose: () => {
    if (lastAdded) {
      const target = state.books.find((b) => b.id === lastAdded)?.shelf;
      lastAdded = null;
      if (target && target !== tabs.current) tabs.select(target);
      else renderShelf(tabs.current, { switching: true });
    }
  },
});

function openAdd() {
  addTo = tabs.current || "want";
  drawAddShelf();
  addSheet.show();
  const q = $("#q");
  q.value = "";
  $("#results").replaceChildren(suggestions());
  setTimeout(() => q.focus({ preventScroll: true }), 300);
}

function drawAddShelf() {
  $("#add-shelf").replaceChildren(
    ...S.SHELVES.map((id) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "seg-btn",
          "aria-checked": String(addTo === id),
          vars: { "--tone": SHELF_META[id].tone },
          on: {
            click: () => {
              addTo = id;
              drawAddShelf();
            },
          },
        },
        `${SHELF_META[id].emoji} ${SHELF_META[id].label}`,
      ),
    ),
  );
}

function suggestions() {
  const picks = ["Fourth Wing", "Project Hail Mary", "The Hobbit", "Atomic Habits", "Normal People", "Dune"];
  return h(
    "div",
    { class: "suggest" },
    h("p", { class: "hint", text: "Try one of these" }),
    h("div", { class: "chips-row" }, picks.map((p) => h("button", { type: "button", class: "pill", text: p, on: { click: () => ((($("#q").value = p)), runSearch()) } }))),
  );
}

let searchTimer = 0;
$("#q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 320);
});
$("#q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(searchTimer);
    runSearch();
  }
});

async function runSearch() {
  const q = $("#q").value.trim();
  const out = $("#results");
  if (q.length < 2) return out.replaceChildren(suggestions());
  out.replaceChildren(h("div", { class: "loading" }, h("i"), h("i"), h("i")));
  try {
    const found = await searchBooks(q);
    if ($("#q").value.trim() !== q) return;
    if (!found.length) return out.replaceChildren(h("p", { class: "hint", text: `Nothing for "${q}". Try fewer words, or add it yourself below.` }));
    out.replaceChildren(...found.map(resultRow));
    $$(".result", out).forEach((el, i) => el.animate([{ opacity: 0, transform: "translateY(16px) scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: i * 35, easing: SPRING, fill: "backwards" }));
  } catch (err) {
    if (err?.name === "AbortError" && $("#q").value.trim() !== q) return;
    out.replaceChildren(h("p", { class: "hint warn", text: navigator.onLine === false ? "You're offline. You can still add a book by hand below." : "Search is having a moment. Try again, or add it by hand below." }));
  }
}

function resultRow(r) {
  const seed = S.hash(`${r.title}|${r.author}`);
  const have = state.books.find((b) => (r.key && b.key === r.key) || (b.title === r.title && b.author === r.author));
  const btn = h("button", { type: "button", class: `add-one${have ? " added" : ""}`, "aria-label": have ? `${r.title} is already on your shelves` : `Add ${r.title}`, text: have ? "✓" : "+" });
  const row = h(
    "div",
    { class: "result" },
    bookArt({ ...r, seed }, { size: "sm" }),
    h("span", { class: "r-text" }, h("b", { text: r.title }), h("small", { text: [r.author, r.year, r.pages ? `${r.pages} pages` : null].filter(Boolean).join(" · ") })),
    btn,
  );
  row.addEventListener("click", () => {
    if (btn.classList.contains("added")) return;
    const res = commit(S.addBook(state, { ...r, pages: r.pages || 300, shelf: addTo, seed }), btn);
    lastAdded = res.events.find((e) => e.type === "added")?.book.id;
    btn.textContent = "✓";
    btn.classList.add("added");
    btn.setAttribute("aria-label", `${r.title} added`);
    burst(btn, { count: 36, power: 0.7 });
    play(row.querySelector(".book"), [{ transform: "none" }, { transform: "translateY(-14px) rotate(-8deg) scale(1.1)" }, { transform: "none" }], { duration: 600, easing: SPRING });
  });
  return row;
}

$("#m-add").addEventListener("click", (e) => {
  const title = $("#m-title").value.trim();
  if (!title) {
    $("#m-title").focus();
    play($("#m-title"), [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(-4px)" }, { transform: "none" }], { duration: 360 });
    return;
  }
  const res = commit(S.addBook(state, { title, author: $("#m-author").value, pages: $("#m-pages").value, shelf: addTo }), e.currentTarget);
  lastAdded = res.events.find((x) => x.type === "added")?.book.id;
  burst(e.currentTarget, { count: 60 });
  $("#m-title").value = "";
  $("#m-author").value = "";
  addSheet.close();
});

/* ============================================================
   Pick my next read
   ============================================================ */

const pickSheet = sheet($("#sheet-pick"), { onClose: () => renderShelf(tabs.current) });
function openPick() {
  const pile = S.shelf(state, "want");
  createDeck($("#deck"), {
    cards: pile,
    render: (book) =>
      h(
        "div",
        { class: "deck-in" },
        bookArt(book, { size: "lg" }),
        h("div", { class: "deck-meta" }, h("b", { text: book.title }), h("small", { text: [book.author, `${book.pages} pages`].filter(Boolean).join(" · ") })),
      ),
    onRight: (book) => {
      commit(S.moveBook(state, book.id, "reading"), $("#deck"));
      burst($("#deck"), { count: 70, emoji: ["📖", "💖"] });
      setTimeout(() => {
        pickSheet.close();
        tabs.select("reading");
      }, 700);
    },
    onLeft: () => {},
  });
  pickSheet.show();
  setTimeout(() => $("#deck").focus({ preventScroll: true }), 200);
}

/* ============================================================
   You: level, badges, goal
   ============================================================ */

const meSheet = sheet($("#sheet-me"));
function openMe() {
  drawMe();
  meSheet.show();
}

function drawMe() {
  const lp = S.levelProgress(state.xp);
  const goalVal = h("b", { class: "goal-val", text: String(state.goal) });
  const setG = (g, el) => {
    commit(S.setGoal(state, g));
    goalVal.textContent = String(state.goal);
    if (el) bump(el);
  };
  $("#me-body").replaceChildren(
    h(
      "div",
      { class: "me-hero" },
      h("span", { class: "me-lvl" }, h("small", { text: "LEVEL" }), h("b", { text: String(lp.level) })),
      h("div", {}, h("h2", { class: "sheet-title", id: "me-title", text: lp.title }), h("p", { class: "hint", text: `${fmt(state.xp)} XP · ${fmt(lp.need - lp.into)} XP to level ${lp.level + 1}` }), h("div", { class: "xp-bar big" }, h("i", { vars: { width: `${(lp.frac * 100).toFixed(1)}%` } }))),
    ),
    h(
      "div",
      { class: "me-stats" },
      [
        ["🔥", S.streak(state), "day streak"],
        ["📚", S.finishedCount(state), "finished"],
        ["📄", fmt(S.totalPages(state)), "pages"],
        ["🥚", state.eggs.length, "eggs"],
      ].map(([e, n, l]) => h("span", { class: "me-stat" }, h("i", { text: e }), h("b", { text: String(n) }), h("small", { text: l }))),
    ),
    h(
      "div",
      { class: "goal-set" },
      h("span", { class: "label", text: "Daily goal" }),
      h("button", { type: "button", class: "pill round", "aria-label": "Lower goal", on: { click: (e) => setG(state.goal - 5, e.currentTarget) } }, "−"),
      goalVal,
      h("span", { class: "unit", text: "pages" }),
      h("button", { type: "button", class: "pill round", "aria-label": "Raise goal", on: { click: (e) => setG(state.goal + 5, e.currentTarget) } }, "+"),
    ),
    h("h3", { class: "me-h", text: `Badges · ${Object.keys(state.badges).length}/${S.BADGES.length}` }),
    h(
      "div",
      { class: "badge-grid" },
      S.BADGES.map((b) => {
        const got = state.badges[b.id];
        return h("span", { class: `badge ${got ? "got" : "locked"}` }, h("span", { class: "be", text: got ? b.emoji : "?" }), h("b", { text: b.name }), h("small", { text: b.text }));
      }),
    ),
    h(
      "div",
      { class: "me-actions" },
      h("button", { type: "button", class: "btn ghost", on: { click: exportData } }, "⬇️ Back up"),
      h("label", { class: "btn ghost" }, "⬆️ Restore", h("input", { type: "file", accept: "application/json,.json", hidden: true, on: { change: importData } })),
    ),
  );
  $$(".badge.got", $("#me-body")).forEach((el, i) => el.animate([{ transform: "scale(0.4) rotate(-20deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 600, delay: 120 + i * 50, easing: SPRING, fill: "backwards" }));
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
    render();
    renderShelf(tabs.current, { switching: true });
    drawMe();
    island.say({ icon: "✅", title: "Shelves restored", sub: `${state.books.length} books`, tone: "lime" });
  } catch {
    island.say({ icon: "🤔", title: "That file didn't work", sub: "Pick a Shelfie backup (.json)", tone: "pink" });
  }
}

/* ============================================================
   Secrets
   ============================================================ */

// Tap the logo five times quickly.
let logoTaps = [];
$("#logo").addEventListener("click", () => {
  const now = Date.now();
  logoTaps = logoTaps.filter((t) => now - t < 1500).concat(now);
  play($("#logo"), [{ transform: "none" }, { transform: `rotate(${logoTaps.length % 2 ? -6 : 6}deg) scale(1.08)` }, { transform: "none" }], { duration: 300, easing: SPRING });
  if (logoTaps.length >= 5) {
    logoTaps = [];
    document.body.classList.add("party");
    setTimeout(() => document.body.classList.remove("party"), 4000);
    rain({ count: 200, emoji: ["📚", "🪩", "✨", "🦄"] });
    const r = S.findEgg(state, "app", "party");
    r.events.forEach((e) => e.type === "egg" && (e.label = "Party shelf"));
    if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, $("#logo"));
    else island.say({ icon: "🪩", title: "Party shelf", sub: "You already knew that one", tone: "violet" });
  }
});

// The good old Konami code, on a keyboard.
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
let kIdx = 0;
addEventListener("keydown", (e) => {
  kIdx = e.key === KONAMI[kIdx] ? kIdx + 1 : e.key === KONAMI[0] ? 1 : 0;
  if (kIdx < KONAMI.length) return;
  kIdx = 0;
  const r = S.findEgg(state, "app", "konami");
  r.events.forEach((e) => e.type === "egg" && (e.label = "Cheat code"));
  commit(r, island.el);
  rain({ count: 160, emoji: ["🎮", "👾", "🕹️"] });
});

/* ============================================================
   Wiring
   ============================================================ */

$("#level").addEventListener("click", openMe);
$("#goal").addEventListener("click", openMe);
$("#badges-all").addEventListener("click", openMe);
$("#streak").addEventListener("click", (e) => {
  const n = S.streak(state);
  bump(e.currentTarget);
  island.say(n ? { icon: "🔥", title: `${n}-day streak`, sub: S.pagesOn(state) ? "You've read today. Legend." : "Read a page today to keep it alive", tone: "sun" } : { icon: "🕯️", title: "No streak yet", sub: "Log a page today to light it", tone: "sun" });
});

function render() {
  renderTop();
  renderStats();
  renderBadges();
  tabs.counts(Object.fromEntries(S.SHELVES.map((id) => [id, S.shelf(state, id).length])));
  // While a sheet covers the shelf, refresh it when the sheet closes instead.
  if (shownShelf && !document.documentElement.classList.contains("sheet-open")) renderShelf(tabs.current);
}

// Keep the streak and "today" honest if the app stays open past midnight.
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && render());

const first = S.shelf(state, "reading").length ? "reading" : S.shelf(state, "want").length ? "want" : state.books.length ? "read" : "reading";
tabs.select(first, { silent: true, animate: false });
render();
renderShelf(first, { switching: true });
if (!state.seen) {
  state = { ...state, seen: true };
  S.save(globalThis.localStorage, state);
  setTimeout(() => island.say({ icon: "👋", title: "Welcome to Shelfie", sub: "Add a book to start levelling up", tone: "pink" }), 700);
}

// Exposed for the browser tests.
globalThis.__shelfie = { get state() { return state; } };

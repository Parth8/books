// Adding books: the search panel you pull up from the + stamp, and the starter stack.

import { h, $, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { bookStamp } from "../js/stamp.js";
import { createPanel } from "../js/panel.js";
import { burst } from "../js/confetti.js";
import { feel } from "../js/sfx.js";
import { searchBooks } from "../js/search.js";
import { Spring, Velocity, rubber } from "../js/physics.js";
import { state } from "./state.js";
import { book, deck, deckEl, renderShelf, SHELF, shelf, STARTER, switchShelf } from "./boot.js";
import { commit } from "./celebrate.js";
import { fill } from "./import.js";
import { panelProgress } from "./panels.js";

/* ---------------- Adding books (pull up the + stamp) ---------------- */

// Books you add land on the shelf you were looking at when you opened search.
let addShelf = "want";
function drawLegend() {
  const lab = (to, text) => h("span", { class: `lg ${to}` }, text);
  $("#legend").replaceChildren(lab(addShelf, `TAP → ${SHELF[addShelf].label}`), h("span", { class: "lg-or", text: "OR SWIPE" }), lab("want", "→ WANT"), lab("reading", "→→ READING"), lab("read", "→→→ READ"));
  $("#m-add").querySelector("span").textContent = `ADD TO ${SHELF[addShelf].label}`;
  $("#add-title").textContent = `ADD TO ${SHELF[addShelf].label}`;
}

export const add = createPanel($("#panel-add"), {
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
export let added = [];
export function openAdd({ manual = false } = {}) {
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
export function row(r) {
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

export function loadStarter(el) {
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
  switchShelf("reading", { force: true }); // (even if you're on it: the new books deal in)
}

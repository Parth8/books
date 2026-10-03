// Reading: turning pages by dragging up on a book (scrubbing), with momentum, and saving the page a moment after you stop.

import { clamp, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { pages as flutter, shockwave } from "../js/confetti.js";
import { feel } from "../js/sfx.js";
import { state } from "./state.js";
import { book, deck, deckEl, hints, liquid, patchStamp, renderShelf } from "./boot.js";
import { commit, maybeJackpot } from "./celebrate.js";
import { renderDock, updateScreen } from "./dock.js";

/* ---------------- reading: scrub, dial, keys ---------------- */

export let live = null; // { id, page, carry }
let saveTimer = 0;
let coast = 0;

export function startScrub(id) {
  cancelAnimationFrame(coast);
  const b = book(id);
  live = { id, page: live?.id === id ? live.page : b.page, carry: 0 };
  deck.top?.el.classList.add("scrubbing");
}

function pxPerPage(b) {
  return clamp(300 / Math.min(b.pages, 50), 4, 30);
}

export function scrub(id, dy, vy) {
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

export function endScrub(id, vy) {
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

export function nudge(id, n) {
  const b = book(id);
  if (!b) return;
  live = { id, page: live?.id === id ? live.page : b.page, carry: 0 };
  setLive(b, live.page + n);
  liquid?.splash(n > 0 ? 0.5 : -0.3, Math.random());
  saveSoon(600);
}

/** The page you're on in a book, while you're turning pages (saved a moment after you stop). */
export function liveFor(b) {
  if (!live || live.id !== b.id) live = { id: b.id, page: b.page, carry: 0 };
  return live;
}

export function setLive(b, page) {
  const p = clamp(page, 0, b.pages);
  liveFor(b);
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

export function showPageLabel(p, b) {
  const lbl = deck.top?.el.querySelector(".pg");
  if (!lbl) return;
  lbl.textContent = `P.${p}`;
  lbl.parentElement.style.setProperty("--lvl", String(p / b.pages)); // (on the lid: the page label and the ripple both ride the level)
}

export function saveSoon(ms) {
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

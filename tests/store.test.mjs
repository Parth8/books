// Unit tests for the data and gamification rules.
//   node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/store.js";

const day = (d, h = 12) => new Date(2026, 9, d, h, 0, 0); // October 2026, local time

function withBook(input = {}, now = day(1)) {
  const r = S.addBook(S.empty(), { title: "Dune", author: "Frank Herbert", pages: 400, shelf: "reading", ...input }, now);
  return { state: r.state, id: r.state.books[0].id, events: r.events };
}

test("levels: 0, 100, 300, 600, 1000 XP", () => {
  assert.equal(S.levelOf(0), 1);
  assert.equal(S.levelOf(99), 1);
  assert.equal(S.levelOf(100), 2);
  assert.equal(S.levelOf(299), 2);
  assert.equal(S.levelOf(300), 3);
  assert.equal(S.levelOf(1000), 5);
  for (let n = 1; n < 20; n++) assert.equal(S.levelOf(S.levelFloor(n)), n);
  const p = S.levelProgress(150);
  assert.deepEqual([p.level, p.into, p.need], [2, 50, 200]);
});

test("adding a book pays XP and unlocks the first badge", () => {
  const { state, events } = withBook();
  assert.equal(state.xp, S.XP.add);
  assert.equal(state.books[0].shelf, "reading");
  assert.ok(events.some((e) => e.type === "badge" && e.badge.id === "first-add"));
  assert.ok(events.some((e) => e.type === "added"));
});

test("addBook cleans its input", () => {
  const { state } = withBook({ title: "  ", pages: "abc", shelf: "nope", cover: "x" });
  const b = state.books[0];
  assert.equal(b.title, "Untitled");
  assert.equal(b.pages, 300);
  assert.equal(b.shelf, "want");
  assert.equal(b.cover, null);
  const big = withBook({ pages: 99999 }).state.books[0];
  assert.equal(big.pages, 5000);
});

test("pages logged add XP, today's count and milestones", () => {
  const { state, id } = withBook();
  const r = S.setPage(state, id, 120, day(2));
  assert.equal(r.state.books[0].page, 120);
  assert.equal(S.pagesOn(r.state, day(2)), 120);
  assert.equal(r.state.xp, S.XP.add + 120);
  assert.deepEqual(r.events.filter((e) => e.type === "milestone").map((e) => e.pct), [25]);
  assert.ok(r.events.some((e) => e.type === "badge" && e.badge.id === "pages-100"));
  assert.ok(r.events.some((e) => e.type === "badge" && e.badge.id === "goal"));
});

test("scrolling back and forth can't farm XP", () => {
  let { state, id } = withBook();
  state = S.setPage(state, id, 50, day(2)).state;
  const xp = state.xp;
  state = S.setPage(state, id, 10, day(2)).state;
  state = S.setPage(state, id, 50, day(2)).state;
  assert.equal(state.xp, xp);
  assert.equal(S.pagesOn(state, day(2)), 50);
  state = S.setPage(state, id, 60, day(2)).state;
  assert.equal(state.xp, xp + 10);
});

test("the last page finishes the book", () => {
  const { state, id } = withBook();
  const r = S.setPage(state, id, 400, day(2));
  const b = r.state.books[0];
  assert.equal(b.shelf, "read");
  assert.ok(b.finished);
  assert.ok(r.events.some((e) => e.type === "finished"));
  assert.equal(r.events.filter((e) => e.type === "milestone").length, 0, "no 25/50/75 spam when finishing in one go");
  assert.equal(r.state.xp, S.XP.add + 400 + S.XP.finish);
  assert.ok(r.events.some((e) => e.type === "level"));
});

test("reading a want-to-read book moves it to reading", () => {
  const { state, id } = withBook({ shelf: "want" });
  const r = S.setPage(state, id, 5, day(2));
  assert.equal(r.state.books[0].shelf, "reading");
  assert.ok(r.events.some((e) => e.type === "moved" && e.shelf === "reading"));
});

test("moving a book to read counts its unread pages once", () => {
  let { state, id } = withBook();
  state = S.setPage(state, id, 100, day(2)).state;
  const r = S.moveBook(state, id, "read", day(2));
  assert.equal(S.pagesOn(r.state, day(2)), 400);
  assert.equal(r.state.books[0].page, 400);
  // Read it again: starts from zero and doesn't pay for the same pages twice.
  const again = S.moveBook(r.state, id, "reading", day(3));
  assert.equal(again.state.books[0].page, 0);
  const re = S.setPage(again.state, id, 200, day(3));
  assert.equal(S.pagesOn(re.state, day(3)), 0);
});

test("streaks count days in a row, and survive until the day ends", () => {
  let { state, id } = withBook();
  state = S.setPage(state, id, 10, day(1)).state;
  state = S.setPage(state, id, 20, day(2)).state;
  const r = S.setPage(state, id, 30, day(3));
  assert.equal(S.streak(r.state, day(3)), 3);
  assert.ok(r.events.some((e) => e.type === "streak" && e.days === 3));
  assert.ok(r.events.some((e) => e.type === "badge" && e.badge.id === "streak-3"));
  assert.equal(S.streak(r.state, day(4)), 3, "not broken yet on the next morning");
  assert.equal(S.streak(r.state, day(5)), 0, "broken after a full day off");
});

test("week gives seven days, oldest first", () => {
  let { state, id } = withBook();
  state = S.setPage(state, id, 15, day(7)).state;
  const w = S.week(state, day(7));
  assert.equal(w.length, 7);
  assert.equal(w[6].pages, 15);
  assert.equal(w[0].day, "2026-10-01");
});

test("night owl badge between midnight and 4 AM", () => {
  const { state, id } = withBook();
  const r = S.setPage(state, id, 5, day(2, 1));
  assert.ok(r.events.some((e) => e.type === "badge" && e.badge.id === "owl"));
});

test("each egg pays once per book", () => {
  const { state, id } = withBook();
  const a = S.findEgg(state, id, "spice");
  assert.equal(a.state.xp, state.xp + S.XP.egg);
  const egg = (r) => r.events.find((e) => e.type === "egg");
  assert.ok(egg(a).fresh);
  const b = S.findEgg(a.state, id, "spice");
  assert.equal(b.state.xp, a.state.xp);
  assert.equal(egg(b).fresh, false);
  const c = S.findEgg(b.state, id, "flip");
  assert.equal(c.state.xp, a.state.xp + S.XP.egg);
});

test("rating pays once", () => {
  const { state, id } = withBook({ shelf: "read" });
  const a = S.rateBook(state, id, 4);
  const b = S.rateBook(a.state, id, 5);
  assert.equal(a.state.xp, state.xp + S.XP.rate);
  assert.equal(b.state.xp, a.state.xp);
  assert.equal(b.state.books[0].rating, 5);
});

test("changes never mutate the old state", () => {
  const { state, id } = withBook();
  const snap = JSON.stringify(state);
  S.setPage(state, id, 300);
  S.moveBook(state, id, "read");
  S.findEgg(state, id, "x");
  S.removeBook(state, id);
  assert.equal(JSON.stringify(state), snap);
});

test("save and load round-trip; bad data falls back to empty", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const { state } = withBook();
  assert.ok(S.save(storage, state));
  assert.deepEqual(S.load(storage), state);
  mem.set(S.KEY, "{not json");
  assert.deepEqual(S.load(storage), S.empty());
  mem.set(S.KEY, JSON.stringify({ v: 9, books: [] }));
  assert.deepEqual(S.load(storage), S.empty());
  assert.deepEqual(S.load(null), S.empty());
});

test("shelf sorts by most recently touched", () => {
  let s = S.empty();
  s = S.addBook(s, { title: "A", shelf: "reading" }, day(1)).state;
  s = S.addBook(s, { title: "B", shelf: "reading" }, day(2)).state;
  assert.deepEqual(S.shelf(s, "reading").map((b) => b.title), ["B", "A"]);
  s = S.setPage(s, s.books[0].id, 5, day(3)).state;
  assert.deepEqual(S.shelf(s, "reading").map((b) => b.title), ["A", "B"]);
});

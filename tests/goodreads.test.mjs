import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCSV, fromGoodreads, shelfOf } from "../js/goodreads.js";
import * as S from "../js/store.js";

const CSV = readFileSync(new URL("./fixtures/goodreads.csv", import.meta.url), "utf8");

test("CSV: quotes, doubled quotes, commas and newlines inside quotes, CRLF, a BOM", () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n'), [["a", "b"], ["x, y", 'say "hi"\nthere']]);
  assert.deepEqual(parseCSV("a,b\n1,\n\n"), [["a", "b"], ["1", ""]]);
});

test("Goodreads export → books, with shelves, ratings, dates and ISBNs", () => {
  const { books, counts, skipped } = fromGoodreads(CSV);
  assert.equal(skipped, 1, "a row with no title is skipped");
  assert.deepEqual(counts, { read: 2, reading: 1, want: 1 });
  const dune = books[0];
  assert.equal(dune.title, "Dune (Dune, #1)");
  assert.equal(dune.author, "Frank Herbert");
  assert.equal(dune.isbn, "9780441013593");
  assert.equal(dune.pages, 688);
  assert.equal(dune.year, 1965, "original publication year wins");
  assert.equal(dune.rating, 5);
  assert.equal(dune.shelf, "read");
  assert.equal(dune.key, "gr:234225");
  assert.deepEqual([dune.finished.getFullYear(), dune.finished.getMonth(), dune.finished.getDate()], [2023, 4, 14]);
  assert.equal(books[1].isbn, null, 'an empty ="" ISBN is no ISBN');
  assert.equal(books[1].finished, null);
  assert.equal(books[2].shelf, "reading");
  assert.equal(books[2].rating, 0);
  assert.equal(books[3].shelf, "want");
});

test("not a Goodreads file: a friendly error", () => {
  assert.throws(() => fromGoodreads(""), /empty/);
  assert.throws(() => fromGoodreads("name,age\nbob,3\n"), /doesn't look like a Goodreads export/);
});

test("custom shelves fall back sensibly", () => {
  assert.equal(shelfOf("", "favourites, read"), "read");
  assert.equal(shelfOf("did-not-finish", "did-not-finish"), "want");
  assert.equal(shelfOf("currently-reading"), "reading");
});

test("importing: dedupes, keeps dates and ratings, a capped XP bonus, a sticker", () => {
  const now = new Date(2025, 5, 1, 12);
  const { books } = fromGoodreads(CSV);
  let s = S.addBook(S.empty(), { title: "Dune", author: "Frank Herbert", isbn: "9780441013593", shelf: "want" }, now).state;
  const r = S.importBooks(s, books, now, { source: "goodreads" });
  const ev = r.events.find((e) => e.type === "imported");
  assert.equal(ev.added, 3);
  assert.equal(ev.skipped, 1, "Dune was already here");
  s = r.state;
  assert.equal(s.books.length, 4);
  const hhg = s.books.find((b) => /Hitchhiker/.test(b.title));
  assert.equal(hhg.shelf, "read");
  assert.equal(hhg.rating, 4);
  assert.ok(s.eggs.includes("app:goodreads"));
  assert.ok(s.xp > 0 && s.xp <= 1000);
  // Importing again adds nothing.
  const again = S.importBooks(s, books, now, { source: "goodreads" });
  assert.equal(again.events.find((e) => e.type === "imported").added, 0);
});

test("importing a big library caps the XP bonus", () => {
  const books = Array.from({ length: 300 }, (_, i) => ({ title: `Book ${i}`, author: "A", shelf: "read", finished: new Date(2024, 0, 1, 12) }));
  const s = S.importBooks(S.empty(), books, new Date(2025, 0, 1)).state;
  assert.equal(s.books.length, 300);
  assert.ok(s.xp <= 1000 + 200, `xp ${s.xp}`);
  assert.equal(S.finishedIn(s, "year", new Date(2024, 5, 1)), 300);
});

test("names: cleaned, short, never markup", () => {
  assert.equal(S.cleanName("  <script>Ada</script>  "), "scriptAda/script".slice(0, 24));
  assert.equal(S.cleanName("x".repeat(50)).length, 24);
  assert.equal(S.cleanName("\u0000\u0007"), "");
  const s = S.setName(S.empty(), "  Zoë ", new Date()).state;
  assert.equal(s.name, "Zoë");
});

test("reset: an older copy can't bring the books back when it merges", () => {
  const before = S.addBook(S.empty(), { title: "Old" }, new Date(1000)).state;
  const wiped = S.reset(new Date(5000));
  const merged = S.merge(wiped, before);
  assert.equal(merged.books.length, 0);
  assert.equal(merged.resetAt, wiped.resetAt);
  const after = S.addBook(wiped, { title: "New" }, new Date(6000)).state;
  assert.deepEqual(S.merge(before, after).books.map((b) => b.title), ["New"]);
});

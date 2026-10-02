// Unit tests for turning search answers into books, in the Worker and in the page.
//   node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanGoogle, cleanOpenLibrary } from "../worker/worker.js";
import { cleanWorkerGoogle, cleanOpenLibraryResult } from "../js/search.js";
import * as S from "../js/store.js";

const google = JSON.parse(readFileSync(new URL("./fixtures/google-dune.json", import.meta.url), "utf8"));
const ol = JSON.parse(readFileSync(new URL("./fixtures/search-dune.json", import.meta.url), "utf8"));

test("Google Books: fields, a sharp cover and a plain-text blurb", () => {
  assert.deepEqual(cleanGoogle(google.items[0]), {
    key: "g:B1hSG45JCX4C",
    title: "Dune",
    author: "Frank Herbert",
    pages: 535,
    year: 1990,
    img: "https://books.google.com/books/content?id=B1hSG45JCX4C&printsec=frontcover&img=1&zoom=1&fife=w720-h1080&source=gbs_api",
    cats: "Fiction",
    blurb: "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides.",
  });
});

test("Google Books: odd ids are dropped, missing fields are null", () => {
  assert.equal(cleanGoogle(google.items[2]), null);
  const b = cleanGoogle(google.items[3]);
  assert.equal(b.pages, null);
  assert.equal(b.img, null);
  assert.equal(b.blurb, null);
  assert.equal(cleanGoogle({}), null);
  assert.equal(cleanGoogle(null), null);
});

test("Open Library: fields", () => {
  const b = cleanOpenLibrary(ol.docs[0]);
  assert.equal(b.title, "Dune");
  assert.equal(b.cover, 11481354);
  assert.equal(b.pages, 608);
  assert.equal(b.key, "ol:OL893414W");
});

test("the page re-checks what the Worker sends", () => {
  const good = cleanGoogle(google.items[0]);
  assert.deepEqual(cleanWorkerGoogle(good), good);
  const evil = cleanWorkerGoogle({ ...good, img: "https://evil.example/x.jpg", key: "g:<script>", pages: -4, title: "x".repeat(500) });
  assert.equal(evil.img, null);
  assert.equal(evil.key, null);
  assert.equal(evil.pages, null);
  assert.equal(evil.title.length, 140);
  assert.equal(cleanOpenLibraryResult({ title: "A", cover: "1" }).cover, null);
});

test("only Google cover addresses are stored as images", () => {
  const ok = S.addBook(S.empty(), cleanGoogle(google.items[0])).state.books[0];
  assert.match(ok.img, /^https:\/\/books\.google\.com\//);
  for (const img of ["https://evil.example/x.jpg", "javascript:alert(1)", "http://books.google.com/x"]) assert.equal(S.addBook(S.empty(), { title: "x", img }).state.books[0].img, null);
});

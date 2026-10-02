// Unit tests for turning search answers into books.
//   node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanGoogle, cleanOpenLibrary } from "../js/search.js";
import * as S from "../js/store.js";

const google = JSON.parse(readFileSync(new URL("./fixtures/google-dune.json", import.meta.url), "utf8"));
const ol = JSON.parse(readFileSync(new URL("./fixtures/search-dune.json", import.meta.url), "utf8"));

test("Google Books: fields, a sharp cover and a plain-text blurb", () => {
  const b = cleanGoogle(google.items[0]);
  assert.deepEqual(b, {
    key: "g:B1hSG45JCX4C",
    title: "Dune",
    author: "Frank Herbert",
    pages: 535,
    year: 1990,
    img: "https://books.google.com/books/content?id=B1hSG45JCX4C&printsec=frontcover&img=1&zoom=1&fife=w480-h720&source=gbs_api",
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

test("only Google cover addresses are stored as images", () => {
  const ok = S.addBook(S.empty(), cleanGoogle(google.items[0])).state.books[0];
  assert.match(ok.img, /^https:\/\/books\.google\.com\//);
  const evil = S.addBook(S.empty(), { title: "x", img: "https://evil.example/x.jpg" }).state.books[0];
  assert.equal(evil.img, null);
  const js = S.addBook(S.empty(), { title: "x", img: "javascript:alert(1)" }).state.books[0];
  assert.equal(js.img, null);
});

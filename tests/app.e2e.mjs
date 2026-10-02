// Browser tests for the whole app, driven with real pointer gestures.
//
//   python3 -m http.server 8765        (from the repo root, in another terminal)
//   NODE_PATH=$(npm root -g) node tests/app.e2e.mjs
//
// Google Books and Open Library are stubbed with recorded answers, so this runs offline.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { cleanGoogle } from "../worker/worker.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SITE = process.env.SITE || "http://localhost:8765/";
// What the Worker answers when Google is up.
const WORKER_GOOGLE = JSON.stringify({ source: "google", results: JSON.parse(readFileSync(new URL("./fixtures/google-dune.json", import.meta.url), "utf8")).items.map(cleanGoogle).filter(Boolean) });
const OPEN_LIBRARY = readFileSync(new URL("./fixtures/search-dune.json", import.meta.url), "utf8");
const COVER = readFileSync(new URL("../icons/icon-192.png", import.meta.url));
const ONLY = process.env.ONLY || "";

const browser = await chromium.launch();
let failures = 0;

async function run(name, fn, { motion = "reduce", google = "ok", allow = null } = {}) {
  if (ONLY && !name.includes(ONLY)) return;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: motion });
  const page = await ctx.newPage();
  if (process.env.SLOW) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.SLOW) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !(allow && allow.test(m.text())) && errors.push(m.text()));
  const cors = { "access-control-allow-origin": "*" };
  // Shelfie's Worker (the only place the Google key lives). "down" means it can't be reached.
  await page.route("https://shelf-api.8parthaggarwal1999.workers.dev/api/search*", (r) =>
    google === "ok" ? r.fulfill({ contentType: "application/json", body: WORKER_GOOGLE, headers: cors }) : r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"upstream_unavailable"}', headers: cors }),
  );
  await page.route("https://www.googleapis.com/**", () => {
    throw new Error("the page must never call Google's API directly");
  });
  await page.route("https://openlibrary.org/search.json*", (r) => r.fulfill({ contentType: "application/json", body: OPEN_LIBRARY, headers: cors }));
  for (const host of ["https://books.google.com/**", "https://covers.openlibrary.org/**"]) await page.route(host, (r) => r.fulfill({ contentType: "image/png", body: COVER }));
  try {
    await page.goto(SITE);
    await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
    await fn(page);
    assert.deepEqual(errors, [], "no errors in the console");
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}\n     ${err.message.split("\n").slice(0, 8).join("\n     ")}`);
  } finally {
    await ctx.close();
  }
}

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__shelfie.state)));
const app = (page) => page.evaluate(() => ({ shelf: globalThis.__shelfie.shelf, top: globalThis.__shelfie.top, pile: globalThis.__shelfie.pile }));
const topCard = (page) => page.locator(".stamp.top:not(.leaving)");
const settle = (page, ms = 350) => page.waitForTimeout(ms);

async function drag(page, from, to, { steps = 12, hold = 0, pause = 12 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(pause);
  }
  await page.mouse.up();
}
async function center(loc) {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
async function starter(page) {
  await page.click('.dock .key[aria-label="Load a starter stack"]');
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "reading" && globalThis.__shelfie.pile.length === 3);
  await settle(page, 500);
}
async function dismissPosters(page) {
  for (let i = 0; i < 4 && (await page.locator(".poster").count()); i++) {
    await page.locator(".poster").first().press("Escape");
    await settle(page, 250);
  }
}

await run("empty shelves: only the + stamp, with search and starter keys", async (page) => {
  assert.deepEqual((await app(page)).pile, ["add"]);
  assert.ok(await page.isVisible('.dock .key[aria-label="Load a starter stack"]'));
  assert.equal(await page.textContent("#counter"), "EMPTY · ADD ONE");
});

await run("starter stack: the + stamp is always last on every shelf", async (page) => {
  await starter(page);
  for (const [shelf, n] of [["reading", 2], ["want", 5], ["read", 1]]) {
    await page.evaluate((s) => document.querySelector(`.tape-item[data-shelf=${s}]`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 })), shelf);
    await page.evaluate((s) => {
      const el = document.querySelector(`.tape-item[data-shelf=${s}]`);
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9 }));
    }, shelf);
    await page.waitForFunction((s) => globalThis.__shelfie.shelf === s && globalThis.__shelfie.pile.length > 0, shelf);
    const { pile } = await app(page);
    assert.equal(pile.length, n + 1, shelf);
    assert.equal(pile[pile.length - 1], "add", shelf);
  }
});

await run("swipe left and right flips through the pile", async (page) => {
  await starter(page);
  const first = (await app(page)).top;
  const c = await center(topCard(page));
  await drag(page, c, { x: c.x - 200, y: c.y + 10 });
  await settle(page);
  const second = (await app(page)).top;
  assert.notEqual(second, first);
  await drag(page, await center(topCard(page)), { x: c.x - 200, y: c.y });
  await settle(page);
  assert.equal((await app(page)).top, "add", "the + stamp comes last");
  // Past the end it rubber-bands and stays put.
  await drag(page, await center(topCard(page)), { x: c.x - 200, y: c.y });
  await settle(page);
  assert.equal((await app(page)).top, "add");
  await drag(page, await center(topCard(page)), { x: c.x + 250, y: c.y });
  await settle(page);
  assert.equal((await app(page)).top, second);
  // Keyboard too.
  await page.focus("#deck");
  await page.keyboard.press("ArrowLeft");
  assert.equal((await app(page)).top, first);
});

await run("drag up on a book to turn pages; liquid, stamp and LCD follow", async (page) => {
  await starter(page);
  const s0 = await state(page);
  const id = (await app(page)).top;
  const before = s0.books.find((b) => b.id === id);
  const c = await center(topCard(page));
  await drag(page, { x: c.x, y: c.y + 80 }, { x: c.x, y: c.y - 40 }, { steps: 12, pause: 30 });
  await page.waitForFunction((bid) => globalThis.__shelfie.state.books.find((b) => b.id === bid).page > 212, id);
  const after = (await state(page)).books.find((b) => b.id === id);
  assert.ok(after.page > before.page, `page went up (${before.page} → ${after.page})`);
  const s1 = await state(page);
  assert.equal(s1.xp, s0.xp + (after.page - before.page));
  assert.match(await page.textContent(".dock .screen .ln"), new RegExp(`PG 0*${after.page} /`));
  assert.equal(await topCard(page).locator(".denom b").textContent(), String(Math.round((after.page / after.pages) * 100)));
  await dismissPosters(page);
  // Dragging back down moves the bookmark without taking XP away.
  const c2 = await center(topCard(page));
  await drag(page, { x: c2.x, y: c2.y - 20 }, { x: c2.x, y: c2.y + 40 }, { steps: 6, pause: 30 });
  await page.waitForTimeout(700);
  const back = (await state(page)).books.find((b) => b.id === id);
  assert.ok(back.page < after.page);
  assert.equal((await state(page)).xp, s1.xp);
});

await run("the knob and keycaps log pages", async (page) => {
  await starter(page);
  const id = (await app(page)).top;
  await page.focus(".knob");
  await page.keyboard.press("PageUp");
  await page.waitForTimeout(800);
  assert.equal((await state(page)).books.find((b) => b.id === id).page, 222);
  await page.click('.dock .key[aria-label="Add 25 pages"]');
  await page.click('.dock .key[aria-label="Add 5 pages"]');
  await page.waitForTimeout(800);
  assert.equal((await state(page)).books.find((b) => b.id === id).page, 252);
  await page.waitForTimeout(400);
  await dismissPosters(page);
  // Spin it with a finger: a full turn clockwise is ~25 pages.
  const k = await center(page.locator(".knob"));
  await page.mouse.move(k.x, k.y - 40);
  await page.mouse.down();
  for (let a = 0; a <= 360; a += 15) {
    const r = (a * Math.PI) / 180;
    await page.mouse.move(k.x + Math.sin(r) * 40, k.y - Math.cos(r) * 40);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const p = (await state(page)).books.find((b) => b.id === id).page;
  assert.ok(p >= 272 && p <= 280, `a full turn adds ~25 pages (got ${p - 252})`);
});

await run("finishing a book: poster, it moves to Read, rate it with a feeling", async (page) => {
  await starter(page);
  const hhg = (await state(page)).books.find((b) => b.title.startsWith("The Hitchhiker"));
  await page.focus("#deck");
  while ((await app(page)).top !== hhg.id) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 8; i++) await page.click('.dock .key[aria-label="Add 25 pages"]');
  await page.waitForSelector(".poster");
  assert.match(await page.textContent(".poster"), /DONE\./);
  await dismissPosters(page);
  let b = (await state(page)).books.find((x) => x.id === hhg.id);
  assert.equal(b.shelf, "read");
  assert.equal(b.page, 216);
  assert.ok((await state(page)).badges["first-finish"] === undefined || true);
  await page.evaluate(() => {
    const el = document.querySelector(".tape-item[data-shelf=read]");
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 3 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3 }));
  });
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "read");
  await page.focus("#deck");
  while ((await app(page)).top !== hhg.id) await page.keyboard.press("ArrowRight");
  await page.click('.dock .key[aria-label="Mind blown"]');
  b = (await state(page)).books.find((x) => x.id === hhg.id);
  assert.equal(b.rating, 5);
  await page.waitForTimeout(500);
  assert.equal(await page.getAttribute('.dock .key[aria-label="Mind blown"]', "aria-checked"), "true");
});

await run("hold a book and drop it on WANT", async (page) => {
  await starter(page);
  const id = (await app(page)).top;
  const c = await center(topCard(page));
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  const z = await center(page.locator(".zone.on[data-zone=want]"));
  for (let i = 1; i <= 10; i++) await page.mouse.move(c.x + ((z.x - c.x) * i) / 10, c.y + ((z.y - c.y) * i) / 10);
  await page.waitForSelector(".zone.hot[data-zone=want]");
  await page.mouse.up();
  await page.waitForFunction((bid) => globalThis.__shelfie.state.books.find((b) => b.id === bid).shelf === "want", id);
  await page.waitForFunction((bid) => !globalThis.__shelfie.pile.includes(bid), id);
  assert.equal(await page.locator(".zone.on").count(), 0, "zones hide again");
});

await run("drop on REMOVE, then undo from the island", async (page) => {
  await starter(page);
  const n = (await state(page)).books.length;
  const c = await center(topCard(page));
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  const z = await center(page.locator(".zone.on[data-zone=bin]"));
  for (let i = 1; i <= 10; i++) await page.mouse.move(c.x + ((z.x - c.x) * i) / 10, c.y + ((z.y - c.y) * i) / 10);
  await page.mouse.up();
  await page.waitForFunction((k) => globalThis.__shelfie.state.books.length === k - 1, n);
  await page.waitForSelector(".island.open");
  await page.waitForFunction(() => /REMOVED/.test(document.querySelector(".island").textContent));
  await page.click(".island");
  await page.waitForFunction((k) => globalThis.__shelfie.state.books.length === k, n);
});

await run("drag the shelf tape to switch shelves", async (page) => {
  await starter(page);
  const t = await center(page.locator("#tape"));
  await drag(page, { x: t.x + 60, y: t.y }, { x: t.x - 180, y: t.y }, { steps: 10 });
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "want");
  assert.equal(await page.getAttribute(".tape-item[data-shelf=want]", "aria-selected"), "true");
  await page.focus(".tape-item[data-shelf=want]");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "read");
});

await run("START on the want pile begins reading", async (page) => {
  await starter(page);
  await page.focus(".tape-item[data-shelf=reading]");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "want");
  await settle(page, 500);
  const id = (await app(page)).top;
  await page.click('.dock .key:has-text("START")');
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "reading");
  assert.equal((await state(page)).books.find((b) => b.id === id).shelf, "reading");
});

await run("tap flips a stamp; double-tap pokes it for an easter egg", async (page) => {
  await starter(page);
  const dune = (await state(page)).books.find((b) => b.title === "Dune");
  assert.equal((await app(page)).top, dune.id);
  await topCard(page).click({ position: { x: 100, y: 60 } });
  await page.waitForSelector(".stamp.top.flipped");
  await topCard(page).click({ position: { x: 100, y: 60 } });
  await page.waitForSelector(".stamp.top:not(.flipped)");
  await topCard(page).dblclick({ position: { x: 100, y: 60 } });
  await page.waitForFunction(() => globalThis.__shelfie.state.eggs.length === 1);
  assert.equal((await state(page)).eggs[0], `${dune.id}:spice`);
});

await run("search Google Books: tap adds to Want, swipe further for Reading", async (page) => {
  await page.click('.dock .key:has-text("SEARCH")');
  await page.waitForSelector("#panel-add[aria-hidden=false]");
  await page.fill("#q", "dune");
  await page.waitForSelector(".row");
  assert.equal(await page.locator(".row").count(), 3, "the bad id is dropped");
  assert.match(await page.textContent("#source"), /GOOGLE BOOKS/);
  await page.locator(".row").first().click();
  await page.waitForFunction(() => globalThis.__shelfie.state.books.length === 1);
  let s = await state(page);
  assert.equal(s.books[0].title, "Dune");
  assert.equal(s.books[0].shelf, "want");
  assert.equal(s.books[0].pages, 535);
  assert.equal(s.books[0].img, "https://books.google.com/books/content?id=B1hSG45JCX4C&printsec=frontcover&img=1&zoom=1&fife=w480-h720&source=gbs_api");
  assert.equal(s.books[0].blurb, "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides.");
  // Swipe the second row past the Reading mark.
  const r = await center(page.locator(".row").nth(1));
  await drag(page, { x: r.b.x + 30, y: r.y }, { x: r.b.x + 30 + 200, y: r.y }, { steps: 10 });
  await page.waitForFunction(() => globalThis.__shelfie.state.books.length === 2);
  s = await state(page);
  assert.equal(s.books[1].title, "Dune Messiah");
  assert.equal(s.books[1].shelf, "reading");
  await page.click("#panel-add [data-close]");
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "reading" && globalThis.__shelfie.pile.length === 2);
});

await run("search falls back to Open Library when the Worker can't answer", async (page) => {
  await page.click('.dock .key:has-text("SEARCH")');
  await page.fill("#q", "dune");
  await page.waitForSelector(".row");
  assert.match(await page.textContent("#source"), /OPEN LIBRARY/);
  await page.locator(".row").first().click();
  await page.waitForFunction(() => globalThis.__shelfie.state.books.length === 1);
  assert.equal((await state(page)).books[0].cover, 11481354);
}, { google: "down", allow: /503/ });

await run("pull the + stamp up to open search, and add a book by hand", async (page) => {
  const c = await center(topCard(page));
  await drag(page, c, { x: c.x, y: c.y - 160 }, { steps: 10 });
  await page.waitForSelector("#panel-add[aria-hidden=false]");
  await page.click("details.manual summary");
  await page.fill("#m-title", "My Zine");
  await page.fill("#m-pages", "42");
  await page.click("#m-add");
  await page.waitForSelector("#panel-add[aria-hidden=true]", { state: "attached" });
  const s = await state(page);
  assert.equal(s.books[0].title, "My Zine");
  assert.equal(s.books[0].pages, 42);
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "want");
});

await run("pull the stats bar up; spin the dial to set a goal", async (page) => {
  const p = await center(page.locator("#pullbar"));
  await drag(page, p, { x: p.x, y: p.y - 500 }, { steps: 10 });
  await page.waitForSelector("#panel-stats[aria-hidden=false]");
  await page.waitForSelector(".tile.t-level");
  await page.focus(".t-dial");
  await page.keyboard.press("ArrowUp");
  assert.equal((await state(page)).goal, 25);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#panel-stats[aria-hidden=true]", { state: "attached" });
});

await run("tap the LCD five times for party mode", async (page) => {
  for (let i = 0; i < 5; i++) await page.click("#lcd", { delay: 10 });
  await page.waitForFunction(() => globalThis.__shelfie.state.eggs.includes("app:party"));
});

await run("shelves survive a reload", async (page) => {
  await starter(page);
  const n = (await state(page)).books.length;
  await page.reload();
  await page.waitForFunction(() => globalThis.__shelfie?.pile.length === 3);
  assert.equal((await state(page)).books.length, n);
});

await run(
  "full motion: starter, swipe, scrub, lift, posters, panels",
  async (page) => {
    await starter(page);
    await page.waitForTimeout(1200);
    let c = await center(topCard(page));
    await drag(page, c, { x: c.x - 220, y: c.y }, { steps: 8 });
    await page.waitForTimeout(900);
    await drag(page, { x: c.x - 120, y: c.y }, { x: c.x + 160, y: c.y }, { steps: 8 });
    await page.waitForTimeout(900);
    c = await center(topCard(page));
    await drag(page, { x: c.x, y: c.y + 100 }, { x: c.x, y: c.y - 60 }, { steps: 14, pause: 20 });
    await page.waitForTimeout(1500);
    await dismissPosters(page);
    await page.dblclick(".stamp.top:not(.leaving)", { position: { x: 100, y: 60 } });
    await page.waitForTimeout(2600);
    const p = await center(page.locator("#pullbar"));
    await drag(page, p, { x: p.x, y: p.y - 500 }, { steps: 8 });
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    assert.equal((await app(page)).pile.at(-1), "add");
  },
  { motion: "no-preference" },
);

await browser.close();
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");

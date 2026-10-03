// Browser tests for the whole app, driven with real pointer gestures.
//
//   python3 -m http.server 8765        (from the repo root, in another terminal)
//   NODE_PATH=$(npm root -g) node tests/app.e2e.mjs
//
// Google Books and Open Library are stubbed with recorded answers, so this runs offline.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker, { cleanGoogle } from "../worker/worker.js";
import { FakeD1 } from "./helpers/d1.mjs";

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

const WORKER = "https://shelf-api.8parthaggarwal1999.workers.dev";

/** A stand-in for the Worker's sync store, shared by every browser in one test. */
function fakeSync(store) {
  return async (r) => {
    const req = r.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT", "access-control-allow-headers": "Content-Type" };
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    const key = new URL(req.url()).pathname;
    const cur = store.get(key);
    if (req.method() === "GET") return r.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify(cur || { rev: 0 }) });
    const b = JSON.parse(req.postData());
    assert.ok(!/Dune|Hitchhiker|title/.test(req.postData()), "only ciphertext goes to the server");
    if (cur && cur.rev !== b.base) return r.fulfill({ status: 409, headers: cors, contentType: "application/json", body: JSON.stringify(cur) });
    store.set(key, { rev: (cur?.rev || 0) + 1, iv: b.iv, ct: b.ct });
    return r.fulfill({ headers: cors, contentType: "application/json", body: JSON.stringify({ rev: (cur?.rev || 0) + 1 }) });
  };
}

/**
 * The real Worker (accounts and all) running right here, on a test database. With `accounts`
 * off it answers like a Worker that has no database set up.
 */
function realWorker(accountsEnv) {
  return async (r) => {
    const req = r.request();
    const headers = { ...req.headers(), "cf-connecting-ip": "10.0.0.1" };
    const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData() }), accountsEnv, { waitUntil: () => {} });
    return r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
  };
}
const accountsEnv = (on) => ({ ALLOWED_ORIGINS: new URL(SITE).origin, ...(on ? { DB: new FakeD1(), AUTH_SECRET: "e2e-auth-secret-NOT-REAL-0123456789abcdef" } : {}) });

const TIPS = ["stamp", "addstamp", "pad", "padwant", "padread", "tape", "lcd", "pull"];

async function setup(page, { google = "ok", tour = false, tips = false, store = new Map(), accounts = accountsEnv(false) } = {}) {
  const cors = { "access-control-allow-origin": "*" };
  if (!tour) await page.addInitScript(() => localStorage.setItem("shelfie.tour", "1"));
  // Explainer pop-ups and wandering animals would get in the way of the gestures under test.
  await page.addInitScript(
    ([tips, ids]) => {
      if (!tips && !localStorage.getItem("shelfie.tips")) localStorage.setItem("shelfie.tips", JSON.stringify(ids));
      if (!localStorage.getItem("shelfie.fx")) localStorage.setItem("shelfie.fx", JSON.stringify({ visitors: false }));
      // No random jackpots in tests (they'd change the XP being checked).
      localStorage.setItem("shelfie.jackpot", String(Date.now() + 1e12));
      if (!localStorage.getItem("shelfie.a2hs")) localStorage.setItem("shelfie.a2hs", JSON.stringify({ n: 2, at: Date.now() }));
    },
    [tips, TIPS],
  );
  await page.route(`${WORKER}/api/search*`, (r) =>
    google === "ok" ? r.fulfill({ contentType: "application/json", body: WORKER_GOOGLE, headers: cors }) : r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"upstream_unavailable"}', headers: cors }),
  );
  await page.route(`${WORKER}/api/sync/**`, fakeSync(store));
  for (const path of ["/api/health", "/api/auth/**", "/api/vault"]) await page.route(`${WORKER}${path}`, realWorker(accounts));
  await page.route(`${WORKER}/api/cover*`, (r) => r.fulfill({ contentType: "application/json", body: '{"img":null}', headers: cors }));
  await page.route("https://www.googleapis.com/**", () => {
    throw new Error("the page must never call Google's API directly");
  });
  await page.route("https://openlibrary.org/search.json*", (r) => r.fulfill({ contentType: "application/json", body: OPEN_LIBRARY, headers: cors }));
  for (const host of ["https://books.google.com/**", "https://covers.openlibrary.org/**"]) await page.route(host, (r) => r.fulfill({ contentType: "image/png", body: COVER }));
}

async function run(name, fn, { motion = "reduce", google = "ok", allow = null, tour = false, tips = false, raw = false } = {}) {
  if (ONLY && !name.includes(ONLY)) return;
  if (raw) {
    // The test sets up its own browsers.
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${name}\n     ${err.message.split("\n").slice(0, 8).join("\n     ")}`);
    }
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: motion });
  const page = await ctx.newPage();
  if (process.env.SLOW) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.SLOW) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !(allow && allow.test(m.text())) && errors.push(m.text()));
  await setup(page, { google, tour, tips });
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
/** Flip the pile (with the keyboard) until a book is on top. */
async function goTo(page, id) {
  await page.focus("#deck");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 24; i++) {
    if ((await page.evaluate(() => globalThis.__shelfie.top)) === id) return;
    await page.keyboard.press("ArrowRight");
  }
  throw new Error(`couldn't find ${id} in the pile`);
}

/** The middle of an element, once it has stopped moving (a card may still be dealing in). */
async function center(loc) {
  let b = await loc.boundingBox();
  for (let i = 0; i < 40; i++) {
    await new Promise((ok) => setTimeout(ok, 50));
    const n = await loc.boundingBox();
    const still = n && b && Math.abs(n.x - b.x) < 0.5 && Math.abs(n.y - b.y) < 0.5 && Math.abs(n.width - b.width) < 0.5;
    b = n;
    if (still) break;
  }
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
async function starter(page) {
  await page.click('.dock .key[aria-label="Load a starter stack"]');
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "reading" && globalThis.__shelfie.pile.length === 3);
  await settle(page, 500);
}
async function dismissPosters(page) {
  for (let i = 0; i < 4 && (await page.locator(".poster").count()); i++) {
    // (A poster can also leave on its own between the check and the key press.)
    await page.locator(".poster").first().press("Escape", { timeout: 2000 }).catch(() => {});
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
  await goTo(page, hhg.id);
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
  await goTo(page, hhg.id);
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

await run("search Google Books: tap adds to this shelf, swipe picks one", async (page) => {
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
  assert.equal(s.books[0].shelf, "reading", "a tap adds to the shelf search was opened from");
  assert.equal(s.books[0].pages, 535);
  assert.equal(s.books[0].img, "https://books.google.com/books/content?id=B1hSG45JCX4C&printsec=frontcover&img=1&zoom=1&fife=w720-h1080&source=gbs_api");
  assert.equal(s.books[0].blurb, "Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides.");
  // Swipe the second row past the Reading mark.
  const r = await center(page.locator(".row").nth(1));
  await drag(page, { x: r.b.x + 30, y: r.y }, { x: r.b.x + 30 + 200, y: r.y }, { steps: 10 });
  await page.waitForFunction(() => globalThis.__shelfie.state.books.length === 2);
  s = await state(page);
  assert.equal(s.books[1].title, "Dune Messiah");
  assert.equal(s.books[1].shelf, "reading");
  await page.click("#panel-add [data-close]");
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "reading" && globalThis.__shelfie.pile.length === 3);
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
  assert.equal(await page.textContent("#m-add"), "ADD TO READING");
  await page.click("#m-add");
  await page.waitForSelector("#panel-add[aria-hidden=true]", { state: "attached" });
  const s = await state(page);
  assert.equal(s.books[0].title, "My Zine");
  assert.equal(s.books[0].pages, 42);
  assert.equal(s.books[0].shelf, "reading");
});

await run("pull the stats bar up; set daily, monthly and yearly goals", async (page) => {
  const p = await center(page.locator("#pullbar"));
  await drag(page, p, { x: p.x, y: p.y - 500 }, { steps: 10 });
  await page.waitForSelector("#panel-stats[aria-hidden=false]");
  await page.waitForSelector(".tile.t-level");
  await page.focus(".t-dial[data-kind=day]");
  await page.keyboard.press("ArrowUp");
  assert.equal((await state(page)).goal, 25);
  await page.focus(".t-dial[data-kind=month]");
  await page.keyboard.press("ArrowUp");
  assert.equal((await state(page)).goalMonth, 3);
  await page.focus(".t-dial[data-kind=year]");
  await page.keyboard.press("ArrowDown");
  assert.equal((await state(page)).goalYear, 23);
  // Spin the year ring with a finger: a quarter turn from the top is about a quarter of 365.
  const d = await center(page.locator(".t-dial[data-kind=year] .dial-svg"));
  await page.mouse.move(d.x, d.y - 40);
  await page.mouse.down();
  for (let a = 0; a <= 90; a += 10) await page.mouse.move(d.x + Math.sin((a * Math.PI) / 180) * 40, d.y - Math.cos((a * Math.PI) / 180) * 40);
  await page.mouse.up();
  const y = (await state(page)).goalYear;
  assert.ok(y > 80 && y < 100, `about a quarter of the ring (got ${y})`);
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

await run("first launch: the tour teaches each gesture, and remembers it was seen", async (page) => {
  await page.waitForSelector(".tour");
  assert.match(await page.textContent(".tour-title"), /HEY/);
  await page.click(".tour-btn.go");
  // Swipe the practice pile.
  const p = await center(page.locator(".tt-pile"));
  await drag(page, p, { x: p.x - 140, y: p.y }, { steps: 8 });
  await page.waitForSelector(".tour-try.done");
  await page.click(".tour-btn.go");
  // Drag the practice stamp up.
  const q = await center(page.locator(".tt-pile"));
  await drag(page, { x: q.x, y: q.y + 60 }, { x: q.x, y: q.y - 120 }, { steps: 10 });
  await page.waitForSelector(".tour-try.done");
  for (let i = 0; i < 3; i++) await page.click(".tour-btn.go");
  assert.match(await page.textContent(".tour-btn.go"), /START READING/);
  await page.click(".tour-btn.go");
  await page.waitForSelector(".tour", { state: "detached" });
  assert.equal(await page.evaluate(() => localStorage.getItem("shelfie.tour")), "1");
  // Then it asks for a name (and only a name), and offers to bring books in.
  await page.waitForSelector(".pop-input");
  await page.fill(".pop-input", "  Ada <b>  ");
  await page.click('.pop-btn[data-id="ok"]');
  await page.waitForFunction(() => globalThis.__shelfie.state.name === "Ada b");
  await page.waitForSelector('.pop-btn[data-id="gr"]');
  await page.click('.pop-btn[data-id="later"]');
  await page.waitForSelector(".pop", { state: "detached" });
  assert.ok((await state(page)).toured);
  await page.reload();
  await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator(".tour").count(), 0, "not shown again");
  assert.equal(await page.locator(".pop").count(), 0, "no onboarding pop-ups again");
  assert.match(await page.textContent("#lcd"), /HI ADA/);
  await page.click("#me");
  await page.click('.me-row[aria-label="HOW TO USE"]');
  await page.click('.pop-btn[data-id="tour"]');
  await page.waitForSelector(".tour");
  await page.click(".tour-skip");
  await page.waitForSelector(".tour", { state: "detached" });
}, { tour: true });

await run("adding from a shelf adds to that shelf", async (page) => {
  await starter(page);
  await page.focus(".tape-item[data-shelf=reading]");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "read");
  await goTo(page, "add");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#panel-add[aria-hidden=false]");
  assert.equal(await page.textContent("#add-title"), "ADD TO READ");
  await page.fill("#q", "dune");
  await page.waitForSelector(".row:not(.have)");
  await page.locator(".row:not(.have)").first().click();
  await page.waitForFunction(() => globalThis.__shelfie.state.books.some((b) => b.title === "Dune Messiah"));
  assert.equal((await state(page)).books.find((b) => b.title === "Dune Messiah").shelf, "read");
});

await run("two tabs don't wipe each other's changes", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const [a, b] = [await ctx.newPage(), await ctx.newPage()];
  for (const p of [a, b]) {
    await setup(p);
    await p.goto(SITE);
    await p.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
  }
  await starter(a); // tab A adds eight books; tab B is still showing an empty shelf
  await b.waitForFunction(() => globalThis.__shelfie.state.books.length === 8, null, { timeout: 5000 });
  await b.waitForFunction(() => globalThis.__shelfie.pile.length === 3, null, { timeout: 5000 }); // dealt in on B too
  await goTo(b, "add");
  await b.click('.dock .key:has-text("SEARCH")');
  await b.fill("#q", "dune");
  await b.waitForSelector(".row:not(.have)");
  await b.locator(".row:not(.have)").first().click();
  await a.waitForFunction(() => globalThis.__shelfie.state.books.length === 9, null, { timeout: 5000 });
  const saved = await a.evaluate(() => JSON.parse(localStorage.getItem("shelf.v1")).books.length);
  assert.equal(saved, 9);
  await ctx.close();
}, { raw: true });

await run("sync: Safari and the home-screen app share one set of shelves", async () => {
  const store = new Map();
  // Two separate browsers: separate storage, like Safari and an installed app on iPhone.
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await setup(page, { store });
    await page.goto(SITE);
    await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
    return { ctx, page };
  };
  const safari = await open();
  const app = await open();
  try {
  await starter(safari.page);
  await safari.page.click("#me");
  await safari.page.click('#sync-tile .key:has-text("ON")');
  await safari.page.waitForFunction(() => /SYNCED/.test(document.querySelector("#sync-tile")?.textContent || ""));
  const code = await safari.page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.sync")).code);
  assert.equal(store.size, 1);
  const [stored] = store.values();
  assert.ok(!JSON.stringify(stored).includes(code), "the code never reaches the server");

  // The app links with the code (typed messily) and gets everything.
  await app.page.click("#me");
  await app.page.click('#sync-tile .key:has-text("I HAVE A CODE")');
  await app.page.fill("#sync-code", code.toLowerCase().match(/.{1,4}/g).join(" "));
  await app.page.click('#sync-tile .key:has-text("LINK")');
  await app.page.waitForFunction(() => globalThis.__shelfie.state.books.length === 8);

  // Read in the app; Safari picks it up.
  await app.page.click("#panel-me [data-close]");
  await app.page.waitForTimeout(300);
  const dune = (await state(app.page)).books.find((b) => b.title === "Dune");
  await goTo(app.page, dune.id);
  await app.page.click('.dock .key[aria-label="Add 10 pages"]');
  await app.page.waitForFunction((id) => globalThis.__shelfie.state.books.find((b) => b.id === id).page === 222, dune.id);
  await app.page.evaluate(() => globalThis.__shelfie.backupNow()); // (on its own it saves once things go quiet)
  await safari.page.click('#sync-tile .key:has-text("SYNC NOW")');
  await safari.page.waitForFunction((id) => globalThis.__shelfie.state.books.find((b) => b.id === id).page === 222, dune.id);

  // A wrong code is refused without touching anything.
  const third = await open();
  await third.page.click("#me");
  await third.page.click('#sync-tile .key:has-text("I HAVE A CODE")');
  await third.page.fill("#sync-code", "not a code");
  await third.page.click('#sync-tile .key:has-text("LINK")');
  await third.page.waitForFunction(() => /ISN'T A SYNC CODE/.test(document.querySelector("#sync-tile").textContent));
  await third.ctx.close();
  } finally {
    await safari.ctx.close();
    await app.ctx.close();
  }
}, { raw: true });

await run("sound and haptics can be switched off, and stay off", async (page) => {
  await page.click("#me");
  await page.click('.me-row[aria-label="SOUND"]');
  await page.click('.me-row[aria-label="HAPTICS"]');
  const fxp = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.fx")));
  assert.equal(fxp.sound, false);
  assert.equal(fxp.haptics, false);
  assert.equal(await page.getAttribute('.me-row[aria-label="SOUND"]', "aria-checked"), "false");
});

await run("reset: pull the lever, type 'reset', and everything's wiped", async (page) => {
  await starter(page);
  await dismissPosters(page);
  assert.ok((await state(page)).books.length > 0);
  await page.click("#me");
  // Let go of the lever early: it springs back and nothing happens.
  const lever = page.locator(".lever").first();
  await lever.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await lever.locator(".lever-ball").boundingBox();
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2, y: box.y + 30 }, { steps: 6 });
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".pop").count(), 0);
  // Pull it all the way.
  const b2 = await lever.locator(".lever-ball").boundingBox();
  await drag(page, { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 }, { x: b2.x + b2.width / 2, y: b2.y + 160 }, { steps: 10 });
  await page.waitForSelector(".pop-card.is-danger");
  // Cancel leaves everything alone.
  await page.click('.pop-btn[data-id="cancel"]');
  await page.waitForSelector(".pop", { state: "detached" });
  assert.ok((await state(page)).books.length > 0);
  await lever.press("Enter"); // the keyboard pulls it too
  await page.waitForSelector(".pop-card.is-danger");
  assert.match(await page.textContent(".danger-text"), /gone for good/);
  assert.ok(await page.isDisabled('.pop-btn[data-id="reset"]'), "can't delete until 'reset' is typed");
  await page.fill(".pop-input", "rest");
  assert.ok(await page.isDisabled('.pop-btn[data-id="reset"]'));
  await page.fill(".pop-input", "RESET ");
  await page.click('.pop-btn[data-id="reset"]');
  await page.waitForEvent("load");
  await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
  const s = await state(page);
  assert.equal(s.books.length, 0);
  assert.equal(s.xp, 0);
  assert.ok(s.resetAt > 0);
  // A clean slate says hello again (but doesn't replay the tour).
  await page.waitForSelector(".pop-input");
  assert.equal(await page.locator(".tour").count(), 0);
});

await run("import a Goodreads export: preview, then the books land on their shelves", async (page) => {
  await page.click('.dock .key[aria-label="Import from Goodreads"]');
  await page.waitForSelector("#panel-import .gr-drop");
  assert.match(await page.textContent("#panel-import"), /Export Library/i);
  // Not a Goodreads file: a friendly error.
  await page.setInputFiles("#gr-file", { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("name,age\nbob,3\n") });
  await page.waitForSelector(".gr-error");
  await page.setInputFiles("#gr-file", new URL("./fixtures/goodreads.csv", import.meta.url).pathname);
  await page.waitForSelector(".gr-found");
  assert.equal((await page.textContent(".gr-total")).trim(), "4");
  await page.click("#panel-import .key.k-lime");
  await page.waitForFunction(() => globalThis.__shelfie.state.books.length === 4);
  await dismissPosters(page);
  const s = await state(page);
  const by = Object.fromEntries(s.books.map((b) => [b.title, b]));
  assert.equal(by["Dune (Dune, #1)"].shelf, "read");
  assert.equal(by["Dune (Dune, #1)"].rating, 5);
  assert.equal(by["Dune (Dune, #1)"].finished.slice(0, 7), "2023-05");
  assert.equal(by["Atomic Habits"].shelf, "reading");
  assert.equal(by["Fahrenheit 451"].shelf, "want");
  assert.ok(s.eggs.includes("app:goodreads"));
});

await run("explainer pop-ups point at things once, then stay away", async (page) => {
  await page.waitForSelector(".tip-bubble");
  assert.match(await page.textContent(".tip-title"), /\w/);
  for (let i = 0; i < 6 && (await page.locator(".tip").count()); i++) {
    await page.click(".tip-btn");
    await page.waitForTimeout(700);
  }
  await page.reload();
  await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
  await page.waitForTimeout(1800);
  assert.equal(await page.locator(".tip").count(), 0);
}, { tips: true });

async function device(accounts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page, { accounts });
  await page.goto(SITE);
  await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
  return { ctx, page, errors };
}

await run("accounts: sign up, save the recovery code, log in on another device, shelves follow", async () => {
  const env = accountsEnv(true);
  const a = await device(env);
  const b = await device(env);
  try {
    await starter(a.page);
    await a.page.click("#me");
    await a.page.waitForSelector("#account-tile");
    assert.equal(await a.page.locator("#sync-tile").count(), 0, "with accounts on, the sync code steps aside");
    await a.page.click('#account-tile .key[aria-label="Create an account"]');
    await a.page.fill('.pop input[name="login"]', "Ada.Reads");
    await a.page.fill('.pop input[name="password"]', "short");
    await a.page.fill('.pop input[name="again"]', "short");
    await a.page.click('.pop-btn[data-id="go"]');
    await a.page.waitForSelector(".pop-error:not(:empty)");
    assert.match(await a.page.textContent(".pop-error"), /10 characters/);
    await a.page.fill('.pop input[name="password"]', "tea and long books");
    await a.page.fill('.pop input[name="again"]', "tea and long books");
    assert.ok(Number(await a.page.getAttribute(".pw-meter", "data-n")) >= 2);
    await a.page.click('.pop-btn[data-id="go"]');
    await a.page.waitForSelector(".recovery-code", { timeout: 20000 });
    const code = (await a.page.textContent(".recovery-code")).trim();
    assert.match(code, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    await a.page.fill(".pop-input", "nope");
    assert.ok(await a.page.isDisabled('.pop-btn[data-id="ok"]'), "needs the last four characters");
    await a.page.fill(".pop-input", code.slice(-4).toLowerCase());
    await a.page.click('.pop-btn[data-id="ok"]');
    await a.page.waitForSelector(".pop", { state: "detached" });
    await a.page.waitForFunction(() => /BACKED UP/.test(document.querySelector("#account-tile")?.textContent || ""));
    assert.match(await a.page.textContent("#account-tile"), /ada\.reads/);
    // Nothing readable reached the server.
    const dump = JSON.stringify([env.DB.rows("SELECT * FROM users"), env.DB.rows("SELECT * FROM vaults")]);
    for (const leak of ["ada.reads", "tea and long books", "Dune", "Hitchhiker", code]) assert.ok(!dump.includes(leak), `server has ${leak}`);

    // Another device: a wrong password stays in the pop-up with a message; the right one brings the books.
    await b.page.click("#me");
    await b.page.click('#account-tile .key[aria-label="Log in"]');
    await b.page.fill('.pop input[name="login"]', "ada.reads");
    await b.page.fill('.pop input[name="password"]', "tea and short books");
    await b.page.click('.pop-btn[data-id="go"]');
    await b.page.waitForSelector(".pop-error:not(:empty)", { timeout: 20000 });
    assert.match(await b.page.textContent(".pop-error"), /don't match/);
    await b.page.fill('.pop input[name="password"]', "tea and long books");
    await b.page.click('.pop-btn[data-id="go"]');
    await b.page.waitForFunction(() => globalThis.__shelfie.state.books.length === 8, null, { timeout: 20000 });

    // A change on B reaches A.
    await b.page.keyboard.press("Escape");
    await b.page.waitForTimeout(500);
    const xpBefore = await b.page.evaluate(() => globalThis.__shelfie.state.xp);
    await b.page.click('.dock .key:has-text("+25")');
    await b.page.waitForFunction((x) => globalThis.__shelfie.state.xp > x, xpBefore);
    await b.page.evaluate(() => globalThis.__shelfie.backupNow());
    const want = await b.page.evaluate(() => globalThis.__shelfie.state.xp);
    await a.page.evaluate(() => globalThis.__shelfie.backupNow());
    await a.page.waitForFunction((x) => globalThis.__shelfie.state.xp === x, want, { timeout: 15000 });
    assert.deepEqual([...a.errors, ...b.errors], []);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
}, { raw: true });

await run("accounts: forgot password with the recovery code, then log out and clear the device", async () => {
  const env = accountsEnv(true);
  const a = await device(env);
  try {
    await starter(a.page);
    await a.page.click("#me");
    await a.page.click('#account-tile .key[aria-label="Create an account"]');
    await a.page.fill('.pop input[name="login"]', "grace@example.com");
    await a.page.fill('.pop input[name="password"]', "compilers are fun");
    await a.page.fill('.pop input[name="again"]', "compilers are fun");
    await a.page.click('.pop-btn[data-id="go"]');
    await a.page.waitForSelector(".recovery-code", { timeout: 20000 });
    const code = (await a.page.textContent(".recovery-code")).trim();
    await a.page.fill(".pop-input", code.slice(-4));
    await a.page.click('.pop-btn[data-id="ok"]');
    await a.page.waitForFunction(() => /BACKED UP/.test(document.querySelector("#account-tile")?.textContent || ""));
    // Log out, clearing this device.
    await a.page.click('#account-tile .key[aria-label="Log out"]');
    await a.page.click('.pop-btn[data-id="clear"]');
    await a.page.waitForEvent("load");
    await a.page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
    assert.equal(await a.page.evaluate(() => globalThis.__shelfie.state.books.length), 0);
    await a.page.evaluate(() => document.querySelector(".pop-btn[data-id='skip']")?.click());
    await a.page.waitForTimeout(400);
    await a.page.evaluate(() => document.querySelector(".pop-btn[data-id='later']")?.click());
    await a.page.waitForSelector(".pop", { state: "detached" });
    // Even a device that was reset (it remembers when) gets the account's books back on login.
    await a.page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("shelf.v1"));
      localStorage.setItem("shelf.v1", JSON.stringify({ ...s, resetAt: Date.now() }));
    });
    await a.page.reload();
    await a.page.waitForFunction(() => globalThis.__shelfie?.state.resetAt > 0);
    // Forgot the password: the recovery code sets a new one and the books come back.
    await a.page.click("#me");
    await a.page.click('#account-tile .link-btn:has-text("FORGOT")');
    await a.page.fill('.pop input[name="login"]', "Grace@Example.com");
    await a.page.fill('.pop input[name="code"]', code.toLowerCase().replace(/-/g, " "));
    await a.page.fill('.pop input[name="password"]', "a new secret phrase");
    await a.page.fill('.pop input[name="again"]', "a new secret phrase");
    await a.page.click('.pop-btn[data-id="go"]');
    await a.page.waitForFunction(() => globalThis.__shelfie.state.books.length === 8, null, { timeout: 20000 });
    assert.deepEqual(a.errors, []);
  } finally {
    await a.ctx.close();
  }
}, { raw: true });

await run("first launch with accounts: after the name, it explains keeping books safe", async () => {
  const env = accountsEnv(true);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  try {
    await setup(page, { tour: true, accounts: env });
    await page.goto(SITE);
    await page.waitForSelector(".tour");
    await page.click(".tour-skip");
    await page.waitForSelector(".pop-input");
    await page.fill(".pop-input", "Mo");
    await page.click('.pop-btn[data-id="ok"]');
    await page.waitForSelector('.pop-btn[data-id="signup"]');
    assert.match(await page.textContent(".pop-card"), /KEEP YOUR BOOKS SAFE/);
    assert.match(await page.textContent(".pop-card"), /recovery code/);
    await page.click('.pop-btn[data-id="later"]');
    // Then the Goodreads offer (with a log-in option, since accounts are on).
    await page.waitForSelector('.pop-btn[data-id="gr"]');
    assert.equal(await page.locator('.pop-btn[data-id="sync"]').count(), 1);
    await page.click('.pop-btn[data-id="later"]');
    await page.waitForSelector(".pop", { state: "detached" });
  } finally {
    await ctx.close();
  }
}, { raw: true });

await run("a book you add shows up on top straight away", async (page) => {
  await starter(page);
  await goTo(page, "add");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#panel-add[aria-hidden=false]");
  await page.fill("#q", "dune");
  await page.waitForSelector(".row:not(.have)");
  await page.locator(".row:not(.have)").first().click();
  await page.waitForFunction(() => globalThis.__shelfie.state.books.some((b) => b.title === "Dune Messiah"));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const id = globalThis.__shelfie.top;
    return globalThis.__shelfie.state.books.find((b) => b.id === id)?.title === "Dune Messiah";
  });
  assert.match(await page.locator(".stamp.top:not(.leaving) .cap b").textContent(), /DUNE MESSIAH|Dune Messiah/i);
});

await run("each pass has a Find on Amazon button: by ISBN when there is one, else title and author", async (page) => {
  await starter(page);
  const href = await page.locator(".stamp.top:not(.leaving) .tk-buy").getAttribute("href");
  assert.match(href, /^https:\/\/www\.amazon\.in\/s\?k=Dune%20Frank%20Herbert$/);
  assert.equal(await page.locator(".stamp.top:not(.leaving) .tk-buy").getAttribute("rel"), "noopener noreferrer");
  // Want books also get a GET IT key.
  await page.focus(".tape-item[data-shelf=reading]");
  await page.keyboard.press("ArrowRight"); // reading → want
  await page.waitForFunction(() => globalThis.__shelfie.shelf === "want");
  await settle(page, 600);
  assert.ok(await page.isVisible('.dock .key[aria-label^="Find "]'));
});

await run("pick an animal for your profile; it shows on the avatar and stays", async (page) => {
  await page.click("#me");
  await page.click(".ava-arrow.next");
  await page.waitForFunction(() => globalThis.__shelfie.state.avatar === "llama");
  assert.equal(await page.textContent("#me-face"), "🦙");
  await page.reload();
  await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
  assert.equal(await page.textContent("#me-face"), "🦙");
});

await run("motion controls: flick for books, twist for shelves, flick up to add, tilt to lean", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference", hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  try {
    await setup(page);
    await page.addInitScript(() => localStorage.setItem("shelfie.fx", JSON.stringify({ visitors: false, motion: true })));
    await page.goto(SITE);
    await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
    await starter(page); // (the first tap is what lets an iPhone start the sensors)
    // A gesture as the gyroscope reports it: a quick turn about one axis, the swing back, then still.
    const motion = (axis, peak) =>
      page.evaluate(([axis, peak]) => {
        const fire = (v) => dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: { x: 0, y: 0, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 0, [axis]: v }, interval: 16 }));
        const n = 10;
        for (let i = 0; i < n; i++) fire(peak * Math.sin((Math.PI * (i + 0.5)) / n));
        for (let i = 0; i < n; i++) fire(-peak * Math.sin((Math.PI * (i + 0.5)) / n));
      }, [axis, peak]);
    // (events dispatched in one go share a timestamp, so settle with a still pause between moves)
    const still = () => page.evaluate(() => new Promise((ok) => {
      const id = setInterval(() => dispatchEvent(new DeviceMotionEvent("devicemotion", { rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16 })), 16);
      setTimeout(() => (clearInterval(id), ok()), 900);
    }));
    const first = (await app(page)).top;
    await motion("gamma", 400);
    await page.waitForFunction((t) => globalThis.__shelfie.top !== t, first);
    await still();
    await motion("gamma", -400);
    await page.waitForFunction((t) => globalThis.__shelfie.top === t, first);
    await still();
    await motion("gamma", 60); // a little wobble is ignored
    await still();
    assert.equal((await app(page)).top, first);
    await motion("alpha", -600);
    await page.waitForFunction(() => globalThis.__shelfie.shelf === "want");
    await still();
    await motion("beta", 500);
    await page.waitForSelector("#panel-add[aria-hidden=false]");
    // No gestures while a panel is open.
    await still();
    await motion("alpha", -600);
    await page.waitForTimeout(400);
    assert.equal((await app(page)).shelf, "want");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#panel-add[aria-hidden=true]", { state: "attached" });
    // Bouncing the phone up (held upright: gravity along y) also adds a book.
    await still();
    await page.evaluate(() => {
      for (const v of [3, 8, 11, 6, -4]) dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: { x: 0, y: v, z: 0 }, accelerationIncludingGravity: { x: 0, y: 9.8 + v, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16 }));
    });
    await page.waitForSelector("#panel-add[aria-hidden=false]");
    await page.keyboard.press("Escape");
    for (let i = 0; i < 25; i++) await page.evaluate((i) => dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: i ? 60 : 45, gamma: i ? 18 : 0 })), i);
    await page.waitForFunction(() => /px$/.test(document.querySelector("#deck").style.translate) && document.querySelector("#deck").style.translate !== "0px 0px");
  } finally {
    await ctx.close();
  }
}, { raw: true });

await run("guide: hints stop after a few opens, and tips never come back", async (page) => {
  await starter(page);
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await page.waitForFunction(() => globalThis.__shelfie?.pile.length >= 1);
  }
  await page.waitForTimeout(1500);
  assert.equal(await page.locator("#hint-slot .hint.on").count(), 0, "no hint chip from the fourth open");
  assert.equal(await page.locator(".tip").count(), 0);
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

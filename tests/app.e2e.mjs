// Browser tests for the whole app.
//
//   python3 -m http.server 8765        (from the repo root, in another terminal)
//   node tests/app.e2e.mjs
//
// Needs Playwright (npm i -g playwright, then NODE_PATH=$(npm root -g)).
// Open Library is stubbed with a recorded answer, so the tests run offline and stay stable.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SITE = process.env.SITE || "http://localhost:8765/";
const SEARCH = readFileSync(new URL("./fixtures/search-dune.json", import.meta.url), "utf8");
const COVER = readFileSync(new URL("../icons/icon-192.png", import.meta.url));

const browser = await chromium.launch();
let failures = 0;

async function run(name, fn, { motion = "reduce", allow = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: motion });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !(allow && allow.test(m.text())) && errors.push(m.text()));
  await page.route("https://openlibrary.org/search.json*", (r) => r.fulfill({ contentType: "application/json", body: SEARCH, headers: { "access-control-allow-origin": "*" } }));
  await page.route("https://covers.openlibrary.org/**", (r) => r.fulfill({ contentType: "image/png", body: COVER }));
  try {
    await page.goto(SITE);
    await page.waitForSelector(".card.add");
    await fn(page);
    assert.deepEqual(errors, [], "no errors in the console");
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}\n     ${err.message.split("\n").join("\n     ")}`);
  } finally {
    await ctx.close();
  }
}

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__shelfie.state)));
const lastCard = (page) => page.$eval("#track", (t) => t.lastElementChild.dataset.id);

await run("empty shelves show only the + card and a starter button", async (page) => {
  assert.equal(await page.locator("#track .card").count(), 1);
  assert.equal(await lastCard(page), "add");
  assert.ok(await page.isVisible("#starter"));
});

await run("search and add a book; the + card stays last", async (page) => {
  await page.click(".card.add .add-btn");
  await page.waitForSelector("#sheet-add[open]");
  await page.click('#add-shelf [role=radio]:has-text("Want")');
  await page.fill("#q", "dune");
  await page.waitForSelector(".result");
  assert.equal(await page.locator(".result").count(), 3);
  await page.locator(".result").first().click();
  await page.waitForSelector(".result .add-one.added");
  const s = await state(page);
  assert.equal(s.books.length, 1);
  assert.equal(s.books[0].title, "Dune");
  assert.equal(s.books[0].pages, 608);
  assert.equal(s.books[0].cover, 11481354);
  assert.equal(s.books[0].shelf, "want");
  assert.equal(s.xp, 20);
  // Adding it again is not possible: it shows as already added after a new search.
  await page.fill("#q", "dune ");
  await page.waitForTimeout(500);
  assert.ok(await page.locator(".result").first().locator(".add-one.added").count());
  await page.click("#sheet-add .x");
  await page.waitForSelector("#sheet-add:not([open])", { state: "attached" });
  await page.waitForFunction(() => document.querySelector(".tab[data-tab=want]").getAttribute("aria-selected") === "true");
  assert.equal(await page.locator("#track .card").count(), 2);
  assert.equal(await lastCard(page), "add");
  assert.equal(await page.textContent(".tab[data-tab=want] .tab-count"), "1");
});

await run("add a book by hand", async (page) => {
  await page.click(".card.add .add-btn");
  await page.click("details.manual summary");
  await page.fill("#m-title", "My Zine");
  await page.fill("#m-author", "Me");
  await page.fill("#m-pages", "42");
  await page.click("#m-add");
  await page.waitForSelector("#sheet-add:not([open])", { state: "attached" });
  const s = await state(page);
  assert.equal(s.books[0].title, "My Zine");
  assert.equal(s.books[0].pages, 42);
  assert.equal(s.books[0].shelf, "reading");
});

await run("log pages with +10, the wheel, the slider and quick buttons", async (page) => {
  await page.click("#starter");
  await page.waitForSelector('.card[data-id]:not(.add)');
  const dune = (await state(page)).books.find((b) => b.title === "Dune");
  assert.equal(dune.page, 212);
  const xp0 = (await state(page)).xp;

  await page.click(`.card[data-id="${dune.id}"] [data-act=plus]`);
  let s = await state(page);
  assert.equal(s.books.find((b) => b.id === dune.id).page, 222);
  assert.equal(s.xp, xp0 + 10);
  assert.equal(await page.textContent("#goal-n"), "10");

  await page.click(`.card[data-id="${dune.id}"] .card-open`);
  await page.waitForSelector("#sheet-book[open] .wheel");
  assert.equal(await page.textContent(".bk-page"), "222");
  await page.focus(".wheel");
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => document.querySelector(".bk-page").textContent === "232");
  await page.waitForTimeout(900);
  assert.equal((await state(page)).books.find((b) => b.id === dune.id).page, 232);

  await page.$eval(".slider", (el) => {
    el.value = "320";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(await page.textContent(".bk-page"), "320");
  assert.equal(await page.getAttribute(".wheel", "aria-valuenow"), "320");
  await page.waitForTimeout(900);
  s = await state(page);
  assert.equal(s.books.find((b) => b.id === dune.id).page, 320);
  assert.ok(s.badges["pages-100"], "100 pages badge");
  assert.ok(s.badges.goal, "daily goal badge");

  await page.click('.quick button:has-text("+25")');
  await page.waitForTimeout(700);
  assert.equal((await state(page)).books.find((b) => b.id === dune.id).page, 345);
});

await run("finish a book, rate it, and it moves to Read", async (page) => {
  await page.click("#starter");
  const hhg = (await state(page)).books.find((b) => b.title.startsWith("The Hitchhiker"));
  await page.click(`.card[data-id="${hhg.id}"]`); // side card: brings it to the middle
  await page.click(`.card[data-id="${hhg.id}"] .card-open`);
  await page.waitForSelector("#sheet-book[open] .quick");
  await page.click('.quick button:has-text("Finished")');
  await page.waitForSelector("#sheet-book .stars.big");
  let s = await state(page);
  assert.equal(s.books.find((b) => b.id === hhg.id).shelf, "read");
  await page.click('.stars.big [aria-label="5 stars"]');
  s = await state(page);
  assert.equal(s.books.find((b) => b.id === hhg.id).rating, 5);
  assert.ok(s.badges["first-finish"]);
  await page.keyboard.press("Escape");
  await page.click(".tab[data-tab=read]");
  await page.waitForSelector(`#track .card[data-id="${hhg.id}"]`);
  assert.equal(await lastCard(page), "add");
});

await run("tabs switch shelves and keep the + card last", async (page) => {
  await page.click("#starter");
  for (const [tab, n] of [["want", 5], ["read", 1], ["reading", 2]]) {
    await page.click(`.tab[data-tab=${tab}]`);
    await page.waitForFunction((t) => document.body.dataset.shelf === t, tab);
    assert.equal(await page.getAttribute(`.tab[data-tab=${tab}]`, "aria-selected"), "true");
    assert.equal(await page.locator("#track .card").count(), n + 1);
    assert.equal(await lastCard(page), "add");
  }
  await page.focus(".tab[data-tab=reading]");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.body.dataset.shelf), "want");
});

await run("swipe right on the pick deck starts reading", async (page) => {
  await page.click("#starter");
  await page.click(".tab[data-tab=want]");
  await page.click("#pick");
  await page.waitForSelector("#sheet-pick[open] .deck-card");
  const top = page.locator(".deck-card").last();
  const id = await top.getAttribute("data-id");
  const box = await top.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + i * 22, box.y + box.height / 2 + i * 2);
  await page.mouse.up();
  await page.waitForFunction((bid) => globalThis.__shelfie.state.books.find((b) => b.id === bid).shelf === "reading", id);
  await page.waitForFunction(() => document.body.dataset.shelf === "reading");
});

await run("swipe left sends a book to the back of the pile", async (page) => {
  await page.click("#starter");
  await page.click(".tab[data-tab=want]");
  await page.click("#pick");
  await page.waitForSelector("#sheet-pick[open] .deck-card");
  const first = await page.locator(".deck-card").last().getAttribute("data-id");
  await page.click(".deck-btn.nope");
  await page.waitForFunction((bid) => document.querySelector(".deck-card:last-child").dataset.id !== bid, first);
  assert.equal((await state(page)).books.find((b) => b.id === first).shelf, "want");
});

await run("poking a cover finds an easter egg once", async (page) => {
  await page.click("#starter");
  const dune = (await state(page)).books.find((b) => b.title === "Dune");
  await page.click(`.card[data-id="${dune.id}"] .card-open`);
  await page.waitForSelector("#sheet-book[open] .bk-art");
  const xp0 = (await state(page)).xp;
  await page.click(".bk-art");
  await page.waitForFunction(() => globalThis.__shelfie.state.eggs.length === 1);
  let s = await state(page);
  assert.equal(s.eggs[0], `${dune.id}:spice`);
  assert.equal(s.xp, xp0 + 15);
  await page.click(".bk-art");
  await page.waitForTimeout(300);
  s = await state(page);
  assert.equal(s.eggs.length, 2, "the second poke is a different trick");
});

await run("tapping the logo five times throws a party", async (page) => {
  for (let i = 0; i < 5; i++) await page.click("#logo");
  await page.waitForFunction(() => globalThis.__shelfie.state.eggs.includes("app:party"));
});

await run("shelves survive a reload", async (page) => {
  await page.click("#starter");
  const n = (await state(page)).books.length;
  await page.reload();
  await page.waitForSelector('.card[data-id]:not(.add)');
  assert.equal((await state(page)).books.length, n);
  assert.equal(await page.evaluate(() => document.body.dataset.shelf), "reading");
});

await run("daily goal can be changed", async (page) => {
  await page.click("#goal");
  await page.waitForSelector("#sheet-me[open]");
  await page.click('[aria-label="Raise goal"]');
  assert.equal((await state(page)).goal, 25);
  assert.equal(await page.textContent("#goal-of"), "/ 25");
});

await run("search failure says so, and offers adding by hand", async (page) => {
  await page.unroute("https://openlibrary.org/search.json*");
  await page.route("https://openlibrary.org/search.json*", (r) => r.fulfill({ status: 503, body: "busy", headers: { "access-control-allow-origin": "*" } }));
  await page.click(".card.add .add-btn");
  await page.fill("#q", "anything");
  await page.waitForSelector(".results .hint.warn");
}, { allow: /status of 503/ });

// The same journeys with full motion on, to catch animation-path errors.
await run(
  "full motion: starter, open, poke, switch, pick",
  async (page) => {
    await page.click("#starter");
    await page.waitForTimeout(1200);
    await page.click(".card.alive .card-open");
    await page.waitForSelector("#sheet-book[open] .bk-art");
    await page.waitForTimeout(800);
    await page.click(".bk-art");
    await page.waitForTimeout(2600);
    await page.click('.quick button:has-text("+10")');
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await page.click(".tab[data-tab=want]");
    await page.waitForTimeout(1500);
    await page.click("#pick");
    await page.waitForTimeout(900);
    await page.click(".deck-btn.nope");
    await page.waitForTimeout(800);
    await page.click(".deck-btn.yes");
    await page.waitForFunction(() => document.body.dataset.shelf === "reading", null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    assert.equal(await lastCard(page), "add");
  },
  { motion: "no-preference" },
);

await browser.close();
if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");

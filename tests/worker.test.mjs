// Worker tests: node --test tests/
// Upstream calls are answered from recorded responses, so these run offline.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { cleanQuery } from "../worker/worker.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const ORIGIN = "https://parth8.github.io";
const KEY = "test-key-NOT-REAL-0123456789";
const env = { ALLOWED_ORIGINS: ORIGIN, GOOGLE_BOOKS_KEY: KEY };

class MemoryCache {
  constructor() {
    this.store = new Map();
  }
  async match(req) {
    const hit = this.store.get(req.url);
    return hit ? new Response(hit) : undefined;
  }
  async put(req, res) {
    this.store.set(req.url, await res.text());
  }
}

let upstream;
let calls;
let pending;
let logs;
const ctx = { waitUntil: (p) => pending.push(p) };
let ip = 0;

beforeEach(() => {
  ip++;
  globalThis.caches = { default: new MemoryCache() };
  upstream = new Map();
  calls = [];
  pending = [];
  logs = [];
  for (const level of ["log", "warn", "error"]) console[level] = (...a) => logs.push(a.join(" "));
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [match, make] of upstream) if (String(url).includes(match)) return make(String(url));
    throw new Error(`unexpected fetch ${url}`);
  };
});

async function call(path, { origin = ORIGIN, extra = {}, method = "GET" } = {}) {
  const res = await worker.fetch(new Request(`https://shelf-api.example${path}`, { method, headers: { "CF-Connecting-IP": `10.0.0.${ip}`, ...(origin ? { Origin: origin } : {}) } }), { ...env, ...extra }, ctx);
  await Promise.all(pending);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

const googleOk = () => upstream.set("www.googleapis.com", () => new Response(fixture("google-dune.json")));
const olOk = () => upstream.set("openlibrary.org", () => new Response(fixture("search-dune.json")));

test("search answers from Google, with the key sent only to Google", async () => {
  googleOk();
  const r = await call("/api/search?q=dune");
  assert.equal(r.status, 200);
  assert.equal(r.body.source, "google");
  assert.equal(r.body.results.length, 3);
  assert.equal(r.body.results[0].title, "Dune");
  assert.equal(calls.length, 1);
  const u = new URL(calls[0]);
  assert.equal(u.hostname, "www.googleapis.com");
  assert.equal(u.searchParams.get("key"), KEY);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("the key never appears in a response", async () => {
  googleOk();
  const r = await call("/api/search?q=dune");
  assert.ok(!JSON.stringify(r.body).includes(KEY));
  const h = await call("/api/health");
  assert.deepEqual(h.body, { ok: true, google: true });
});

test("a response that somehow contains the key is blocked", async () => {
  upstream.set("www.googleapis.com", () => new Response(JSON.stringify({ items: [{ id: "abcd1234", volumeInfo: { title: `leak ${KEY}` } }] })));
  const r = await call("/api/search?q=leaky");
  assert.equal(r.status, 500);
  assert.equal(r.body.error, "internal_error");
  assert.ok(!JSON.stringify(r.body).includes(KEY));
});

test("errors from Google never put the key in the logs", async () => {
  upstream.set("www.googleapis.com", (url) => {
    throw new Error(`failed to fetch ${url}`);
  });
  olOk();
  const r = await call("/api/search?q=dune");
  assert.equal(r.body.source, "openlibrary");
  assert.ok(logs.length > 0);
  assert.ok(logs.every((l) => !l.includes(KEY)), "logs are redacted");
  assert.ok(logs.some((l) => l.includes("[redacted]")));
});

test("Google over quota or empty: Open Library answers", async () => {
  upstream.set("www.googleapis.com", () => new Response('{"error":{"code":429}}', { status: 429 }));
  olOk();
  const r = await call("/api/search?q=dune");
  assert.equal(r.body.source, "openlibrary");
  assert.equal(r.body.results[0].cover, 11481354);
});

test("without a key, Google is never called", async () => {
  olOk();
  const r = await call("/api/search?q=dune", { extra: { GOOGLE_BOOKS_KEY: undefined } });
  assert.equal(r.body.source, "openlibrary");
  assert.ok(calls.every((c) => !c.includes("googleapis")));
});

test("answers are cached", async () => {
  googleOk();
  await call("/api/search?q=Dune");
  await call("/api/search?q=dune");
  assert.equal(calls.length, 1);
});

test("only our own site may search", async () => {
  googleOk();
  assert.equal((await call("/api/search?q=dune", { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("/api/search?q=dune", { origin: null })).status, 403);
  assert.equal((await call("/api/search?q=dune", { origin: null, extra: { REQUIRE_ORIGIN: "false" } })).status, 200);
  assert.equal(calls.length, 1);
});

test("bad input, methods and routes are refused", async () => {
  assert.equal((await call("/api/search?q=a")).status, 400);
  assert.equal((await call(`/api/search?q=${"x".repeat(121)}`)).status, 400);
  assert.equal((await call("/api/search")).status, 400);
  assert.equal((await call("/api/nope")).status, 404);
  assert.equal((await call("/api/search?q=dune", { method: "POST" })).status, 405);
  assert.equal(calls.length, 0);
  assert.equal(cleanQuery("  the\u0000 \n hobbit "), "the hobbit");
});

test("rate limited per visitor", async () => {
  googleOk();
  let last;
  for (let i = 0; i < 31; i++) last = await call(`/api/search?q=book${i}`);
  assert.equal(last.status, 429);
});

test("everything down: a clear error, or yesterday's answer", async () => {
  googleOk();
  await call("/api/search?q=dune");
  // Fresh copy gone, both sources down: the stale copy answers.
  const store = globalThis.caches.default.store;
  for (const k of [...store.keys()]) if (!k.endsWith("stale")) store.delete(k);
  upstream.set("www.googleapis.com", () => new Response("", { status: 503 }));
  upstream.set("openlibrary.org", () => new Response("", { status: 503 }));
  const r = await call("/api/search?q=dune");
  assert.equal(r.body.results[0].title, "Dune");
  const miss = await call("/api/search?q=nothing+cached");
  assert.equal(miss.status, 502);
  assert.equal(miss.body.error, "upstream_unavailable");
});

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

class MemoryKV {
  constructor() {
    this.map = new Map();
    this.puts = [];
  }
  async get(k, type) {
    const v = this.map.get(k);
    return v == null ? null : type === "json" ? JSON.parse(v) : v;
  }
  async put(k, v, opts) {
    this.map.set(k, v);
    this.puts.push({ k, opts });
  }
}

async function call(path, { origin = ORIGIN, extra = {}, method = "GET", body = null, type = "application/json" } = {}) {
  const headers = { "CF-Connecting-IP": `10.0.0.${ip}`, ...(origin ? { Origin: origin } : {}), ...(body != null ? { "Content-Type": type } : {}) };
  const res = await worker.fetch(new Request(`https://shelf-api.example${path}`, { method, headers, body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), { ...env, ...extra }, ctx);
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
  assert.deepEqual(h.body, { ok: true, google: true, sync: false, accounts: false });
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

/* ---------------- sync ---------------- */

const ID = "a".repeat(64);
const box = { iv: "AAAAAAAAAAAAAAAA", ct: "c2VjcmV0IHN0dWZmIHRoYXQgaXMgZW5jcnlwdGVk" };

test("sync: empty, then store, then read back", async () => {
  const SYNC = new MemoryKV();
  let r = await call(`/api/sync/${ID}`, { extra: { SYNC } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { rev: 0 });
  r = await call(`/api/sync/${ID}`, { method: "PUT", body: { ...box, base: 0 }, extra: { SYNC } });
  assert.deepEqual(r.body, { rev: 1 });
  assert.equal(SYNC.puts[0].opts.expirationTtl, 400 * 86400);
  r = await call(`/api/sync/${ID}`, { extra: { SYNC } });
  assert.deepEqual(r.body, { rev: 1, ...box });
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});

test("sync: a save built on an old revision gets the current copy back (409)", async () => {
  const SYNC = new MemoryKV();
  await call(`/api/sync/${ID}`, { method: "PUT", body: { ...box, base: 0 }, extra: { SYNC } });
  const r = await call(`/api/sync/${ID}`, { method: "PUT", body: { ...box, ct: "b3RoZXIgZGV2aWNlIGNvcHkgaGVyZQ==", base: 0 }, extra: { SYNC } });
  assert.equal(r.status, 409);
  assert.equal(r.body.rev, 1);
  assert.equal(r.body.ct, box.ct);
  const ok = await call(`/api/sync/${ID}`, { method: "PUT", body: { ...box, base: 1 }, extra: { SYNC } });
  assert.deepEqual(ok.body, { rev: 2 });
});

test("sync: bad ids, bodies, types and sizes are refused", async () => {
  const SYNC = new MemoryKV();
  const put = (body, opts = {}) => call(`/api/sync/${ID}`, { method: "PUT", body, extra: { SYNC }, ...opts });
  assert.equal((await call("/api/sync/not-a-hash", { extra: { SYNC } })).status, 404);
  assert.equal((await call(`/api/sync/${"A".repeat(64)}`, { extra: { SYNC } })).status, 404, "lowercase hex only");
  assert.equal((await put({ ...box, base: 0 }, { type: "text/plain" })).status, 415);
  assert.equal((await put("{nope")).status, 400);
  assert.equal((await put({ ...box, iv: "short", base: 0 })).status, 400);
  assert.equal((await put({ ...box, ct: "<script>", base: 0 })).status, 400);
  assert.equal((await put({ ...box })).status, 400, "base is required");
  assert.equal((await put({ ...box, ct: "A".repeat(600_001), base: 0 })).status, 413);
  assert.equal((await call(`/api/sync/${ID}`, { method: "DELETE", extra: { SYNC } })).status, 405);
  assert.equal((await call("/api/search?q=dune", { method: "PUT", body: {} })).status, 405, "PUT only on sync");
  assert.equal(SYNC.map.size, 0);
});

test("sync: only our own site, and off without its store", async () => {
  const SYNC = new MemoryKV();
  assert.equal((await call(`/api/sync/${ID}`, { origin: "https://evil.example", extra: { SYNC } })).status, 403);
  const r = await call(`/api/sync/${ID}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "sync_not_configured");
});

test("sync: the browser may send JSON with PUT (preflight)", async () => {
  const r = await worker.fetch(new Request(`https://shelf-api.example/api/sync/${ID}`, { method: "OPTIONS", headers: { Origin: ORIGIN } }), env, ctx);
  assert.equal(r.status, 204);
  assert.match(r.headers.get("Access-Control-Allow-Methods"), /PUT/);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("covers by ISBN: a sharp Google cover, looked up once, key only to Google", async () => {
  upstream.set("www.googleapis.com", () => new Response(JSON.stringify({ items: [{ id: "nocover1" , volumeInfo: {} }, { id: "B1hSG45JCX4C", volumeInfo: { imageLinks: { thumbnail: "http://x" } } }] })));
  const r = await call("/api/cover?isbn=978-0-441-01359-3");
  assert.equal(r.status, 200);
  assert.match(r.body.img, /^https:\/\/books\.google\.com\/books\/content\?id=B1hSG45JCX4C&.*fife=w720-h1080/);
  assert.ok(!JSON.stringify(r.body).includes(KEY));
  assert.equal(new URL(calls[0]).searchParams.get("q"), "isbn:9780441013593");
  await call("/api/cover?isbn=9780441013593");
  assert.equal(calls.length, 1, "cached");
  assert.equal((await call("/api/cover?isbn=12345")).status, 400);
});

test("covers by ISBN: none found is a normal answer, and no key means no lookup", async () => {
  upstream.set("www.googleapis.com", () => new Response("{}"));
  assert.deepEqual((await call("/api/cover?isbn=0441013597")).body, { img: null });
  calls = [];
  assert.deepEqual((await call("/api/cover?isbn=0441013598", { extra: { GOOGLE_BOOKS_KEY: "" } })).body, { img: null });
  assert.equal(calls.length, 0);
});

test("covers by title and author: only a matching title counts", async () => {
  upstream.set("www.googleapis.com", () => new Response(JSON.stringify({ items: [{ id: "wrongbook1", volumeInfo: { title: "Dune Messiah Coloring Book", imageLinks: { thumbnail: "x" } } }, { id: "B1hSG45JCX4C", volumeInfo: { title: "Dune", imageLinks: { thumbnail: "x" } } }] })));
  const r = await call("/api/cover?t=Dune&a=Frank%20Herbert");
  assert.equal(r.status, 200);
  assert.match(r.body.img, /id=B1hSG45JCX4C/, "not the coloring book");
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get("q"), "intitle:Dune inauthor:Frank Herbert");
  upstream.set("www.googleapis.com", () => new Response(JSON.stringify({ items: [{ id: "otherbook1", volumeInfo: { title: "Something Else", imageLinks: { thumbnail: "x" } } }] })));
  assert.deepEqual((await call("/api/cover?t=The%20Hobbit&a=Tolkien")).body, { img: null });
  assert.equal((await call("/api/cover?t=x")).status, 400);
});

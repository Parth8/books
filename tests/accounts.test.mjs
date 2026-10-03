// Accounts, end to end: the browser's own crypto (js/account.js) against the real Worker and
// real SQL (Node's SQLite standing in for D1).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { cleanLogin } from "../worker/worker.js";
import { FakeD1 } from "./helpers/d1.mjs";
import { fakeAuthenticator } from "./helpers/webauthn.mjs";
import { prfKey } from "../js/passkey.js";
import * as A from "../js/account.js";

const ORIGIN = "https://parth8.github.io";
const SECRET = "test-auth-secret-NOT-REAL-0123456789abcdef";
let env;
let ip = 0;
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };

beforeEach(() => {
  ip++;
  env = { ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1(), AUTH_SECRET: SECRET };
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  for (const level of ["log", "warn", "error"]) console[level] = () => {};
});

async function call(path, { body, raw = null, method = body || raw ? "POST" : "GET", token, from = `10.1.0.${ip}` } = {}) {
  const headers = { Origin: ORIGIN, "CF-Connecting-IP": from };
  if (body || raw) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.example${path}`, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) }), env, ctx);
  await Promise.all(pending.splice(0));
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

const PW = "correct horse battery";

async function signup(login = "ada", pw = PW) {
  const made = await A.newAccount(login, pw);
  const r = await call("/api/auth/signup", { body: made.body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...made, token: r.body.token };
}

async function login(login = "ada", pw = PW, opts = {}) {
  const pre = await call("/api/auth/prelogin", { body: { login }, ...opts });
  const { auth, encKey } = await A.fromPassword(pw, pre.body.salt, pre.body.kdf);
  const r = await call("/api/auth/login", { body: { login, auth }, ...opts });
  return { ...r, encKey };
}

test("logins: usernames and emails, normalised the same on both sides", () => {
  for (const v of ["Ada", " ada.lovelace ", "ADA@Example.com", "a_b-c"]) assert.equal(A.cleanLogin(v), cleanLogin(v));
  assert.equal(A.cleanLogin("ab"), null);
  assert.equal(A.cleanLogin("<script>@x.com"), null);
  assert.throws(() => cleanLogin("no spaces allowed"));
});

test("passwords: too short, too common, or containing the username are refused", () => {
  assert.match(A.passwordProblem("short", "ada"), /10 characters/);
  assert.match(A.passwordProblem("password123", "ada"), /hacker/);
  assert.match(A.passwordProblem("ada-is-great-2025", "ada"), /username/);
  assert.match(A.passwordProblem("aaaaaaaaaaaa", "ada"), /repetitive/);
  assert.equal(A.passwordProblem(PW, "ada"), null);
  assert.ok(A.strength("correct horse battery staple") > A.strength("abcdefghij"));
});

test("sign up, log in elsewhere, and both devices open the same shelves", async () => {
  const a = await signup();
  assert.match(a.recovery, /^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
  // Device A saves.
  const shelves = { v: 1, books: [{ id: "x", title: "Dune", shelf: "reading" }] };
  const put = await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, shelves)), base: 0 }) });
  assert.equal(put.status, 200);
  assert.equal(put.body.rev, 1);
  // Device B logs in and reads them.
  const b = await login();
  assert.equal(b.status, 200);
  const keyB = await A.unwrap(b.body.wrapped, b.encKey);
  const got = await call("/api/vault", { token: b.body.token });
  assert.deepEqual(await A.open(keyB, got.body), shelves);
  // A save built on an old revision gets the newer copy back.
  const stale = await call("/api/vault", { method: "PUT", token: b.body.token, raw: JSON.stringify({ ...(await A.seal(keyB, shelves)), base: 0 }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, 1);
});

test("the server never holds a password, a login, a readable shelf or a raw token", async () => {
  const a = await signup("ada@example.com");
  await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { title: "Secret Garden" })), base: 0 }) });
  const dump = JSON.stringify([env.DB.rows("SELECT * FROM users"), env.DB.rows("SELECT * FROM names"), env.DB.rows("SELECT * FROM sessions"), env.DB.rows("SELECT * FROM vaults"), env.DB.rows("SELECT * FROM hits")]);
  for (const leak of ["ada@example.com", "example.com", PW, "Secret Garden", a.token, a.body.auth, SECRET]) assert.ok(!dump.includes(leak), `database contains ${leak}`);
  // Raw IPs aren't stored either.
  assert.ok(!dump.includes(`10.1.0.${ip}`));
});

test("compression keeps a big library small", async () => {
  const key = (await A.newAccount("ada", PW)).dataKey;
  const books = Array.from({ length: 1000 }, (_, i) => ({ id: `b${i}`, title: `Book number ${i}`, author: "Some Author", shelf: "read", pages: 300, page: 300, added: "2024-01-01T12:00:00.000Z" }));
  const sealed = await A.seal(key, { books });
  assert.ok(sealed.ct.length < JSON.stringify({ books }).length / 4, `${sealed.ct.length} bytes`);
  assert.equal((await A.open(key, sealed)).books.length, 1000);
});

test("wrong passwords: the same answer as an unknown account, then a lockout", async () => {
  await signup();
  const unknown = await login("nobody-here", PW);
  const wrong = await login("ada", "wrong password here");
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(unknown.body.message, wrong.body.message);
  // The salt for an unknown account looks real, and never changes.
  const p1 = await call("/api/auth/prelogin", { body: { login: "nobody-here" } });
  const p2 = await call("/api/auth/prelogin", { body: { login: "nobody-here" } });
  assert.equal(p1.body.salt, p2.body.salt);
  assert.equal(p1.body.salt.length, 24);
  for (let i = 0; i < 4; i++) await login("ada", "wrong password here", { from: `10.2.0.${i}` });
  const locked = await login("ada", PW, { from: "10.3.0.1" });
  assert.equal(locked.status, 429, "locked even from another address, and even with the right password");
  assert.ok(Number(locked.headers.get("Retry-After")) > 0);
});

test("durable rate limits per address and per account", async () => {
  for (let i = 0; i < 5; i++) {
    const made = await A.newAccount(`user${i}x`, PW);
    assert.equal((await call("/api/auth/signup", { body: made.body, from: "10.9.9.9" })).status, 200);
  }
  const sixth = await A.newAccount("user6x", PW);
  const r = await call("/api/auth/signup", { body: sixth.body, from: "10.9.9.9" });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "rate_limited");
});

test("usernames are unique, and bodies are checked", async () => {
  await signup();
  const again = await A.newAccount("ADA", PW);
  assert.equal((await call("/api/auth/signup", { body: again.body })).status, 409);
  const bad = await A.newAccount("bob", PW);
  const patches = [{ kdf: 1000 }, { salt: "short" }, { auth: "x" }, { wrapped: "a.b" }, { rwrapped: `${"A".repeat(16)}.${"A".repeat(64)}.x` }, { login: "a b" }];
  for (const [i, patch] of patches.entries()) {
    assert.equal((await call("/api/auth/signup", { body: { ...bad.body, ...patch }, from: `10.5.${ip}.${i}` })).status, 400, JSON.stringify(patch));
  }
  assert.equal((await call("/api/auth/signup", { raw: "{not json", from: "10.6.0.1" })).status, 400);
  assert.equal((await call("/api/auth/signup", { raw: JSON.stringify({ pad: "x".repeat(10000) }), from: "10.6.0.2" })).status, 413);
});

test("sessions: bad and old tokens are refused; log out, and log out everywhere", async () => {
  const a = await signup();
  assert.equal((await call("/api/vault", { token: "x".repeat(43) })).status, 401);
  assert.equal((await call("/api/vault")).status, 401);
  const b = await login();
  assert.equal((await call("/api/auth/logout", { body: {}, token: a.token })).status, 200);
  assert.equal((await call("/api/vault", { token: a.token })).status, 401);
  assert.equal((await call("/api/vault", { token: b.body.token })).status, 200);
  await call("/api/auth/logout", { body: { all: true }, token: b.body.token });
  assert.equal((await call("/api/vault", { token: b.body.token })).status, 401);
  // Expired sessions don't work.
  const c = await login();
  env.DB.db.prepare("UPDATE sessions SET expires = 1").run();
  assert.equal((await call("/api/vault", { token: c.body.token })).status, 401);
});

test("change password: the old one stops working, other devices are signed out, books stay readable", async () => {
  const a = await signup();
  await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { n: 1 })), base: 0 }) });
  const other = await login();
  const pre = await call("/api/auth/prelogin", { body: { login: "ada" } });
  const old = await A.fromPassword(PW, pre.body.salt, pre.body.kdf);
  const next = await A.rewrap(a.wrapped, old.encKey, "a brand new passphrase");
  const r = await call("/api/auth/password", { token: a.token, body: { auth: old.auth, salt: next.salt, kdf: next.kdf, newAuth: next.auth, wrapped: next.wrapped } });
  assert.equal(r.status, 200);
  assert.equal((await call("/api/vault", { token: other.body.token })).status, 401);
  assert.equal((await login("ada", PW)).status, 401);
  const fresh = await login("ada", "a brand new passphrase");
  const key = await A.unwrap(fresh.body.wrapped, fresh.encKey);
  assert.deepEqual(await A.open(key, (await call("/api/vault", { token: fresh.body.token })).body), { n: 1 });
});

test("forgot password: the recovery code sets a new one and the books survive", async () => {
  const a = await signup();
  await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { n: 7 })), base: 0 }) });
  const code = A.cleanRecovery(a.recovery);
  const begin = await call("/api/auth/recover/begin", { body: { login: "ada" } });
  const r = await A.fromRecovery(code);
  const next = await A.rewrap(begin.body.rwrapped, r.encKey, "remembered it now");
  const done = await call("/api/auth/recover", { body: { login: "ada", rauth: r.auth, salt: next.salt, kdf: next.kdf, auth: next.auth, wrapped: next.wrapped } });
  assert.equal(done.status, 200);
  assert.equal((await call("/api/vault", { token: a.token })).status, 401, "old sessions end");
  assert.deepEqual(await A.open(next.dataKey, (await call("/api/vault", { token: done.body.token })).body), { n: 7 });
  // A wrong code can't open the wrapped key, and can't pass the server's check either.
  const wrongR = await A.fromRecovery(A.cleanRecovery("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA"));
  await assert.rejects(A.unwrap(begin.body.rwrapped, wrongR.encKey));
  assert.equal((await call("/api/auth/recover", { body: { login: "ada", rauth: wrongR.auth, salt: next.salt, kdf: next.kdf, auth: next.auth, wrapped: next.wrapped } })).status, 401);
  // Unknown accounts get a made-up wrapped key of the same shape.
  const fake = await call("/api/auth/recover/begin", { body: { login: "ghost" } });
  assert.match(fake.body.rwrapped, /^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{64}$/);
});

test("delete account: everything goes, and it needs the password", async () => {
  const a = await signup();
  await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { n: 1 })), base: 0 }) });
  const wrong = await A.fromPassword("not the password!", (await call("/api/auth/prelogin", { body: { login: "ada" } })).body.salt);
  assert.equal((await call("/api/auth/delete", { token: a.token, body: { auth: wrong.auth } })).status, 401);
  const pre = await call("/api/auth/prelogin", { body: { login: "ada" } });
  const right = await A.fromPassword(PW, pre.body.salt, pre.body.kdf);
  assert.equal((await call("/api/auth/delete", { token: a.token, body: { auth: right.auth } })).status, 200);
  assert.equal(env.DB.rows("SELECT * FROM users").length + env.DB.rows("SELECT * FROM vaults").length + env.DB.rows("SELECT * FROM sessions").length, 0);
});

test("accounts are off without the database or a long enough secret", async () => {
  env = { ALLOWED_ORIGINS: ORIGIN, DB: new FakeD1(), AUTH_SECRET: "short" };
  assert.equal((await call("/api/auth/prelogin", { body: { login: "ada" } })).status, 503);
  env = { ALLOWED_ORIGINS: ORIGIN };
  assert.equal((await call("/api/vault", { token: "x".repeat(43) })).status, 503);
});

test("the secret never appears in an answer or a log", async () => {
  const logs = [];
  for (const level of ["log", "warn", "error"]) console[level] = (...a) => logs.push(a.join(" "));
  await signup();
  const r = await login("ada", "wrong password here");
  assert.ok(!JSON.stringify(r.body).includes(SECRET));
  assert.ok(!logs.join("\n").includes(SECRET));
});

test("CORS: the site may send a token with POST and PUT", async () => {
  const res = await worker.fetch(new Request("https://api.example/api/vault", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env, ctx);
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.match(res.headers.get("Access-Control-Allow-Methods"), /POST/);
});

test("a save retried after a lost answer applies once, and a different save still conflicts", async () => {
  const a = await signup();
  const sealed = await A.seal(a.dataKey, { n: 1 });
  const first = await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...sealed, base: 0, op: "op-aaaaaaaa1" }) });
  assert.equal(first.body.rev, 1);
  const retry = await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...sealed, base: 0, op: "op-aaaaaaaa1" }) });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.rev, 1, "no second write");
  const other = await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...sealed, base: 0, op: "op-bbbbbbbb2" }) });
  assert.equal(other.status, 409);
  assert.equal((await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...sealed, base: 1, op: "bad op!" }) })).status, 400);
});

test("backups cost no database writes beyond the save itself", async () => {
  const a = await signup();
  const before = env.DB.rows("SELECT COUNT(*) n FROM hits")[0].n;
  for (let i = 0; i < 5; i++) await call("/api/vault", { token: a.token });
  await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { n: 1 })), base: 0 }) });
  assert.equal(env.DB.rows("SELECT COUNT(*) n FROM hits")[0].n, before, "no rate-limit rows written for backups");
});

test("a new recovery code replaces the old one (and needs the password)", async () => {
  const a = await signup();
  const pre = await call("/api/auth/prelogin", { body: { login: "ada" } });
  const { auth, encKey } = await A.fromPassword(PW, pre.body.salt, pre.body.kdf);
  const key = await A.unwrap(a.wrapped, encKey, true);
  const code = "BBBBCCCCDDDDEEEEFFFFGGGG";
  const r = await A.fromRecovery(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.wrapKey("raw", key, r.encKey, { name: "AES-GCM", iv });
  const rwrapped = `${Buffer.from(iv).toString("base64")}.${Buffer.from(ct).toString("base64")}`;
  const wrong = await A.fromPassword("nope nope nope", pre.body.salt, pre.body.kdf);
  assert.equal((await call("/api/auth/recovery", { token: a.token, body: { auth: wrong.auth, rauth: r.auth, rwrapped } })).status, 401);
  assert.equal((await call("/api/auth/recovery", { token: a.token, body: { auth, rauth: r.auth, rwrapped } })).status, 200);
  // The new code works; the old one doesn't.
  const begin = await call("/api/auth/recover/begin", { body: { login: "ada" } });
  assert.equal(begin.body.rwrapped, rwrapped);
  const old = await A.fromRecovery(A.cleanRecovery(a.recovery));
  await assert.rejects(A.unwrap(begin.body.rwrapped, old.encKey));
});

test("databases made before the op column get it added", async () => {
  env.DB.db.exec("CREATE TABLE vaults (uid TEXT PRIMARY KEY, rev INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, updated INTEGER NOT NULL)");
  const a = await signup();
  const r = await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { n: 1 })), base: 0, op: "op-cccccccc3" }) });
  assert.equal(r.status, 200);
  assert.equal(env.DB.rows("SELECT op FROM vaults")[0].op, "op-cccccccc3");
});

let spread = 0; // (many logins in one test: from different addresses, under the rate limits)
const L = (name) => login(name, PW, { from: `10.80.${ip}.${spread++ % 250}` });
async function signup3(username, email, pw = PW, from = `10.81.${ip}.${spread++ % 250}`) {
  const made = await A.newAccount({ username, email }, pw);
  const r = await call("/api/auth/signup", { body: made.body, from });
  return { ...made, status: r.status, body: r.body, token: r.body?.token };
}
const proof = async (token, pw = PW) => {
  const me = await call("/api/auth/me", { token, body: {} });
  return (await A.fromPassword(pw, me.body.salt, me.body.kdf)).auth;
};

test("username, email and password are three separate things; log in with either name", async () => {
  const a = await signup3("ada", "ada@example.com");
  assert.equal(a.status, 200, JSON.stringify(a.body));
  await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { n: 3 })), base: 0 }) });
  for (const name of ["ada", "ADA@example.com"]) {
    const r = await L(name);
    assert.equal(r.status, 200, name);
    assert.equal(r.body.username, "ada");
  }
  const me = await call("/api/auth/me", { token: a.token, body: {} });
  assert.deepEqual([me.body.username, me.body.email, me.body.passkeys], ["ada", true, 0]);
  // The email is never stored: only a keyed hash of it.
  assert.ok(!JSON.stringify([env.DB.rows("SELECT * FROM users"), env.DB.rows("SELECT * FROM names")]).includes("example.com"));

  // A new username: no password needed. The email and password stay; the old username stops.
  await signup3("bob", "bob@example.com");
  assert.equal((await call("/api/auth/username", { token: a.token, body: { username: "bob" } })).status, 409, "taken");
  assert.equal((await call("/api/auth/username", { token: a.token, body: { username: "@Lovelace" } })).status, 200);
  assert.equal((await L("ada")).status, 401);
  assert.equal((await L("lovelace")).body.username, "lovelace");
  assert.equal((await L("ada@example.com")).status, 200, "same email");
  // Same session, same backup.
  assert.deepEqual(await A.open(a.dataKey, (await call("/api/vault", { token: a.token })).body), { n: 3 });

  // A new email needs the password; the username stays.
  const wrong = await proof(a.token, "wrong wrong wrong");
  assert.equal((await call("/api/auth/email", { token: a.token, body: { auth: wrong, email: "ada@new.example" } })).status, 401);
  assert.equal((await call("/api/auth/email", { token: a.token, body: { auth: await proof(a.token), email: "bob@example.com" } })).status, 409, "someone else's");
  assert.equal((await call("/api/auth/email", { token: a.token, body: { auth: await proof(a.token), email: "ada@new.example" } })).status, 200);
  assert.equal((await L("ada@example.com")).status, 401);
  assert.equal((await L("ada@new.example")).body.username, "lovelace");
  assert.equal((await L("lovelace")).status, 200);
  // Remove the email: the username still logs in.
  assert.equal((await call("/api/auth/email", { token: a.token, body: { auth: await proof(a.token), email: "" } })).status, 200);
  assert.equal((await L("ada@new.example")).status, 401);
  assert.equal((await call("/api/auth/me", { token: a.token, body: {} })).body.email, false);
  // No email at all is fine too.
  assert.equal((await signup3("carol", null)).status, 200);
  assert.equal((await signup3("carol2", "bob@example.com")).status, 409, "email already used");
});

test("older accounts keep working, and get a separate username and email when they log in", async () => {
  // Build the old row by hand with the same keyed hashes the Worker uses.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = async (label, bytes) => Buffer.from(await crypto.subtle.sign("HMAC", key, new Uint8Array([...new TextEncoder().encode(`${label}\0`), ...bytes]))).toString("hex");
  const old = async (login) => {
    const made = await A.newAccount(login, PW);
    const b = made.body;
    await call("/api/auth/prelogin", { body: { login: "warmup" } }); // (makes the tables)
    env.DB.db
      .prepare("INSERT INTO users (id, salt, kdf, auth, wrapped, rauth, rwrapped, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(await mac("id", new TextEncoder().encode(login)), b.salt, b.kdf, await mac("auth", Buffer.from(b.auth, "base64")), b.wrapped, await mac("auth", Buffer.from(b.rauth, "base64")), b.rwrapped, Date.now());
    return made;
  };
  await old("ada");
  const r = await L("ada");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.username, "ada", "an old username login becomes the username");
  // Now an email can be added, and the username changed, independently.
  assert.equal((await call("/api/auth/email", { token: r.body.token, body: { auth: await proof(r.body.token), email: "ada@example.com" } })).status, 200);
  assert.equal((await call("/api/auth/username", { token: r.body.token, body: { username: "lovelace" } })).status, 200);
  assert.equal((await L("ada")).status, 401);
  assert.equal((await L("lovelace")).status, 200);
  assert.equal((await L("ada@example.com")).status, 200);

  // An old email login, upgraded from a device that's still logged in (it sends its login).
  await old("bob@example.com");
  const b = await L("bob@example.com");
  const me = await call("/api/auth/me", { token: b.body.token, body: { login: "bob@example.com" } });
  assert.deepEqual([me.body.username, me.body.email], [null, true]);
  assert.equal((await call("/api/auth/username", { token: b.body.token, body: { username: "bob" } })).status, 200);
  assert.equal((await L("bob")).status, 200);
  assert.equal((await L("bob@example.com")).status, 200, "the email still works");
  // An old login nobody else can take.
  assert.equal((await signup3("someone", "bob@example.com")).status, 409);
});

const RP = new URL(ORIGIN).hostname;

test("Face ID: switched on with the password, then one glance logs in and opens the books", async () => {
  const a = await signup3("ada", "ada@example.com");
  await call("/api/vault", { method: "PUT", token: a.token, raw: JSON.stringify({ ...(await A.seal(a.dataKey, { secret: "Dune" })), base: 0 }) });
  const face = await fakeAuthenticator({ rpId: RP, origin: ORIGIN });
  // The books' key, wrapped with the passkey's own PRF secret (on the device).
  const raw = await A.unwrap(a.wrapped, (await A.fromPassword(PW, a.body.salt ?? (await call("/api/auth/me", { token: a.token, body: {} })).body.salt)).encKey, true);
  const pwrapped = await A.wrap(raw, await prfKey(face.prf));

  const ch = await call("/api/auth/passkey/challenge", { token: a.token, body: { for: "create" } });
  assert.equal(ch.status, 200);
  assert.equal(ch.body.rpId, RP);
  const att = await face.create(ch.body.challenge);
  // Without the password: no.
  const noPw = await call("/api/auth/passkey/register", { token: a.token, body: { auth: await proof(a.token, "wrong wrong wrong"), challenge: ch.body.challenge, ...att, pwrapped } });
  assert.equal(noPw.status, 401);
  const ch2 = await call("/api/auth/passkey/challenge", { token: a.token, body: { for: "create" } });
  const reg = await call("/api/auth/passkey/register", { token: a.token, body: { auth: await proof(a.token), challenge: ch2.body.challenge, ...(await face.create(ch2.body.challenge)), pwrapped } });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.equal((await call("/api/auth/me", { token: a.token, body: {} })).body.passkeys, 1);
  // The challenge only works once.
  assert.equal((await call("/api/auth/passkey/register", { token: a.token, body: { auth: await proof(a.token), challenge: ch2.body.challenge, ...(await face.create(ch2.body.challenge)), pwrapped } })).status, 401);

  // Log in on a "new device": no password, no username.
  const g = await call("/api/auth/passkey/challenge", { body: { for: "get" } });
  const r = await call("/api/auth/passkey/login", { body: { challenge: g.body.challenge, ...(await face.get(g.body.challenge)) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.username, "ada");
  const key = await A.unwrap(r.body.pwrapped, await prfKey(face.prf));
  assert.deepEqual(await A.open(key, (await call("/api/vault", { token: r.body.token })).body), { secret: "Dune" });
  // The server never had anything that opens the books: the PRF secret stays on the device.
  assert.ok(!JSON.stringify(env.DB.rows("SELECT * FROM passkeys")).includes(Buffer.from(face.prf).toString("base64")));
});

test("Face ID: replays, other sites, no Face ID, forged signatures and removed passkeys are refused", async () => {
  const a = await signup3("ada", null);
  const face = await fakeAuthenticator({ rpId: RP, origin: ORIGIN });
  const ch = await call("/api/auth/passkey/challenge", { token: a.token, body: { for: "create" } });
  const pwrapped = await A.wrap(await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]), await prfKey(face.prf));
  assert.equal((await call("/api/auth/passkey/register", { token: a.token, body: { auth: await proof(a.token), challenge: ch.body.challenge, ...(await face.create(ch.body.challenge)), pwrapped } })).status, 200);
  const attempt = async (opts = {}, patch = {}) => {
    const g = await call("/api/auth/passkey/challenge", { body: { for: "get" }, from: "10.70.0.1" });
    return call("/api/auth/passkey/login", { body: { challenge: g.body.challenge, ...(await face.get(g.body.challenge, opts)), ...patch }, from: "10.70.0.2" });
  };
  assert.equal((await attempt()).status, 200);
  assert.equal((await attempt({ origin: "https://evil.example" })).status, 401, "another site");
  assert.equal((await attempt({ flags: 0x01 })).status, 401, "no Face ID (user not verified)");
  assert.equal((await attempt({ tamper: true })).status, 401, "forged signature");
  assert.equal((await attempt({ type: "webauthn.create" })).status, 401, "wrong ceremony");
  // A replayed answer (same challenge twice).
  const g = await call("/api/auth/passkey/challenge", { body: { for: "get" } });
  const ans = await face.get(g.body.challenge);
  assert.equal((await call("/api/auth/passkey/login", { body: { challenge: g.body.challenge, ...ans } })).status, 200);
  assert.equal((await call("/api/auth/passkey/login", { body: { challenge: g.body.challenge, ...ans } })).status, 401, "replay");
  // Someone else's passkey for another site's id can't register here either.
  const evil = await fakeAuthenticator({ rpId: "evil.example", origin: ORIGIN });
  const ch3 = await call("/api/auth/passkey/challenge", { token: a.token, body: { for: "create" } });
  assert.equal((await call("/api/auth/passkey/register", { token: a.token, body: { auth: await proof(a.token), challenge: ch3.body.challenge, ...(await evil.create(ch3.body.challenge)), pwrapped } })).status, 401);
  // A create challenge needs a session.
  assert.equal((await call("/api/auth/passkey/challenge", { body: { for: "create" } })).status, 401);
  // Face ID off: the passkey stops working.
  assert.equal((await call("/api/auth/passkey/remove", { token: a.token, body: {} })).status, 200);
  assert.equal((await attempt()).status, 401);
  // And deleting the account takes passkeys and names with it.
  await call("/api/auth/delete", { token: a.token, body: { auth: await proof(a.token) } });
  assert.equal(env.DB.rows("SELECT * FROM names").length, 0);
  assert.equal(env.DB.rows("SELECT * FROM passkeys").length, 0);
});

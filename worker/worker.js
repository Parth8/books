/**
 * Shelf API: the Cloudflare Worker behind Shelfie's book search.
 *
 * The Google Books key lives here, as a Worker secret, and nowhere else: not in the page, not
 * in this repository. The browser only ever talks to this Worker.
 *
 * Routes:
 *   GET /api/health
 *   GET /api/search?q=dune
 *   GET /api/cover?isbn=9780441013593   a sharp Google cover for an ISBN, if Google has one
 *   GET /api/sync/<id>     a synced copy of someone's shelves (end-to-end encrypted)
 *   PUT /api/sync/<id>     store a new copy; { iv, ct, base } where base is the revision it
 *                          was built on (a mismatch answers 409 with the current copy)
 *
 * Accounts (end-to-end encrypted; see "Accounts" below for the whole design):
 *   POST /api/auth/prelogin         { login }                      → { salt, kdf }
 *   POST /api/auth/signup           { login, salt, kdf, auth, wrapped, rauth, rwrapped } → { token }
 *   POST /api/auth/login            { login, auth }                → { token, wrapped }
 *   POST /api/auth/logout           { all? }            (Bearer)   → { ok }
 *   POST /api/auth/password         { auth, salt, kdf, newAuth, wrapped } (Bearer) → { token }
 *   POST /api/auth/recover/begin    { login }                      → { rwrapped }
 *   POST /api/auth/recover          { login, rauth, salt, kdf, auth, wrapped } → { token }
 *   POST /api/auth/delete           { auth }            (Bearer)   → { ok }
 *   GET  /api/vault                                     (Bearer)   → { rev, iv, ct } or { rev: 0 }
 *   PUT  /api/vault                 { iv, ct, base }    (Bearer)   → { rev } or 409 with the current copy
 *
 * Sync: the browser encrypts the shelves (AES-256-GCM) with a key derived from a sync code
 * that never leaves the user's devices. <id> is a SHA-256 hash of that code. This Worker only
 * stores and returns ciphertext; it cannot read it.
 *
 * Settings (Worker > Settings > Variables and Secrets):
 *   ALLOWED_ORIGINS    text    e.g. https://parth8.github.io   (comma separated, no path)
 *   GOOGLE_BOOKS_KEY   SECRET  Google Books API key. Add it with the "Secret" type, never "Text".
 *                              It is only ever sent to www.googleapis.com, and every response and
 *                              log line is checked so that no secret value can leave this Worker.
 *                              Without it, search answers from Open Library.
 *   REQUIRE_ORIGIN     text    optional, "false" lets you test in a browser tab
 *   SYNC               KV namespace binding for synced shelves. Sync stays off without it.
 *   LIMITER            optional Rate Limiting binding (otherwise a per-isolate limiter is used)
 *   DB                 D1 database binding for accounts. Accounts stay off without it. The tables
 *                      are created on first use.
 *   AUTH_SECRET        SECRET  32+ random characters. Keys the hashes of logins, passwords and
 *                              rate-limit counters. Add it with the "Secret" type. Changing it
 *                              signs everyone out and makes every password stop working.
 */

const GOOGLE = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_FIELDS = "items(id,volumeInfo(title,subtitle,authors,pageCount,publishedDate,imageLinks/thumbnail,categories,description))";
const OPEN_LIBRARY = "https://openlibrary.org/search.json";
const OL_FIELDS = "key,title,author_name,cover_i,number_of_pages_median,first_publish_year,subject";
const LIMIT = 16;
const TTL = { search: 21600, stale: 604800 }; // 6 hours fresh, a week as a fallback
// Per visitor, per minute, in each Cloudflare location (a first line of defence; the account
// routes also have durable limits in the database, below).
const RATE = { windowMs: 60_000, api: 30, cover: 90, auth: 20, vault: 120 };
const UPSTREAM_TIMEOUT_MS = 8000;
const SYNC = { maxBytes: 600_000, ttlSeconds: 400 * 86400 };

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env, ctx) {
    logEnv = env;
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const cors = allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, PUT, POST", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" },
      });
    }

    try {
      const path = url.pathname;
      const syncId = /^\/api\/sync\/([0-9a-f]{64})$/.exec(path)?.[1];
      const authRoute = /^\/api\/auth\/(prelogin|signup|login|logout|password|recover\/begin|recover|delete)$/.exec(path)?.[1];
      const allowed_ =
        request.method === "GET" ||
        (request.method === "PUT" && (syncId || path === "/api/vault")) ||
        (request.method === "POST" && authRoute);
      if (!allowed_) throw new ApiError(405, "method_not_allowed", "That method isn't supported here.");
      if (path === "/api/health") return reply({ ok: true, google: !!env.GOOGLE_BOOKS_KEY, sync: !!env.SYNC, accounts: accountsOn(env) }, 200, cors, 0, env);

      // Only our own site may use the key from a browser.
      const originOk = allowed.includes(origin) || (!origin && env.REQUIRE_ORIGIN === "false");
      if (!originOk) throw new ApiError(403, "forbidden", "This API only serves its own website.");

      await rateLimit(request, env, path === "/api/cover" ? "cover" : authRoute ? "auth" : path === "/api/vault" ? "vault" : "api");

      if (path === "/api/search") return reply(await searchRoute(url, env, ctx), 200, cors, 300, env);
      if (path === "/api/cover") return reply(await coverRoute(url, env, ctx), 200, cors, 86400, env);
      if (syncId) {
        const [status, body] = request.method === "PUT" ? await syncPut(syncId, request, env) : await syncGet(syncId, env);
        return reply(body, status, cors, 0, env);
      }
      if (authRoute || path === "/api/vault") {
        const [status, body] = await accountRoute(authRoute, request, env, ctx);
        return reply(body, status, cors, 0, env, status === 429 ? body.retry : 0);
      }
      throw new ApiError(404, "not_found", "Unknown route.");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      const code = err instanceof ApiError ? err.code : "internal_error";
      const message = err instanceof ApiError ? err.message : "Something went wrong on our side.";
      if (!(err instanceof ApiError)) log("error", "unhandled", String(err && err.stack));
      return reply({ error: code, message, ...(err?.retry ? { retry: err.retry } : {}) }, status, cors, 0, env, err?.retry || 0);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Secrets never leave                                                 */
/* ------------------------------------------------------------------ */

/** Names of settings whose values must never appear in a response or a log. */
const isSecretName = (name) => /KEY|TOKEN|SECRET|PASS/i.test(name);

function secretValues(env) {
  return Object.entries(env || {})
    .filter(([k, v]) => isSecretName(k) && typeof v === "string" && v.length >= 6)
    .map(([, v]) => v);
}

function redact(text, env) {
  let out = String(text);
  for (const v of secretValues(env)) out = out.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
  return out;
}

/** Every log line goes through here, so secrets never reach the logs either. */
let logEnv = {};
const log = (level, ...parts) => console[level](...parts.map((p) => redact(typeof p === "string" ? p : JSON.stringify(p), logEnv)));

/**
 * The only way a response leaves this Worker. Last line of defence: if a secret value ever
 * ended up in the body, the body is replaced with a generic error. Nothing about the secret is
 * revealed, not even its length.
 */
function reply(body, status, cors, maxAge, env, retryAfter = 0) {
  let text = JSON.stringify(body);
  const lower = text.toLowerCase();
  if (secretValues(env).some((v) => lower.includes(v.toLowerCase()))) {
    log("error", "blocked a response that contained a secret value");
    text = JSON.stringify({ error: "internal_error", message: "Something went wrong on our side." });
    status = 500;
    maxAge = 0;
  }
  return new Response(text, {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `private, max-age=${maxAge}` : "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

/* ------------------------------------------------------------------ */
/* Rate limiting: platform binding if configured, else per-isolate     */
/* ------------------------------------------------------------------ */

const buckets = new Map();
function limited(retry, message = "Too many tries. Give it a minute.") {
  const e = new ApiError(429, "rate_limited", message);
  e.retry = Math.max(1, Math.round(retry));
  return e;
}
async function rateLimit(request, env, bucket = "api") {
  const ip = `${bucket}:${request.headers.get("CF-Connecting-IP") || "unknown"}`;
  const max = RATE[bucket] || RATE.api;
  if (env.LIMITER && typeof env.LIMITER.limit === "function") {
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) throw limited(60);
    return;
  }
  const now = Date.now();
  const b = buckets.get(ip) || { start: now, count: 0 };
  if (now - b.start > RATE.windowMs) {
    b.start = now;
    b.count = 0;
  }
  b.count += 1;
  buckets.set(ip, b);
  if (buckets.size > 5000) buckets.clear();
  if (b.count > max) throw limited(Math.ceil((b.start + RATE.windowMs - now) / 1000));
}

/* ------------------------------------------------------------------ */
/* Sync: stores ciphertext it can't read                               */
/* ------------------------------------------------------------------ */

function syncStore(env) {
  if (!env.SYNC || typeof env.SYNC.get !== "function") throw new ApiError(503, "sync_not_configured", "Sync isn't switched on yet.");
  return env.SYNC;
}

async function syncGet(id, env) {
  const copy = await syncStore(env).get(`s:${id}`, "json");
  // Nothing synced yet is a normal answer, not an error: revision 0, no copy.
  if (!copy) return [200, { rev: 0 }];
  return [200, { rev: copy.rev, iv: copy.iv, ct: copy.ct }];
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

async function syncPut(id, request, env) {
  const kv = syncStore(env);
  if (!/^application\/json\b/.test(request.headers.get("Content-Type") || "")) throw new ApiError(415, "bad_type", "Send JSON.");
  if (Number(request.headers.get("Content-Length") || 0) > SYNC.maxBytes) throw new ApiError(413, "too_large", "That's more than a shelf should hold.");
  const text = await request.text();
  if (text.length > SYNC.maxBytes) throw new ApiError(413, "too_large", "That's more than a shelf should hold.");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "bad_body", "That isn't valid JSON.");
  }
  const { iv, ct, base } = body || {};
  // A 12-byte AES-GCM nonce is 16 base64 characters; the ciphertext carries a 16-byte tag.
  if (typeof iv !== "string" || iv.length !== 16 || !B64.test(iv)) throw new ApiError(400, "bad_body", "Missing or odd iv.");
  if (typeof ct !== "string" || ct.length < 24 || !B64.test(ct)) throw new ApiError(400, "bad_body", "Missing or odd ct.");
  if (!Number.isInteger(base) || base < 0) throw new ApiError(400, "bad_body", "Missing base revision.");
  const current = await kv.get(`s:${id}`, "json");
  if (current && current.rev !== base) return [409, { error: "conflict", message: "Changed elsewhere first.", rev: current.rev, iv: current.iv, ct: current.ct }];
  const rev = (current?.rev || 0) + 1;
  await kv.put(`s:${id}`, JSON.stringify({ rev, iv, ct, at: Date.now() }), { expirationTtl: SYNC.ttlSeconds });
  return [200, { rev }];
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */
//
// End to end encrypted, like a password manager. What the browser does:
//   master  = PBKDF2-SHA256(password, salt, 600,000 rounds)
//   authKey = HKDF(master, "shelfie auth")   → sent here, as proof of the password
//   encKey  = HKDF(master, "shelfie enc")    → never leaves the device
//   dataKey = a random AES-256 key that encrypts the shelves; stored here only "wrapped"
//             (encrypted) with encKey, and again with a key from a one-time recovery code.
// So this Worker never sees a password, never sees a key that can read the shelves, and
// stores only ciphertext. A stolen database holds no readable books and no usable passwords.
//
// What this Worker stores (all in D1):
//   users     id = HMAC(AUTH_SECRET, login): the username or email itself is never stored.
//             auth = HMAC(AUTH_SECRET, authKey). Even with the database, guessing a password
//             needs AUTH_SECRET too, and 600,000 PBKDF2 rounds per guess.
//   sessions  SHA-256 of each session token (the token itself only lives on the device).
//   vaults    one encrypted, compressed copy of the shelves per account, with a revision.
//   hits      rate-limit counters, keyed by HMACs of the IP or account (no raw IPs).

const ACCOUNT = {
  kdfMin: 600_000,
  kdfMax: 5_000_000,
  sessionMs: 30 * 86400_000, // a session lasts 30 days from its last refresh
  refreshMs: 15 * 86400_000, // and is refreshed when it's used with less than 15 days left
  maxSessions: 10, // devices signed in at once; the oldest is signed out beyond that
  vaultMax: 1_400_000, // base64 characters of ciphertext (about 1 MB)
  lock: { after: 5, baseMs: 60_000, maxMs: 3600_000 }, // failed passwords: 1 min, 2, 4 … up to an hour
};

// Durable limits (they hold across every Cloudflare location): [what, max, window seconds].
const LIMITS = {
  prelogin: [["ip", 40, 600]],
  login: [["ip", 20, 600], ["login", 10, 600]],
  signup: [["ip", 5, 3600]],
  recoverBegin: [["ip", 10, 3600], ["login", 5, 3600]],
  recover: [["ip", 10, 3600], ["login", 5, 3600]],
  password: [["user", 10, 3600]],
  delete: [["user", 5, 3600]],
  vaultGet: [["user", 900, 3600]],
  vaultPut: [["user", 400, 3600]],
};

const accountsOn = (env) => !!(env.DB && typeof env.DB.prepare === "function" && typeof env.AUTH_SECRET === "string" && env.AUTH_SECRET.length >= 32);

const te = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => toB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const hmacKeys = new Map();
async function hmac(env, label, data) {
  let key = hmacKeys.get(env.AUTH_SECRET);
  if (!key) {
    key = await crypto.subtle.importKey("raw", te.encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    hmacKeys.clear();
    hmacKeys.set(env.AUTH_SECRET, key);
  }
  const bytes = typeof data === "string" ? te.encode(data) : data;
  const msg = new Uint8Array(label.length + 1 + bytes.length);
  msg.set(te.encode(label), 0);
  msg.set(bytes, label.length + 1); // label \0 data
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
}

/** Constant-time comparison of two byte arrays (or hex strings). */
function sameBytes(a, b) {
  if (typeof a === "string") a = te.encode(a);
  if (typeof b === "string") b = te.encode(b);
  if (crypto.subtle.timingSafeEqual && a.byteLength === b.byteLength) return crypto.subtle.timingSafeEqual(a, b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** A username (3 to 32 of a-z 0-9 . _ -) or an email address, normalised. */
export function cleanLogin(raw) {
  const v = String(raw ?? "").normalize("NFKC").trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9._-]{2,31}$/.test(v)) return v;
  if (v.length <= 254 && /^[^\s@<>"]{1,64}@[^\s@<>"]{1,189}\.[^\s@<>".]{2,}$/.test(v)) return v;
  throw new ApiError(400, "bad_login", "Use a username (3 to 32 letters, numbers, dots, dashes or underscores) or an email address.");
}

const B64_ = /^[A-Za-z0-9+/]+={0,2}$/;
function b64Field(v, bytes, name) {
  const len = 4 * Math.ceil(bytes / 3);
  if (typeof v !== "string" || v.length !== len || !B64_.test(v)) throw new ApiError(400, "bad_body", `Missing or odd ${name}.`);
  return v;
}
/** A wrapped key: "iv.ciphertext", where the ciphertext is a 32-byte key plus its 16-byte tag. */
function wrappedField(v, name) {
  const [iv, ct, extra] = typeof v === "string" ? v.split(".") : [];
  if (extra !== undefined) throw new ApiError(400, "bad_body", `Missing or odd ${name}.`);
  b64Field(iv, 12, name);
  b64Field(ct, 48, name);
  return v;
}
function kdfField(v) {
  if (!Number.isInteger(v) || v < ACCOUNT.kdfMin || v > ACCOUNT.kdfMax) throw new ApiError(400, "bad_body", "Odd key-derivation setting.");
  return v;
}

async function readJson(request, max = 4096) {
  if (!/^application\/json\b/.test(request.headers.get("Content-Type") || "")) throw new ApiError(415, "bad_type", "Send JSON.");
  if (Number(request.headers.get("Content-Length") || 0) > max) throw new ApiError(413, "too_large", "That's too big.");
  const text = await request.text();
  if (text.length > max) throw new ApiError(413, "too_large", "That's too big.");
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new ApiError(400, "bad_body", "That isn't valid JSON.");
  }
}

const schemaReady = new WeakMap(); // per database binding, created once per isolate
function schema(db) {
  if (schemaReady.has(db)) return schemaReady.get(db);
  const ready = db
    .batch([
      db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, salt TEXT NOT NULL, kdf INTEGER NOT NULL, auth TEXT NOT NULL, wrapped TEXT NOT NULL, rauth TEXT NOT NULL, rwrapped TEXT NOT NULL, created INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS sessions_uid ON sessions (uid)"),
      db.prepare("CREATE TABLE IF NOT EXISTS vaults (uid TEXT PRIMARY KEY, rev INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, updated INTEGER NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL, exp INTEGER NOT NULL)"),
    ])
    .catch((err) => {
      schemaReady.delete(db);
      throw err;
    });
  schemaReady.set(db, ready);
  return ready;
}

/** A fixed-window counter in the database: throws 429 (with Retry-After) past `max`. */
async function hit(env, what, id, max, windowSec, now) {
  const k = toHex(await hmac(env, "limit", `${what}:${id}`)).slice(0, 32);
  const win = Math.floor(now / 1000 / windowSec);
  const exp = (win + 1) * windowSec;
  const row = await env.DB.prepare(
    "INSERT INTO hits (k, win, n, exp) VALUES (?1, ?2, 1, ?3) ON CONFLICT (k) DO UPDATE SET n = CASE WHEN hits.win = ?2 THEN hits.n + 1 ELSE 1 END, win = ?2, exp = ?3 RETURNING n",
  )
    .bind(k, win, exp)
    .first();
  if ((row?.n ?? 0) > max) throw limited(exp - now / 1000);
}

async function limits(env, name, request, { login, user } = {}, now) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  for (const [what, max, windowSec] of LIMITS[name]) {
    const id = what === "ip" ? ip : what === "login" ? login : user;
    if (id) await hit(env, `${name}:${what}`, id, max, windowSec, now);
  }
}

const userId = async (env, login) => toHex(await hmac(env, "id", login));
const authHash = async (env, authB64) => toHex(await hmac(env, "auth", fromB64(authB64)));

async function newSession(env, uid, now) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = toHex(await crypto.subtle.digest("SHA-256", te.encode(token)));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions (hash, uid, created, expires) VALUES (?, ?, ?, ?)").bind(hash, uid, now, now + ACCOUNT.sessionMs),
    // Beyond the limit, the oldest devices are signed out.
    env.DB.prepare("DELETE FROM sessions WHERE uid = ?1 AND hash NOT IN (SELECT hash FROM sessions WHERE uid = ?1 ORDER BY created DESC LIMIT ?2)").bind(uid, ACCOUNT.maxSessions),
  ]);
  return token;
}

/** The signed-in account for a request's Bearer token, or a 401. */
async function session(env, request, now) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("Authorization") || "");
  if (!m) throw new ApiError(401, "signed_out", "Please log in again.");
  const hash = toHex(await crypto.subtle.digest("SHA-256", te.encode(m[1])));
  const row = await env.DB.prepare("SELECT uid, expires FROM sessions WHERE hash = ?").bind(hash).first();
  if (!row || row.expires <= now) {
    if (row) await env.DB.prepare("DELETE FROM sessions WHERE hash = ?").bind(hash).run();
    throw new ApiError(401, "signed_out", "Please log in again.");
  }
  if (row.expires - now < ACCOUNT.refreshMs) await env.DB.prepare("UPDATE sessions SET expires = ? WHERE hash = ?").bind(now + ACCOUNT.sessionMs, hash).run();
  return { uid: row.uid, hash };
}

/** Checks a password proof, with a growing lockout after repeated misses. */
async function checkAuth(env, user, authB64, field, now) {
  if (user && user.locked > now) throw limited((user.locked - now) / 1000, "Too many wrong tries. Try again a little later.");
  // Unknown accounts take the same path, so the answer and the time it takes look the same.
  const given = await authHash(env, authB64);
  const ok = sameBytes(given, user ? user[field] : toHex(await hmac(env, "auth", te.encode("no such account"))));
  if (!user) throw new ApiError(401, "bad_login", "That username and password don't match.");
  if (ok) {
    if (user.fails) await env.DB.prepare("UPDATE users SET fails = 0, locked = 0 WHERE id = ?").bind(user.id).run();
    return;
  }
  const fails = user.fails + 1;
  const n = fails - ACCOUNT.lock.after;
  const locked = n >= 0 ? now + Math.min(ACCOUNT.lock.maxMs, ACCOUNT.lock.baseMs * 2 ** n) : 0;
  await env.DB.prepare("UPDATE users SET fails = ?, locked = ? WHERE id = ?").bind(fails, locked, user.id).run();
  throw new ApiError(401, "bad_login", "That username and password don't match.");
}

const getUser = (env, id) => env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();

async function accountRoute(name, request, env, ctx) {
  if (!accountsOn(env)) throw new ApiError(503, "accounts_not_configured", "Accounts aren't switched on yet.");
  await schema(env.DB);
  const now = Date.now();
  // Now and then, sweep out expired counters and sessions.
  if (Math.random() < 0.02) ctx.waitUntil(env.DB.batch([env.DB.prepare("DELETE FROM hits WHERE exp < ?").bind(Math.floor(now / 1000)), env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(now)]).catch(() => {}));

  if (!name) {
    // The vault.
    const { uid } = await session(env, request, now);
    if (request.method === "GET") {
      await limits(env, "vaultGet", request, { user: uid }, now);
      const row = await env.DB.prepare("SELECT rev, iv, ct FROM vaults WHERE uid = ?").bind(uid).first();
      return [200, row ? { rev: row.rev, iv: row.iv, ct: row.ct } : { rev: 0 }];
    }
    await limits(env, "vaultPut", request, { user: uid }, now);
    const { iv, ct, base } = await readJson(request, ACCOUNT.vaultMax + 200);
    b64Field(iv, 12, "iv");
    if (typeof ct !== "string" || ct.length < 24 || ct.length > ACCOUNT.vaultMax || !B64_.test(ct)) throw new ApiError(400, "bad_body", "Missing or odd ct.");
    if (!Number.isInteger(base) || base < 0) throw new ApiError(400, "bad_body", "Missing base revision.");
    // Only replace the revision this copy was built on; otherwise hand back the newer one.
    const res = base === 0
      ? await env.DB.prepare("INSERT INTO vaults (uid, rev, iv, ct, updated) VALUES (?, 1, ?, ?, ?) ON CONFLICT (uid) DO NOTHING").bind(uid, iv, ct, now).run()
      : await env.DB.prepare("UPDATE vaults SET rev = rev + 1, iv = ?, ct = ?, updated = ? WHERE uid = ? AND rev = ?").bind(iv, ct, now, uid, base).run();
    if (!res.meta?.changes) {
      const cur = await env.DB.prepare("SELECT rev, iv, ct FROM vaults WHERE uid = ?").bind(uid).first();
      return [409, { error: "conflict", message: "Changed elsewhere first.", rev: cur?.rev || 0, iv: cur?.iv, ct: cur?.ct }];
    }
    return [200, { rev: base + 1 }];
  }

  const body = await readJson(request);

  if (name === "prelogin") {
    const login = cleanLogin(body.login);
    await limits(env, "prelogin", request, { login }, now);
    const user = await getUser(env, await userId(env, login));
    // Unknown accounts get a made-up salt that never changes, so this can't be used to find
    // out who has an account.
    if (user) return [200, { salt: user.salt, kdf: user.kdf }];
    return [200, { salt: toB64((await hmac(env, "salt", login)).slice(0, 16)), kdf: ACCOUNT.kdfMin }];
  }

  if (name === "signup") {
    const login = cleanLogin(body.login);
    await limits(env, "signup", request, { login }, now);
    const row = {
      salt: b64Field(body.salt, 16, "salt"),
      kdf: kdfField(body.kdf),
      auth: await authHash(env, b64Field(body.auth, 32, "auth")),
      wrapped: wrappedField(body.wrapped, "wrapped"),
      rauth: await authHash(env, b64Field(body.rauth, 32, "rauth")),
      rwrapped: wrappedField(body.rwrapped, "rwrapped"),
    };
    const id = await userId(env, login);
    const res = await env.DB.prepare("INSERT INTO users (id, salt, kdf, auth, wrapped, rauth, rwrapped, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
      .bind(id, row.salt, row.kdf, row.auth, row.wrapped, row.rauth, row.rwrapped, now)
      .run();
    if (!res.meta?.changes) throw new ApiError(409, "taken", "That username is taken. Try another, or log in.");
    return [200, { token: await newSession(env, id, now) }];
  }

  if (name === "login") {
    const login = cleanLogin(body.login);
    await limits(env, "login", request, { login }, now);
    const user = await getUser(env, await userId(env, login));
    await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    return [200, { token: await newSession(env, user.id, now), wrapped: user.wrapped }];
  }

  if (name === "recover/begin") {
    const login = cleanLogin(body.login);
    await limits(env, "recoverBegin", request, { login }, now);
    const user = await getUser(env, await userId(env, login));
    if (user) return [200, { rwrapped: user.rwrapped }];
    // A made-up (and unopenable) one for unknown accounts, the same every time.
    const fake = await hmac(env, "rwrapped", login);
    const more = await hmac(env, "rwrapped2", login);
    return [200, { rwrapped: `${toB64(fake.slice(0, 12))}.${toB64(new Uint8Array([...fake, ...more]).slice(12, 60))}` }];
  }

  if (name === "recover") {
    const login = cleanLogin(body.login);
    await limits(env, "recover", request, { login }, now);
    const user = await getUser(env, await userId(env, login));
    await checkAuth(env, user, b64Field(body.rauth, 32, "rauth"), "rauth", now);
    const salt = b64Field(body.salt, 16, "salt");
    const kdf = kdfField(body.kdf);
    const auth = await authHash(env, b64Field(body.auth, 32, "auth"));
    const wrapped = wrappedField(body.wrapped, "wrapped");
    // A new password: every device is signed out, and this one gets a fresh session.
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET salt = ?, kdf = ?, auth = ?, wrapped = ?, fails = 0, locked = 0 WHERE id = ?").bind(salt, kdf, auth, wrapped, user.id),
      env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(user.id),
    ]);
    return [200, { token: await newSession(env, user.id, now) }];
  }

  // The rest need a session.
  const { uid, hash } = await session(env, request, now);

  if (name === "logout") {
    if (body.all === true) await env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(uid).run();
    else await env.DB.prepare("DELETE FROM sessions WHERE hash = ?").bind(hash).run();
    return [200, { ok: true }];
  }

  if (name === "password") {
    await limits(env, "password", request, { user: uid }, now);
    const user = await getUser(env, uid);
    await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    const salt = b64Field(body.salt, 16, "salt");
    const kdf = kdfField(body.kdf);
    const auth = await authHash(env, b64Field(body.newAuth, 32, "newAuth"));
    const wrapped = wrappedField(body.wrapped, "wrapped");
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET salt = ?, kdf = ?, auth = ?, wrapped = ? WHERE id = ?").bind(salt, kdf, auth, wrapped, uid),
      env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(uid),
    ]);
    return [200, { token: await newSession(env, uid, now) }];
  }

  if (name === "delete") {
    await limits(env, "delete", request, { user: uid }, now);
    const user = await getUser(env, uid);
    await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM vaults WHERE uid = ?").bind(uid),
      env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(uid),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid),
    ]);
    return [200, { ok: true }];
  }

  throw new ApiError(404, "not_found", "Unknown route.");
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** A query: printable text, 2 to 120 characters, whitespace squashed. */
export function cleanQuery(raw) {
  const q = String(raw || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (q.length < 2 || q.length > 120) throw new ApiError(400, "bad_query", "Search for 2 to 120 characters.");
  return q;
}

const cacheKey = (name) => new Request(`https://shelf-cache.internal/${encodeURIComponent(name)}`);

async function searchRoute(url, env, ctx) {
  const q = cleanQuery(url.searchParams.get("q"));
  const name = `search/${q.toLowerCase()}`;
  const cache = caches.default;
  const hit = await cache.match(cacheKey(name));
  if (hit) return hit.json();
  try {
    const data = await search(q, env);
    // Only cache real answers: an empty one may be a hiccup.
    if (data.results.length) {
      const put = (key, seconds) => cache.put(cacheKey(key), new Response(JSON.stringify(data), { headers: { "Cache-Control": `max-age=${seconds}` } }));
      ctx.waitUntil(Promise.all([put(name, TTL.search), put(`${name}/stale`, TTL.stale)]));
    }
    return data;
  } catch (err) {
    const stale = await cache.match(cacheKey(`${name}/stale`));
    if (stale) return stale.json();
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Covers by ISBN                                                      */
/* ------------------------------------------------------------------ */

export function cleanIsbn(raw) {
  const d = String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (!/^\d{13}$/.test(d) && !/^\d{9}[\dX]$/.test(d)) throw new ApiError(400, "bad_isbn", "That isn't an ISBN.");
  return d;
}

const googleCover = (id) => `https://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=1&fife=w720-h1080&source=gbs_api`;

/** The first Google volume for an ISBN that has a cover. Answers (found or not) are cached at the edge. */
async function coverRoute(url, env, ctx) {
  const isbn = cleanIsbn(url.searchParams.get("isbn"));
  const name = `cover/${isbn}`;
  const hit = await caches.default.match(cacheKey(name));
  if (hit) return hit.json();
  let img = null;
  if (env.GOOGLE_BOOKS_KEY) {
    const params = new URLSearchParams({ q: `isbn:${isbn}`, maxResults: "3", fields: "items(id,volumeInfo/imageLinks/thumbnail)", key: env.GOOGLE_BOOKS_KEY });
    const href = `${GOOGLE}?${params}`;
    if (new URL(href).hostname !== "www.googleapis.com") throw new Error("refusing to send the key elsewhere");
    try {
      const data = await getJson(href, { headers: { Accept: "application/json" } });
      const item = (Array.isArray(data?.items) ? data.items : []).find((it) => typeof it?.id === "string" && /^[\w-]{4,20}$/.test(it.id) && it.volumeInfo?.imageLinks?.thumbnail);
      img = item ? googleCover(item.id) : null;
    } catch (err) {
      log("warn", "cover lookup failed", String(err && err.message));
      throw new ApiError(502, "upstream_unavailable", "Covers are having a moment.");
    }
  }
  const body = { img };
  // Found: a month. Not found: a week (Google adds covers over time).
  ctx.waitUntil(caches.default.put(cacheKey(name), new Response(JSON.stringify(body), { headers: { "Cache-Control": `max-age=${img ? 2592000 : 604800}` } })));
  return body;
}

/** Google Books first, Open Library if Google can't answer. */
async function search(q, env) {
  if (env.GOOGLE_BOOKS_KEY) {
    try {
      const results = await google(q, env.GOOGLE_BOOKS_KEY);
      if (results.length) return { results, source: "google" };
    } catch (err) {
      log("warn", "google books failed, using open library", String(err && err.message));
    }
  }
  try {
    return { results: await openLibrary(q), source: "openlibrary" };
  } catch (err) {
    log("warn", "open library failed", String(err && err.message));
    throw new ApiError(502, "upstream_unavailable", "Book search is having a moment. Try again shortly.");
  }
}

async function getJson(href, init = {}) {
  const res = await fetch(href, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(href).hostname} answered ${res.status}`);
  return res.json();
}

async function google(q, key) {
  const params = new URLSearchParams({ q, maxResults: String(LIMIT), printType: "books", fields: GOOGLE_FIELDS, key });
  const href = `${GOOGLE}?${params}`;
  // The key only ever goes to Google.
  if (new URL(href).hostname !== "www.googleapis.com") throw new Error("refusing to send the key elsewhere");
  const data = await getJson(href, { headers: { Accept: "application/json" } });
  return (Array.isArray(data?.items) ? data.items : []).map(cleanGoogle).filter(Boolean);
}

async function openLibrary(q) {
  const data = await getJson(`${OPEN_LIBRARY}?${new URLSearchParams({ q, limit: String(LIMIT), fields: OL_FIELDS })}`, { headers: { Accept: "application/json" } });
  return (Array.isArray(data?.docs) ? data.docs : []).map(cleanOpenLibrary).filter(Boolean);
}

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** One Google volume, cut down to what the app shows. */
export function cleanGoogle(item) {
  const v = item?.volumeInfo;
  if (!v || typeof v.title !== "string" || typeof item.id !== "string" || !/^[\w-]{4,20}$/.test(item.id)) return null;
  const year = parseInt(str(v.publishedDate, 4), 10);
  return {
    key: `g:${item.id}`,
    title: str(v.title, 140),
    author: Array.isArray(v.authors) ? str(v.authors[0], 100) : "",
    pages: Number.isInteger(v.pageCount) && v.pageCount > 0 ? v.pageCount : null,
    year: Number.isInteger(year) && year > 0 ? year : null,
    // A sharper cover than the API's thumbnail, from the same place. Covers need no key.
    img: v.imageLinks?.thumbnail ? `https://books.google.com/books/content?id=${item.id}&printsec=frontcover&img=1&zoom=1&fife=w720-h1080&source=gbs_api` : null,
    cats: Array.isArray(v.categories) ? str(v.categories[0], 40) || null : null,
    blurb: str(v.description, 600).replace(/<[^>]*>/g, "").slice(0, 280) || null,
  };
}

/** One Open Library work, cut down to what the app shows. */
export function cleanOpenLibrary(d) {
  if (!d || typeof d.title !== "string") return null;
  return {
    key: typeof d.key === "string" ? d.key.replace("/works/", "ol:").slice(0, 40) : null,
    title: d.title.slice(0, 140),
    author: Array.isArray(d.author_name) ? String(d.author_name[0] || "").slice(0, 100) : "",
    cover: Number.isInteger(d.cover_i) && d.cover_i > 0 ? d.cover_i : null,
    pages: Number.isInteger(d.number_of_pages_median) && d.number_of_pages_median > 0 ? d.number_of_pages_median : null,
    year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null,
    cats: Array.isArray(d.subject) ? str(d.subject[0], 40) || null : null,
  };
}

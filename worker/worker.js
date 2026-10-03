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
 *   GET /api/cover?t=Dune&a=Frank%20Herbert   the same, found by title and author
 *   GET /api/sync/<id>     a synced copy of someone's shelves (end-to-end encrypted)
 *   PUT /api/sync/<id>     store a new copy; { iv, ct, base } where base is the revision it
 *                          was built on (a mismatch answers 409 with the current copy)
 *
 * Accounts (end-to-end encrypted; see "Accounts" below for the whole design):
 *   (login = your username or your email; either works)
 *   POST /api/auth/prelogin         { login }                      → { salt, kdf }
 *   POST /api/auth/signup           { username, email?, salt, kdf, auth, wrapped, rauth, rwrapped } → { token }
 *   POST /api/auth/login            { login, auth }                → { token, wrapped, username }
 *   POST /api/auth/me               { login? }          (Bearer)   → { username, email, passkeys, salt, kdf }
 *   POST /api/auth/username         { username }        (Bearer)   → { ok }   (no password needed)
 *   POST /api/auth/email            { auth, email }     (Bearer)   → { ok }   ("" removes it)
 *   POST /api/auth/logout           { all? }            (Bearer)   → { ok }
 *   POST /api/auth/password         { auth, salt, kdf, newAuth, wrapped } (Bearer) → { token }
 *   POST /api/auth/recover/begin    { login }                      → { rwrapped }
 *   POST /api/auth/recover          { login, rauth, salt, kdf, auth, wrapped } → { token }
 *   POST /api/auth/recovery         { auth, rauth, rwrapped } (Bearer) → { ok }   (a new recovery code)
 *   POST /api/auth/passkey/challenge { for: "create" | "get" } (Bearer for create) → { challenge, rpId, user }
 *   POST /api/auth/passkey/register  { auth, challenge, id, clientDataJSON, attestationObject, pwrapped } (Bearer) → { ok }
 *   POST /api/auth/passkey/login     { challenge, id, clientDataJSON, authenticatorData, signature } → { token, pwrapped, wrapped, username }
 *   POST /api/auth/passkey/remove    {}                 (Bearer)   → { ok }
 *   POST /api/auth/delete           { auth }            (Bearer)   → { ok }
 *   GET  /api/vault                                     (Bearer)   → { rev, iv, ct } or { rev: 0 }
 *   PUT  /api/vault                 { iv, ct, base, op } (Bearer)  → { rev } or 409 with the current copy
 *
 * Costs (D1 bills rows read and rows written): a backup read is 2 rows read; a backup save is
 * 2 rows read + 1 row written. Saves are only made when something changed, a few seconds after
 * a burst of changes, so an active reader writes a handful of rows a day. Rate limits for saves
 * live in memory (no database writes); only sign-in routes keep durable counters.
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
      const authRoute = /^\/api\/auth\/(prelogin|signup|login|logout|password|recovery|me|username|email|recover\/begin|recover|delete|passkey\/(?:challenge|register|login|remove))$/.exec(path)?.[1];
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
//   users     id: the account's own id. (Older accounts: HMAC(AUTH_SECRET, the login they
//             signed up with).) uname: the username, which is public anyway (it's shown as
//             @username). The email is never stored, only its HMAC in names.
//   names     h = HMAC(AUTH_SECRET, a username or email) → the account it logs in to, and which
//             kind it is. So username, email and password are three separate things: change one
//             and the others stay.
//   passkeys  Face ID / Touch ID: the passkey's public key (it can only check signatures), and
//             the data key wrapped with a secret only that passkey can produce (WebAuthn PRF).
//             A stolen database can't log in with these, and can't open the wrapped key.
//   challenges one-time WebAuthn challenges, five minutes each.
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
  recovery: [["user", 10, 3600]],
  me: [["user", 120, 3600]],
  username: [["user", 10, 3600]],
  email: [["user", 5, 3600]],
  pkChallenge: [["ip", 30, 600]],
  pkRegister: [["user", 10, 3600]],
  pkLogin: [["ip", 20, 600]],
  pkRemove: [["user", 10, 3600]],
  delete: [["user", 5, 3600]],
};

const accountsOn = (env) => !!(env.DB && typeof env.DB.prepare === "function" && typeof env.AUTH_SECRET === "string" && env.AUTH_SECRET.length >= 32);

const te = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => toB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

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

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,189}\.[^\s@<>".]{2,}$/;
const norm = (raw) => String(raw ?? "").normalize("NFKC").trim().toLowerCase();

/** A username (3 to 32 of a-z 0-9 . _ -) or an email address, normalised. */
export function cleanLogin(raw) {
  const v = norm(raw);
  if (USERNAME.test(v)) return v;
  if (v.length <= 254 && EMAIL.test(v)) return v;
  throw new ApiError(400, "bad_login", "Use your username or your email address.");
}
export function cleanUsername(raw) {
  const v = norm(raw).replace(/^@/, "");
  if (USERNAME.test(v)) return v;
  throw new ApiError(400, "bad_username", "A username is 3 to 32 letters, numbers, dots, dashes or underscores.");
}
export function cleanEmail(raw) {
  const v = norm(raw);
  if (v.length <= 254 && EMAIL.test(v)) return v;
  throw new ApiError(400, "bad_email", "That doesn't look like an email address.");
}
const kindOf = (login) => (login.includes("@") ? "email" : "user");

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

const schemaReady = new WeakMap(); // per database binding, checked once per isolate

/**
 * Makes sure the tables exist. The usual case is one cheap query that reads no rows; the
 * tables (and any column added since) are only created when that query fails.
 */
function schema(db) {
  if (schemaReady.has(db)) return schemaReady.get(db);
  const ready = db
    .prepare("SELECT v.op, u.uname, n.h, p.cid, c.c FROM vaults v, users u, names n, passkeys p, challenges c LIMIT 0")
    .all()
    .catch(async () => {
      await db.batch([
        db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, salt TEXT NOT NULL, kdf INTEGER NOT NULL, auth TEXT NOT NULL, wrapped TEXT NOT NULL, rauth TEXT NOT NULL, rwrapped TEXT NOT NULL, created INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0)"),
        db.prepare("CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)"),
        db.prepare("CREATE INDEX IF NOT EXISTS sessions_uid ON sessions (uid)"),
        db.prepare("CREATE TABLE IF NOT EXISTS vaults (uid TEXT PRIMARY KEY, rev INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, updated INTEGER NOT NULL, op TEXT)"),
        db.prepare("CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL, exp INTEGER NOT NULL)"),
        db.prepare("CREATE TABLE IF NOT EXISTS names (h TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL)"),
        db.prepare("CREATE INDEX IF NOT EXISTS names_uid ON names (uid)"),
        db.prepare("CREATE TABLE IF NOT EXISTS passkeys (cid TEXT PRIMARY KEY, uid TEXT NOT NULL, alg INTEGER NOT NULL, pub TEXT NOT NULL, pwrapped TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)"),
        db.prepare("CREATE INDEX IF NOT EXISTS passkeys_uid ON passkeys (uid)"),
        db.prepare("CREATE TABLE IF NOT EXISTS challenges (c TEXT PRIMARY KEY, uid TEXT, kind TEXT NOT NULL, exp INTEGER NOT NULL)"),
      ]);
      // Databases made before these columns existed get them now.
      await db.prepare("ALTER TABLE vaults ADD COLUMN op TEXT").run().catch(() => {});
      await db.prepare("ALTER TABLE users ADD COLUMN uname TEXT").run().catch(() => {});
    })
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
const hasNames = async (env, uid) => !!(await env.DB.prepare("SELECT 1 AS x FROM names WHERE uid = ? LIMIT 1").bind(uid).first());

/**
 * The account a username or email logs in to, or null. Accounts made before usernames and
 * emails were separate have their login as their id, until they're upgraded (see adopt).
 */
async function resolve(env, login) {
  const h = await userId(env, login);
  const row = await env.DB.prepare("SELECT uid FROM names WHERE h = ?").bind(h).first();
  if (row) return getUser(env, row.uid);
  const user = await getUser(env, h);
  if (!user || (await hasNames(env, user.id))) return null; // (that old login was changed away)
  return user;
}

/** Is this username or email someone else's? */
async function taken(env, h, uid) {
  const row = await env.DB.prepare("SELECT uid FROM names WHERE h = ?").bind(h).first();
  if (row) return row.uid !== uid;
  const old = await getUser(env, h);
  return !!old && old.id !== uid && !(await hasNames(env, old.id));
}

/**
 * Upgrades an older account: its login becomes a username or an email row. `login` is the login
 * it was made with, if known (it must hash to the account's id); otherwise the old login is kept
 * working as it is.
 */
async function adopt(env, user, login) {
  if (await hasNames(env, user.id)) return;
  const known = login && (await userId(env, login)) === user.id;
  const kind = known ? kindOf(login) : "legacy";
  const steps = [env.DB.prepare("INSERT INTO names (h, uid, kind) VALUES (?, ?, ?) ON CONFLICT (h) DO NOTHING").bind(user.id, user.id, kind)];
  if (kind === "user") steps.push(env.DB.prepare("UPDATE users SET uname = ? WHERE id = ?").bind(login, user.id));
  await env.DB.batch(steps);
  if (kind === "user") user.uname = login;
}

/* ---------------- passkeys (Face ID / Touch ID) ---------------- */
// Standard WebAuthn, checked with WebCrypto: no libraries. A passkey is a key pair made inside
// the phone's secure hardware; the private half never leaves it (and syncs only through the
// user's own iCloud Keychain or password manager). Face ID unlocks it on the phone; this Worker
// only ever sees the public key and signatures. Apple never shares anything about your face.

const td = new TextDecoder();

/** The site's own name for passkeys: its host (the page asks for the same one). */
function rpIdOf(request) {
  try {
    return new URL(request.headers.get("Origin") || "").hostname;
  } catch {
    throw new ApiError(400, "bad_origin", "Unknown site.");
  }
}

async function newChallenge(env, request, uid, kind, now) {
  const c = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO challenges (c, uid, kind, exp) VALUES (?, ?, ?, ?)").bind(c, uid, kind, now + 300_000).run();
  return { challenge: c, rpId: rpIdOf(request) };
}

/** A challenge is good once: it's deleted as it's used. */
async function useChallenge(env, c, kind, uid, now) {
  if (typeof c !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(c)) throw new ApiError(400, "bad_body", "Missing challenge.");
  const row = await env.DB.prepare("DELETE FROM challenges WHERE c = ? RETURNING uid, kind, exp").bind(c).first();
  if (!row || row.kind !== kind || row.exp < now || (uid && row.uid !== uid)) throw new ApiError(401, "bad_challenge", "That took a little too long. Try again.");
}

function idField(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{16,1400}$/.test(v)) throw new ApiError(400, "bad_body", "Odd passkey id.");
  return v;
}
function b64urlField(v, name, max) {
  if (typeof v !== "string" || v.length > max || !/^[A-Za-z0-9_-]+$/.test(v)) throw new ApiError(400, "bad_body", `Missing or odd ${name}.`);
  return fromB64url(v);
}

/** A small CBOR reader (RFC 8949): enough for WebAuthn's attestation objects and COSE keys. */
export function cbor(bytes, start = 0) {
  let i = start;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => {
    throw new ApiError(400, "bad_passkey", "That passkey answer couldn't be read.");
  };
  const need = (n) => (i + n > bytes.length ? bad() : 0);
  const len = (info) => {
    if (info < 24) return info;
    if (info === 24) return need(1), bytes[i++];
    if (info === 25) return need(2), (i += 2), dv.getUint16(i - 2);
    if (info === 26) return need(4), (i += 4), dv.getUint32(i - 4);
    return bad();
  };
  const item = (depth) => {
    if (depth > 8) bad();
    need(1);
    const b = bytes[i++];
    const info = b & 31;
    switch (b >> 5) {
      case 0:
        return len(info);
      case 1:
        return -1 - len(info);
      case 2: {
        const n = len(info);
        need(n);
        return bytes.slice(i, (i += n));
      }
      case 3: {
        const n = len(info);
        need(n);
        return td.decode(bytes.slice(i, (i += n)));
      }
      case 4: {
        const n = len(info);
        if (n > 64) bad();
        return Array.from({ length: n }, () => item(depth + 1));
      }
      case 5: {
        const n = len(info);
        if (n > 64) bad();
        const m = new Map();
        for (let k = 0; k < n; k++) m.set(item(depth + 1), item(depth + 1));
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        return bad();
      default:
        return bad();
    }
  };
  const value = item(0);
  return { value, end: i };
}

/** A COSE public key → { alg, jwk }. ES256 (Apple, Google, most) and RS256 (Windows Hello). */
function coseToJwk(m) {
  const b = (v) => (v instanceof Uint8Array ? b64url(v) : null);
  const alg = m.get(3);
  if (m.get(1) === 2 && alg === -7 && m.get(-1) === 1 && b(m.get(-2)) && b(m.get(-3))) return { alg, jwk: { kty: "EC", crv: "P-256", x: b(m.get(-2)), y: b(m.get(-3)) } };
  if (m.get(1) === 3 && alg === -257 && b(m.get(-1)) && b(m.get(-2))) return { alg, jwk: { kty: "RSA", n: b(m.get(-1)), e: b(m.get(-2)), alg: "RS256" } };
  throw new ApiError(400, "bad_passkey", "This kind of passkey isn't supported. Try your phone's built-in Face ID or fingerprint.");
}
const importPub = (alg, jwk) =>
  crypto.subtle.importKey("jwk", jwk, alg === -7 ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);

/** An ECDSA signature as WebAuthn sends it (DER) → the raw r‖s WebCrypto wants. */
export function derToRaw(der) {
  const bad = () => {
    throw new ApiError(401, "bad_passkey", "That passkey signature isn't valid.");
  };
  if (der[0] !== 0x30) bad();
  let i = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const int = () => {
    if (der[i] !== 0x02) bad();
    const n = der[i + 1];
    let v = der.slice(i + 2, i + 2 + n);
    i += 2 + n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) bad();
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = int();
  const s = int();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/** The checks both ceremonies share: what the browser signed, for this site, with Face ID. */
async function checkClient(request, body, type, cdBytes, authData) {
  let cd;
  try {
    cd = JSON.parse(td.decode(cdBytes));
  } catch {
    throw new ApiError(400, "bad_passkey", "That passkey answer couldn't be read.");
  }
  if (cd.type !== type || cd.challenge !== body.challenge || cd.origin !== request.headers.get("Origin") || cd.crossOrigin === true) throw new ApiError(401, "bad_passkey", "That passkey answer wasn't for this site.");
  if (authData.length < 37) throw new ApiError(400, "bad_passkey", "That passkey answer couldn't be read.");
  const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(rpIdOf(request))));
  if (!sameBytes(authData.slice(0, 32), rpHash)) throw new ApiError(401, "bad_passkey", "That passkey belongs to another site.");
  const flags = authData[32];
  // UP: someone was there. UV: and unlocked it (Face ID, Touch ID or the phone's passcode).
  if ((flags & 0x05) !== 0x05) throw new ApiError(401, "bad_passkey", "Face ID (or your passcode) has to confirm it's you.");
  return flags;
}

async function verifyAttestation(request, body) {
  const cdBytes = b64urlField(body.clientDataJSON, "clientDataJSON", 2000);
  const att = cbor(b64urlField(body.attestationObject, "attestationObject", 8000)).value;
  const authData = att instanceof Map ? att.get("authData") : null;
  if (!(authData instanceof Uint8Array)) throw new ApiError(400, "bad_passkey", "That passkey answer couldn't be read.");
  const flags = await checkClient(request, body, "webauthn.create", cdBytes, authData);
  if (!(flags & 0x40) || authData.length < 55) throw new ApiError(400, "bad_passkey", "That passkey answer has no key in it.");
  const idLen = (authData[53] << 8) | authData[54];
  if (idLen < 16 || idLen > 1023 || 55 + idLen > authData.length) throw new ApiError(400, "bad_passkey", "That passkey answer couldn't be read.");
  const credId = authData.slice(55, 55 + idLen);
  if (b64url(credId) !== idField(body.id)) throw new ApiError(400, "bad_passkey", "That passkey answer doesn't add up.");
  const key = cbor(authData, 55 + idLen).value;
  if (!(key instanceof Map)) throw new ApiError(400, "bad_passkey", "That passkey answer has no key in it.");
  const { alg, jwk } = coseToJwk(key);
  await importPub(alg, jwk).catch(() => {
    throw new ApiError(400, "bad_passkey", "That passkey's key isn't valid.");
  });
  return { cid: b64url(credId), alg, pub: JSON.stringify(jwk) };
}

async function verifyAssertion(request, body, pk) {
  const cdBytes = b64urlField(body.clientDataJSON, "clientDataJSON", 2000);
  const authData = b64urlField(body.authenticatorData, "authenticatorData", 2000);
  const sig = b64urlField(body.signature, "signature", 1000);
  await checkClient(request, body, "webauthn.get", cdBytes, authData);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", cdBytes));
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(hash, authData.length);
  const key = await importPub(pk.alg, JSON.parse(pk.pub));
  const ok =
    pk.alg === -7
      ? await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed)
      : await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed);
  if (!ok) throw new ApiError(401, "bad_passkey", "That passkey signature isn't valid.");
}

async function accountRoute(name, request, env, ctx) {
  if (!accountsOn(env)) throw new ApiError(503, "accounts_not_configured", "Accounts aren't switched on yet.");
  await schema(env.DB);
  const now = Date.now();
  // Now and then (on sign-in routes, never on backups), sweep out expired counters and sessions.
  if (name && Math.random() < 0.02) ctx.waitUntil(env.DB.batch([env.DB.prepare("DELETE FROM hits WHERE exp < ?").bind(Math.floor(now / 1000)), env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(now), env.DB.prepare("DELETE FROM challenges WHERE exp < ?").bind(now)]).catch(() => {}));

  if (!name) {
    // The vault.
    const { uid } = await session(env, request, now);
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT rev, iv, ct FROM vaults WHERE uid = ?").bind(uid).first();
      return [200, row ? { rev: row.rev, iv: row.iv, ct: row.ct } : { rev: 0 }];
    }
    const { iv, ct, base, op = null } = await readJson(request, ACCOUNT.vaultMax + 200);
    b64Field(iv, 12, "iv");
    if (typeof ct !== "string" || ct.length < 24 || ct.length > ACCOUNT.vaultMax || !B64_.test(ct)) throw new ApiError(400, "bad_body", "Missing or odd ct.");
    if (!Number.isInteger(base) || base < 0) throw new ApiError(400, "bad_body", "Missing base revision.");
    if (op !== null && (typeof op !== "string" || !/^[A-Za-z0-9_-]{8,40}$/.test(op))) throw new ApiError(400, "bad_body", "Odd op.");
    // Only replace the revision this copy was built on; otherwise hand back the newer one.
    const res = base === 0
      ? await env.DB.prepare("INSERT INTO vaults (uid, rev, iv, ct, updated, op) VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT (uid) DO NOTHING").bind(uid, iv, ct, now, op).run()
      : await env.DB.prepare("UPDATE vaults SET rev = rev + 1, iv = ?, ct = ?, updated = ?, op = ? WHERE uid = ? AND rev = ?").bind(iv, ct, now, op, uid, base).run();
    if (res.meta?.changes) return [200, { rev: base + 1 }];
    const cur = await env.DB.prepare("SELECT rev, iv, ct, op FROM vaults WHERE uid = ?").bind(uid).first();
    // The same save sent twice (the answer to the first got lost): it already happened.
    if (op && cur?.op === op) return [200, { rev: cur.rev }];
    return [409, { error: "conflict", message: "Changed elsewhere first.", rev: cur?.rev || 0, iv: cur?.iv, ct: cur?.ct }];
  }

  const body = await readJson(request, name.startsWith("passkey") ? 16384 : 4096);

  if (name === "prelogin") {
    const login = cleanLogin(body.login);
    await limits(env, "prelogin", request, { login }, now);
    const user = await resolve(env, login);
    // Unknown accounts get a made-up salt that never changes, so this can't be used to find
    // out who has an account.
    if (user) return [200, { salt: user.salt, kdf: user.kdf }];
    return [200, { salt: toB64((await hmac(env, "salt", login)).slice(0, 16)), kdf: ACCOUNT.kdfMin }];
  }

  if (name === "signup") {
    // A username, and optionally an email. (Older pages send one "login": a username or email.)
    let username = body.username != null ? cleanUsername(body.username) : null;
    let email = body.email ? cleanEmail(body.email) : null;
    if (body.username == null) {
      const login = cleanLogin(body.login);
      if (kindOf(login) === "user") username = login;
      else email = login;
    }
    if (!username && !email) throw new ApiError(400, "bad_username", "Pick a username.");
    await limits(env, "signup", request, { login: username || email }, now);
    const row = {
      salt: b64Field(body.salt, 16, "salt"),
      kdf: kdfField(body.kdf),
      auth: await authHash(env, b64Field(body.auth, 32, "auth")),
      wrapped: wrappedField(body.wrapped, "wrapped"),
      rauth: await authHash(env, b64Field(body.rauth, 32, "rauth")),
      rwrapped: wrappedField(body.rwrapped, "rwrapped"),
    };
    const uh = username && (await userId(env, username));
    const eh = email && (await userId(env, email));
    if (uh && (await taken(env, uh, null))) throw new ApiError(409, "taken", "That username is taken. Try another, or log in.");
    if (eh && (await taken(env, eh, null))) throw new ApiError(409, "email_taken", "That email already has an account. Log in instead.");
    const id = toHex(crypto.getRandomValues(new Uint8Array(32)));
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users (id, salt, kdf, auth, wrapped, rauth, rwrapped, created, uname) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, row.salt, row.kdf, row.auth, row.wrapped, row.rauth, row.rwrapped, now, username),
        ...(uh ? [env.DB.prepare("INSERT INTO names (h, uid, kind) VALUES (?, ?, 'user')").bind(uh, id)] : []),
        ...(eh ? [env.DB.prepare("INSERT INTO names (h, uid, kind) VALUES (?, ?, 'email')").bind(eh, id)] : []),
      ]);
    } catch {
      throw new ApiError(409, "taken", "That username is taken. Try another, or log in."); // (taken a moment ago)
    }
    return [200, { token: await newSession(env, id, now) }];
  }

  if (name === "login") {
    const login = cleanLogin(body.login);
    await limits(env, "login", request, { login }, now);
    const user = await resolve(env, login);
    await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    await adopt(env, user, login);
    return [200, { token: await newSession(env, user.id, now), wrapped: user.wrapped, username: user.uname || null }];
  }

  if (name === "recover/begin") {
    const login = cleanLogin(body.login);
    await limits(env, "recoverBegin", request, { login }, now);
    const user = await resolve(env, login);
    if (user) return [200, { rwrapped: user.rwrapped }];
    // A made-up (and unopenable) one for unknown accounts, the same every time.
    const fake = await hmac(env, "rwrapped", login);
    const more = await hmac(env, "rwrapped2", login);
    return [200, { rwrapped: `${toB64(fake.slice(0, 12))}.${toB64(new Uint8Array([...fake, ...more]).slice(12, 60))}` }];
  }

  if (name === "recover") {
    const login = cleanLogin(body.login);
    await limits(env, "recover", request, { login }, now);
    const user = await resolve(env, login);
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
    await adopt(env, user, login);
    return [200, { token: await newSession(env, user.id, now), username: user.uname || null }];
  }

  if (name === "passkey/challenge" && body.for !== "create") {
    // Logging in with Face ID: anyone may ask; the challenge is good once, for five minutes.
    await limits(env, "pkChallenge", request, {}, now);
    return [200, await newChallenge(env, request, null, "get", now)];
  }

  if (name === "passkey/login") {
    await limits(env, "pkLogin", request, {}, now);
    await useChallenge(env, body.challenge, "get", null, now);
    const cid = idField(body.id);
    const pk = await env.DB.prepare("SELECT * FROM passkeys WHERE cid = ?").bind(cid).first();
    if (!pk) throw new ApiError(401, "bad_passkey", "That passkey isn't linked to an account any more. Log in with your password.");
    const user = await getUser(env, pk.uid);
    if (!user) throw new ApiError(401, "bad_passkey", "That passkey isn't linked to an account any more. Log in with your password.");
    await verifyAssertion(request, body, pk);
    await env.DB.prepare("UPDATE passkeys SET used = ? WHERE cid = ?").bind(now, cid).run();
    // (wrapped too: changing the password later re-wraps the same key. Only after Face ID, and it
    // opens nothing without the password.)
    return [200, { token: await newSession(env, user.id, now), pwrapped: pk.pwrapped, wrapped: user.wrapped, username: user.uname || null }];
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

  if (name === "recovery") {
    // A new recovery code (the old one stops working). Needs the password, like any change to how
    // the account is unlocked.
    await limits(env, "recovery", request, { user: uid }, now);
    const user = await getUser(env, uid);
    await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    const rauth = await authHash(env, b64Field(body.rauth, 32, "rauth"));
    const rwrapped = wrappedField(body.rwrapped, "rwrapped");
    await env.DB.prepare("UPDATE users SET rauth = ?, rwrapped = ? WHERE id = ?").bind(rauth, rwrapped, uid).run();
    return [200, { ok: true }];
  }

  if (name === "me") {
    // Who this session is. An older account's device sends the login it signed up with, so the
    // account can be upgraded to a separate username and email.
    await limits(env, "me", request, { user: uid }, now);
    const user = await getUser(env, uid);
    if (!user) throw new ApiError(401, "signed_out", "Please log in again.");
    let login = null;
    try {
      login = body.login ? cleanLogin(body.login) : null;
    } catch {}
    await adopt(env, user, login);
    const email = !!(await env.DB.prepare("SELECT 1 AS x FROM names WHERE uid = ? AND kind = 'email'").bind(uid).first());
    const pk = await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE uid = ?").bind(uid).first();
    return [200, { username: user.uname || null, email, passkeys: pk?.n || 0, salt: user.salt, kdf: user.kdf }];
  }

  if (name === "username" || name === "email") {
    // A new username needs no password (it's only what you're called). A new email does, since
    // it's how you log in.
    await limits(env, name, request, { user: uid }, now);
    const user = await getUser(env, uid);
    if (name === "email") await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    await adopt(env, user, null);
    const kind = name === "username" ? "user" : "email";
    const value = name === "username" ? cleanUsername(body.username) : body.email === "" ? "" : cleanEmail(body.email);
    if (value === "") {
      if (!user.uname) throw new ApiError(400, "need_username", "Pick a username first, so you can still log in.");
      await env.DB.prepare("DELETE FROM names WHERE uid = ? AND kind = 'email'").bind(uid).run();
      return [200, { ok: true }];
    }
    const h = await userId(env, value);
    if (await taken(env, h, uid)) throw new ApiError(409, "taken", kind === "user" ? "That username is taken. Try another." : "That email already has an account.");
    const steps = [
      // The old one stops working; the other kind (and an old login of unknown kind) stays.
      env.DB.prepare("DELETE FROM names WHERE uid = ? AND kind = ?").bind(uid, kind),
      env.DB.prepare("INSERT INTO names (h, uid, kind) VALUES (?, ?, ?) ON CONFLICT (h) DO UPDATE SET kind = excluded.kind WHERE names.uid = excluded.uid").bind(h, uid, kind),
    ];
    if (kind === "user") steps.push(env.DB.prepare("UPDATE users SET uname = ? WHERE id = ?").bind(value, uid));
    try {
      await env.DB.batch(steps);
    } catch {
      throw new ApiError(409, "taken", "That's taken. Try another.");
    }
    return [200, { ok: true }];
  }

  if (name === "passkey/challenge") {
    await limits(env, "pkChallenge", request, {}, now);
    const user = await getUser(env, uid);
    return [200, { ...(await newChallenge(env, request, uid, "create", now)), user: { id: b64url(fromHex(uid).slice(0, 32)), name: user?.uname || "Shelfie reader" } }];
  }

  if (name === "passkey/register") {
    // Turning on Face ID needs the password, so a stolen session can't add its own passkey.
    await limits(env, "pkRegister", request, { user: uid }, now);
    const user = await getUser(env, uid);
    await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    await useChallenge(env, body.challenge, "create", uid, now);
    const pwrapped = wrappedField(body.pwrapped, "pwrapped");
    const { cid, alg, pub } = await verifyAttestation(request, body);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE uid = ?").bind(uid).first();
    if ((n?.n || 0) >= 10) throw new ApiError(400, "too_many", "That's ten passkeys already. Turn Face ID off and on again to start fresh.");
    await env.DB.prepare("INSERT INTO passkeys (cid, uid, alg, pub, pwrapped, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (cid) DO UPDATE SET pwrapped = excluded.pwrapped WHERE passkeys.uid = excluded.uid")
      .bind(cid, uid, alg, pub, pwrapped, now)
      .run();
    return [200, { ok: true }];
  }

  if (name === "passkey/remove") {
    await limits(env, "pkRemove", request, { user: uid }, now);
    await env.DB.prepare("DELETE FROM passkeys WHERE uid = ?").bind(uid).run();
    return [200, { ok: true }];
  }

  if (name === "delete") {
    await limits(env, "delete", request, { user: uid }, now);
    const user = await getUser(env, uid);
    await checkAuth(env, user, b64Field(body.auth, 32, "auth"), "auth", now);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM vaults WHERE uid = ?").bind(uid),
      env.DB.prepare("DELETE FROM sessions WHERE uid = ?").bind(uid),
      env.DB.prepare("DELETE FROM names WHERE uid = ?").bind(uid),
      env.DB.prepare("DELETE FROM passkeys WHERE uid = ?").bind(uid),
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

/** Title and author for a cover lookup: plain words, short. */
const coverWords = (v, n) => String(v || "").normalize("NFKC").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, n);
const looseTitle = (v) => coverWords(v, 80).toLowerCase().replace(/^(the|a|an) /, "");

/**
 * The first Google volume (by ISBN, or by title and author) that has a cover. Answers, found or
 * not, are cached at the edge, so each book is looked up once for everyone.
 */
async function coverRoute(url, env, ctx) {
  let q;
  let name;
  let want = null;
  if (url.searchParams.has("isbn")) {
    const isbn = cleanIsbn(url.searchParams.get("isbn"));
    q = `isbn:${isbn}`;
    name = `cover/${isbn}`;
  } else {
    const t = coverWords(url.searchParams.get("t"), 80);
    const a = coverWords(url.searchParams.get("a"), 60);
    if (t.length < 2) throw new ApiError(400, "bad_query", "Give an ISBN, or a title (and author).");
    q = `intitle:${t}${a ? ` inauthor:${a}` : ""}`;
    name = `cover/t/${t.toLowerCase()}|${a.toLowerCase()}`;
    want = looseTitle(t);
  }
  const hit = await caches.default.match(cacheKey(name));
  if (hit) return hit.json();
  let img = null;
  if (env.GOOGLE_BOOKS_KEY) {
    const params = new URLSearchParams({ q, maxResults: "5", printType: "books", fields: "items(id,volumeInfo(title,imageLinks/thumbnail))", key: env.GOOGLE_BOOKS_KEY });
    const href = `${GOOGLE}?${params}`;
    if (new URL(href).hostname !== "www.googleapis.com") throw new Error("refusing to send the key elsewhere");
    try {
      const data = await getJson(href, { headers: { Accept: "application/json" } });
      const item = (Array.isArray(data?.items) ? data.items : []).find(
        (it) =>
          typeof it?.id === "string" &&
          /^[\w-]{4,20}$/.test(it.id) &&
          it.volumeInfo?.imageLinks?.thumbnail &&
          // By title: only the same title (a subtitle after ":" or "(" is fine), no lookalikes.
          (!want || looseTitle(String(it.volumeInfo.title || "").split(/[:(]/)[0]) === want),
      );
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

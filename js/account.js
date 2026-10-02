// Accounts: log in with a username (or email) and a password, and your shelves follow you to
// any device, end-to-end encrypted. Shelfie's server can't read them, and never sees your
// password.
//
//   master  = PBKDF2-SHA256(password, salt, 600,000 rounds)        (here, in the browser)
//   authKey = HKDF(master, "shelfie auth")  → sent to the server as proof of the password
//   encKey  = HKDF(master, "shelfie enc")   → never leaves this device
//   dataKey = random AES-256 key for the shelves, kept on the server only wrapped by encKey
//             (and by a key from your one-time recovery code)
//
// On this device the data key is kept as a non-extractable CryptoKey in IndexedDB: page code
// can use it, but even page code can't read its bytes out. The shelves are compressed, then
// sealed with AES-256-GCM, so a whole library is a few dozen KB.
//
// Your phone stays the main copy (so the app is instant and works offline); the account is the
// encrypted backup and the bridge between devices.

import { makeCode, cleanCode, prettyCode } from "./sync.js";

export const KDF_ROUNDS = 600_000;
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Same rules as the server: a username or an email, lower-cased. Null if neither. */
export function cleanLogin(raw) {
  const v = String(raw ?? "").normalize("NFKC").trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9._-]{2,31}$/.test(v)) return v;
  if (v.length <= 254 && /^[^\s@<>"]{1,64}@[^\s@<>"]{1,189}\.[^\s@<>".]{2,}$/.test(v)) return v;
  return null;
}

const COMMON = new Set(["password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "iloveyou12", "qwerty1234", "1q2w3e4r5t", "letmein123", "welcome123", "abcdefghij", "booksbooks", "shelfie123", "readingisfun", "harrypotter", "0987654321", "1111111111", "aaaaaaaaaa"]);

/** Why a password won't do, or null if it's fine. */
export function passwordProblem(pw, login = "") {
  if (typeof pw !== "string" || pw.length < 10) return "Use at least 10 characters. A few random words work well.";
  if (pw.length > 128) return "That's a bit long. 128 characters at most.";
  if (new Set(pw).size < 4) return "Too repetitive. Mix it up a little.";
  if (COMMON.has(pw.toLowerCase())) return "That one's on every hacker's list. Pick something less common.";
  const name = login.split("@")[0];
  if (name.length >= 3 && pw.toLowerCase().includes(name)) return "Don't put your username in your password.";
  return null;
}

/** 0 to 4, for the strength bar. A rough guide, not a guarantee. */
export function strength(pw) {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const bits = Math.log2(Math.max(pool, 2)) * new Set(pw).size * 0.6 + Math.log2(Math.max(pw.length, 1)) * 4;
  return bits < 30 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
}

async function hkdfPair(keyMaterial, salt) {
  const base = await crypto.subtle.importKey("raw", keyMaterial, "HKDF", false, ["deriveBits", "deriveKey"]);
  const auth = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: te.encode("shelfie auth") }, base, 256);
  const encKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: te.encode("shelfie enc") }, base, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  return { auth: b64(auth), encKey };
}

/** The password, stretched: the proof for the server and the key that stays here. */
export async function fromPassword(password, saltB64, rounds = KDF_ROUNDS) {
  const pw = await crypto.subtle.importKey("raw", te.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: rounds }, pw, 256);
  return hkdfPair(master, te.encode("shelfie v1"));
}

/** The recovery code works the same way (it's random enough not to need stretching). */
export const fromRecovery = (code) => hkdfPair(te.encode(`shelfie-recovery:${code}`), te.encode("shelfie recovery v1"));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

async function wrap(dataKey, encKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.wrapKey("raw", dataKey, encKey, { name: "AES-GCM", iv });
  return `${b64(iv)}.${b64(ct)}`;
}

/** The data key from its wrapped form. `extractable` only while re-wrapping it. */
export async function unwrap(wrapped, encKey, extractable = false) {
  const [iv, ct] = String(wrapped).split(".");
  return crypto.subtle.unwrapKey("raw", unb64(ct), encKey, { name: "AES-GCM", iv: unb64(iv) }, { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}

/** Everything a new account needs. The recovery code is shown once and never stored. */
export async function newAccount(login, password) {
  const salt = newSalt();
  const { auth, encKey } = await fromPassword(password, salt);
  const recovery = makeCode();
  const r = await fromRecovery(recovery);
  const raw = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrapped = await wrap(raw, encKey);
  const body = { login, salt, kdf: KDF_ROUNDS, auth, wrapped, rauth: r.auth, rwrapped: await wrap(raw, r.encKey) };
  const dataKey = await unwrap(wrapped, encKey); // the copy this device keeps can't be exported
  return { body, dataKey, recovery: prettyCode(recovery), wrapped };
}

/** New password, same data key. `wrapped` is the current wrapped key, `encKey` the one that opens it. */
export async function rewrap(wrapped, encKey, newPassword) {
  const key = await unwrap(wrapped, encKey, true);
  const salt = newSalt();
  const next = await fromPassword(newPassword, salt);
  const nextWrapped = await wrap(key, next.encKey);
  return { salt, kdf: KDF_ROUNDS, auth: next.auth, wrapped: nextWrapped, dataKey: await unwrap(nextWrapped, next.encKey) };
}

export { cleanCode as cleanRecovery };

/* ---------------- sealing the shelves ---------------- */

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Shelves → { iv, ct }: JSON, compressed (deflate), then AES-256-GCM. */
export async function seal(dataKey, data) {
  const json = te.encode(JSON.stringify(data));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  const pt = new Uint8Array(packed.length + 1);
  pt[0] = 1; // format 1: deflate-raw JSON
  pt.set(packed, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, pt);
  return { iv: b64(iv), ct: b64(ct) };
}

export async function open(dataKey, { iv, ct }) {
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, dataKey, unb64(ct)));
  if (pt[0] !== 1) throw new Error("Unknown backup format.");
  return JSON.parse(td.decode(await pipe(pt.subarray(1), new DecompressionStream("deflate-raw"))));
}

/* ---------------- this device's sign-in ---------------- */

const DB_NAME = "shelfie";
const STORE = "account";
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const readMe = () => idbDo("readonly", (s) => s.get("me")).catch(() => null);
const writeMe = (me) => idbDo("readwrite", (s) => (me ? s.put(me, "me") : s.delete("me")));

/* ---------------- the client ---------------- */

/**
 * get(): the shelves now; put(next): replace them; merge(a, b): combine two copies.
 * onStatus({ state, at, error, login }) hears about progress. onJoin() runs just before this
 * device first syncs with an account it has logged into.
 */
export function createAccount({ base, get, put, merge, onStatus, onSignedOut, onJoin }) {
  let me = null; // { login, token, dataKey, wrapped, at }
  let timer = 0;
  let busy = null;
  let pending = null;
  let lastPull = 0;
  const status = { state: "loading", at: 0, error: "", login: null };
  const tell = (patch) => {
    Object.assign(status, patch);
    onStatus?.({ ...status });
  };

  async function call(path, { method = "POST", body, auth = false } = {}) {
    if (!base) throw new Error("Accounts need Shelfie's server, and it isn't set up here.");
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        credentials: "omit",
        referrerPolicy: "strict-origin",
        cache: "no-store",
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth && me ? { Authorization: `Bearer ${me.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(navigator.onLine === false ? "You're offline. Try again when you're back." : "Couldn't reach Shelfie's server. Try again in a moment.");
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401 && auth) {
      // The session ended (signed out elsewhere, password changed, or it expired).
      await forget();
      onSignedOut?.();
    }
    if (!res.ok && res.status !== 409) {
      const err = new Error(data?.message || `The server answered ${res.status}.`);
      err.status = res.status;
      err.code = data?.error;
      throw err;
    }
    return { status: res.status, data };
  }

  async function forget() {
    me = null;
    clearTimeout(timer);
    await writeMe(null).catch(() => {});
    tell({ state: "off", login: null, at: 0, error: "" });
  }

  async function signIn(login, token, dataKey, wrapped) {
    // Joining an account brings its books here; it never wipes them (see onJoin in main.js).
    await onJoin?.();
    me = { login, token, dataKey, wrapped, at: 0, rev: null, sum: null };
    await writeMe(me);
    tell({ state: "idle", login, error: "" });
    await round("pull");
  }

  // A fingerprint of a copy, to skip saves that would change nothing.
  const sumOf = (data) => {
    const text = JSON.stringify(data);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return `${text.length}:${(h >>> 0).toString(36)}`;
  };
  const opId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(36).padStart(2, "0")).join("");

  /**
   * One sync round. Reads and writes are what the database bills, so:
   *   - "pull" (app opened, back on screen, back online): read the backup, merge, and save only
   *     if this device had something the backup didn't;
   *   - "push" (after changes): save straight away on top of the revision we last saw, with no
   *     read first; if another device saved in between, the server hands its copy back, we
   *     merge and save again. Nothing is sent when nothing changed since the last save.
   * Every save carries an id, so a save retried after a lost answer can't apply twice.
   */
  async function round(mode = "push") {
    if (!me) return;
    if (busy) {
      pending = pending === "pull" || mode === "pull" ? "pull" : "push";
      return busy;
    }
    busy = (async () => {
      try {
        if (mode === "pull" || me.rev == null) {
          tell({ state: "syncing", error: "" });
          const { data } = await call("/api/vault", { method: "GET", auth: true });
          me.rev = data?.rev || 0;
          if (data?.ct) {
            const remote = await open(me.dataKey, data);
            put(merge(get(), remote));
            me.sum = sumOf(merge(remote, remote));
          } else me.sum = null;
          lastPull = Date.now();
        }
        let next = merge(get(), get());
        if (sumOf(next) !== me.sum) {
          tell({ state: "syncing", error: "" });
          const op = opId();
          let st = 0;
          let data;
          for (let attempt = 0; attempt < 4; attempt++) {
            ({ status: st, data } = await call("/api/vault", { method: "PUT", auth: true, body: { ...(await seal(me.dataKey, next)), base: me.rev, op } }));
            if (st === 200) break;
            // Saved from another device first: fold that copy in and go again.
            me.rev = data.rev || 0;
            if (data.ct) next = merge(next, await open(me.dataKey, data));
            put(next);
            next = merge(get(), get());
          }
          if (st !== 200) throw new Error("Saving kept colliding. Try again.");
          me.rev = data.rev;
          me.sum = sumOf(next);
        }
        me.at = Date.now();
        writeMe(me).catch(() => {});
        tell({ state: "idle", at: me.at });
      } catch (err) {
        if (!me) return;
        tell({ state: "error", error: err?.name === "OperationError" ? "Couldn't unlock your backup on this device. Log out and back in." : String(err?.message || err) });
      } finally {
        busy = null;
        if (pending && me) {
          const m = pending;
          pending = null;
          round(m);
        }
      }
    })();
    return busy;
  }

  const ready = readMe().then((saved) => {
    if (saved?.token && saved?.dataKey) {
      me = saved;
      tell({ state: "idle", login: saved.login, at: saved.at || 0 });
      round("pull");
    } else tell({ state: "off" });
  });

  addEventListener("online", () => round("pull"));
  // Back on screen: catch up with other devices (at most once a minute). Leaving: save now.
  document.addEventListener("visibilitychange", () => {
    if (!me) return;
    if (document.visibilityState === "visible") {
      if (Date.now() - lastPull > 60_000) round("pull");
    } else if (timer) {
      clearTimeout(timer);
      timer = 0;
      round("push");
    }
  });

  return {
    status,
    ready,
    get on() {
      return !!me;
    },
    /** The username or email this device is logged in as. */
    get user() {
      return me?.login || null;
    },

    async signup(rawLogin, password) {
      const login = cleanLogin(rawLogin);
      if (!login) throw new Error("Use a username (3 to 32 letters, numbers, dots, dashes or underscores) or an email address.");
      const problem = passwordProblem(password, login);
      if (problem) throw new Error(problem);
      const made = await newAccount(login, password);
      const { data } = await call("/api/auth/signup", { body: made.body });
      if (!data?.token) throw new Error(data?.message || "That username is taken. Try another, or log in.");
      await signIn(login, data.token, made.dataKey, made.wrapped);
      return made.recovery;
    },

    async login(rawLogin, password) {
      const login = cleanLogin(rawLogin);
      if (!login) throw new Error("That isn't a username or an email address.");
      const { data: pre } = await call("/api/auth/prelogin", { body: { login } });
      const { auth, encKey } = await fromPassword(password, pre.salt, pre.kdf);
      const { data } = await call("/api/auth/login", { body: { login, auth } });
      const dataKey = await unwrap(data.wrapped, encKey);
      await signIn(login, data.token, dataKey, data.wrapped);
    },

    /** Forgot the password: the recovery code sets a new one. */
    async recover(rawLogin, code, newPassword) {
      const login = cleanLogin(rawLogin);
      if (!login) throw new Error("That isn't a username or an email address.");
      const clean = cleanCode(code);
      if (!clean) throw new Error("A recovery code is 24 letters and numbers.");
      const problem = passwordProblem(newPassword, login);
      if (problem) throw new Error(problem);
      const { data: begin } = await call("/api/auth/recover/begin", { body: { login } });
      const r = await fromRecovery(clean);
      let next;
      try {
        next = await rewrap(begin.rwrapped, r.encKey, newPassword);
      } catch {
        throw new Error("That username and recovery code don't match.");
      }
      const { data } = await call("/api/auth/recover", { body: { login, rauth: r.auth, salt: next.salt, kdf: next.kdf, auth: next.auth, wrapped: next.wrapped } });
      await signIn(login, data.token, next.dataKey, next.wrapped);
    },

    async changePassword(oldPassword, newPassword) {
      if (!me) throw new Error("Log in first.");
      const problem = passwordProblem(newPassword, me.login);
      if (problem) throw new Error(problem);
      const { data: pre } = await call("/api/auth/prelogin", { body: { login: me.login } });
      const old = await fromPassword(oldPassword, pre.salt, pre.kdf);
      let next;
      try {
        next = await rewrap(me.wrapped, old.encKey, newPassword);
      } catch {
        throw new Error("That isn't your current password.");
      }
      const { data } = await call("/api/auth/password", { auth: true, body: { auth: old.auth, salt: next.salt, kdf: next.kdf, newAuth: next.auth, wrapped: next.wrapped } });
      me = { ...me, token: data.token, dataKey: next.dataKey, wrapped: next.wrapped };
      await writeMe(me);
      tell({ state: "idle" });
    },

    async logout({ all = false } = {}) {
      if (!me) return;
      await round("push").catch(() => {}); // last changes go up first
      try {
        await call("/api/auth/logout", { auth: true, body: { all } });
      } catch {}
      await forget();
    },

    async deleteAccount(password) {
      if (!me) throw new Error("Log in first.");
      const { data: pre } = await call("/api/auth/prelogin", { body: { login: me.login } });
      const { auth } = await fromPassword(password, pre.salt, pre.kdf);
      await call("/api/auth/delete", { auth: true, body: { auth } });
      await forget();
    },

    /** "Sync now": catch up and save. */
    now: () => round("pull"),
    /**
     * After a change: save once things go quiet. A burst of page turns becomes one save, which
     * keeps database writes (and battery) down. Leaving the app saves straight away.
     */
    soon(ms = 12_000) {
      if (!me) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        round("push");
      }, ms);
    },

    /** A fresh recovery code (the old one stops working). Needs the password. */
    async newRecovery(password) {
      if (!me) throw new Error("Log in first.");
      const { data: pre } = await call("/api/auth/prelogin", { body: { login: me.login } });
      const { auth, encKey } = await fromPassword(password, pre.salt, pre.kdf);
      let key;
      try {
        key = await unwrap(me.wrapped, encKey, true);
      } catch {
        throw new Error("That isn't your password.");
      }
      const code = makeCode();
      const r = await fromRecovery(code);
      await call("/api/auth/recovery", { auth: true, body: { auth, rauth: r.auth, rwrapped: await wrap(key, r.encKey) } });
      return prettyCode(code);
    },
  };
}

// Sync: the same shelves in Safari, the home-screen app, and on any other device, with a
// backup that survives the browser clearing its storage.
//
// No accounts. Turning sync on makes a random sync code on this device. Everything is
// encrypted here, in the browser, with a key derived from that code (AES-256-GCM), before it
// is sent to Shelfie's Worker. The Worker only ever sees:
//   - an address: a SHA-256 hash of the code (it can't be turned back into the code), and
//   - ciphertext it cannot read.
// Whoever has the code can read and change the shelves, so it's treated like a password: it
// never leaves this device except when you copy it yourself.

const KEY = "shelfie.sync";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0, O, 1, I or L to misread
const CODE_LEN = 24; // 24 characters of 31 ≈ 119 bits of randomness

export function makeCode() {
  const out = [];
  const bytes = new Uint8Array(64);
  while (out.length < CODE_LEN) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      // Rejection sampling keeps every character equally likely.
      if (b < 248 && out.length < CODE_LEN) out.push(ALPHABET[b % 31]);
    }
  }
  return out.join("");
}

/** "abcd-efgh …" → "ABCDEFGH…", or null if it isn't a sync code. */
export function cleanCode(text) {
  const c = String(text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (c.length !== CODE_LEN || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return c;
}

export const prettyCode = (c) => c.match(/.{1,4}/g).join("-");

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

/** The Worker address (a hash) and the encryption key, both derived from the code. */
export async function derive(code) {
  const id = hex(await crypto.subtle.digest("SHA-256", enc.encode(`shelfie-sync-id:${code}`)));
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`shelfie-sync-key:${code}`));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id, key };
}

export async function seal(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function open(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/**
 * The sync engine. `get()` returns the current shelves, `put(next)` replaces them (after a
 * merge), `merge(a, b)` combines two copies, `onStatus` hears about progress.
 */
export function createSync({ base, get, put, merge, onStatus }) {
  let cfg = null;
  try {
    cfg = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {}
  if (cfg && !cleanCode(cfg.code)) cfg = null;
  let keys = null;
  let timer = 0;
  let busy = null;
  const status = { state: cfg ? "idle" : "off", at: cfg?.at || 0, error: "" };

  const remember = () => {
    try {
      if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
      else localStorage.removeItem(KEY);
    } catch {}
  };
  const tell = (patch) => {
    Object.assign(status, patch);
    onStatus?.({ ...status });
  };
  const url = () => `${base}/api/sync/${keys.id}`;

  async function request(method, body) {
    const res = await fetch(url(), {
      method,
      credentials: "omit",
      referrerPolicy: "strict-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      keepalive: method === "PUT" && JSON.stringify(body).length < 60000,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  /** Pull, merge, push if anything changed. One round at a time. */
  async function round() {
    if (!cfg || !base) return;
    if (busy) return busy;
    busy = (async () => {
      tell({ state: "syncing", error: "" });
      try {
        keys ||= await derive(cfg.code);
        let { status: st, data } = await request("GET");
        let remote = null;
        let rev = 0;
        if (st !== 200) throw new Error(data?.message || `Sync answered ${st}`);
        if (data?.ct) {
          remote = await open(keys.key, data);
          rev = data.rev;
        }
        let next = remote ? merge(get(), remote) : merge(get(), get());
        put(next);
        // Only upload when this device has something the synced copy doesn't.
        if (!remote || JSON.stringify(next) !== JSON.stringify(merge(remote, remote))) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const sealed = await seal(keys.key, next);
            ({ status: st, data } = await request("PUT", { ...sealed, base: rev }));
            if (st === 200) break;
            if (st !== 409 || !data?.ct) throw new Error(data?.message || `Sync answered ${st}`);
            // Someone else saved first: fold their copy in and try again.
            next = merge(next, await open(keys.key, data));
            rev = data.rev;
            put(next);
          }
          if (st !== 200) throw new Error("Sync kept colliding. Try again.");
        }
        cfg.at = Date.now();
        remember();
        tell({ state: "idle", at: cfg.at });
      } catch (err) {
        tell({ state: "error", error: err?.name === "OperationError" ? "This code doesn't open these shelves." : navigator.onLine === false ? "Offline. Will sync when you're back." : String(err?.message || err) });
      } finally {
        busy = null;
      }
    })();
    return busy;
  }

  addEventListener("online", () => round());
  document.addEventListener("visibilitychange", () => {
    if (!cfg) return;
    if (document.visibilityState === "visible") round();
    else if (timer) {
      clearTimeout(timer);
      timer = 0;
      round();
    }
  });

  return {
    status,
    get on() {
      return !!cfg;
    },
    get code() {
      return cfg?.code || null;
    },
    /** Start syncing with a new code (this device's shelves become the synced copy). */
    async enable() {
      cfg = { code: makeCode(), at: 0 };
      keys = null;
      remember();
      await round();
      return cfg.code;
    },
    /** Join shelves synced from another device; both copies are merged. */
    async link(text) {
      const code = cleanCode(text);
      if (!code) throw new Error("That isn't a sync code. It's 24 letters and numbers.");
      const before = cfg;
      cfg = { code, at: 0 };
      keys = null;
      remember();
      await round();
      if (status.state === "error") {
        cfg = before;
        keys = null;
        remember();
        throw new Error(status.error);
      }
    },
    disable() {
      cfg = null;
      keys = null;
      remember();
      tell({ state: "off", at: 0, error: "" });
    },
    now: () => round(),
    /**
     * After a change: sync once things go quiet (changes in a burst go together). Sync codes
     * live in Workers KV, whose free plan allows 1,000 writes a day for everyone, so saves are
     * batched generously; leaving the app saves straight away.
     */
    soon(ms = 15_000) {
      if (!cfg) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        round();
      }, ms);
    },
  };
}

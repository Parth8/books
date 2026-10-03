// Sharp covers. Google Books serves covers up to 1080 × 1620; Open Library's largest is about
// 325 × 500, which goes soft on a phone screen (and blurs when you zoom). So:
//   - Google covers are asked for at the size this screen needs (srcset), up to the full 1080.
//   - A book without a Google cover (Goodreads imports, Open Library books, the starter stack)
//     asks Shelfie's Worker, once, whether Google has a sharper one: by ISBN, or else by title
//     and author. The answer is remembered on this device (and cached at the edge for
//     everyone), so each book is looked up at most once.

const KEY = "shelfie.covers";
const MAX = 4000;
const apiBase = () => (document.querySelector('meta[name="api-base"]')?.content || "").trim().replace(/\/$/, "");
const GOOGLE = /^https:\/\/books\.google(usercontent)?\.com\/books\/content\?/;

let memo = null;
const load = () => {
  if (memo) return memo;
  try {
    memo = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) || "{}")));
  } catch {
    memo = new Map();
  }
  return memo;
};
let saveTimer = 0;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const m = load();
      while (m.size > MAX) m.delete(m.keys().next().value);
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(m)));
    } catch {}
  }, 500);
};

/** A Google cover URL at a given width (2:3 covers). Other URLs come back unchanged. */
export function sized(url, w) {
  if (!GOOGLE.test(url)) return url;
  const h = Math.round(w * 1.5);
  return /[?&]fife=/.test(url) ? url.replace(/fife=w\d+-h\d+/, `fife=w${w}-h${h}`) : `${url}&fife=w${w}-h${h}`;
}

/** srcset for a Google cover: the browser picks by screen size and density. */
export const srcsetOf = (url) => (GOOGLE.test(url) ? [480, 720, 1080].map((w) => `${sized(url, w)} ${w}w`).join(", ") : "");

const words = (v) => String(v || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
/** What a book is looked up by: its ISBN, or its title and author. */
export function lookupKey(book) {
  if (typeof book?.isbn === "string" && /^[\dX]{10,13}$/.test(book.isbn)) return book.isbn;
  const t = words(book?.title).slice(0, 80);
  return t.length >= 2 ? `t:${t}|${words(book?.author).slice(0, 60)}` : null;
}

/** A remembered sharper cover: a URL, "" (looked, none), or undefined (not asked yet). */
export const knownHd = (book) => {
  const k = lookupKey(book);
  return k ? load().get(k) : undefined;
};

const inflight = new Map();
let active = 0;
const waiting = [];
const slot = () => (active < 2 ? Promise.resolve(active++) : new Promise((r) => waiting.push(r)).then(() => active++));
const release = () => {
  active--;
  waiting.shift()?.();
};

/** Ask (once per book) for a Google cover. Resolves to a URL or null. */
export function findHd(book) {
  const key = lookupKey(book);
  if (!key) return Promise.resolve(null);
  const known = knownHd(book);
  if (known !== undefined) return Promise.resolve(known || null);
  if (inflight.has(key)) return inflight.get(key);
  const base = apiBase();
  if (!base) return Promise.resolve(null);
  const job = (async () => {
    await slot();
    try {
      const q = key.startsWith("t:") ? new URLSearchParams({ t: book.title.slice(0, 80), a: (book.author || "").slice(0, 60) }) : new URLSearchParams({ isbn: key });
      const res = await fetch(`${base}/api/cover?${q}`, { credentials: "omit", referrerPolicy: "strict-origin" });
      if (res.status === 429 || res.status >= 500) return null; // try again another time
      const data = await res.json().catch(() => null);
      const img = typeof data?.img === "string" && GOOGLE.test(data.img) ? data.img : "";
      load().set(key, img);
      save();
      return img || null;
    } catch {
      return null;
    } finally {
      release();
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

// Sharp covers. Google Books serves covers up to 1080 × 1620; Open Library's largest is about
// 325 × 500, which goes soft on a phone screen (and blurs when you zoom). So:
//   - Google covers are asked for at the size this screen needs (srcset), up to the full 1080.
//   - A book with only an ISBN (most Goodreads imports) asks Shelfie's Worker, once, whether
//     Google has a sharper cover. The answer is remembered on this device (and cached at the
//     edge for everyone), so each ISBN is looked up at most once.

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

/** A remembered sharper cover for this ISBN: a URL, "" (looked, none), or undefined (not asked yet). */
export const knownHd = (isbn) => (isbn ? load().get(isbn) : undefined);

const inflight = new Map();
let active = 0;
const waiting = [];
const slot = () => (active < 2 ? Promise.resolve(active++) : new Promise((r) => waiting.push(r)).then(() => active++));
const release = () => {
  active--;
  waiting.shift()?.();
};

/** Ask (once per ISBN) for a Google cover. Resolves to a URL or null. */
export function findHd(isbn) {
  if (!isbn || !/^[\dX]{10,13}$/.test(isbn)) return Promise.resolve(null);
  const known = knownHd(isbn);
  if (known !== undefined) return Promise.resolve(known || null);
  if (inflight.has(isbn)) return inflight.get(isbn);
  const base = apiBase();
  if (!base) return Promise.resolve(null);
  const job = (async () => {
    await slot();
    try {
      const res = await fetch(`${base}/api/cover?isbn=${isbn}`, { credentials: "omit", referrerPolicy: "strict-origin" });
      if (res.status === 429 || res.status >= 500) return null; // try again another time
      const data = await res.json().catch(() => null);
      const img = typeof data?.img === "string" && GOOGLE.test(data.img) ? data.img : "";
      load().set(isbn, img);
      save();
      return img || null;
    } catch {
      return null;
    } finally {
      release();
      inflight.delete(isbn);
    }
  })();
  inflight.set(isbn, job);
  return job;
}

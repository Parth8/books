// Book search, through Shelfie's own Worker (worker/worker.js). The Worker holds the Google
// Books key as a secret and falls back to Open Library itself, so this page never sees a key.
//
// If there's no Worker address in the api-base meta tag, or the Worker can't answer, search goes
// straight to Open Library, which needs no key.

const OPEN_LIBRARY = "https://openlibrary.org/search.json";
const OL_FIELDS = "key,title,author_name,cover_i,number_of_pages_median,first_publish_year,subject";

let ctl = null;
const apiBase = () => (document.querySelector('meta[name="api-base"]')?.content || "").trim().replace(/\/$/, "");

/** { results, source: "google" | "openlibrary" } */
export async function searchBooks(q, { limit = 16 } = {}) {
  ctl?.abort();
  const mine = (ctl = new AbortController());
  const { signal } = mine;
  const timer = setTimeout(() => mine.abort(), 12000);
  try {
    const base = apiBase();
    if (base) {
      try {
        return await viaWorker(base, q, signal);
      } catch (err) {
        // Worker unreachable or unhappy: Open Library still answers, keylessly.
        if (signal.aborted) throw err;
      }
    }
    return { results: await openLibrary(q, limit, signal), source: "openlibrary" };
  } finally {
    clearTimeout(timer);
  }
}

async function viaWorker(base, q, signal) {
  const res = await fetch(`${base}/api/search?${new URLSearchParams({ q })}`, { signal, credentials: "omit", referrerPolicy: "strict-origin" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message || `Search failed (${res.status})`), { status: res.status });
  // The Worker cleans its answers, but trust nothing that crosses the network.
  const pick = data?.source === "google" ? cleanWorkerGoogle : cleanOpenLibraryResult;
  return { results: (Array.isArray(data?.results) ? data.results : []).map(pick).filter(Boolean), source: data?.source === "google" ? "google" : "openlibrary" };
}

async function openLibrary(q, limit, signal) {
  const res = await fetch(`${OPEN_LIBRARY}?${new URLSearchParams({ q, limit: String(limit), fields: OL_FIELDS })}`, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.docs) ? data.docs : []).map(cleanOpenLibrary).filter(Boolean);
}

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const int = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/** A Google result as the Worker sent it. */
export function cleanWorkerGoogle(r) {
  if (!r || typeof r.title !== "string") return null;
  return {
    key: typeof r.key === "string" && /^g:[\w-]{4,20}$/.test(r.key) ? r.key : null,
    title: str(r.title, 140),
    author: str(r.author, 100),
    pages: int(r.pages),
    year: int(r.year),
    img: typeof r.img === "string" && r.img.startsWith("https://books.google.com/books/content?") ? r.img.slice(0, 400) : null,
    cats: str(r.cats, 40) || null,
    blurb: str(r.blurb, 280) || null,
  };
}

/** An Open Library result as the Worker sent it. */
export function cleanOpenLibraryResult(r) {
  if (!r || typeof r.title !== "string") return null;
  return { key: str(r.key, 40) || null, title: str(r.title, 140), author: str(r.author, 100), cover: int(r.cover), pages: int(r.pages), year: int(r.year), cats: str(r.cats, 40) || null };
}

/** A raw Open Library document (direct mode, before a Worker is set up). */
export function cleanOpenLibrary(d) {
  if (!d || typeof d.title !== "string") return null;
  return {
    key: typeof d.key === "string" ? d.key.replace("/works/", "ol:").slice(0, 40) : null,
    title: d.title.slice(0, 140),
    author: Array.isArray(d.author_name) ? str(d.author_name[0], 100) : "",
    cover: int(d.cover_i),
    pages: int(d.number_of_pages_median),
    year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null,
    cats: Array.isArray(d.subject) ? str(d.subject[0], 40) || null : null,
  };
}

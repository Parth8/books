// Book search. Google Books first (put your API key in the google-books-key meta tag in
// index.html), Open Library if Google says no (no key, over quota, offline, nothing found).
// Only the fields the app shows are asked for, and every answer is checked before use.

const GOOGLE = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_FIELDS = "items(id,volumeInfo(title,subtitle,authors,pageCount,publishedDate,imageLinks/thumbnail,categories,description))";
const OPEN_LIBRARY = "https://openlibrary.org/search.json";
const OL_FIELDS = "key,title,author_name,cover_i,number_of_pages_median,first_publish_year,subject";

let ctl = null;
const key = () => document.querySelector('meta[name="google-books-key"]')?.content.trim() || "";

/** { results, source: "google" | "openlibrary" } */
export async function searchBooks(q, { limit = 16 } = {}) {
  ctl?.abort();
  ctl = new AbortController();
  const { signal } = ctl;
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    try {
      const results = await google(q, limit, signal);
      if (results.length) return { results, source: "google" };
    } catch (err) {
      if (signal.aborted) throw err;
    }
    return { results: await openLibrary(q, limit, signal), source: "openlibrary" };
  } finally {
    clearTimeout(timer);
  }
}

async function google(q, limit, signal) {
  const params = new URLSearchParams({ q, maxResults: String(Math.min(40, limit)), printType: "books", fields: GOOGLE_FIELDS });
  if (key()) params.set("key", key());
  const res = await fetch(`${GOOGLE}?${params}`, { signal, referrerPolicy: "strict-origin-when-cross-origin" });
  if (!res.ok) throw new Error(`Google Books ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.items) ? data.items : []).map(cleanGoogle).filter(Boolean);
}

async function openLibrary(q, limit, signal) {
  const res = await fetch(`${OPEN_LIBRARY}?${new URLSearchParams({ q, limit: String(limit), fields: OL_FIELDS })}`, { signal, referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data?.docs) ? data.docs : []).map(cleanOpenLibrary).filter(Boolean);
}

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

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
    // A sharper cover than the API's thumbnail, from the same place.
    img: v.imageLinks?.thumbnail ? `https://books.google.com/books/content?id=${item.id}&printsec=frontcover&img=1&zoom=1&fife=w480-h720&source=gbs_api` : null,
    cats: Array.isArray(v.categories) ? str(v.categories[0], 40) : null,
    blurb: str(v.description, 600).replace(/<[^>]*>/g, "").slice(0, 280) || null,
  };
}

export function cleanOpenLibrary(d) {
  if (!d || typeof d.title !== "string") return null;
  return {
    key: typeof d.key === "string" ? d.key.replace("/works/", "ol:") : null,
    title: d.title.slice(0, 140),
    author: Array.isArray(d.author_name) ? String(d.author_name[0] || "").slice(0, 100) : "",
    cover: Number.isInteger(d.cover_i) && d.cover_i > 0 ? d.cover_i : null,
    pages: Number.isInteger(d.number_of_pages_median) && d.number_of_pages_median > 0 ? d.number_of_pages_median : null,
    year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null,
    cats: Array.isArray(d.subject) ? str(d.subject[0], 40) : null,
  };
}

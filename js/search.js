// Book search, straight from Open Library (free, no key). Only the fields the app shows are
// asked for, and answers are checked before use.

const API = "https://openlibrary.org/search.json";
const FIELDS = "key,title,author_name,cover_i,number_of_pages_median,first_publish_year";

let ctl = null;

export async function searchBooks(q, { limit = 12 } = {}) {
  ctl?.abort();
  ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const url = `${API}?${new URLSearchParams({ q, limit: String(limit), fields: FIELDS })}`;
    const res = await fetch(url, { signal: ctl.signal, referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data?.docs) ? data.docs : []).map(clean).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

export function clean(d) {
  if (!d || typeof d.title !== "string") return null;
  return {
    key: typeof d.key === "string" ? d.key.replace("/works/", "") : null,
    title: d.title.slice(0, 140),
    author: Array.isArray(d.author_name) ? String(d.author_name[0] || "").slice(0, 100) : "",
    cover: Number.isInteger(d.cover_i) && d.cover_i > 0 ? d.cover_i : null,
    pages: Number.isInteger(d.number_of_pages_median) && d.number_of_pages_median > 0 ? d.number_of_pages_median : null,
    year: Number.isInteger(d.first_publish_year) ? d.first_publish_year : null,
  };
}

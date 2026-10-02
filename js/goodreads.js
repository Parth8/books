// Goodreads import. Goodreads lets you export your whole library as a CSV
// (My Books → Import and export → Export library). This reads that file right here in the
// browser (it never goes anywhere) and turns each row into a book.
//
// Columns used: Title, Author, ISBN, ISBN13, My Rating, Number of Pages, Original Publication
// Year / Year Published, Date Read, Date Added, Exclusive Shelf, Bookshelves, Book Id.

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, a BOM. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let quoted = false;
  const s = String(text).replace(/^﻿/, "");
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      i += c === "\r" && s[i + 1] === "\n" ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** Header row → array of objects keyed by column name. */
export function toObjects(rows) {
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((k) => k.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? "").trim()])));
}

/** Goodreads wraps ISBNs as ="0441013597" so spreadsheets keep the leading zero. */
const isbnOf = (v) => {
  const d = String(v || "").replace(/^="?|"$/g, "").replace(/[^0-9Xx]/g, "").toUpperCase();
  return /^\d{13}$/.test(d) || /^\d{9}[\dX]$/.test(d) ? d : null;
};

/** "2023/05/14" (or 2023-05-14) → a local date at noon, so time zones can't shift the day. */
const dateOf = (v) => {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(v || "").trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return isNaN(d) || d.getFullYear() < 1900 ? null : d;
};

const intOf = (v) => {
  const n = parseInt(String(v || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

/** Goodreads shelves → Shelfie shelves. Custom shelves (and "did-not-finish") go to Want. */
export function shelfOf(exclusive, shelves = "") {
  const e = String(exclusive || "").toLowerCase().trim();
  if (e === "read") return "read";
  if (e === "currently-reading") return "reading";
  if (e === "to-read") return "want";
  const all = String(shelves).toLowerCase();
  if (/(^|,\s*)read(,|$)/.test(all)) return "read";
  if (all.includes("currently-reading")) return "reading";
  return "want";
}

/** True if the rows look like a Goodreads export. */
export function looksLikeGoodreads(objects) {
  const first = objects[0] || {};
  return "Title" in first && "Author" in first && ("Exclusive Shelf" in first || "Bookshelves" in first);
}

/**
 * The file's text → { books, counts, skipped }. `books` are inputs for store.importBooks.
 * Throws a friendly error if this isn't a Goodreads export.
 */
export function fromGoodreads(text) {
  const objects = toObjects(parseCSV(text));
  if (!objects.length) throw new Error("That file is empty.");
  if (!looksLikeGoodreads(objects)) throw new Error("That doesn't look like a Goodreads export. It should be the .csv from My Books → Import and export.");
  const books = [];
  let skipped = 0;
  const counts = { read: 0, reading: 0, want: 0 };
  for (const o of objects) {
    const title = (o.Title || "").replace(/\s+/g, " ").trim();
    if (!title) {
      skipped++;
      continue;
    }
    const shelf = shelfOf(o["Exclusive Shelf"], o.Bookshelves);
    const rating = intOf(o["My Rating"]);
    const year = intOf(o["Original Publication Year"]) || intOf(o["Year Published"]);
    books.push({
      title: title.slice(0, 140),
      author: (o.Author || "").replace(/\s+/g, " ").trim().slice(0, 100),
      isbn: isbnOf(o.ISBN13) || isbnOf(o.ISBN),
      pages: intOf(o["Number of Pages"]) || null,
      year: year && year > 0 && year < 3000 ? year : null,
      rating: rating && rating >= 1 && rating <= 5 ? rating : 0,
      shelf,
      finished: dateOf(o["Date Read"]),
      added: dateOf(o["Date Added"]),
      key: o["Book Id"] && /^\d+$/.test(o["Book Id"]) ? `gr:${o["Book Id"]}` : null,
    });
    counts[shelf]++;
  }
  return { books, counts, skipped };
}

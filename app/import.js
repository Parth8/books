// Goodreads import: pick your export, preview it, and the books land on their shelves.

import { h, $, fmt, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { createPanel } from "../js/panel.js";
import { feel } from "../js/sfx.js";
import { fromGoodreads } from "../js/goodreads.js";
import { state } from "./state.js";
import { add } from "./adding.js";
import { sync } from "./backup.js";
import { book, deckEl, island, renderShelf, shelf, switchShelf } from "./boot.js";
import { commit, queuePoster } from "./celebrate.js";
import { key } from "./dock.js";
import { panelProgress } from "./panels.js";
import { countUp, stats } from "./stats.js";

/* ---------------- Goodreads import ---------------- */

export const imp = createPanel($("#panel-import"), {
  onProgress: (p) => panelProgress("import", p),
  onOpen: () => {
    feel("open", "medium");
    showImportStart();
  },
  onClose: () => feel("close", "light"),
});
$("#panel-import [data-close]").addEventListener("click", () => imp.close());
export function openImport() {
  if (stats.isOpen) stats.close();
  if (add.isOpen) add.close();
  setTimeout(() => imp.open(), 200);
}

/** replaceChildren, skipping the null / false left by optional parts. */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
}

function showImportStart(error = "") {
  const file = h("input", { type: "file", accept: ".csv,text/csv", hidden: true, id: "gr-file", on: { change: (e) => e.target.files?.[0] && readExport(e.target.files[0]) } });
  const drop = h("label", { class: "gr-drop", for: "gr-file" }, h("span", { class: "gr-drop-icon", text: "📄" }), h("b", { text: "PICK YOUR EXPORT" }), h("small", { text: "goodreads_library_export.csv" }), file);
  drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("over")));
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) readExport(f);
  });
  const step = (n, title, text, extra = null) => h("li", { class: "gr-step" }, h("span", { class: "gr-n", text: String(n) }), h("div", {}, h("b", { text: title }), h("p", { text }), extra));
  fill($("#import-body"),
    h("p", { class: "gr-lede", text: "Three steps, a couple of minutes. Your reading history, ratings and dates come with you." }),
    h(
      "ol",
      { class: "gr-steps" },
      step(1, "OPEN GOODREADS IN A BROWSER", "The export lives on the website (not the Goodreads app). Sign in, then open My Books → Import and export.", h("a", { class: "gr-link", href: "https://www.goodreads.com/review/import", target: "_blank", rel: "noopener noreferrer", text: "OPEN GOODREADS EXPORT ↗" })),
      step(2, "TAP “EXPORT LIBRARY”", "Goodreads prepares a file. Big libraries can take a few minutes; refresh that page until the download link appears."),
      step(3, "PICK THE FILE HERE", "It's called goodreads_library_export.csv, usually in Downloads (or Files → Downloads on iPhone)."),
    ),
    drop,
    error ? h("p", { class: "gr-error", role: "alert", text: error }) : null,
    h("p", { class: "p-note", text: "🔒 THE FILE IS READ ON YOUR DEVICE AND NEVER UPLOADED." }),
  );
}

async function readExport(fileObj) {
  if (fileObj.size > 15 * 1024 * 1024) return showImportStart("That file is bigger than a Goodreads export should be (15 MB max).");
  let parsed;
  try {
    parsed = fromGoodreads(await fileObj.text());
  } catch (err) {
    feel("error", "error");
    return showImportStart(String(err.message || err));
  }
  const { books, counts } = parsed;
  if (!books.length) return showImportStart("No books found in that file.");
  feel("sparkle", "success");
  let ratings = true;
  const total = h("b", { class: "gr-total", "data-n": String(books.length), text: fmt(books.length) });
  const stat = (n, label, cls) => h("span", { class: `gr-stat ${cls}` }, h("b", { text: fmt(n) }), h("small", { text: label }));
  const already = books.filter((b) => state.books.some((x) => (b.isbn && x.isbn === b.isbn) || x.title.toLowerCase() === b.title.toLowerCase())).length;
  const toggle = h("button", { type: "button", class: "gr-toggle on", "aria-pressed": "true", text: "✓ BRING MY STAR RATINGS (AS FEELINGS)" });
  toggle.addEventListener("click", () => {
    ratings = !ratings;
    toggle.classList.toggle("on", ratings);
    toggle.setAttribute("aria-pressed", String(ratings));
    toggle.textContent = `${ratings ? "✓" : "○"} BRING MY STAR RATINGS (AS FEELINGS)`;
    feel("snap", "select");
  });
  const go = key("BRING THEM IN", "k-lime wide", () => doImport(books, ratings), { sub: `${fmt(books.length - already)} BOOKS` });
  fill($("#import-body"),
    h("div", { class: "gr-found" }, h("small", { text: "FOUND IN YOUR EXPORT" }), total, h("span", { text: books.length === 1 ? "BOOK" : "BOOKS" })),
    h("div", { class: "gr-stats" }, stat(counts.read, "READ", "read"), stat(counts.reading, "READING", "reading"), stat(counts.want, "WANT", "want")),
    already ? h("p", { class: "p-note", text: `${already} ALREADY ON YOUR SHELVES WILL BE SKIPPED.` }) : null,
    h("p", { class: "sync-text", text: "Read books keep their finish dates, so this year's count and your yearly goal are right straight away. Custom shelves land on Want. Covers come from Open Library by ISBN." }),
    toggle,
    h("div", { class: "keys one" }, go),
  );
  if (!prefersReducedMotion()) countUp(total);
}

function doImport(books, ratings) {
  const input = ratings ? books : books.map((b) => ({ ...b, rating: 0 }));
  const r = S.importBooks(state, input);
  const ev = r.events.find((e) => e.type === "imported");
  imp.close();
  commit(r, deckEl);
  if (!ev?.added) return island.say({ icon: "🤷", title: "NOTHING NEW", sub: "Every book was already on your shelves", tone: "sun" });
  queuePoster({
    kicker: `${fmt(ev.added)} BOOKS · ${fmt(ev.counts.read)} READ`,
    lines: ["WELCOME", state.name ? `HOME, ${state.name.toUpperCase().slice(0, 10)}.` : "HOME."],
    sub: ev.skipped ? `${ev.skipped} already here, skipped.` : "Your whole library, moved in.",
    tone: "#ff6ad5",
    ink: "#0d0d0d",
    emoji: ["📚", "🧳", "🏠", "⭐"],
    sounds: ["fanfare", "levelup"],
  });
  const where = ev.counts.reading ? "reading" : ev.counts.read ? "read" : "want";
  setTimeout(() => (where !== shelf ? switchShelf(where) : renderShelf({ deal: 1 })), 300);
}

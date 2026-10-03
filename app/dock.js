// The dock under the pile: it changes with the book on top. A macropad with a page dial while you're reading, START and SHUFFLE for your want pile, feeling keys for finished books.

import { h, $, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { feelOf, amazonUrl } from "../js/stamp.js";
import { createKnob } from "../js/knob.js";
import { burst, floatText } from "../js/confetti.js";
import { sound, feel } from "../js/sfx.js";
import { state } from "./state.js";
import { loadStarter, openAdd } from "./adding.js";
import { book, deck, deckEl, liquid, renderShelf, switchShelf, topId } from "./boot.js";
import { commit } from "./celebrate.js";
import { openImport } from "./import.js";
import { live, liveFor, saveSoon, setLive } from "./reading.js";

/* ---------------- The dock ---------------- */

export const dock = $("#dock");

/** A chunky keycap. */
export function key(label, cls, onPress, { aria, sub } = {}) {
  const b = h("button", { type: "button", class: `key ${cls}`, "aria-label": aria || null }, h("span", { class: "cap" }, h("b", { text: label }), sub ? h("small", { text: sub }) : null));
  b.addEventListener("pointerdown", () => feel("click", "medium"));
  b.addEventListener("click", (e) => {
    if (e.detail === 0) feel("click", "medium"); // keyboard press
    sparkKey(b);
    onPress(e);
  });
  return b;
}

/** A keycap throws a few sparks when pressed. */
function sparkKey(el) {
  const colors = { "k-blue": ["#2b3bff", "#ffffff"], "k-yellow": ["#ffd60a", "#ffffff"], "k-red": ["#ff3b30", "#ffffff"] };
  const c = Object.entries(colors).find(([k]) => el.classList.contains(k))?.[1] || ["#e7ff3d", "#ffffff"];
  burst(el, { count: 10, colors: c, kinds: ["dot", "star"], power: 0.55 });
}

/** The little LCD: lines of pixel text that type themselves out. */
export function screen(lines) {
  const el = h("div", { class: "screen", role: "status" }, lines.map((l) => h("span", { class: "ln", text: "" })));
  [...el.children].forEach((ln, k) => typeTo(ln, lines[k]));
  return el;
}

function typeTo(el, text) {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  clearInterval(Number(el.dataset.timer || 0));
  if (prefersReducedMotion() || text.length > 48) return (el.textContent = text);
  let n = 0;
  const t = setInterval(() => {
    n += 2;
    el.textContent = text.slice(0, n) + (n < text.length ? "▌" : "");
    if (n >= text.length) clearInterval(t);
  }, 16);
  el.dataset.timer = String(t);
}

export const bar = (frac, cells = 14) => "▓".repeat(Math.round(frac * cells)).padEnd(cells, "░");
const hoursLeft = (pages) => {
  const m = pages * 1.6;
  return m < 60 ? `${Math.max(1, Math.round(m))} MIN` : `${(m / 60).toFixed(1).replace(/\.0$/, "")} H`;
};

let screenEl = null;
export let knob = null;

function readingLines(b, p) {
  return [`PG ${String(p).padStart(4, "0")} / ${String(b.pages).padStart(4, "0")}`, `${bar(p / b.pages)} ${Math.round((p / b.pages) * 100)}%`, p >= b.pages ? "LAST PAGE!" : `${hoursLeft(b.pages - p)} LEFT · TODAY ${S.pagesOn(state)}/${state.goal}`];
}

export function updateScreen(b, p) {
  if (!screenEl || dock.dataset.mode !== "reading") return;
  readingLines(b, p).forEach((t, k) => {
    const ln = screenEl.children[k];
    ln.dataset.text = t;
    ln.textContent = t;
  });
  knob?.value(`Page ${p} of ${b.pages}`);
}

/** Fairy lights strung across the top of the macropad. */
export const fairy = (() => {
  const n = 13;
  const colors = ["#e7ff3d", "#ff6ad5", "#25c7ff", "#ff5a1f", "#ffd60a"];
  const sag = (t) => 4 + Math.sin(t * Math.PI) * 12; // the wire droops in the middle
  const path = `M0 4 ${Array.from({ length: 21 }, (_, i) => `L${(i / 20) * 100} ${sag(i / 20).toFixed(1)}`).join(" ")}`;
  const el = h("div", { class: "fairy", "aria-hidden": "true" }, h("span", { svg: `<svg viewBox="0 0 100 26" preserveAspectRatio="none"><path d="${path}" vector-effect="non-scaling-stroke"/></svg>` }));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    el.append(h("i", { vars: { "--x": `${t * 100}%`, "--y": `${sag(t) + 1}px`, "--c": colors[i % colors.length], "--d": `${(1.6 + ((i * 7) % 5) * 0.45).toFixed(2)}s`, "--delay": `${-((i * 13) % 9) * 0.3}s`, "--n": i } }));
  }
  return el;
})();
/** On big moments the lights chase. */
export function lightsChase() {
  if (prefersReducedMotion()) return;
  fairy.classList.remove("chase");
  void fairy.offsetWidth;
  fairy.classList.add("chase");
  clearTimeout(lightsChase.t);
  lightsChase.t = setTimeout(() => fairy.classList.remove("chase"), 3200);
}

export function renderDock() {
  const b = book(topId);
  const mode = !b ? (state.books.length ? "add" : "empty") : b.shelf;
  const sameBook = dock.dataset.mode === mode && dock.dataset.id === (b?.id || "") && mode !== "read";
  dock.dataset.mode = mode;
  dock.dataset.id = b?.id || "";
  if (sameBook && mode === "reading") return updateScreen(b, live?.id === b.id ? live.page : b.page);
  knob = null;
  let body;
  if (mode === "reading") {
    screenEl = screen(readingLines(b, b.page));
    knob = createKnob({
      label: `Page dial for ${b.title}`,
      onTurn: (n) => {
        const cur = book(topId);
        if (!cur) return;
        sound("detent");
        setLive(cur, liveFor(cur).page + n);
        liquid?.splash(n > 0 ? 0.25 : -0.15, 0.85);
      },
      onRelease: () => saveSoon(500),
    });
    knob.value(`Page ${b.page} of ${b.pages}`);
    const plus = (n, cls) => key(`+${n}`, cls, (e) => nudgeKey(n, e), { aria: `Add ${n} pages` });
    body = [
      h("div", { class: "pad reading" }, screenEl, h("div", { class: "knob-well" }, knob.el, h("small", { text: "SPIN" })), h("div", { class: "keys round" }, plus(1, "k-cream"), plus(5, "k-blue"), plus(10, "k-yellow"), plus(25, "k-red"))),
    ];
  } else if (mode === "want") {
    screenEl = screen([`NEXT UP?`, b.title.toUpperCase().slice(0, 28), `${b.pages} PAGES · ~${hoursLeft(b.pages)}`]);
    body = [
      h(
        "div",
        { class: "pad want" },
        screenEl,
        h(
          "div",
          { class: "keys three" },
          (() => {
            const k = key("START", "k-blue wide", (e) => start(b.id, e.currentTarget), { sub: "READING" });
            k.querySelector("b").append(h("i", { class: "play-tri", "aria-hidden": "true" }));
            return k;
          })(),
          key("🛒", "k-pink", () => window.open(amazonUrl(b), "_blank", "noopener,noreferrer"), { aria: `Find ${b.title} on Amazon`, sub: "GET IT" }),
          key("🎲", "k-yellow", () => shuffle(), { aria: "Shuffle the pile", sub: "SHUFFLE" }),
        ),
      ),
    ];
  } else if (mode === "read") {
    const when = b.finished ? new Date(b.finished).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "";
    screenEl = screen([`FINISHED ${when}`, `${b.pages} PAGES`, "HOW DID IT FEEL?"]);
    body = [
      h(
        "div",
        { class: "pad read" },
        screenEl,
        h(
          "div",
          { class: "keys feel", role: "radiogroup", "aria-label": "How did it feel?" },
          [1, 2, 3, 4, 5].map((n) => {
            const k = key(feelOf(n), `k-glass${b.rating === n ? " on" : ""}`, (e) => rate(b.id, n, e.currentTarget), { aria: ["", "Meh", "Okay", "Good", "Loved it", "Mind blown"][n] });
            k.setAttribute("role", "radio");
            k.setAttribute("aria-checked", String(b.rating === n));
            return k;
          }),
        ),
        h("div", { class: "keys two" }, key("↺", "k-cream", (e) => start(b.id, e.currentTarget), { sub: "READ AGAIN" })),
      ),
    ];
  } else {
    screenEl = screen(mode === "empty" ? [state.name ? `HI ${state.name.toUpperCase().slice(0, 14)}!` : "SHELVES EMPTY", "SEARCH, IMPORT FROM", "GOODREADS, OR TRY A DEMO"] : ["ADD A BOOK", "PULL THE + STAMP UP", "OR PRESS SEARCH"]);
    body = [
      h(
        "div",
        { class: "pad add" },
        screenEl,
        h(
          "div",
          { class: mode === "empty" ? "keys three" : "keys two" },
          key("SEARCH", "k-blue wide", () => openAdd(), { sub: "FIND A BOOK" }),
          // Goodreads is a first-day thing: offered here only while the library is empty
          // (afterwards it lives in You → Library).
          mode === "empty"
            ? key("🧳", "k-pink", () => openImport(), { aria: "Import from Goodreads", sub: "GOODREADS" })
            : key("✍️", "k-cream", () => openAdd({ manual: true }), { aria: "Type a book in by hand", sub: "BY HAND" }),
          mode === "empty" ? key("⚡", "k-yellow", (e) => loadStarter(e.currentTarget), { aria: "Load a starter stack", sub: "DEMO" }) : null,
        ),
      ),
    ];
  }
  dock.replaceChildren(...body, fairy);
  if (!prefersReducedMotion()) dock.firstElementChild.animate([{ transform: "translateY(18px)", opacity: 0.4 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,1.4,.4,1)" });
}

function nudgeKey(n, e) {
  const cur = book(topId);
  if (!cur) return;
  setLive(cur, liveFor(cur).page + n);
  liquid?.splash(0.35 + n / 40, Math.random());
  floatText(e.currentTarget, `+${n}`, "#e7ff3d");
  saveSoon(500);
}

export function start(id, el) {
  commit(S.moveBook(state, id, "reading"), el);
  burst(el, { count: 50 });
  setTimeout(() => switchShelf("reading"), 450);
}

function rate(id, n, el) {
  commit(S.rateBook(state, id, n), el);
  burst(el, { count: 20 + n * 10, emoji: [feelOf(n)] });
  setTimeout(() => renderShelf(), 250);
}

function shuffle() {
  const pile = S.shelf(state, "want");
  if (pile.length < 2) return;
  const pick = pile[Math.floor(Math.random() * pile.length)];
  // Riffle: flick through quickly, landing on a random book.
  let k = 0;
  const target = S.shelf(state, "want").findIndex((b) => b.id === pick.id);
  deck.go(0);
  const step = () => {
    if (k >= target) return;
    k++;
    deck.go(k, { x: -900 });
    setTimeout(step, 110);
  };
  setTimeout(step, 150);
  burst(deckEl, { count: 30, emoji: ["🎲"] });
}

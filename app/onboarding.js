// First run and coming back: the tour, your name, keeping your books safe, explainer pop-ups and the add-to-home-screen nudge.

import { h, $, buzz } from "../js/util.js";
import * as S from "../js/store.js";
import { rain } from "../js/confetti.js";
import { feel } from "../js/sfx.js";
import { startTutorial } from "../js/tutorial.js";
import { popup } from "../js/modal.js";
import { tip, holdTipsWhile, resetTips } from "../js/tips.js";
import { showInstall, shouldOffer, markOffered } from "../js/home.js";
import * as Q from "../js/quips.js";
import { account, setState, state } from "./state.js";
import { accountsUp, checkAccounts, loginFlow, signupFlow } from "./accounts.js";
import { add, row } from "./adding.js";
import { sync } from "./backup.js";
import { book, deck, flip, hints, island, shelf, tape, topId } from "./boot.js";
import { backupSoon, commit, posterUp } from "./celebrate.js";
import { screen, start } from "./dock.js";
import { imp, openImport } from "./import.js";
import { live, scrub } from "./reading.js";
import { stats } from "./stats.js";

/* ---------------- first run: the tutorial ---------------- */

/* ---------------- first run: tour → name → bring your books ---------------- */

export const TOUR = "shelfie.tour";
export const touring = () => !!document.querySelector(".tour");
export const popping = () => !!document.querySelector(".pop");

function tutorialDone(finished) {
  try {
    localStorage.setItem(TOUR, "1");
  } catch {}
  const first = !state.toured;
  if (first) setState(S.save(globalThis.localStorage, { ...state, toured: true, seen: true }));
  // The tour had you practise swiping and turning pages: no need to hint at them again.
  if (finished) ["swipe", "scrub"].forEach((k) => hints.learn(k));
  backupSoon();
  if (first) setTimeout(onboard, finished ? 900 : 300);
}

/** After the first tour: ask for a name, then offer Goodreads (or a sync code). */
async function onboard() {
  if (!state.name) await askName();
  if (!account?.on && (await checkAccounts())) await safeStep();
  if (state.books.length < 3) await bringBooks();
  setTimeout(introTips, 600);
}

export async function askName({ edit = false } = {}) {
  const res = await popup({
    tone: "lime",
    icon: "👋",
    title: edit ? "WHAT SHOULD WE CALL YOU?" : "HEY, WHO'S READING?",
    text: "Just a first name or a nickname, to make things friendlier. It stays on your device (and in your encrypted sync, if you turn it on).",
    input: { placeholder: "Your name", max: 24, value: state.name, capitalize: "words", label: "Your first name or nickname" },
    actions: [
      { id: "skip", label: edit ? "CANCEL" : "SKIP", cancel: true },
      { id: "ok", label: "THAT'S ME", primary: true },
    ],
  });
  if (res.id !== "ok" || !S.cleanName(res.value)) {
    if (!edit) island.say({ icon: "🕶️", title: "ANONYMOUS READER", sub: Q.goodbyeNoName(), tone: "violet" });
    return;
  }
  commit(S.setName(state, res.value), $("#lcd"));
  feel("levelup", "success");
  rain({ count: 90, emoji: ["👋", "✨"] });
  island.say({ icon: "👋", title: `HI, ${state.name.toUpperCase()}!`, sub: Q.hello(state.name), tone: "lime" });
}

/** Onboarding: where your books live, and how to keep them. */
async function safeStep() {
  const choice = await popup({
    tone: "cyan",
    icon: "🛟",
    title: "KEEP YOUR BOOKS SAFE",
    body: h(
      "div",
      { class: "explain" },
      h("p", { class: "explain-row" }, h("span", { text: "📱" }), h("span", { text: "Your books live on this phone. Shelfie works offline and stays fast." })),
      h("p", { class: "explain-row" }, h("span", { text: "☁️" }), h("span", { text: "A free account backs them up, encrypted on your phone first: not even we can read them." })),
      h("p", { class: "explain-row" }, h("span", { text: "🔁" }), h("span", { text: "New phone? Log in and everything comes back. Forgot your password? Your recovery code gets you in." })),
    ),
    actions: [
      { id: "later", label: "LATER", cancel: true },
      { id: "login", label: "LOG IN" },
      { id: "signup", label: "SIGN UP", primary: true },
    ],
  });
  if (choice === "signup") await signupFlow();
  if (choice === "login") await loginFlow();
}

async function bringBooks() {
  const choice = await popup({
    tone: "pink",
    icon: "🧳",
    title: "BRING YOUR BOOKS?",
    text: "Coming from Goodreads? Import your whole library: what you've read (with dates and ratings), what you're reading, and your want-to-read. Already have a Shelfie account? Log in and your shelves come with you.",
    actions: [
      { id: "later", label: "START FRESH", cancel: true },
      ...(account?.on || accountsUp !== true ? [] : [{ id: "sync", label: "LOG IN" }]),
      { id: "gr", label: "GOODREADS", primary: true },
    ],
  });
  if (choice === "gr") openImport();
  if (choice === "sync") loginFlow();
}

export async function helpFlow() {
  feel("open", "light");
  const what = await popup({
    tone: "yellow",
    icon: "?",
    title: "HOW CAN WE HELP?",
    text: "Replay the gesture tour, or bring the explainer pop-ups back as you go.",
    actions: [
      { id: "tips", label: "POP-UPS AGAIN" },
      { id: "tour", label: "PLAY THE TOUR", primary: true },
    ],
  });
  if (what === "tour") startTutorial({ onDone: tutorialDone });
  if (what === "tips") {
    resetTips();
    hints.reset?.();
    introTips();
  }
}

export let toured = false;

/* ---------------- explainer pop-ups ---------------- */

/** The tips that make sense for what's on screen right now. Each shows once. */
function introTips() {
  if (stats.isOpen) return;
  const b = book(topId);
  if (b) tip({ id: "stamp", el: () => deck.top?.el, tone: "lime", title: "THIS IS A BOOK", text: b.shelf === "reading" ? "Drag it UP to turn pages (down to go back). Swipe sideways to flip through your books. Tap to flip the stamp over. Hold it to move it to another shelf." : "Swipe sideways to flip through. Tap to flip the stamp over. Hold it, then drop it on a shelf to move it." });
  else tip({ id: "addstamp", el: () => deck.top?.el, tone: "lime", title: "YOUR FIRST BOOK", text: "This + stamp is always last on every shelf. Tap it (or pull it up) to search for a book." });
  if (b?.shelf === "reading") tip({ id: "pad", el: () => $(".pad.reading"), tone: "cyan", title: "YOUR PAGE DECK", text: "Spin the dial, or tap +1 +5 +10 +25, to log pages. The green screen shows where you are and what's left." });
  if (b?.shelf === "want") tip({ id: "padwant", el: () => $(".pad.want"), tone: "orange", title: "WANT TO READ", text: "START moves this book to Reading. 🎲 SHUFFLE picks one for you." });
  if (b?.shelf === "read") tip({ id: "padread", el: () => $(".pad.read"), tone: "yellow", title: "FINISHED", text: "Tap a face to say how it felt. ↺ starts it again." });
  tip({ id: "tape", el: () => $("#tape"), tone: "pink", title: "YOUR SHELVES", text: "Drag the big word sideways (or tap the next one) to switch between READING, WANT and READ." });
  tip({ id: "lcd", el: () => $("#lcd"), tone: "lime", title: "STATUS SCREEN", text: "Level, XP, streak and your goals take turns here. Tap it for your stats." });
  tip({ id: "pull", el: () => $("#pullbar"), tone: "cyan", title: "PULL ME UP", text: "Stats, daily / monthly / yearly goals, stickers, sync, Goodreads import and settings live down here." });
}

/** At start-up: the tour on a first run, a hello when you come back, and (on a later visit) the home-screen offer. */
export function startOnboarding() {
  toured = !!state.toured;
  try {
    toured ||= !!localStorage.getItem(TOUR);
  } catch {}
  if (!toured) setTimeout(() => startTutorial({ onDone: tutorialDone }), 700);
  else if (sessionStorage.getItem("shelfie.fresh")) {
    // Just reset: a clean slate, so say hello again.
    sessionStorage.removeItem("shelfie.fresh");
    setTimeout(() => {
      island.say({ icon: "🧹", title: "FRESH START", sub: "Squeaky clean shelves", tone: "lime", buzz: false });
      onboard();
    }, 900);
  } else setTimeout(() => {
    island.say({ icon: "📚", title: Q.greeting(state.name).toUpperCase(), sub: S.pagesOn(state) ? `${S.pagesOn(state)}/${state.goal} pages today` : "Ready when you are", tone: "lime", buzz: false });
    introTips();
  }, 900);

  // Tips wait while something else has your attention.
  holdTipsWhile(() => touring() || popping() || add.isOpen || deck.dragging || posterUp || !!document.querySelector(".tour"));

  // Counted per device: the offer comes on a later visit, never on the first one.
  let visits = 0;
  try {
    visits = Number(localStorage.getItem("shelfie.visits") || 0) + 1;
    localStorage.setItem("shelfie.visits", String(visits));
  } catch {}
  if (visits >= 2 && state.toured)
    setTimeout(() => {
      if (!shouldOffer() || touring() || popping() || stats.isOpen || add.isOpen || imp.isOpen || posterUp || document.querySelector(".tip")) return;
      markOffered();
      showInstall({ name: state.name });
    }, 6000);
}

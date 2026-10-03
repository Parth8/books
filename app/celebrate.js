// Changes and celebrations: every change goes through commit(), which saves, backs up and turns what happened into confetti, posters and sounds.

import { h, $, buzz, fmt, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { bookStamp } from "../js/stamp.js";
import { poster } from "../js/poster.js";
import { burst, floatText, coins, shockwave, shake } from "../js/confetti.js";
import { sound, haptic, feel } from "../js/sfx.js";
import * as Q from "../js/quips.js";
import { account, setState, state, syncRef } from "./state.js";
import { added } from "./adding.js";
import { book, deckEl, island, renderHud, SHELF, shelf, STARTER } from "./boot.js";
import { lightsChase } from "./dock.js";
import { markStatsDirty, prerenderStats, renderStats, stats } from "./stats.js";

/* ---------------- Changes and celebrations ---------------- */

// Changes go to whichever backup is on: your account, or (without one) a sync code.
export function backupSoon() {
  if (account?.on) account.soon();
  else syncRef?.soon(); // (syncRef: this can run while the app is still starting up)
}

export function commit(result, at, { keepStats = false } = {}) {
  const before = state;
  setState(result.state);
  setState(S.save(globalThis.localStorage, state));
  const events = [...result.events];
  celebrate(events, at);
  renderHud();
  markStatsDirty();
  if (stats.isOpen && !keepStats) renderStats();
  else prerenderStats();
  backupSoon();
  void before;
  return result;
}

const posters = [];
export let posterUp = false;
export function queuePoster(p) {
  posters.push(p);
  if (!posterUp) nextPoster();
}
function nextPoster() {
  const p = posters.shift();
  if (!p) return (posterUp = false);
  posterUp = true;
  (p.sounds || ["fanfare"]).forEach((name, i) => setTimeout(() => sound(name), i * 380));
  haptic("celebrate");
  poster({ ...p, onDone: () => setTimeout(nextPoster, 120) });
}

export const MONTH = () => new Date().toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
let combo = { n: 0, t: 0 };

/**
 * Now and then, reading pays out: a jackpot. About one page session in twelve, never twice in ten
 * minutes, so it stays a surprise.
 */
export function maybeJackpot(anchor) {
  // Remembered on the device, so reopening the app can't be used to farm jackpots.
  let last = 0;
  try {
    last = Number(localStorage.getItem("shelfie.jackpot") || 0);
  } catch {}
  if (Date.now() - last < 600_000 || Math.random() > 1 / 12) return;
  try {
    localStorage.setItem("shelfie.jackpot", String(Date.now()));
  } catch {}
  const amount = [25, 25, 50, 50, 77, 100][Math.floor(Math.random() * 6)];
  setTimeout(() => commit(S.jackpot(state, amount), anchor), 700);
}

export function celebrate(events, at) {
  if (events.some((e) => ["finished", "goal", "level", "imported", "jackpot", "badge"].includes(e.type))) lightsChase();
  const jp = events.find((e) => e.type === "jackpot");
  if (jp) {
    feel("fanfare", "celebrate");
    queuePoster({ lines: ["JACK", "POT!"], kicker: "🎰 BONUS ROUND", sub: `+${jp.amount} XP for reading. Lucky you${state.name ? `, ${state.name}` : ""}.`, tone: "#ffd60a", ink: "#0d0d0d", emoji: ["🪙", "⭐", "🎰"] });
  }
  const xp = events.find((e) => e.type === "xp")?.amount || 0;
  if (xp && at) {
    floatText(at, `+${xp} XP`, "#e7ff3d");
    coins(at, Math.min(30, 6 + Math.round(xp / 4)));
    sound("coin");
  }
  // Reading in bursts builds a combo: each log within 90 seconds of the last ramps it up.
  if (events.some((e) => e.type === "xp") && events.some((e) => e.type === "xp" && e.amount > 0) && !events.some((e) => e.type === "added" || e.type === "egg" || e.type === "starter")) {
    const now = Date.now();
    combo = now - combo.t < 90000 ? { n: combo.n + 1, t: now } : { n: 1, t: now };
    if (combo.n >= 2) showCombo(combo.n);
    if (combo.n === 5)
      setTimeout(() => {
        const r = S.findEgg(state, "app", "combo5");
        r.events.forEach((e) => e.type === "egg" && (e.label = "Combo ×5"));
        if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, $("#stage"));
      }, 1600);
  }
  const msgs = [];
  for (const e of events) {
    if (e.type === "imported" && e.added) msgs.push({ icon: "🧳", title: "LIBRARY IMPORTED", sub: `${fmt(e.added)} books moved in`, tone: "pink" });
    if (e.type === "starter") msgs.push({ icon: "📚", title: "STARTER STACK LOADED", sub: "Swipe through, drag a book up to read", tone: "pink" });
    if (e.type === "added") msgs.push({ icon: "📮", title: `ADDED TO ${SHELF[e.book.shelf].label}`, sub: `${e.book.title} · ${Q.added(state.name)}`, tone: "pink" });
    if (e.type === "moved") msgs.push({ icon: e.shelf === "reading" ? "📖" : e.shelf === "want" ? "🔖" : "✅", title: `MOVED TO ${SHELF[e.shelf].label}`, sub: e.book.title, tone: e.shelf === "want" ? "sun" : "cyan" });
    if (e.type === "milestone") {
      msgs.push({ icon: { 25: "🌒", 50: "🌓", 75: "🌔" }[e.pct], title: `${e.pct}% THROUGH`, sub: e.book.title, tone: "lime" });
      burst(at || deckEl, { count: 50 + e.pct / 2 });
    }
    if (e.type === "finished") {
      queuePoster({ kicker: "BOOK FINISHED", lines: ["DONE."], sub: `${e.book.title}. ${Q.finished(state.name)}`, tone: "#ffd60a", ink: "#0d0d0d", art: bookStamp({ ...e.book, shelf: "read", finished: new Date().toISOString() }), emoji: ["📚", "⭐", "🎉"], sounds: ["stamp", "fanfare"] });
      shockwave(at || deckEl, "#ffd60a");
      shake($("#stage"), 10);
    }
    if (e.type === "goal" && e.period === "day") queuePoster({ kicker: `${e.target} PAGES TODAY`, lines: ["GOAL", "SMASHED."], sub: "Daily goal done. Anything more is a bonus.", tone: "#ff5a1f", ink: "#0d0d0d", emoji: ["🎯", "🔥"], sounds: ["levelup"] });
    if (e.type === "goal" && e.period === "month") queuePoster({ kicker: `${e.target} ${e.target === 1 ? "BOOK" : "BOOKS"} IN ${MONTH()}`, lines: ["MONTH", "CRUSHED."], sub: "Monthly goal done. Look at you.", tone: "#ff6ad5", ink: "#0d0d0d", emoji: ["🗓️", "💥", "📚"], sounds: ["fanfare"] });
    if (e.type === "goal" && e.period === "year") queuePoster({ kicker: `${e.target} BOOKS IN ${new Date().getFullYear()}`, lines: ["YEAR", "GOAL.", "DONE."], sub: "You hit your reading goal for the whole year.", tone: "#25c7ff", ink: "#0d0d0d", emoji: ["👑", "🏆", "📚", "✨"], sounds: ["fanfare", "levelup"] });
    if (e.type === "streak") msgs.push({ icon: "🔥", title: `${e.days}-DAY STREAK`, sub: "Come back tomorrow to keep it", tone: "sun" });
    if (e.type === "level") queuePoster({ kicker: `NOW A ${e.title.toUpperCase()}`, lines: ["LEVEL", `${String(e.level).padStart(2, "0")}.`], sub: "Keep turning pages.", tone: "#2b3bff", ink: "#ffffff", emoji: ["🆙", "⚡"], sounds: ["levelup"] });
    if (e.type === "badge") {
      msgs.push({ icon: e.badge.emoji, title: `BADGE: ${e.badge.name.toUpperCase()}`, sub: e.badge.text, tone: "violet" });
      setTimeout(() => feel("sparkle", "success"), 400);
    }
    if (e.type === "egg" && e.fresh) msgs.push({ icon: "🥚", title: `EGG: ${e.label.toUpperCase()}`, sub: "New easter egg found", tone: "pink" });
  }
  if (!msgs.length && xp) {
    const p = S.pagesOn(state);
    msgs.push({ icon: "⚡", title: `${p}/${state.goal} PAGES TODAY`, sub: Q.pages(state.name, xp), tone: "lime", bar: Math.min(1, p / state.goal) });
  }
  if (msgs.length && xp) Object.assign(msgs[0], { value: xp, unit: " XP" });
  for (const m of msgs) island.say(m);
  if (events.some((e) => e.type === "milestone")) feel("levelup", "success");
}

/** "x3 COMBO" sticker that slaps onto the stage and fades. */
function showCombo(n) {
  sound("combo", n);
  haptic(n >= 5 ? "celebrate" : "success");
  const el = h("div", { class: `combo${n >= 5 ? " hot" : ""}`, "aria-hidden": "true" }, h("b", { text: `×${n}` }), h("small", { text: n >= 5 ? "ON FIRE" : "COMBO" }));
  if (n === 3 || n === 6) island.say({ icon: "⚡", title: Q.combo(state.name, n).toUpperCase(), tone: "lime", buzz: false });
  $("#stage").append(el);
  burst(el, { count: 10 + n * 6, emoji: n >= 5 ? ["🔥"] : null });
  const done = () => el.remove();
  if (prefersReducedMotion()) return setTimeout(done, 1200);
  el.animate([{ transform: "scale(3) rotate(-20deg)", opacity: 0 }, { transform: "scale(1) rotate(-8deg)", opacity: 1, offset: 0.25 }, { transform: "scale(1.06) rotate(-6deg)", opacity: 1, offset: 0.8 }, { transform: "scale(0.8) rotate(-8deg) translateY(-30px)", opacity: 0 }], { duration: 1500, easing: "cubic-bezier(.2,1.4,.4,1)" }).finished.then(done, done);
}

// Motion controls: tilt the phone and the scene moves; flicks, tips and bounces are gestures (js/gyro.js reads them).

import { h, $, buzz, prefersReducedMotion } from "../js/util.js";
import { feel, fx } from "../js/sfx.js";
import { popup } from "../js/modal.js";
import { tip } from "../js/tips.js";
import { createGyro, motionSupported, askMotion } from "../js/gyro.js";
import { add, openAdd, row } from "./adding.js";
import { book, deck, deckEl, island, opensSoFar, ORDER, SHELF, shelf, switchShelf } from "./boot.js";
import { posterUp } from "./celebrate.js";
import { fairy, start } from "./dock.js";
import { imp } from "./import.js";
import { popping, touring } from "./onboarding.js";
import { mePanel, refreshMe, stats } from "./stats.js";

/* ---------------- motion controls ---------------- */

const stageBg = $(".stage-bg");
/**
 * The tilt of the phone, -1..1 each way: the pile drifts, the room shifts the other way, the bulbs
 * swing and the light on the cover slides. All of it is transforms on elements that already have
 * their own layer, so the GPU just moves pictures about; nothing is re-laid out or repainted.
 */
function applyTilt(x, y) {
  // The pile leans in 3D about an axis at right angles to the tilt, and drifts a little with it.
  const mag = Math.hypot(x, y);
  deckEl.style.translate = `${(x * 10).toFixed(1)}px ${(y * 6).toFixed(1)}px`;
  deckEl.style.rotate = mag > 0.01 ? `${(-y).toFixed(3)} ${x.toFixed(3)} 0 ${(mag * 9).toFixed(2)}deg` : "";
  stageBg.style.translate = `${(-x * 16).toFixed(1)}px ${(-y * 10).toFixed(1)}px`;
  fairy.style.rotate = `${(x * 2.5).toFixed(2)}deg`;
  const spot = deck.top?.el.querySelector(".hotspot");
  if (spot) spot.style.transform = `translate(${(x * 45).toFixed(1)}%, ${(y * 40).toFixed(1)}%)`;
  swingTo(-x * 14);
}

/**
 * The bulbs hang like pendulums: they swing towards where "down" went, overshoot a little and
 * settle. A small spring, stepped by real time, written only while it moves (one custom property
 * per string of bulbs; the rotation itself is composited).
 */
const bulb = { a: 0, v: 0, to: 0, raf: 0, last: 0, shown: 0 };
function swingTo(deg) {
  bulb.to = deg;
  if (!bulb.raf) {
    bulb.last = 0;
    bulb.raf = requestAnimationFrame(swing);
  }
}
function swing(now) {
  const dt = bulb.last ? Math.min(now - bulb.last, 48) / 1000 : 1 / 60;
  bulb.last = now;
  // Spring towards the target: ~1.1 s period, lightly damped (a bulb on a cord).
  bulb.v += ((bulb.to - bulb.a) * 32 - bulb.v * 4.5) * dt;
  bulb.a += bulb.v * dt;
  if (Math.abs(bulb.a - bulb.shown) >= 0.05) {
    bulb.shown = bulb.a;
    const val = `${bulb.a.toFixed(2)}deg`;
    for (const e of document.querySelectorAll(".edison")) e.style.setProperty("--swing", val);
  }
  if (Math.abs(bulb.to - bulb.a) < 0.05 && Math.abs(bulb.v) < 0.05) bulb.raf = 0;
  else bulb.raf = requestAnimationFrame(swing);
}

const motionUsed = new Set();
/** A gesture made with the whole phone. */
function motionGesture(name) {
  const say = (icon, title) => {
    // The first couple of times, say what just happened.
    const n = (motionUsed.has(name) ? 1 : 0) + Number(localStorage.getItem(`shelfie.mo.${name}`) || 0);
    motionUsed.add(name);
    if (n < 2) {
      island.say({ icon, title, tone: "lime", buzz: false });
      try {
        localStorage.setItem(`shelfie.mo.${name}`, String(n + 1));
      } catch {}
    }
  };
  if (name === "next" || name === "prev") {
    // Flick right: the top pass flies off to the right, uncovering the next one.
    if (!deck.toss(name === "next" ? 1 : -1)) return feel("error", "warning");
    feel("swoosh", "medium");
    say("📳", name === "next" ? "FLICK! NEXT BOOK" : "FLICK! BACK ONE");
  } else if (name === "shelfNext" || name === "shelfPrev") {
    const k = ORDER.indexOf(shelf);
    const to = ORDER[(k + (name === "shelfNext" ? 1 : ORDER.length - 1)) % ORDER.length];
    switchShelf(to);
    say("🎡", `TIP! ${SHELF[to].label}`);
  } else if (name === "add") {
    feel("pop", "success");
    openAdd();
    say("🚀", "BOUNCE! ADD A BOOK");
  }
}

export const gyro = createGyro({
  onTilt: applyTilt,
  onGesture: motionGesture,
  tilt: () => !prefersReducedMotion(),
  canGesture: () =>
    document.visibilityState === "visible" && !deck.dragging && !touring() && !popping() && !stats.isOpen && !add.isOpen && !imp.isOpen && !mePanel.isOpen && !posterUp && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || ""),
});

/** Turn motion on. Must run inside a tap (iPhone asks permission). */
async function enableMotion() {
  const ok = await askMotion();
  if (!ok) throw new Error("Motion was blocked. On iPhone: Settings → Apps → Safari → Motion & Orientation Access, then try again.");
  fx.set("motion", true);
  gyro.start();
  feel("levelup", "success");
  return true;
}

/** The guide: the moves, drawn as little animated phones. */
function motionGuide() {
  const move = (cls, title, text) => h("div", { class: "mo-row" }, h("span", { class: `mo-phone ${cls}`, "aria-hidden": "true" }, h("i")), h("span", {}, h("b", { text: title }), h("small", { text })));
  return h(
    "div",
    { class: "mo-guide" },
    move("flick", "FLICK SIDEWAYS", "Snap the phone to the right and straight back (turn it, or twist it like a dial): next book. Left: back one."),
    move("tipping", "TIP", "Snap the top edge away from you and back: next shelf. Towards you: the shelf before."),
    move("lift", "BOUNCE", "A quick bounce up and down, like tapping the phone on an invisible table: add a book."),
    move("tilt", "TILT", "Just tilt: the pile leans, the lights swing, the cover catches the light."),
  );
}

export async function motionInvite({ fromSettings = false } = {}) {
  try {
    localStorage.setItem("shelfie.motionAsked", "1");
  } catch {}
  const res = await popup({
    tone: "lime",
    icon: "📳",
    title: fromSettings ? "MOTION CONTROLS" : "NEW: MOVE YOUR PHONE",
    text: "Shelfie can feel your phone move. Nothing about it is stored or sent anywhere.",
    body: motionGuide(),
    actions: [
      { id: "later", label: fromSettings ? "CANCEL" : "NOT NOW", cancel: true },
      { id: "on", label: "TURN IT ON", primary: true, busy: "ASKING…" },
    ],
    submit: () => enableMotion(),
  });
  if (res === "on" || res?.id === "on") island.say({ icon: "📳", title: "MOTION ON", sub: "Flick, tip, bounce, tilt", tone: "lime" });
  refreshMe();
}

/** At start-up: pick up where you left off, or (once, on a later visit) offer motion controls. */
export function startMotion() {
  if (!motionSupported()) return;
  if (fx.motion) wakeMotion();
  else if (opensSoFar >= 1 && !localStorage.getItem("shelfie.motionAsked")) {
    // Once, on a later visit: show it off.
    setTimeout(() => {
      if (touring() || popping() || stats.isOpen || add.isOpen || imp.isOpen || mePanel.isOpen || posterUp || document.querySelector(".tip")) return;
      motionInvite();
    }, 9000);
  }
}

/**
 * Motion is on: get the sensors talking. Where permission carried over (Android, or iPhone
 * within the same session) readings just arrive. Otherwise iPhone needs the permission asked
 * again, and only straight after a real tap: "click" or "touchend" (it ignores finger-down). So
 * if nothing arrives, the next tap asks, and so does every tap after it until it works. The same
 * check runs each time you come back to the app.
 */
let waking = false;
function wakeMotion() {
  if (!fx.motion) return;
  gyro.start();
  setTimeout(() => {
    if (!fx.motion || gyro.alive || waking) return;
    waking = true;
    const ask = async () => {
      if (gyro.alive || !fx.motion) return done();
      if (await askMotion()) {
        gyro.stop();
        gyro.start(); // (fresh listeners, now that they're allowed)
        done();
      }
    };
    const done = () => {
      waking = false;
      removeEventListener("click", ask, true);
      removeEventListener("touchend", ask, true);
    };
    addEventListener("click", ask, true);
    addEventListener("touchend", ask, true);
  }, 1000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && fx.motion && motionSupported()) wakeMotion();
});

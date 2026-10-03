// Secrets: the LCD's party mode and the Konami code.

import { $ } from "../js/util.js";
import * as S from "../js/store.js";
import { rain } from "../js/confetti.js";
import { state } from "./state.js";
import { add } from "./adding.js";
import { commit } from "./celebrate.js";
import { start } from "./dock.js";
import { imp } from "./import.js";
import { mePanel, stats } from "./stats.js";

let lcdTapTimes = [];
export function lcdTaps() {
  const now = Date.now();
  lcdTapTimes = lcdTapTimes.filter((t) => now - t < 1600).concat(now);
  if (lcdTapTimes.length < 5) return false;
  lcdTapTimes = [];
  document.body.classList.add("party");
  setTimeout(() => document.body.classList.remove("party"), 4000);
  rain({ count: 220, emoji: ["📚", "🪩", "✨", "🦄"] });
  const r = S.findEgg(state, "app", "party");
  r.events.forEach((e) => e.type === "egg" && (e.label = "Party mode"));
  commit(r, $("#lcd"));
  return true;
}

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** The keyboard: Escape closes whatever is up, and the Konami code. Called once at start-up. */
export function listenForKeys() {
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".pop, .tour")) return;
    if (add.isOpen) add.close();
    else if (imp.isOpen) imp.close();
    else if (mePanel.isOpen) mePanel.close();
    else if (stats.isOpen) stats.close();
  });

  let kIdx = 0;
  addEventListener("keydown", (e) => {
    kIdx = e.key === KONAMI[kIdx] ? kIdx + 1 : e.key === KONAMI[0] ? 1 : 0;
    if (kIdx < KONAMI.length) return;
    kIdx = 0;
    const r = S.findEgg(state, "app", "konami");
    r.events.forEach((e) => e.type === "egg" && (e.label = "Cheat code"));
    commit(r, $("#lcd"));
    rain({ count: 160, emoji: ["🎮", "👾", "🕹️"] });
  });
}

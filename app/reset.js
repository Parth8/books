// Reset: pull the lever, type 'reset', and everything (or just this device) is wiped.

import { h, $, buzz } from "../js/util.js";
import * as S from "../js/store.js";
import { rain } from "../js/confetti.js";
import { sound, haptic, feel } from "../js/sfx.js";
import { popup } from "../js/modal.js";
import { account, setState, state } from "./state.js";
import { sync } from "./backup.js";
import { book, island } from "./boot.js";
import { TOUR, toured } from "./onboarding.js";
import { mePanel, stats } from "./stats.js";

/* ---------------- reset ---------------- */

export async function resetFlow() {
  // The lever was the "are you sure?". With a backup, say what to reset; then type to confirm.
  const cloud = account?.on ? "account" : sync.on ? "sync" : null;
  let scope = "phone";
  if (cloud) {
    scope = await popup({
      tone: "orange",
      icon: "🧨",
      title: "RESET WHAT?",
      text: cloud === "account" ? `Your books are on this phone and backed up to your account (${account.user}).` : "Your books are on this phone and synced to your other devices with a code.",
      actions: [
        { id: "cancel", label: "CANCEL", cancel: true },
        { id: "phone", label: "JUST THIS PHONE" },
        { id: "all", label: cloud === "account" ? "PHONE + BACKUP" : "EVERY DEVICE", primary: true },
      ],
    });
    if (scope !== "phone" && scope !== "all") return;
  }
  const what =
    scope === "all"
      ? cloud === "account"
        ? "Every book, page, goal, XP, badge and sticker, on this phone and in your account backup. Your other devices empty too when they next sync. You stay logged in."
        : "Every book, page, goal, XP, badge and sticker, here and on every device linked with your sync code."
      : cloud === "account"
        ? "Everything on this phone, and you'll be logged out here. Your account backup stays: log in again any time to bring it back."
        : cloud === "sync"
          ? "Everything on this phone, and sync is switched off here. Your other devices keep their copy."
          : "Every book, page, goal, XP, badge and sticker on this phone. There's no backup, so it can't come back.";
  const res = await popup({
    tone: "danger",
    danger: true,
    icon: "⚠",
    title: "THIS CAN'T BE UNDONE",
    body: h(
      "div",
      { class: "danger-body" },
      h("p", { class: "danger-text", text: `Once it's deleted, it's gone for good. ${what}` }),
      h("p", { class: "pop-text" }, "To reset, type ", h("b", { class: "danger-word", text: "reset" }), " below."),
    ),
    input: { placeholder: "type reset", max: 12, label: "Type reset to confirm", match: (v) => v.trim().toLowerCase() === "reset" },
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "reset", label: "DELETE IT", primary: true, danger: true },
    ],
    sound: "error",
  });
  if (res.id !== "reset") return;
  mePanel.close();
  stats.close();
  if (scope === "all") {
    // Mark the reset and send it up before anything else, so every copy empties.
    setState({ ...S.reset(), toured: true, name: state.name, nameAt: state.nameAt });
    try {
      localStorage.setItem(S.KEY, JSON.stringify(state));
    } catch {}
    island.say({ icon: "🧹", title: "RESETTING EVERYWHERE…", tone: "violet", buzz: false });
    await (cloud === "account" ? account.now() : sync.now()).catch(() => {});
    return wipeDevice({ reset: true, keepLink: true });
  }
  if (account?.on) await account.logout().catch(() => {});
  wipeDevice({ reset: true });
}

/**
 * Gone: this device's shelves, sync link, tour and tips. Sound/haptic preferences stay.
 * A reset (`reset: true`) also marks the moment, so an older copy synced from elsewhere can't
 * bring the books back. Clearing after logging out doesn't: logging in again brings them back.
 */
export function wipeDevice({ reset = false, keepLink = false } = {}) {
  if (!keepLink) sync.disable();
  try {
    // You already know the gestures, so the tour stays seen; the name and import offer come back.
    const keep = new Set(["shelfie.fx", TOUR, ...(keepLink ? ["shelfie.sync"] : [])]);
    for (const k of Object.keys(localStorage)) if (k === S.KEY || k.startsWith(`${S.KEY}.`) || (k.startsWith("shelfie.") && !keep.has(k))) localStorage.removeItem(k);
    // Reset everywhere: the reset state already went up; keep exactly that one.
    // You still know your way around: the tour and tips you've seen stay seen.
    const next = keepLink ? state : { ...(reset ? S.reset() : S.empty()), toured: true, guide: state.guide };
    localStorage.setItem(S.KEY, JSON.stringify(next));
    sessionStorage.setItem("shelfie.fresh", "1");
  } catch {}
  stats.close();
  feel("drop", "error");
  // A light sweep (not a heavy shake of the whole page), then a fresh start.
  rain({ count: 50, emoji: ["💨", "🧹"] });
  setTimeout(() => location.reload(), 1100);
}

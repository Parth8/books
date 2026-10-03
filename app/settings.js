// The ME panel: your profile (name and animal), keeping your books safe, settings and the danger zone.

import { h, $, fmt, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { sound, feel, fx } from "../js/sfx.js";
import { popup } from "../js/modal.js";
import { tip } from "../js/tips.js";
import { CRITTERS } from "../js/critters.js";
import { canInstall, showInstall, chaiCard } from "../js/home.js";
import { createLever } from "../js/lever.js";
import { motionSupported } from "../js/gyro.js";
import { account, setState, state, syncRef } from "./state.js";
import { accountsUp, accountTile, deleteFlow, showRecovery } from "./accounts.js";
import { add, added, row } from "./adding.js";
import { ago, sync, syncTile } from "./backup.js";
import { book, island, renderHud, renderShelf, shelf } from "./boot.js";
import { backupSoon, commit } from "./celebrate.js";
import { screen } from "./dock.js";
import { fill, openImport } from "./import.js";
import { gyro, motionInvite } from "./motion.js";
import { askName, helpFlow } from "./onboarding.js";
import { live } from "./reading.js";
import { resetFlow } from "./reset.js";
import { markStatsDirty, mePanel, refreshMe } from "./stats.js";

/* ---------------- the ME panel ---------------- */

/** One tappable row: an icon, what it does, and a line saying what happens. */
function meRow(icon, title, text, onClick, { aria, tone = "", extra = null } = {}) {
  const b = h("button", { type: "button", class: `me-row${tone ? ` tone-${tone}` : ""}`, "aria-label": aria || title }, h("span", { class: "me-row-icon", "aria-hidden": "true", text: icon }), h("span", { class: "me-row-text" }, h("b", { text: title }), h("small", { text })), h("span", { class: "me-row-go", "aria-hidden": "true", text: "›" }), extra);
  b.addEventListener("click", (e) => {
    feel("click", "light");
    onClick(e);
  });
  return b;
}

/** A switch row for a preference. */
function switchRow(icon, title, text, pref) {
  const sw = h("span", { class: `switch${fx[pref] ? " on" : ""}`, "aria-hidden": "true" }, h("i"));
  const b = h("button", { type: "button", class: "me-row", role: "switch", "aria-checked": String(fx[pref]), "aria-label": title }, h("span", { class: "me-row-icon", "aria-hidden": "true", text: icon }), h("span", { class: "me-row-text" }, h("b", { text: title }), h("small", { text })), sw);
  b.addEventListener("click", () => {
    fx.set(pref, !fx[pref]);
    sw.classList.toggle("on", fx[pref]);
    b.setAttribute("aria-checked", String(fx[pref]));
    feel(fx[pref] ? "snap" : "click", "select");
  });
  return b;
}

/** Motion controls: switching on asks permission (in the tap), and shows the moves. */
function motionRow() {
  const sw = h("span", { class: `switch${fx.motion ? " on" : ""}`, "aria-hidden": "true" }, h("i"));
  const b = h("button", { type: "button", class: "me-row", role: "switch", "aria-checked": String(fx.motion), "aria-label": "MOTION CONTROLS" }, h("span", { class: "me-row-icon", "aria-hidden": "true", text: "📳" }), h("span", { class: "me-row-text" }, h("b", { text: "MOTION CONTROLS" }), h("small", { text: "Turn the phone sideways and back for the next book, twist for the next shelf, bounce it to add. Tilt to play with the light." })), sw);
  b.addEventListener("click", () => {
    if (fx.motion) {
      fx.set("motion", false);
      gyro.stop();
      sw.classList.remove("on");
      b.setAttribute("aria-checked", "false");
      feel("click", "select");
      return;
    }
    motionInvite({ fromSettings: true });
  });
  return b;
}

/** Where your books are, in two plain lines. */
export function safeStrip() {
  const n = state.books.length;
  const cloud = account?.on
    ? account.status.state === "error"
      ? ["⚠️", "BACKUP NEEDS ATTENTION", account.status.error, "warn"]
      : ["☁️", "BACKED UP TO YOUR ACCOUNT", account.status.state === "syncing" ? "Saving…" : `Encrypted · ${ago(account.status.at).toLowerCase()}`, "ok"]
    : sync.on
      ? ["🔗", "SYNCED WITH A CODE", `Encrypted · ${ago(sync.status.at).toLowerCase()}`, "ok"]
      : ["☁️", "NOT BACKED UP YET", "If this phone is lost or cleared, so are your books.", "warn"];
  const line = (icon, title, text, cls) => h("div", { class: `safe-line ${cls}` }, h("span", { class: "safe-dot", "aria-hidden": "true" }), h("span", { class: "safe-icon", "aria-hidden": "true", text: icon }), h("span", {}, h("b", { text: title }), h("small", { text })));
  return h("div", { class: "safe-strip", id: "safe-strip" }, line("📱", "ON THIS PHONE", `${fmt(n)} book${n === 1 ? "" : "s"} · always here, works offline`, "ok"), line(...cloud));
}

export function renderMe() {
  const lp = S.levelProgress(state.xp);
  $("#me-title").textContent = state.name ? state.name.toUpperCase().slice(0, 14) : "YOU";
  const restore = h("input", { type: "file", accept: "application/json,.json", hidden: true, on: { change: importData } });
  fill(
    $("#me-body"),
    avatarPicker(),
    h(
      "div",
      { class: "me-id" },
      h("b", { class: "me-name", text: state.name || "Anonymous reader" }),
      h("span", { class: "me-handle", id: "me-handle" }, handleText()),
      h("small", { text: `LV${String(lp.level).padStart(2, "0")} · ${lp.title.toUpperCase()}` }),
      h(
        "div",
        { class: "me-id-links" },
        h("button", { type: "button", class: "link-btn", text: state.name ? "CHANGE NAME" : "ADD YOUR NAME", on: { click: () => askName({ edit: true }).then(refreshMe) } }),
        account?.on ? h("button", { type: "button", class: "link-btn", text: "CHANGE USERNAME", on: { click: () => renameFlow() } }) : null,
      ),
    ),

    h("h3", { class: "p-h", text: "YOUR BOOKS ARE SAFE" }),
    safeSection(),

    h("h3", { class: "p-h", text: "LIBRARY" }),
    h(
      "div",
      { class: "me-rows" },
      meRow("🧳", "IMPORT FROM GOODREADS", "Your whole library: read (with dates and ratings), reading, want to read.", () => {
        mePanel.close();
        setTimeout(openImport, 300);
      }),
      meRow("💾", "SAVE A COPY", "Download a file with everything. Handy for safekeeping; no account needed.", exportData, { aria: "Save a copy of your shelves to a file" }),
      meRow("📂", "RESTORE A COPY", "Pick a saved file. Its books are added; nothing here is deleted.", () => restore.click(), { aria: "Restore shelves from a file", extra: restore }),
    ),

    h("h3", { class: "p-h", text: "SETTINGS" }),
    h(
      "div",
      { class: "me-rows" },
      switchRow("🔊", "SOUND", "Clicks, pops and fanfares. Follows the iPhone silent switch.", "sound"),
      switchRow("📳", "HAPTICS", "Little taps you can feel.", "haptics"),
      switchRow("🦙", "VISITORS", "Animals that wander by now and then.", "visitors"),
      motionSupported() ? motionRow() : null,
      meRow("?", "HOW TO USE", "Replay the tour, or bring the explainer pop-ups back.", () => {
        mePanel.close();
        setTimeout(helpFlow, 320);
      }),
      canInstall() ? meRow("📲", "ADD TO HOME SCREEN", "Opens full-screen like an app. Two taps.", () => showInstall({ name: state.name }), { aria: "Add Shelfie to your home screen" }) : null,
    ),

    h("h3", { class: "p-h danger", text: "DANGER ZONE" }),
    leversSection(),
    chaiCard(state.name),
  );
}

export function safeSection() {
  return h(
    "div",
    { id: "me-safe" },
    safeStrip(),
    accountTile(),
    // Sync codes: for anyone already using one, or while accounts aren't available.
    account?.on ? null : sync.on || accountsUp !== true ? syncTile() : null,
  );
}

export function leversSection() {
  return h(
    "div",
    { class: "levers", id: "me-levers" },
    createLever({ label: "RESET", sub: "WIPE BOOKS, PAGES, XP", onPull: () => resetFlow() }),
    account?.on ? createLever({ label: "DELETE ACCOUNT", sub: "AND ITS BACKUP", tone: "violet", onPull: () => deleteFlow() }) : null,
  );
}

/** The face on the avatar button: your animal, or your initial, or a stand-in. */
function faceOf() {
  const animal = CRITTERS.find((c) => c.id === state.avatar);
  if (animal) return animal.e;
  const c = [...(state.name || "")][0];
  return c ? c.toUpperCase() : "👤";
}

/** "@username" when you're logged in. */
export function handleText() {
  return account?.on ? `@${account.user}` : "NOT LOGGED IN";
}

/**
 * Your profile animal: a carousel of the visitors. Slide through them (or use the arrows);
 * whichever lands in the middle says hello in its own voice, and becomes you.
 */
function avatarPicker() {
  const options = [{ id: "", e: [...(state.name || "")][0]?.toUpperCase() || "👤", name: state.name ? "YOUR INITIAL" : "NO ANIMAL" }, ...CRITTERS.map((c) => ({ ...c, name: c.id.toUpperCase() }))];
  const label = h("small", { class: "ava-name", "aria-live": "polite" });
  const items = options.map((o, i) => h("button", { type: "button", class: `ava${o.id === state.avatar ? " on" : ""}`, "aria-label": `Be the ${o.id || "plain"} avatar`, "data-i": String(i) }, h("span", { text: o.e })));
  const strip = h("div", { class: "ava-strip", role: "listbox", "aria-label": "Choose your animal" }, items);
  let current = Math.max(0, options.findIndex((o) => o.id === (state.avatar || "")));
  label.textContent = options[current].name;

  // While sliding, the one in the middle grows (just a scale on a dozen small items).
  const lens = () => {
    const mid = strip.scrollLeft + strip.clientWidth / 2;
    for (const it of items) {
      const d = Math.min(1, Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid) / 140);
      it.style.transform = `scale(${(1.25 - d * 0.55).toFixed(3)})`;
      it.style.opacity = String((1 - d * 0.55).toFixed(2));
    }
  };
  const nearest = () => {
    const mid = strip.scrollLeft + strip.clientWidth / 2;
    let best = 0;
    items.forEach((it, i) => {
      if (Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid) < Math.abs(items[best].offsetLeft + items[best].offsetWidth / 2 - mid)) best = i;
    });
    return best;
  };
  const choose = (i) => {
    if (i === current) return;
    current = i;
    const o = options[i];
    label.textContent = o.name;
    items.forEach((it, j) => it.classList.toggle("on", j === i));
    commit(S.setAvatar(state, o.id), null, { keepStats: true });
    renderFace();
    feel(o.sound || "pop", "select");
    if (!prefersReducedMotion()) items[i].firstChild.animate([{ transform: "none" }, { transform: "translateY(-14px) rotate(-8deg)" }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.3,1.6,.5,1)" });
  };
  const go = (i, smooth = true) => {
    const it = items[Math.max(0, Math.min(items.length - 1, i))];
    strip.scrollTo({ left: it.offsetLeft + it.offsetWidth / 2 - strip.clientWidth / 2, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  };
  let settleTimer = 0;
  strip.addEventListener("scroll", () => {
    requestAnimationFrame(lens);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => choose(nearest()), 140);
  }, { passive: true });
  items.forEach((it, i) => it.addEventListener("click", () => (i === current ? feel(options[i].sound || "pop", "select") : go(i))));
  strip.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") (e.preventDefault(), go(current + 1));
    if (e.key === "ArrowLeft") (e.preventDefault(), go(current - 1));
  });
  // Start centred on your animal (once it's on the page).
  requestAnimationFrame(() => {
    go(current, false);
    lens();
  });
  const arrow = (dir) => h("button", { type: "button", class: `ava-arrow ${dir < 0 ? "prev" : "next"}`, "aria-label": dir < 0 ? "Previous animal" : "Next animal", text: dir < 0 ? "‹" : "›", on: { click: () => go(current + dir) } });
  return h("div", { class: "ava-picker" }, arrow(-1), strip, arrow(1), label);
}

export async function renameFlow() {
  const res = await popup({
    tone: "cyan",
    icon: "🏷️",
    title: "NEW USERNAME",
    text: `You log in as @${account.user}. Pick a new username (or use an email). Your books, backup and password stay the same.`,
    fields: [
      { name: "login", placeholder: "New username or email", autocomplete: "username", label: "New username or email", max: 254, inputmode: "email" },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "CHANGE IT", primary: true, busy: "CHANGING…" },
    ],
    submit: (v) => account.rename(v.login, v.password),
  });
  if (res.id !== "go") return;
  feel("levelup", "success");
  island.say({ icon: "🏷️", title: `YOU'RE @${account.user.toUpperCase().slice(0, 16)}`, sub: "Log in with this from now on", tone: "lime" });
  refreshMe();
}
export function renderFace() {
  const f = faceOf();
  if ($("#me-face").textContent !== f) $("#me-face").textContent = f;
  // A small badge on the avatar while a real library has no backup.
  $("#me").classList.toggle("warn", !account?.on && !syncRef?.on && state.books.length >= 5);
}

export async function newRecoveryFlow() {
  const res = await popup({
    tone: "yellow",
    icon: "🛟",
    title: "NEW RECOVERY CODE",
    text: "Lost your recovery code? Make a new one. The old one stops working. Enter your password to confirm.",
    fields: [
      { name: "user", type: "text", value: account.user, autocomplete: "username", label: "Username", max: 254 },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "MAKE ONE", primary: true, busy: "MAKING…" },
    ],
    submit: (v) => account.newRecovery(v.password),
  });
  if (res.id !== "go") return;
  await showRecovery(res.result);
  island.say({ icon: "🛟", title: "NEW CODE SAVED", sub: "The old one no longer works", tone: "lime" });
}

export function notReady() {
  popup({ tone: "cream", icon: "🚧", title: "ACCOUNTS ARE COMING", text: "Accounts aren't switched on yet (or the server can't be reached right now). Your shelves are safe on this device; a sync code works in the meantime." });
}


function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `shelfie-${S.dayKey()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const copy = S.load({ getItem: () => text });
    if (!copy.books.length && !copy.xp) throw new Error("empty");
    const before = state.books.length;
    setState(S.restore(state, copy));
    try {
      localStorage.setItem(S.KEY, JSON.stringify(state)); // as is: no merge with an older reset on disk
    } catch {}
    markStatsDirty();
    renderShelf({ deal: 1 });
    renderHud();
    refreshMe();
    backupSoon();
    feel("fanfare", "success");
    island.say({ icon: "✅", title: "COPY RESTORED", sub: `${fmt(state.books.length - before)} books added · ${fmt(state.books.length)} in all`, tone: "lime" });
  } catch {
    island.say({ icon: "🤔", title: "THAT FILE DIDN'T WORK", sub: "Pick a Shelfie copy (.json)", tone: "pink" });
  }
  e.target.value = "";
}

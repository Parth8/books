// Accounts: sign up, log in, recovery codes and deleting it all. The vault is end-to-end encrypted (js/account.js).

import { h, $ } from "../js/util.js";
import * as S from "../js/store.js";
import { rain, shake } from "../js/confetti.js";
import { sound, feel } from "../js/sfx.js";
import { createAccount, passwordProblem, strength, cleanLogin } from "../js/account.js";
import { popup } from "../js/modal.js";
import { account, setAccount, setState, state } from "./state.js";
import { apiBase } from "./api.js";
import { ago, applyIncoming, sync } from "./backup.js";
import { island } from "./boot.js";
import { celebrate } from "./celebrate.js";
import { bar, key, screen } from "./dock.js";
import { wipeDevice } from "./reset.js";
import { newRecoveryFlow, notReady, renameFlow, safeStrip } from "./settings.js";
import { mePanel, refreshMe } from "./stats.js";

/* ---------------- accounts ---------------- */

// null until we've asked the Worker; then true or false.
export let accountsUp = null;
export async function checkAccounts() {
  if (accountsUp !== null || !apiBase) return accountsUp;
  try {
    const r = await fetch(`${apiBase}/api/health`, { credentials: "omit", cache: "no-store" });
    accountsUp = !!(await r.json())?.accounts;
  } catch {
    return null; // try again next time
  }
  refreshMe();
  return accountsUp;
}

setAccount(createAccount({
  base: apiBase,
  get: () => state,
  put: (next) => applyIncoming(next),
  merge: S.merge,
  onStatus: () => {
    renderAccountTile();
    $("#lcd").classList.toggle("synced", (account?.on && account.status.state === "idle") || (sync.on && sync.status.state === "idle"));
  },
  onSignedOut: () => island.say({ icon: "🔒", title: "LOGGED OUT", sub: "Your session ended. Log in again to keep backing up.", tone: "violet" }),
  // A device that was reset remembers when, so an older synced copy can't undo the reset. But
  // logging in means "bring my account's books here": forget the marker first, or the merge
  // would empty the account. Books added since the reset are kept.
  onJoin: () => {
    if (!state.resetAt) return;
    setState({ ...state, resetAt: 0 });
    try {
      localStorage.setItem(S.KEY, JSON.stringify(state));
    } catch {}
  },
}));

function renderAccountTile() {
  if (mePanel.isOpen) {
    $("#account-tile")?.replaceWith(accountTile());
    $("#safe-strip")?.replaceWith(safeStrip());
  }
}

export function accountTile() {
  const st = account.status;
  if (accountsUp === false && !account.on) return null;
  const body = [];
  if (!account.on) {
    body.push(
      h("p", { class: "sync-text", text: "Back up your shelves and open them on any device: phone, laptop, the home-screen app. Encrypted on this device with your password, so not even Shelfie can read your books, and your password never leaves your phone." }),
      h(
        "div",
        { class: "keys two" },
        key("SIGN UP", "k-lime wide", () => signupFlow(), { sub: "FREE, NO EMAIL NEEDED", aria: "Create an account" }),
        key("🔐", "k-cream", () => loginFlow(), { sub: "LOG IN", aria: "Log in" }),
      ),
      h("button", { type: "button", class: "link-btn", text: "FORGOT YOUR PASSWORD?", on: { click: () => recoverFlow() } }),
    );
  } else {
    const line = st.state === "syncing" ? "BACKING UP…" : st.state === "error" ? `⚠ ${st.error}`.toUpperCase() : `BACKED UP ${ago(st.at)}`;
    body.push(
      h("p", { class: "acct-who" }, h("span", { text: "👤" }), h("b", { text: account.user })),
      h("p", { class: "sync-status" + (st.state === "error" ? " warn" : ""), text: line }),
      h(
        "div",
        { class: "keys three" },
        key("↻", "k-blue", () => account.now(), { sub: "SYNC NOW", aria: "Back up now" }),
        key("🔑", "k-cream", () => passwordFlow(), { sub: "PASSWORD", aria: "Change password" }),
        key("⏻", "k-cream", () => logoutFlow(), { sub: "LOG OUT", aria: "Log out" }),
      ),
      h(
        "div",
        { class: "acct-more" },
        h("button", { type: "button", class: "link-btn", text: "NEW RECOVERY CODE", on: { click: () => newRecoveryFlow() } }),
        h("button", { type: "button", class: "link-btn", text: "CHANGE USERNAME", on: { click: () => renameFlow() } }),
        h("button", { type: "button", class: "link-btn", text: "LOG OUT EVERYWHERE", on: { click: () => logoutFlow({ all: true }) } }),
      ),
    );
  }
  return h("div", { class: `tile t-account span2${account.on ? " on" : ""}`, id: "account-tile" }, h("small", { text: account.on ? "🔒 YOUR ACCOUNT · END-TO-END ENCRYPTED" : "🔒 ACCOUNT · END-TO-END ENCRYPTED" }), ...body);
}

/** The strength bar under a new password. */
function meter() {
  const el = h("div", { class: "pw-meter", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("small", { text: "" }));
  const words = ["TOO WEAK", "WEAK", "OKAY", "GOOD", "STRONG"];
  el.update = (pw) => {
    const n = pw ? strength(pw) : -1;
    el.dataset.n = String(n);
    el.querySelector("small").textContent = n < 0 ? "10+ CHARACTERS. A FEW RANDOM WORDS WORK GREAT." : words[n];
  };
  el.update("");
  return el;
}

const LOGIN_FIELD = { name: "login", placeholder: "Username or email", autocomplete: "username", label: "Username or email", max: 254, inputmode: "email" };

export async function signupFlow() {
  if (!(await checkAccounts())) return notReady();
  const m = meter();
  const res = await popup({
    tone: "lime",
    icon: "🔐",
    title: "MAKE AN ACCOUNT",
    text: "Pick a username (or use your email; we never send you anything). Your password locks your shelves on this device before anything is backed up.",
    after: m,
    fields: [LOGIN_FIELD, { name: "password", type: "password", placeholder: "Password", autocomplete: "new-password", label: "New password" }, { name: "again", type: "password", placeholder: "Password again", autocomplete: "new-password", label: "Password again", enter: "done" }],
    onInput: (v) => m.update(v.password),
    actions: [
      { id: "cancel", label: "NOT NOW", cancel: true },
      { id: "go", label: "CREATE", primary: true, busy: "LOCKING…" },
    ],
    submit: async (v) => {
      const login = cleanLogin(v.login);
      if (!login) throw new Error("Use a username (3 to 32 letters, numbers, dots, dashes or underscores) or an email address.");
      const problem = passwordProblem(v.password, login);
      if (problem) throw new Error(problem);
      if (v.password !== v.again) throw new Error("The two passwords don't match.");
      return account.signup(login, v.password);
    },
  });
  if (res.id !== "go") return;
  if (sync.on) sync.disable(); // the account takes over from the sync code
  feel("levelup", "success");
  rain({ count: 120, emoji: ["🔐", "📚", "✨"] });
  await showRecovery(res.result);
  island.say({ icon: "🔐", title: "ACCOUNT MADE", sub: `${state.books.length} books backed up, encrypted`, tone: "lime" });
  refreshMe();
}

/** The recovery code, once. Confirmed by typing its last four characters. */
export async function showRecovery(code) {
  const last = code.slice(-4);
  const copy = h("button", { type: "button", class: "install-go quiet", text: "⧉ COPY" });
  const save = h("button", { type: "button", class: "install-go quiet", text: "💾 SAVE AS FILE" });
  save.addEventListener("click", () => {
    const blob = new Blob([`Shelfie recovery code for ${account?.user || "your account"}\n\n${code}\n\nKeep it somewhere safe. With your username, it sets a new password if you forget yours.\n`], { type: "text/plain" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "shelfie-recovery-code.txt" });
    document.body.append(a);
    a.click();
    a.remove();
    save.textContent = "SAVED ✓";
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "COPIED ✓ NOW PASTE IT SOMEWHERE SAFE";
    } catch {
      copy.textContent = "WRITE IT DOWN INSTEAD";
    }
  });
  await popup({
    tone: "yellow",
    icon: "🛟",
    title: "YOUR RECOVERY CODE",
    body: h(
      "div",
      { class: "danger-body" },
      h("p", { class: "pop-text", text: "If you ever forget your password, this code is the only way back in. We can't reset it for you: we can't read your account, that's the point." }),
      h("p", { class: "recovery-code", text: code }),
      h("div", { class: "install-actions two" }, copy, save),
      h("p", { class: "pop-text", text: "Keep it in your password manager, notes, or that file. To make sure you've got it, type the last 4 characters of the code above. (Lose it later? Make a new one any time in You → Account.)" }),
    ),
    input: { placeholder: "Last 4 characters", max: 4, label: "Last four characters of the recovery code", capitalize: "characters", match: (v) => v.trim().toUpperCase() === last },
    actions: [{ id: "ok", label: "I'VE SAVED IT", primary: true }],
    dismissable: false,
  });
}

export async function loginFlow() {
  if (!(await checkAccounts())) return notReady();
  const res = await popup({
    tone: "cyan",
    icon: "👋",
    title: "WELCOME BACK",
    text: "Log in and your shelves join the ones on this device (nothing here is lost).",
    fields: [LOGIN_FIELD, { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "go" }],
    actions: [
      { id: "forgot", label: "FORGOT?" },
      { id: "go", label: "LOG IN", primary: true, busy: "UNLOCKING…" },
    ],
    submit: (v) => account.login(v.login, v.password),
  });
  if (res.id === "forgot") return recoverFlow();
  if (res.id !== "go") return;
  if (sync.on) sync.disable();
  feel("fanfare", "celebrate");
  rain({ count: 100, emoji: ["📚", "🔓"] });
  island.say({ icon: "🔓", title: `HI ${account.user.split("@")[0].toUpperCase().slice(0, 14)}`, sub: `${state.books.length} books on your shelves`, tone: "lime" });
  refreshMe();
}

async function recoverFlow() {
  if (!(await checkAccounts())) return notReady();
  const m = meter();
  const res = await popup({
    tone: "orange",
    icon: "🛟",
    title: "FORGOT YOUR PASSWORD?",
    text: "Use the recovery code you saved when you made your account, and pick a new password. Other devices will be logged out.",
    after: m,
    fields: [
      LOGIN_FIELD,
      { name: "code", placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", label: "Recovery code", capitalize: "characters", max: 40 },
      { name: "password", type: "password", placeholder: "New password", autocomplete: "new-password", label: "New password" },
      { name: "again", type: "password", placeholder: "New password again", autocomplete: "new-password", label: "New password again", enter: "done" },
    ],
    onInput: (v) => m.update(v.password),
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "RESET IT", primary: true, busy: "UNLOCKING…" },
    ],
    submit: async (v) => {
      if (v.password !== v.again) throw new Error("The two passwords don't match.");
      return account.recover(v.login, v.code, v.password);
    },
  });
  if (res.id !== "go") return;
  if (sync.on) sync.disable();
  feel("fanfare", "celebrate");
  island.say({ icon: "🛟", title: "NEW PASSWORD SET", sub: "Your recovery code still works", tone: "lime" });
  refreshMe();
}

async function passwordFlow() {
  const m = meter();
  const res = await popup({
    tone: "lime",
    icon: "🔑",
    title: "CHANGE PASSWORD",
    text: "Your other devices will be logged out. Your recovery code stays the same.",
    after: m,
    fields: [
      { name: "user", type: "text", value: account.user, autocomplete: "username", label: "Username", max: 254 },
      { name: "old", type: "password", placeholder: "Current password", autocomplete: "current-password", label: "Current password" },
      { name: "password", type: "password", placeholder: "New password", autocomplete: "new-password", label: "New password" },
      { name: "again", type: "password", placeholder: "New password again", autocomplete: "new-password", label: "New password again", enter: "done" },
    ],
    onInput: (v) => m.update(v.password),
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "CHANGE IT", primary: true, busy: "LOCKING…" },
    ],
    submit: async (v) => {
      if (v.password !== v.again) throw new Error("The two passwords don't match.");
      return account.changePassword(v.old, v.password);
    },
  });
  if (res.id === "go") island.say({ icon: "🔑", title: "PASSWORD CHANGED", sub: "Other devices were logged out", tone: "lime" });
}

async function logoutFlow({ all = false } = {}) {
  const choice = await popup({
    tone: "cream",
    icon: "⏻",
    title: all ? "LOG OUT EVERYWHERE?" : "LOG OUT?",
    text: all
      ? "Every device logs out, including this one. Your backup stays safe in your account."
      : "Your backup stays safe in your account. On a phone that isn't yours, clear this device too.",
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "clear", label: "LOG OUT & CLEAR" },
      { id: "out", label: "LOG OUT", primary: true },
    ],
  });
  if (choice !== "out" && choice !== "clear") return;
  await account.logout({ all });
  if (choice === "clear") return wipeDevice();
  island.say({ icon: "👋", title: "LOGGED OUT", sub: "Your shelves are still on this device", tone: "violet" });
  refreshMe();
}

export async function deleteFlow() {
  const res = await popup({
    tone: "danger",
    danger: true,
    icon: "⚠",
    title: "DELETE YOUR ACCOUNT?",
    body: h(
      "div",
      { class: "danger-body" },
      h("p", { class: "danger-text", text: "This deletes your account and its backup for good. It can't be undone, and not even we can bring it back." }),
      h("p", { class: "pop-text", text: "Your shelves stay on this device. Enter your password to confirm." }),
    ),
    fields: [
      { name: "user", type: "text", value: account.user, autocomplete: "username", label: "Username", max: 254 },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "KEEP IT", cancel: true },
      { id: "go", label: "DELETE IT", primary: true, danger: true, busy: "DELETING…" },
    ],
    sound: "error",
    submit: (v) => account.deleteAccount(v.password),
  });
  if (res.id !== "go") return;
  feel("drop", "error");
  shake(document.body, 10);
  island.say({ icon: "🗑️", title: "ACCOUNT DELETED", sub: "Your shelves are still on this device", tone: "violet" });
  refreshMe();
}

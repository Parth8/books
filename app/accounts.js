// Accounts: sign up, log in, recovery codes and deleting it all. The vault is end-to-end encrypted (js/account.js).

import { h, $ } from "../js/util.js";
import * as S from "../js/store.js";
import { rain, shake } from "../js/confetti.js";
import { sound, feel } from "../js/sfx.js";
import { createAccount, passwordProblem, strength, cleanUsername, cleanEmail, USERNAME_RULE } from "../js/account.js";
import { passkeysAvailable, passkeyName, cancelled } from "../js/passkey.js";
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

// Can this device log in with Face ID (a passkey that can also unlock the books)?
export let canPasskey = false;
passkeysAvailable().then((v) => {
  canPasskey = v;
  if (v) refreshMe();
});
// iPhone shows the Face ID prompt only straight after a tap, so the login challenge is fetched
// ahead of time (when the account tile appears), and used on the tap.
let pkChallenge = null;
function prefetchChallenge() {
  if (!canPasskey || account.on || (pkChallenge && Date.now() - pkChallenge.at < 200_000)) return;
  pkChallenge = { at: Date.now() }; // (one request at a time)
  account
    .passkeyChallenge()
    .then((c) => (pkChallenge = c))
    .catch(() => (pkChallenge = null));
}

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
    prefetchChallenge();
    body.push(
      h("p", { class: "sync-text", text: "Back up your shelves and open them on any device: phone, laptop, the home-screen app. Encrypted on this device with your password, so not even Shelfie can read your books, and your password never leaves your phone." }),
      h(
        "div",
        { class: canPasskey ? "keys three" : "keys two" },
        key("SIGN UP", "k-lime wide", () => signupFlow(), { sub: "FREE, NO EMAIL NEEDED", aria: "Create an account" }),
        key("🔐", "k-cream", () => loginFlow(), { sub: "LOG IN", aria: "Log in" }),
        canPasskey ? key("🙂", "k-cream", () => passkeyLoginFlow(), { sub: passkeyName(), aria: `Log in with ${passkeyName().toLowerCase()}` }) : null,
      ),
      h("button", { type: "button", class: "link-btn", text: "FORGOT YOUR PASSWORD?", on: { click: () => recoverFlow() } }),
    );
  } else {
    const line = st.state === "syncing" ? "BACKING UP…" : st.state === "error" ? `⚠ ${st.error}`.toUpperCase() : `BACKED UP ${ago(st.at)}`;
    body.push(
      h("p", { class: "acct-who" }, h("span", { text: "👤" }), h("b", { text: account.username ? `@${account.username}` : account.user })),
      h("p", { class: "acct-email" }, h("span", { text: "✉️" }), h("small", { text: typeof account.email === "string" ? account.email : account.email ? "EMAIL ADDED (HIDDEN: WE ONLY KEEP A SCRAMBLED COPY)" : "NO EMAIL · LOG IN WITH YOUR USERNAME" })),
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
        h("button", { type: "button", class: "link-btn", text: account.username ? "CHANGE USERNAME" : "PICK A USERNAME", on: { click: () => renameFlow() } }),
        h("button", { type: "button", class: "link-btn", text: account.email ? "CHANGE EMAIL" : "ADD EMAIL", on: { click: () => emailFlow() } }),
        canPasskey || account.passkey
          ? h("button", { type: "button", class: "link-btn", text: account.passkey ? `${passkeyName()}: ON · TURN OFF` : `TURN ON ${passkeyName()}`, on: { click: () => (account.passkey ? passkeyOffFlow() : passkeyOnFlow()) } })
          : null,
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
  let pw = "";
  const res = await popup({
    tone: "lime",
    icon: "🔐",
    title: "MAKE AN ACCOUNT",
    text: "Your username is how you're shown (change it any time). An email is optional: it's just another way to log in, and we never send you anything. Your password locks your shelves on this device before anything is backed up.",
    after: m,
    fields: [
      { name: "username", placeholder: "Username", autocomplete: "username", label: "Username", max: 33, capitalize: "none" },
      { name: "email", type: "email", placeholder: "Email (optional)", autocomplete: "email", label: "Email, optional", max: 254, inputmode: "email" },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "new-password", label: "New password" },
      { name: "again", type: "password", placeholder: "Password again", autocomplete: "new-password", label: "Password again", enter: "done" },
    ],
    onInput: (v) => m.update(v.password),
    actions: [
      { id: "cancel", label: "NOT NOW", cancel: true },
      { id: "go", label: "CREATE", primary: true, busy: "LOCKING…" },
    ],
    submit: async (v) => {
      const username = cleanUsername(v.username);
      if (!username) throw new Error(USERNAME_RULE);
      if (v.email.trim() && !cleanEmail(v.email)) throw new Error("That doesn't look like an email address. (It's optional: leave it empty if you like.)");
      const problem = passwordProblem(v.password, username);
      if (problem) throw new Error(problem);
      if (v.password !== v.again) throw new Error("The two passwords don't match.");
      pw = v.password;
      return account.signup(username, v.email.trim(), v.password);
    },
  });
  if (res.id !== "go") return;
  if (sync.on) sync.disable(); // the account takes over from the sync code
  feel("levelup", "success");
  rain({ count: 120, emoji: ["🔐", "📚", "✨"] });
  await showRecovery(res.result);
  island.say({ icon: "🔐", title: "ACCOUNT MADE", sub: `${state.books.length} books backed up, encrypted`, tone: "lime" });
  refreshMe();
  offerPasskey(pw);
}

/** The recovery code, once. Confirmed by typing its last four characters. */
export async function showRecovery(code) {
  const last = code.slice(-4);
  const copy = h("button", { type: "button", class: "install-go quiet", text: "⧉ COPY" });
  const save = h("button", { type: "button", class: "install-go quiet", text: "💾 SAVE AS FILE" });
  save.addEventListener("click", () => {
    const blob = new Blob([`Shelfie recovery code for ${account?.username ? `@${account.username}` : account?.user || "your account"}\n\n${code}\n\nKeep it somewhere safe. With your username (or email), it sets a new password if you forget yours.\n`], { type: "text/plain" });
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
  prefetchChallenge();
  let pw = "";
  const res = await popup({
    tone: "cyan",
    icon: "👋",
    title: "WELCOME BACK",
    text: "Log in with your username or email. Your shelves join the ones on this device (nothing here is lost).",
    fields: [LOGIN_FIELD, { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "go" }],
    actions: [
      { id: "forgot", label: "FORGOT?" },
      ...(canPasskey ? [{ id: "face", label: `🙂 ${passkeyName()}` }] : []),
      { id: "go", label: "LOG IN", primary: true, busy: "UNLOCKING…" },
    ],
    submit: (v) => {
      pw = v.password;
      return account.login(v.login, v.password);
    },
  });
  if (res.id === "forgot") return recoverFlow();
  if (res.id === "face") return passkeyLoginFlow();
  if (res.id !== "go") return;
  welcome();
  offerPasskey(pw);
}

/** Logged in: say hello. */
function welcome(how = "🔓") {
  if (sync.on) sync.disable();
  feel("fanfare", "celebrate");
  rain({ count: 100, emoji: ["📚", how] });
  island.say({ icon: how, title: `HI ${(account.username || account.user).split("@")[0].toUpperCase().slice(0, 14)}`, sub: `${state.books.length} books on your shelves`, tone: "lime" });
  refreshMe();
}

/** Face ID login: straight from the tap (iPhone only allows the prompt then). */
export async function passkeyLoginFlow() {
  const ch = pkChallenge?.challenge ? pkChallenge : null;
  pkChallenge = null; // a challenge is good once
  try {
    await account.loginWithPasskey(ch);
  } catch (err) {
    if (!cancelled(err)) island.say({ icon: "🙂", title: `${passkeyName()} DIDN'T WORK`, sub: String(err?.message || err).slice(0, 90), tone: "violet" });
    prefetchChallenge();
    return;
  }
  welcome("🙂");
}

/**
 * After the first password login (or sign-up) on a device that can: offer Face ID, once. The
 * password just typed is used to get it ready in the background (it's never kept).
 */
function offerPasskey(pw) {
  if (!canPasskey || account.passkey || !pw) return;
  try {
    if (localStorage.getItem("shelfie.pkOffered")) return;
    localStorage.setItem("shelfie.pkOffered", "1");
  } catch {}
  const ready = account.preparePasskey(pw);
  ready.catch(() => {});
  setTimeout(async () => {
    const res = await popup({
      tone: "lime",
      icon: "🙂",
      title: `LOG IN WITH ${passkeyName()}?`,
      text: `Next time, one glance and you're in: no password. Apple never shares your face with anyone; Shelfie gets a passkey that only your ${passkeyName() === "FACE ID" ? "Face ID" : "fingerprint or face"} can unlock. Your password keeps working too.`,
      fields: [],
      actions: [
        { id: "later", label: "NOT NOW", cancel: true },
        { id: "go", label: `TURN ON ${passkeyName()}`, primary: true, busy: "LOOK AT YOUR PHONE…" },
      ],
      submit: async () => account.finishPasskey(await ready),
    });
    if (res.id === "go") passkeyDone();
  }, 900);
}

function passkeyDone() {
  feel("levelup", "success");
  rain({ count: 80, emoji: ["🙂", "✨", "🔓"] });
  island.say({ icon: "🙂", title: `${passkeyName()} IS ON`, sub: "Next time, just look at your phone", tone: "lime" });
  refreshMe();
}

/** Turn Face ID on from the account tile: the password first, then the prompt on a tap. */
async function passkeyOnFlow() {
  const first = await popup({
    tone: "lime",
    icon: "🙂",
    title: `TURN ON ${passkeyName()}`,
    text: "Your password, once, to unlock the key that Face ID will look after. It isn't stored anywhere.",
    fields: [
      { name: "user", type: "text", value: account.username || account.user, autocomplete: "username", label: "Username", max: 254 },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: "NEXT", primary: true, busy: "CHECKING…" },
    ],
    submit: (v) => account.preparePasskey(v.password),
  });
  if (first.id !== "go") return;
  const res = await popup({
    tone: "lime",
    icon: "🙂",
    title: "ONE GLANCE",
    text: "Tap below and look at your phone. Apple asks to save a passkey for Shelfie: say yes.",
    fields: [],
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      { id: "go", label: `TURN ON ${passkeyName()}`, primary: true, busy: "LOOK AT YOUR PHONE…" },
    ],
    submit: () => account.finishPasskey(first.result),
  });
  if (res.id === "go") passkeyDone();
}

async function passkeyOffFlow() {
  const res = await popup({
    tone: "cream",
    icon: "🙂",
    title: `TURN OFF ${passkeyName()}?`,
    text: "You'll log in with your password. (The passkey may still sit in your phone's Passwords app; it won't work any more, so you can delete it there.)",
    fields: [],
    actions: [
      { id: "cancel", label: "KEEP IT", cancel: true },
      { id: "go", label: "TURN OFF", primary: true, busy: "ONE MOMENT…" },
    ],
    submit: () => account.disablePasskey(),
  });
  if (res.id !== "go") return;
  island.say({ icon: "🔑", title: `${passkeyName()} OFF`, sub: "Log in with your password", tone: "violet" });
  refreshMe();
}

/** Add, change or remove the email. Needs the password: it's a way to log in. */
async function emailFlow() {
  const known = typeof account.email === "string" ? account.email : "";
  const res = await popup({
    tone: "cyan",
    icon: "✉️",
    title: account.email ? "CHANGE EMAIL" : "ADD EMAIL",
    text: "Another way to log in, alongside your username. We never send you anything, and we only keep a scrambled copy of it.",
    fields: [
      { name: "email", type: "email", value: known, placeholder: "Email", autocomplete: "email", label: "Email", max: 254, inputmode: "email" },
      { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" },
    ],
    actions: [
      { id: "cancel", label: "CANCEL", cancel: true },
      ...(account.email && account.username ? [{ id: "remove", label: "REMOVE" }] : []),
      { id: "go", label: "SAVE", primary: true, busy: "SAVING…" },
    ],
    submit: (v) => account.setEmail(v.email.trim(), v.password),
  });
  if (res.id === "remove") {
    const pw = await popup({
      tone: "cream",
      icon: "✉️",
      title: "REMOVE EMAIL?",
      text: `You'll log in with @${account.username}.`,
      fields: [{ name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", label: "Password", enter: "done" }],
      actions: [
        { id: "cancel", label: "KEEP IT", cancel: true },
        { id: "go", label: "REMOVE", primary: true, busy: "REMOVING…" },
      ],
      submit: (v) => account.setEmail("", v.password),
    });
    if (pw.id === "go") island.say({ icon: "✉️", title: "EMAIL REMOVED", sub: `Log in with @${account.username}`, tone: "lime" });
    return refreshMe();
  }
  if (res.id !== "go") return;
  feel("levelup", "success");
  island.say({ icon: "✉️", title: "EMAIL SAVED", sub: "Log in with it, or your username", tone: "lime" });
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
  try {
    localStorage.removeItem("shelfie.pkOffered"); // a good moment to offer Face ID again
  } catch {}
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

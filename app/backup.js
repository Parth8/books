// Sync codes: the older, account-free way to share shelves between devices; and applying changes that arrive from elsewhere.

import { h, $, buzz } from "../js/util.js";
import * as S from "../js/store.js";
import { burst, rain } from "../js/confetti.js";
import { feel } from "../js/sfx.js";
import { createSync, prettyCode } from "../js/sync.js";
import { setState, setSyncRef, state } from "./state.js";
import { apiBase } from "./api.js";
import { deck, flip, island, renderHud, renderShelf, shelf } from "./boot.js";
import { celebrate } from "./celebrate.js";
import { key, screen } from "./dock.js";
import { live } from "./reading.js";
import { safeStrip } from "./settings.js";
import { mePanel } from "./stats.js";

/* ---------------- sync ---------------- */

let linking = false;
let revealCode = false;

export const sync = setSyncRef(createSync({
  base: apiBase,
  get: () => state,
  put: (next) => applyIncoming(next),
  merge: S.merge,
  onStatus: () => {
    if (mePanel.isOpen) {
      $("#sync-tile")?.replaceWith(syncTile());
      $("#safe-strip")?.replaceWith(safeStrip());
    }
    $("#lcd").classList.toggle("synced", sync.on && sync.status.state === "idle");
  },
}));

/** A copy arrived (another tab, or sync): fold it in and redraw if anything changed. */
export function applyIncoming(next) {
  const merged = S.merge(state, next);
  if (JSON.stringify(merged) === JSON.stringify(S.merge(state, state))) return;
  const wasEmpty = !S.shelf(state, shelf).length;
  setState(S.save(globalThis.localStorage, merged));
  renderHud();
  if (deck.dragging || live) return;
  // Books arriving on an empty shelf get dealt in, so you see them straight away.
  if (wasEmpty && S.shelf(state, shelf).length) renderShelf({ deal: 1 });
  else renderShelf();
}

export const ago = (t) => {
  if (!t) return "NOT YET";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "JUST NOW";
  if (s < 3600) return `${Math.round(s / 60)} MIN AGO`;
  if (s < 86400) return `${Math.round(s / 3600)} H AGO`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
};

export function syncTile() {
  const st = sync.status;
  const body = [];
  if (!apiBase) body.push(h("p", { class: "sync-text", text: "Sync needs Shelfie's Worker. Set api-base in index.html." }));
  else if (!sync.on && !linking) {
    body.push(
      h("p", { class: "sync-text", text: "Right now your shelves live only in this browser. On iPhone, Safari and the home-screen app each keep a separate copy, and either can be cleared by the phone." }),
      h("p", { class: "sync-text", text: "Sync keeps one copy everywhere, encrypted on your device with a code only you hold." }),
      h(
        "div",
        { class: "keys two" },
        key("ON", "k-blue wide", async () => {
          await sync.enable();
          revealCode = true;
          renderSyncTile();
          feel("levelup", "success");
          burst($("#sync-tile"), { count: 60 });
        }, { sub: "TURN ON SYNC" }),
        key("🔑", "k-cream", () => {
          linking = true;
          renderSyncTile();
          setTimeout(() => $("#sync-code")?.focus(), 50);
        }, { sub: "I HAVE A CODE" }),
      ),
    );
  } else if (!sync.on && linking) {
    const input = h("input", { id: "sync-code", type: "text", inputmode: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", "aria-label": "Sync code" });
    const msg = h("p", { class: "sync-text warn", role: "alert" });
    const go = async () => {
      msg.textContent = "LINKING…";
      try {
        await sync.link(input.value);
        linking = false;
        renderSyncTile();
        feel("fanfare", "celebrate");
        rain({ count: 120, emoji: ["🔗", "📚"] });
        island.say({ icon: "🔗", title: "LINKED", sub: `${state.books.length} books on this shelf now`, tone: "lime" });
      } catch (err) {
        feel("error", "error");
        msg.textContent = String(err.message || err).toUpperCase();
      }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
    body.push(
      h("p", { class: "sync-text", text: "Type or paste the code from your other device (Stats → Sync & backup)." }),
      h("label", { class: "lcd-input" }, h("span", { "aria-hidden": "true", text: "🔑" }), input),
      msg,
      h("div", { class: "keys two" }, key("LINK", "k-blue wide", go, { sub: "MERGE THE SHELVES" }), key("✕", "k-cream", () => ((linking = false), renderSyncTile()), { sub: "CANCEL" })),
    );
  } else {
    const code = sync.code;
    const shown = revealCode ? prettyCode(code) : `${code.slice(0, 4)}-••••-••••-••••-••••-••••`;
    const state_ = st.state === "syncing" ? "SYNCING…" : st.state === "error" ? `⚠ ${st.error}`.toUpperCase() : `SYNCED ${ago(st.at)}`;
    body.push(
      h("p", { class: "sync-status" + (st.state === "error" ? " warn" : ""), text: state_ }),
      h("small", { class: "p-label", text: "YOUR SYNC CODE" }),
      h("button", { type: "button", class: "sync-code", "aria-label": revealCode ? `Sync code ${code.split("").join(" ")}. Tap to hide` : "Show sync code", on: { click: () => ((revealCode = !revealCode), renderSyncTile(), feel("flip", "light")) } }, shown),
      h("p", { class: "sync-text", text: "Treat it like a password: anyone with it can see and change your shelves. To use them in the home-screen app or on another device, open Stats there → I have a code." }),
      h(
        "div",
        { class: "keys three" },
        key("⧉", "k-cream", async () => {
          try {
            await navigator.clipboard.writeText(prettyCode(code));
            island.say({ icon: "📋", title: "CODE COPIED", sub: "Paste it in the other app", tone: "lime", buzz: false });
            feel("pop", "success");
          } catch {
            revealCode = true;
            renderSyncTile();
          }
        }, { sub: "COPY" }),
        key("↻", "k-blue", () => sync.now(), { sub: "SYNC NOW" }),
        key("⏻", "k-red", () => {
          if (!confirm("Turn off sync on this device? Your shelves stay here; the synced copy stays for your other devices.")) return;
          sync.disable();
          revealCode = false;
          renderSyncTile();
        }, { sub: "TURN OFF" }),
      ),
    );
  }
  return h("div", { class: "tile t-sync span2", id: "sync-tile" }, h("small", { text: sync.on ? "🔒 END-TO-END ENCRYPTED SYNC: ON" : "🔒 END-TO-END ENCRYPTED SYNC" }), ...body);
}

function renderSyncTile() {
  $("#sync-tile")?.replaceWith(syncTile());
}

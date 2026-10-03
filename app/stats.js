// Stats: the panel you pull up from the bottom. Bento tiles, goals, the week and your stickers.

import { h, $, buzz, clamp, fmt, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { createPanel } from "../js/panel.js";
import { feel, fx } from "../js/sfx.js";
import { account, state } from "./state.js";
import { checkAccounts } from "./accounts.js";
import { deck, hints, island } from "./boot.js";
import { commit, MONTH } from "./celebrate.js";
import { bar, key } from "./dock.js";
import { fill } from "./import.js";
import { panelProgress } from "./panels.js";
import { lcdTaps } from "./secrets.js";
import { handleText, leversSection, renderMe, safeSection } from "./settings.js";

/* ---------------- Stats (pull up) ---------------- */

export const stats = createPanel($("#panel-stats"), {
  handles: [$("#pullbar")],
  onOpen: () => {
    hints.learn("stats");
    feel("open", "medium");
    if (statsDirty) renderStats();
    else if (!prefersReducedMotion()) $("#stats-body").querySelectorAll("[data-n]").forEach((el) => countUp(el));
  },
  onClose: () => feel("close", "light"),
  onProgress: (p) => panelProgress("stats", p),
});
// Build the stats as soon as a finger lands on the bar, so nothing heavy happens mid-swipe.
let statsDirty = true;
/** Something changed: the stats get redrawn before you next see them. */
export function markStatsDirty() {
  statsDirty = true;
}
$("#pullbar").addEventListener("pointerdown", () => statsDirty && !stats.isOpen && renderStats(), { passive: true });
/** Build the stats while nothing else is happening, so pulling them up is pure motion. */
let prerenderTimer = 0;
export function prerenderStats() {
  clearTimeout(prerenderTimer);
  prerenderTimer = setTimeout(() => {
    const go = () => statsDirty && !stats.isOpen && !deck.dragging && renderStats({ quiet: true });
    if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 4000 });
    else go();
  }, 2500);
}
$("#pullbar").addEventListener("click", () => stats.open());


export const mePanel = createPanel($("#panel-me"), {
  onOpen: () => {
    feel("open", "medium");
    checkAccounts();
  },
  onClose: () => feel("close", "light"),
  onProgress: (p) => panelProgress("me", p),
});
$("#me").addEventListener("click", () => {
  renderMe(); // built before it moves
  mePanel.open();
});
$("#panel-me [data-close]").addEventListener("click", () => mePanel.close());
/**
 * After an account change, redraw only the parts of You that depend on it (never the whole
 * panel: a lever you're holding mustn't vanish under your finger).
 */
export function refreshMe() {
  if (!mePanel.isOpen) return;
  $("#me-safe")?.replaceWith(safeSection());
  if (!document.querySelector(".lever.held")) $("#me-levers")?.replaceWith(leversSection());
  $("#me-title").textContent = state.name ? state.name.toUpperCase().slice(0, 14) : "YOU";
  const who = $(".me-name");
  if (who) who.textContent = state.name || "Anonymous reader";
  const handle = $("#me-handle");
  if (handle) handle.textContent = handleText();
}
// One tap opens your stats; keep tapping and something else happens.
let lcdTimer = 0;
$("#lcd").addEventListener("click", () => {
  clearTimeout(lcdTimer);
  if (lcdTaps()) return;
  lcdTimer = setTimeout(() => stats.open(), 320);
});
$("#panel-stats [data-close]").addEventListener("click", () => stats.close());

export function renderStats({ quiet = false } = {}) {
  const lp = S.levelProgress(state.xp);
  const wk = S.week(state);
  const top = Math.max(state.goal, ...wk.map((d) => d.pages));
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  const tile = (cls, ...kids) => h("div", { class: `tile ${cls}` }, ...kids);
  const num = (n, cls = "big") => h("b", { class: cls, "data-n": String(n), text: fmt(n) });
  const year = new Date().getFullYear();
  fill($("#stats-body"),
    h(
      "div",
      { class: "bento" },
      tile("t-level span2", h("small", { text: "LEVEL" }), h("b", { class: "huge", "data-n": String(lp.level), "data-pad": "2", text: String(lp.level).padStart(2, "0") }), h("span", { class: "t-title", text: lp.title.toUpperCase() }), h("span", { class: "t-bar" }, h("i", { vars: { width: `${(lp.frac * 100).toFixed(1)}%` } })), h("small", { class: "t-foot", text: `${fmt(lp.into)} / ${fmt(lp.need)} XP TO LV${lp.level + 1}` })),
    ),
    h("h3", { class: "p-h", text: "GOALS" }),
    h("p", { class: "p-note", text: "SPIN A RING TO SET THE GOAL" }),
    h(
      "div",
      { class: "bento" },
      goalDial({ kind: "day", label: "TODAY", unit: "PAGES", value: S.pagesOn(state), target: state.goal, cls: "t-dial-day" }),
      goalDial({ kind: "month", label: new Date().toLocaleDateString("en-GB", { month: "long" }).toUpperCase(), unit: "BOOKS", value: S.finishedIn(state, "month"), target: state.goalMonth, cls: "t-dial-month" }),
      goalDial({ kind: "year", label: String(year), unit: "BOOKS", value: S.finishedIn(state, "year"), target: state.goalYear, cls: "t-dial-year span2", wide: true }),
    ),
    h("h3", { class: "p-h", text: "NUMBERS" }),
    h(
      "div",
      { class: "bento" },
      tile("t-streak", h("small", { text: "STREAK" }), num(S.streak(state)), h("span", { class: "t-foot", text: "🔥 DAYS IN A ROW" })),
      tile("t-books", h("small", { text: "BOOKS READ" }), num(S.finishedCount(state)), h("span", { class: "t-foot", text: "ALL TIME" })),
      tile(
        "t-week span2",
        h("small", { text: `THIS WEEK · ${fmt(wk.reduce((a, d) => a + d.pages, 0))} PAGES` }),
        h(
          "div",
          { class: "wbars" },
          wk.map((d, i) => h("span", { class: `wb${d.pages >= state.goal ? " hit" : ""}${i === 6 ? " today" : ""}`, vars: { "--h": `${Math.max(4, (d.pages / top) * 100)}%`, "--i": i } }, h("i"), h("small", { text: names[new Date(`${d.day}T12:00`).getDay()] }))),
        ),
      ),
      tile("t-pages", h("small", { text: "PAGES READ" }), num(S.totalPages(state)), h("span", { class: "t-foot", text: `${fmt(S.pagesIn(state, "month"))} THIS MONTH` })),
      tile("t-xp", h("small", { text: "TOTAL XP" }), num(state.xp)),
      tile("t-eggs span2", h("small", { text: "EASTER EGGS FOUND" }), num(state.eggs.length), h("span", { class: "t-foot", text: "DOUBLE-TAP COVERS. TAP THE SCREEN UP TOP 5×. KONAMI." })),
    ),
    h("h3", { class: "p-h", text: `BADGES ${Object.keys(state.badges).length}/${S.BADGES.length}` }),
    h(
      "div",
      { class: "badges" },
      S.BADGES.map((b) => {
        const got = state.badges[b.id];
        return h("div", { class: `mini${got ? " got" : ""}`, title: b.text }, h("div", { class: "mini-paper" }, h("span", { class: "mini-e", text: got ? b.emoji : "?" }), h("b", { text: b.name.toUpperCase() }), h("small", { text: b.text })));
      }),
    ),
  );
  statsDirty = false;
  if (!quiet && !prefersReducedMotion()) {
    // Only what's on screen first rises in (after the panel has mostly arrived), and numbers roll up.
    [...$("#stats-body").querySelectorAll(".tile")].slice(0, 5).forEach((t, i) => t.animate([{ transform: "translateY(18px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 160 + 70 * i, easing: "cubic-bezier(.22,1.2,.36,1)", fill: "backwards" }));
    $("#stats-body").querySelectorAll("[data-n]").forEach((el) => countUp(el));
  }
}

/** Numbers roll up from zero when the stats open. */
export function countUp(el) {
  const to = Number(el.dataset.n);
  const pad = Number(el.dataset.pad || 0);
  if (!Number.isFinite(to) || to <= 0) return;
  const t0 = performance.now();
  const dur = 700 + Math.min(600, to * 3);
  const step = (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / dur));
    const v = Math.round(to * (1 - Math.pow(1 - k, 4)));
    el.textContent = pad ? String(v).padStart(pad, "0") : fmt(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function toggleKey(emoji, label, pref) {
  const k = key(emoji, `k-cream toggle${fx[pref] ? " on" : ""}`, () => {
    fx.set(pref, !fx[pref]);
    k.classList.toggle("on", fx[pref]);
    k.setAttribute("aria-pressed", String(fx[pref]));
    k.querySelector("small").textContent = `${label} ${fx[pref] ? "ON" : "OFF"}`;
    if (fx[pref]) feel("pop", "success");
  }, { sub: `${label} ${fx[pref] ? "ON" : "OFF"}`, aria: label.toLowerCase() });
  k.setAttribute("aria-pressed", String(fx[pref]));
  return k;
}

/**
 * A goal ring, watch-face style: the arc is your progress, the handle is the goal. Drag the
 * ring round (or use the arrow keys) to set it.
 */
function goalDial({ kind, label, unit, value, target, cls, wide = false }) {
  const [lo, hi] = S.GOAL_LIMITS[kind];
  const step = kind === "day" ? 5 : 1;
  const R = 46;
  const C = 2 * Math.PI * R;
  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const svgEl = mk("svg", { viewBox: "0 0 120 120", class: "dial-svg", "aria-hidden": "true" });
  for (let t = 0; t < 60; t++) svgEl.append(mk("line", { x1: 60, y1: 6, x2: 60, y2: t % 5 ? 10 : 13, class: "tick", transform: `rotate(${t * 6} 60 60)` }));
  svgEl.append(mk("circle", { cx: 60, cy: 60, r: R, class: "trk" }));
  const arc = mk("circle", { cx: 60, cy: 60, r: R, class: "arc", "stroke-dasharray": C, transform: "rotate(-90 60 60)" });
  const handle = mk("circle", { cx: 60, cy: 60 - R, r: 7, class: "handle" });
  svgEl.append(arc, handle);
  const num = h("b", { class: "dial-n", text: String(value) });
  const of = h("small", { class: "dial-of" });
  const foot = h("small", { class: "t-foot" });
  const el = h(
    "div",
    { class: `tile t-dial tile-dial ${cls}`, role: "slider", tabIndex: 0, "aria-label": `${label} goal, ${unit.toLowerCase()}`, "aria-valuemin": String(lo), "aria-valuemax": String(hi), "data-kind": kind },
    h("div", { class: "dial-wrap" }, svgEl, h("span", { class: "dial-in" }, num, of)),
    h("div", { class: "dial-side" }, h("small", { class: "dial-label", text: label }), wide ? h("b", { class: "big", text: `${value}/${target}` }) : null, foot),
  );
  let goal = target;
  const paint = () => {
    const frac = Math.min(1, value / goal);
    arc.style.strokeDashoffset = String(C * (1 - frac));
    const a = ((goal - lo) / (hi - lo)) * 2 * Math.PI * 0.97;
    handle.setAttribute("cx", String(60 + Math.sin(a) * R));
    handle.setAttribute("cy", String(60 - Math.cos(a) * R));
    of.textContent = `/ ${goal}`;
    const left = Math.max(0, goal - value);
    const u = left === 1 ? unit.replace(/S$/, "") : unit;
    foot.textContent = left ? `${left} ${u} TO GO` : `GOAL DONE ✓`;
    if (wide) el.querySelector(".big").textContent = `${value}/${goal}`;
    el.setAttribute("aria-valuenow", String(goal));
    el.setAttribute("aria-valuetext", `${value} of ${goal} ${unit.toLowerCase()}`);
    el.classList.toggle("done", value >= goal);
  };
  paint();
  let d = null;
  const at = (e) => {
    const r = svgEl.getBoundingClientRect();
    let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    if (a < 0) a += 2 * Math.PI;
    const raw = lo + (a / (2 * Math.PI * 0.97)) * (hi - lo);
    return clamp(Math.round(raw / step) * step, lo, hi);
  };
  const save = () => {
    if (goal === { day: state.goal, month: state.goalMonth, year: state.goalYear }[kind]) return;
    commit(S.setGoal(state, goal, kind), null, { keepStats: true });
    feel("snap", "success");
    island.say({ icon: "🎯", title: `${label} GOAL: ${goal} ${unit}`, tone: "lime", buzz: false });
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    d = e.pointerId;
    el.setPointerCapture(d);
    el.classList.add("grab");
    feel("pop", "light");
  });
  el.addEventListener("pointermove", (e) => {
    if (d !== e.pointerId) return;
    const g = at(e);
    if (g !== goal) {
      goal = g;
      feel("detent", "tick");
      paint();
    }
  });
  const up = (e) => {
    if (d !== e.pointerId) return;
    d = null;
    el.classList.remove("grab");
    save();
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("keydown", (e) => {
    const k = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[e.key];
    if (!k) return;
    e.preventDefault();
    goal = clamp(goal + k, lo, hi);
    feel("detent", "tick");
    paint();
    save();
  });
  return el;
}

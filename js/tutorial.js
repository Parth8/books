// How to use Shelfie: a short, hands-on tour. Each step shows a gesture with a ghost finger,
// then lets you do it for real on a practice stamp. Get it right and it celebrates; Next or
// Skip move on any time. Opens on first launch, and again from the "?" button.

import { h, clamp, prefersReducedMotion } from "./util.js";
import { feel, sound, haptic } from "./sfx.js";
import { burst, rain, shockwave } from "./confetti.js";

const STEPS = [
  {
    id: "hello",
    tone: "#2b3bff",
    ink: "#fff",
    title: ["HEY,", "READER."],
    text: "Shelfie runs on gestures. Five moves, under a minute. Try each one on the practice stamp.",
    demo: hello,
    next: "LET'S GO",
  },
  {
    id: "swipe",
    tone: "#ff5a1f",
    ink: "#0d0d0d",
    title: ["SWIPE", "TO FLIP."],
    text: "Swipe left or right to flip through a shelf. The + stamp is always last: tap it, or pull it up, to add a book.",
    try: "SWIPE THE PILE ←",
    demo: swipeDemo,
  },
  {
    id: "scrub",
    tone: "#2b3bff",
    ink: "#fff",
    title: ["DRAG UP", "TO READ."],
    text: "On a book you're reading, drag up to turn pages; the cover fills up. Drag down to go back. Flick to fly through.",
    try: "DRAG THE STAMP UP ↑",
    demo: scrubDemo,
  },
  {
    id: "dial",
    tone: "#efe9dc",
    ink: "#0d0d0d",
    title: ["OR SPIN", "THE DIAL."],
    text: "The dial on the keypad turns one page per click. The keys add 1, 5, 10 or 25 pages at a tap.",
    try: "SPIN IT ⟳",
    demo: dialDemo,
  },
  {
    id: "hold",
    tone: "#ffd60a",
    ink: "#0d0d0d",
    title: ["HOLD", "TO MOVE."],
    text: "Hold a book until it lifts, then drop it on a shelf: Want, Reading, Finished, or Remove.",
    try: "HOLD, THEN DROP IT ON A SHELF",
    demo: holdDemo,
  },
  {
    id: "more",
    tone: "#ff6ad5",
    ink: "#0d0d0d",
    title: ["AND", "THE REST."],
    text: "",
    demo: moreDemo,
    next: "START READING",
  },
];

let open = null;

export function startTutorial({ onDone } = {}) {
  if (open) return;
  let i = 0;
  let cleanup = null;
  const dots = h("div", { class: "tour-dots", "aria-hidden": "true" }, STEPS.map(() => h("i")));
  const kicker = h("small", { class: "tour-kicker" });
  const title = h("h2", { class: "tour-title", id: "tour-title" });
  const text = h("p", { class: "tour-text" });
  const stage = h("div", { class: "tour-stage" });
  const tryLine = h("p", { class: "tour-try", role: "status" });
  const back = h("button", { type: "button", class: "tour-btn back", text: "← BACK" });
  const next = h("button", { type: "button", class: "tour-btn go", text: "NEXT →" });
  const skip = h("button", { type: "button", class: "tour-skip", text: "SKIP TOUR" });
  const el = h(
    "div",
    { class: "tour", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title", popover: "manual", tabIndex: -1 },
    h("div", { class: "tour-top" }, dots, skip),
    h("div", { class: "tour-card" }, kicker, title, text),
    stage,
    tryLine,
    h("div", { class: "tour-nav" }, back, next),
  );
  document.body.append(el);
  try {
    el.showPopover?.();
  } catch {}
  open = el;
  document.getElementById("app")?.setAttribute("inert", "");

  function show(k, dir = 1) {
    cleanup?.();
    i = clamp(k, 0, STEPS.length - 1);
    const s = STEPS[i];
    el.style.setProperty("--tone", s.tone);
    el.style.setProperty("--ink", s.ink);
    [...dots.children].forEach((d, j) => d.classList.toggle("on", j === i));
    kicker.textContent = `${String(i + 1).padStart(2, "0")} / ${String(STEPS.length).padStart(2, "0")}`;
    title.replaceChildren(...s.title.map((t, j) => h("span", { class: "tl", vars: { "--k": j } }, h("b", { text: t }))));
    text.textContent = s.text;
    text.hidden = !s.text;
    tryLine.textContent = s.try ? `TRY IT: ${s.try}` : "";
    tryLine.classList.remove("done");
    back.hidden = i === 0;
    next.textContent = s.next || "NEXT →";
    next.classList.remove("ready");
    stage.replaceChildren();
    cleanup = s.demo(stage, () => passed()) || null;
    if (!prefersReducedMotion()) {
      el.querySelector(".tour-card").animate([{ transform: `translateX(${dir * 60}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,1.3,.4,1)" });
      stage.animate([{ transform: "scale(.9)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 500, delay: 80, easing: "cubic-bezier(.2,1.3,.4,1)", fill: "backwards" });
    }
    feel("swoosh", "light");
    next.focus({ preventScroll: true });
  }

  function passed() {
    if (tryLine.classList.contains("done")) return;
    tryLine.classList.add("done");
    tryLine.textContent = ["NAILED IT ✓", "PERFECT ✓", "THAT'S THE ONE ✓", "EASY ✓"][i % 4];
    next.classList.add("ready");
    feel("levelup", "success");
    burst(stage, { count: 70 });
    shockwave(stage, "#e7ff3d");
  }

  function close(finished) {
    cleanup?.();
    cleanup = null;
    document.getElementById("app")?.removeAttribute("inert");
    const done = () => {
      el.remove();
      open = null;
      onDone?.(finished);
    };
    if (finished) {
      feel("fanfare", "celebrate");
      rain({ count: 160, emoji: ["📚", "✨", "🎉"] });
    } else sound("close");
    if (prefersReducedMotion()) return done();
    el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.04)" }], { duration: 300, fill: "forwards" }).finished.then(done, done);
  }

  next.addEventListener("click", () => (i === STEPS.length - 1 ? close(true) : show(i + 1, 1)));
  back.addEventListener("click", () => show(i - 1, -1));
  skip.addEventListener("click", () => close(false));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close(false);
    if (e.key === "ArrowRight" && e.target === el) show(i + 1, 1);
    if (e.key === "ArrowLeft" && e.target === el) show(i - 1, -1);
  });
  show(0);
}

/* ---------------- the practice stamps ---------------- */

const COLORS = [
  ["#2b3bff", "#ff9a6b"],
  ["#ff5a1f", "#ffd60a"],
  ["#111", "#33e07a"],
  ["#7a3cff", "#ff6ad5"],
];

function mini(k, label = "") {
  const [bg, a] = COLORS[k % COLORS.length];
  return h(
    "div",
    { class: "tt-stamp", vars: { "--bg": bg, "--a": a } },
    h("div", { class: "tt-paper" }, h("b", { class: "tt-num", text: label }), h("div", { class: "tt-win" }, h("i", { class: "tt-blob" }), h("i", { class: "tt-fill" })), h("span", { class: "tt-cap" })),
  );
}

const finger = (anim) => h("i", { class: `tt-finger ${anim}`, "aria-hidden": "true" });

/** Pointer drag helper for the practice stamps. */
function drag(el, { down, move, up }) {
  let d = null;
  const start = (e) => {
    e.preventDefault();
    d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now() };
    el.setPointerCapture(e.pointerId);
    down?.(d, e);
  };
  const mv = (e) => {
    if (!d || e.pointerId !== d.id) return;
    move?.(e.clientX - d.x0, e.clientY - d.y0, d, e);
  };
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const cur = d;
    d = null;
    up?.(e.clientX - cur.x0, e.clientY - cur.y0, cur, e);
  };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointermove", mv);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

function hello(stage) {
  const pile = h("div", { class: "tt-pile fan" }, [3, 2, 1, 0].map((k) => mini(k)));
  stage.append(pile);
}

function swipeDemo(stage, pass) {
  const cards = [0, 1, 2].map((k) => mini(k, ["01", "02", "+"][k]));
  cards[2].classList.add("plus");
  const pile = h("div", { class: "tt-pile" }, [...cards].reverse(), finger("swipe"));
  stage.append(pile);
  let top = 0;
  const layout = () =>
    cards.forEach((c, k) => {
      const slot = k - top;
      c.style.transform = slot < 0 ? "translateX(-160%) rotate(-18deg)" : `translate(${slot * 14}px, ${slot * 8}px) rotate(${slot * 4}deg) scale(${1 - slot * 0.05})`;
      c.style.opacity = slot < 0 ? "0" : "1";
      c.style.zIndex = String(10 - slot);
    });
  layout();
  drag(pile, {
    move: (dx) => {
      const c = cards[top];
      if (c) {
        c.style.transition = "none";
        c.style.transform = `translateX(${dx}px) rotate(${dx * 0.06}deg)`;
      }
    },
    up: (dx) => {
      cards.forEach((c) => (c.style.transition = ""));
      if (dx < -60 && top < cards.length - 1) {
        top++;
        feel("swoosh", "light");
        setTimeout(() => sound("thunk"), 150);
        pass();
      } else if (dx > 60 && top > 0) {
        top--;
        feel("swoosh", "light");
      } else if (Math.abs(dx) > 20) feel("error", "warning");
      layout();
    },
  });
}

function scrubDemo(stage, pass) {
  const card = mini(1, "0%");
  const fill = card.querySelector(".tt-fill");
  const num = card.querySelector(".tt-num");
  const wrap = h("div", { class: "tt-pile single" }, card, finger("up"));
  stage.append(wrap);
  let level = 0;
  let base = 0;
  const paint = () => {
    fill.style.height = `${level}%`;
    num.textContent = `${Math.round(level)}%`;
  };
  drag(wrap, {
    down: () => (base = level),
    move: (dx, dy) => {
      const next = clamp(base - dy / 2.2, 0, 100);
      if (Math.floor(next / 4) !== Math.floor(level / 4)) feel("page", "tick");
      level = next;
      card.style.transform = `translateY(${clamp(dy * 0.08, -12, 12)}px)`;
      paint();
      if (level >= 60) pass();
    },
    up: () => (card.style.transform = ""),
  });
  paint();
}

function dialDemo(stage, pass) {
  const cap = h("span", { class: "knob-cap" }, h("i", { class: "knob-dot" }), h("span", { class: "knob-grip" }));
  const ring = h("span", { class: "knob-ring" });
  const knob = h("div", { class: "knob tt-knob" }, ring, cap);
  const count = h("b", { class: "tt-count", text: "PG 0000" });
  stage.append(h("div", { class: "tt-dial" }, h("div", { class: "screen tt-screen" }, count), knob, finger("spin")));
  let angle = 0;
  let total = 0;
  let pages = 0;
  let last = null;
  const center = () => {
    const r = knob.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  drag(knob, {
    down: (d, e) => {
      const c = center();
      last = Math.atan2(e.clientY - c.y, e.clientX - c.x);
    },
    move: (dx, dy, d, e) => {
      const c = center();
      const a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      let delta = ((a - last) * 180) / Math.PI;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      last = a;
      angle += delta;
      total += Math.abs(delta);
      cap.style.transform = `rotate(${angle}deg)`;
      const p = Math.max(0, Math.floor(angle / 14));
      if (p !== pages) {
        pages = p;
        count.textContent = `PG ${String(p).padStart(4, "0")}`;
        feel("detent", "tick");
        ring.classList.remove("tick");
        void ring.offsetWidth;
        ring.classList.add("tick");
      }
      if (total > 300) pass();
    },
  });
}

function holdDemo(stage, pass) {
  const card = mini(3);
  const zl = h("div", { class: "tt-zone left" }, h("b", { text: "WANT" }));
  const zr = h("div", { class: "tt-zone right" }, h("b", { text: "DONE ✓" }));
  const area = h("div", { class: "tt-hold" }, zl, zr, card, finger("hold"));
  stage.append(area);
  let lifted = false;
  let timer = 0;
  let hot = null;
  const zones = [zl, zr];
  drag(card, {
    down: () => {
      timer = setTimeout(() => {
        lifted = true;
        card.classList.add("lifted");
        area.classList.add("lifting");
        feel("pop", "heavy");
      }, 380);
    },
    move: (dx, dy, d, e) => {
      if (!lifted) {
        if (Math.hypot(dx, dy) > 10) clearTimeout(timer);
        return;
      }
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.04}deg) scale(.85)`;
      const over = zones.find((z) => {
        const r = z.getBoundingClientRect();
        return e.clientX > r.left - 20 && e.clientX < r.right + 20 && e.clientY > r.top - 20 && e.clientY < r.bottom + 20;
      });
      if (over !== hot) {
        hot?.classList.remove("hot");
        hot = over || null;
        if (hot) {
          hot.classList.add("hot");
          feel("snap", "select");
        }
      }
    },
    up: () => {
      clearTimeout(timer);
      card.classList.remove("lifted");
      area.classList.remove("lifting");
      if (lifted && hot) {
        feel("thunk", "success");
        shockwave(hot, "#e7ff3d");
        card.animate([{ transform: card.style.transform, opacity: 1 }, { transform: `${card.style.transform} scale(.2)`, opacity: 0 }], { duration: 250, fill: "forwards" });
        hot.classList.remove("hot");
        pass();
        setTimeout(() => {
          card.getAnimations().forEach((a) => a.cancel());
          card.style.transform = "";
        }, 900);
      } else card.style.transform = "";
      lifted = false;
      hot = null;
    },
  });
}

function moreDemo(stage) {
  const rows = [
    ["👆", "TAP A STAMP", "flips it over: dates, genre, blurb"],
    ["✌️", "DOUBLE-TAP A COVER", "pokes it. Some books hide secrets"],
    ["⬆", "PULL THE + STAMP UP", "search Google Books. Swipe a result right to pick a shelf"],
    ["↔", "DRAG THE SHELF NAME", "switches between Reading, Want and Read"],
    ["▲", "PULL THE BOTTOM BAR UP", "stats, badges, daily / monthly / yearly goals, and sync"],
    ["🔗", "SYNC", "keeps Safari, the home-screen app and your other devices in step"],
  ];
  stage.append(
    h(
      "ul",
      { class: "tt-more" },
      rows.map(([e, b, s], k) => h("li", { vars: { "--k": k } }, h("span", { class: "tt-ico", text: e }), h("span", {}, h("b", { text: b }), h("small", { text: s })))),
    ),
  );
  haptic("light");
}

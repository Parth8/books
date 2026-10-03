// Signs of life while you're just looking: idle fidgets, and the odd visitor wandering across the screen.

import { $, buzz, prefersReducedMotion } from "../js/util.js";
import * as S from "../js/store.js";
import { fx } from "../js/sfx.js";
import { createCritters } from "../js/critters.js";
import * as Q from "../js/quips.js";
import { state } from "./state.js";
import { add } from "./adding.js";
import { deck, island, liquid, tape } from "./boot.js";
import { commit, posterUp } from "./celebrate.js";
import { dock } from "./dock.js";
import { imp } from "./import.js";
import { popping, touring } from "./onboarding.js";
import { stats } from "./stats.js";

/* ---------------- idle fidgets ---------------- */

// While the app is open and you're just looking, it doesn't freeze: every so often something
// does a little something. Each one is a short, composited animation, so it costs next to nothing.
let lastInput = performance.now();
for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, () => (lastInput = performance.now()), { capture: true, passive: true });
const FIDGETS = [
  () => {
    const el = deck.top?.el;
    if (!el || el.classList.contains("flipped")) return;
    el.querySelector(".face.front")?.animate(
      [{ transform: "none" }, { transform: "rotate(-3deg) translateY(-6px)" }, { transform: "rotate(2deg)" }, { transform: "none" }],
      { duration: 900, easing: "cubic-bezier(.3,1.4,.5,1)" },
    );
  },
  () => {
    const r = $(".dock .knob-ring");
    if (!r) return;
    r.classList.remove("fidget");
    void r.offsetWidth;
    r.classList.add("fidget");
  },
  () => {
    const w = $("#tape [aria-selected='true']");
    w?.animate([{ transform: "none" }, { transform: "translateY(-8px) rotate(-2deg)" }, { transform: "none" }], { duration: 700, easing: "cubic-bezier(.3,1.5,.5,1)" });
  },
  () => liquid?.splash(0.25, Math.random()),
  () => [...$("#dock").querySelectorAll(".key")].slice(0, 4).forEach((k, i) =>
    k.animate([{ transform: "none" }, { transform: "translateY(-5px)" }, { transform: "none" }], { duration: 420, delay: i * 70, easing: "ease-out" }),
  ),
];
let fidgetN = 0;
setInterval(() => {
  if (prefersReducedMotion() || document.visibilityState !== "visible") return;
  if (performance.now() - lastInput < 9000 || deck.dragging || touring() || popping() || stats.isOpen || add.isOpen || imp.isOpen || posterUp) return;
  if (Math.random() < 0.35) return; // not like clockwork
  FIDGETS[fidgetN++ % FIDGETS.length]();
  // Now and then, after a longer quiet spell, a line from the island.
  if (performance.now() - lastInput > 45000 && Math.random() < 0.25) island.say({ icon: "📖", title: Q.greeting(state.name).toUpperCase(), sub: "Still here when you're ready", tone: "lime", buzz: false });
}, 6000);

/* ---------------- visitors ---------------- */

export const critters = createCritters({
  host: $("#stage"),
  canShow: () => fx.visitors && !touring() && !popping() && !stats.isOpen && !add.isOpen && !imp.isOpen && !deck.dragging && !posterUp && !document.querySelector(".tip"),
  name: () => state.name,
  onPet: (c, el) => {
    const r = S.findEgg(state, "app", `critter-${c.id}`);
    r.events.forEach((e) => e.type === "egg" && (e.label = `Petted the ${c.id}`));
    if (r.events.find((x) => x.type === "egg")?.fresh) commit(r, el);
  },
});

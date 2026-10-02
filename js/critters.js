// Visitors. Every so often (never while you're busy), a critter wanders across the bottom of
// the screen, says something, and leaves. Tap one to pet it: it hops, makes its noise, and
// counts as a find (pet three for a sticker).

import { h, prefersReducedMotion } from "./util.js";
import { feel, haptic } from "./sfx.js";
import { burst } from "./confetti.js";

export const CRITTERS = [
  { id: "llama", e: "🦙", sound: "hum", secs: 9, lines: ["no drama, just llama", "reading is llamazing", "{n}, read another one"] },
  { id: "horse", e: "🐎", sound: "clop", pet: "neigh", secs: 5, lines: ["neigh-ver stop reading", "galloping through chapters", "hay {n}"] },
  { id: "duck", e: "🦆", sound: "quack", secs: 8, lines: ["quack. (that means: read)", "just ducking through", "what the duck is that book"] },
  { id: "cat", e: "🐈", sound: "meow", secs: 7, lines: ["i will sit on that book", "purr-fect choice, {n}", "meow. (spoilers)"] },
  { id: "dino", e: "🦖", sound: "rawr", secs: 6, lines: ["RAWR means 'nice shelf'", "i'm a T-rex. tiny arms. can't hold books.", "extinct? not your streak"] },
  { id: "snail", e: "🐌", sound: "squeak", secs: 16, lines: ["slow reader. no shame.", "one page at a time, {n}", "i'll finish eventually"] },
  { id: "hedgehog", e: "🦔", sound: "squeak", secs: 7, lines: ["sharp choice, {n}", "spiky plot ahead", "hedge your bets: read"] },
  { id: "penguin", e: "🐧", sound: "honk", secs: 8, lines: ["cool book, {n}", "ice to see you reading", "waddle you read next?"] },
  { id: "turtle", e: "🐢", sound: "chirp", secs: 14, lines: ["slow and steady reads the series", "shell-f care is reading", "no rush, {n}"] },
  { id: "flamingo", e: "🦩", sound: "honk", secs: 7, lines: ["standing on one leg. reading on two.", "pretty in pink, pretty in print", "fla-mingle with a book"] },
  { id: "unicorn", e: "🦄", sound: "chirp", secs: 6, lines: ["rare spotting! make a wish, {n}", "magic is real (it's books)", "✨ you saw nothing ✨"] },
];

/**
 * host: where they walk (positioned element); canShow(): false while busy; name(): your name;
 * onPet(critter, el): a critter was tapped.
 */
export function createCritters({ host, canShow, name, onPet, first = [20000, 45000], gap = [55000, 140000] }) {
  let timer = 0;
  let current = null;
  const rand = ([a, b]) => a + Math.random() * (b - a);

  function schedule(range) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (prefersReducedMotion() || document.visibilityState !== "visible" || !canShow()) return schedule([8000, 15000]);
      walk();
      schedule(gap);
    }, rand(range));
  }

  function walk(kind = null) {
    if (current) return;
    const c = kind ? CRITTERS.find((x) => x.id === kind) : CRITTERS[Math.floor(Math.random() * CRITTERS.length)];
    const right = Math.random() < 0.5; // walking towards the right (emoji faces left, so flip it)
    const line = c.lines[Math.floor(Math.random() * c.lines.length)].replace("{n}", name() || "reader");
    const bubble = h("span", { class: "critter-say", text: line });
    const body = h("span", { class: "critter-body", text: c.e, vars: { "--flip": right ? -1 : 1 } });
    const el = h("button", { type: "button", class: `critter ${c.id}`, "aria-label": `A ${c.id} wandered by. Tap to pet it.` }, bubble, body);
    host.append(el);
    current = el;
    const W = host.clientWidth;
    const from = right ? -90 : W + 30;
    const to = right ? W + 30 : -90;
    const walkAnim = el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration: c.secs * 1000, easing: "linear", fill: "forwards" });
    feel(c.sound, null);
    // Say something halfway.
    setTimeout(() => bubble.classList.add("on"), c.secs * 300);
    setTimeout(() => bubble.classList.remove("on"), c.secs * 300 + 2600);
    let petted = false;
    el.addEventListener("click", () => {
      if (petted) return;
      petted = true;
      walkAnim.pause();
      feel(c.pet || c.sound, "success");
      haptic("celebrate");
      burst(body, { count: 30, emoji: ["💖", "✨", c.e] });
      bubble.textContent = ["hehe", "♥", "thank u", "best day ever"][Math.floor(Math.random() * 4)];
      bubble.classList.add("on");
      body.animate([{ transform: "translateY(0) scaleX(var(--flip))" }, { transform: "translateY(-40px) scaleX(var(--flip)) rotate(-15deg)" }, { transform: "translateY(0) scaleX(var(--flip))" }], { duration: 500, easing: "cubic-bezier(.3,1.5,.5,1)" });
      onPet?.(c, el);
      setTimeout(() => {
        bubble.classList.remove("on");
        walkAnim.playbackRate = 2.5;
        walkAnim.play();
      }, 1400);
    });
    walkAnim.finished.then(
      () => {
        el.remove();
        current = null;
      },
      () => {
        el.remove();
        current = null;
      },
    );
  }

  schedule(first);
  return { walk, stop: () => clearTimeout(timer) };
}

// Easter eggs. Poke a book and it does something. Some books have their own trick, picked from
// the title or author (try Harry Potter, Dune, The Hobbit, 1984, Gatsby, Alice, Hitchhiker's
// Guide, Moby-Dick, Sherlock…). Everything else cycles through a handful of party tricks.
// Poke fast enough and something bigger happens.

import { h, svg, play, wait, buzz, prefersReducedMotion } from "./util.js";
import { burst, rain } from "./confetti.js";

const GOLD = ["#ffd23d", "#ffb81f", "#fff3b0", "#ffffff"];

const BOLT = `<svg viewBox="0 0 64 100"><path d="M38 0 L8 56 H30 L22 100 L58 36 H34 L46 0 Z" fill="#ffe14d" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
const EYE = `<svg viewBox="0 0 100 60"><path d="M2 30 Q50 -14 98 30 Q50 74 2 30 Z" fill="#fff"/><circle cx="50" cy="30" r="17" fill="#e01e37"/><circle cx="50" cy="30" r="7" fill="#0a0a0a"/><circle cx="56" cy="24" r="3" fill="#fff"/></svg>`;
const RING = `<svg viewBox="0 0 100 100"><defs><linearGradient id="egg-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffb81f"/><stop offset="1" stop-color="#a86400"/></linearGradient></defs><ellipse cx="50" cy="50" rx="38" ry="38" fill="none" stroke="url(#egg-gold)" stroke-width="10"/></svg>`;

/** Themed eggs: [id, matcher, label]. */
export const THEMED = [
  ["lumos", /potter|hogwarts|rowling|wizard/i, "Lumos ⚡"],
  ["spice", /dune|arrakis|herbert/i, "The spice must flow"],
  ["precious", /hobbit|lord of the rings|tolkien|fellowship|\bring\b/i, "My precious…"],
  ["watching", /1984|orwell|big brother/i, "Big Brother is watching"],
  ["greenlight", /gatsby|fitzgerald/i, "The green light"],
  ["drinkme", /alice|wonderland|looking.glass/i, "Drink me"],
  ["fortytwo", /hitchhiker|douglas adams|galaxy/i, "Don't panic"],
  ["whale", /moby|whale|ocean|\bsea\b|old man and the sea/i, "Thar she blows"],
  ["detective", /sherlock|holmes|christie|poirot|murder|mystery|detective/i, "Elementary"],
  ["dragonfire", /dragon|throne|fire|ice and fire|fourth wing/i, "Dracarys"],
  ["liftoff", /space|mars|martian|star|rocket|planet|project hail mary/i, "Liftoff"],
  ["heart", /love|romance|heart|pride and prejudice|austen|kiss/i, "Swoon"],
];

const PARTY = ["flip", "open", "jelly", "disco", "boing"];
const PARTY_LABEL = { flip: "Kickflip", open: "Peek inside", jelly: "Jelly mode", disco: "Disco fever", boing: "Boing", supernova: "SUPERNOVA" };

export function themedEgg(book) {
  const text = `${book.title} ${book.author}`;
  return THEMED.find(([, re]) => re.test(text)) || null;
}

const taps = new WeakMap();

/**
 * Poke a book. Returns { egg, label } for whatever played.
 * `art` is the .book element from cover.js.
 */
export async function poke(book, art, count = 0) {
  const now = performance.now();
  const hist = (taps.get(art) || []).filter((t) => now - t < 1800);
  hist.push(now);
  taps.set(art, hist);

  let egg;
  let label;
  const theme = themedEgg(book);
  if (hist.length >= 5) {
    taps.set(art, []);
    egg = "supernova";
  } else if (theme && count % 2 === 0) {
    [egg, , label] = theme;
  } else {
    egg = PARTY[(count + (book.seed % PARTY.length)) % PARTY.length];
  }
  label ||= PARTY_LABEL[egg];
  buzz([6, 20, 6]);
  if (!prefersReducedMotion()) await (TRICKS[egg] || TRICKS.jelly)(art);
  return { egg, label };
}

const box = (art) => art.querySelector(".book-3d");
const fx = (art) => art.querySelector(".book-fx");
const overlay = (art, cls, child) => {
  const el = h("div", { class: `egg ${cls}` }, child);
  fx(art).append(el);
  return el;
};

const TRICKS = {
  async lumos(art) {
    const bolt = overlay(art, "egg-bolt", svg(BOLT));
    play(art, [{ filter: "brightness(1)" }, { filter: "brightness(2.4) saturate(1.4)", offset: 0.12 }, { filter: "brightness(0.8)", offset: 0.24 }, { filter: "brightness(2)", offset: 0.34 }, { filter: "brightness(1)" }], { duration: 900 });
    burst(art, { count: 70, colors: GOLD, kinds: ["star", "dot"], power: 1.1, emoji: ["✨", "⚡"] });
    await play(bolt, [{ transform: "scale(0) rotate(-20deg)", opacity: 0 }, { transform: "scale(1.3) rotate(6deg)", opacity: 1, offset: 0.25 }, { transform: "scale(1)", opacity: 1, offset: 0.7 }, { transform: "scale(1.6)", opacity: 0 }], { duration: 1200, easing: "ease-out" });
    bolt.remove();
  },
  async spice(art) {
    burst(art, { count: 90, colors: ["#e8b45a", "#c98b2e", "#f5d491", "#a0611d"], kinds: ["dot"], spread: 1.4, power: 0.8 });
    await play(box(art), [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ transform: `translate(${i % 2 ? 6 : -6}px, ${i % 3 ? 3 : -3}px) rotate(${i % 2 ? 2 : -2}deg)` })).concat([{ transform: "none" }]), { duration: 900 });
  },
  async precious(art) {
    const ring = overlay(art, "egg-ring", svg(RING));
    play(ring, [{ transform: "translateY(-120%) scale(0.4) rotateX(70deg)", opacity: 0 }, { transform: "translateY(0) scale(1) rotateX(70deg)", opacity: 1, offset: 0.35 }, { transform: "rotateX(70deg) rotateZ(360deg)", opacity: 1, offset: 0.8 }, { transform: "scale(2) rotateX(70deg)", opacity: 0 }], { duration: 1800, easing: "ease-in-out" });
    await play(box(art), [{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0.08, filter: "blur(3px)", offset: 0.55 }, { opacity: 0.08, filter: "blur(3px)", offset: 0.8 }, { opacity: 1 }], { duration: 1800 });
    burst(art, { count: 40, colors: GOLD, kinds: ["dot", "star"] });
    ring.remove();
  },
  async watching(art) {
    const eye = overlay(art, "egg-eye", svg(EYE));
    await play(eye, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)", offset: 0.2 }, { transform: "scaleY(1) translateX(-14px)", offset: 0.4 }, { transform: "scaleY(1) translateX(14px)", offset: 0.6 }, { transform: "scaleY(0.05)", offset: 0.7 }, { transform: "scaleY(1)", offset: 0.8 }, { transform: "scaleY(0)" }], { duration: 2000, easing: "ease-in-out" });
    eye.remove();
  },
  async greenlight(art) {
    const glow = overlay(art, "egg-glow", null);
    burst(art, { count: 60, colors: ["#ffd23d", "#fff3b0", "#3dffb0"], kinds: ["star", "rect"], emoji: ["🥂", "🍾"] });
    await play(glow, [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "scale(1.2)", offset: 0.3 }, { opacity: 0.4, transform: "scale(1)", offset: 0.6 }, { opacity: 1, transform: "scale(1.3)", offset: 0.8 }, { opacity: 0, transform: "scale(1.6)" }], { duration: 1600 });
    glow.remove();
  },
  async drinkme(art) {
    await play(box(art), [{ transform: "none" }, { transform: "scale(0.25) rotate(-10deg)", offset: 0.3 }, { transform: "scale(0.25) rotate(10deg)", offset: 0.45 }, { transform: "scale(1.5) rotate(0)", offset: 0.75 }, { transform: "none" }], { duration: 1600, easing: "cubic-bezier(.5,0,.3,1.4)" });
    burst(art, { count: 30, emoji: ["🐇", "🫖", "🎩", "🍄"], kinds: ["dot"] });
  },
  async fortytwo(art) {
    const n = overlay(art, "egg-text", h("span", {}, h("b", { text: "42" }), h("small", { text: "DON'T PANIC" })));
    burst(art, { count: 30, emoji: ["🐬", "🌌", "🫖"], kinds: ["star"] });
    await play(n, [{ transform: "rotate(-540deg) scale(0)", opacity: 0 }, { transform: "rotate(0) scale(1.15)", opacity: 1, offset: 0.4 }, { transform: "scale(1)", opacity: 1, offset: 0.8 }, { transform: "scale(1.4)", opacity: 0 }], { duration: 2000, easing: "cubic-bezier(.2,.8,.2,1)" });
    n.remove();
  },
  async whale(art) {
    const wave = overlay(art, "egg-wave", null);
    burst(art, { count: 50, colors: ["#2de2ff", "#7af0ff", "#ffffff"], kinds: ["dot"], emoji: ["🐳", "💦"], spread: 0.6, power: 1.2 });
    play(box(art), [{ transform: "none" }, { transform: "rotate(-6deg) translateY(-4px)" }, { transform: "rotate(6deg) translateY(4px)" }, { transform: "rotate(-4deg)" }, { transform: "none" }], { duration: 1400, easing: "ease-in-out" });
    await play(wave, [{ transform: "translateY(100%)" }, { transform: "translateY(20%)", offset: 0.5 }, { transform: "translateY(100%)" }], { duration: 1400, easing: "ease-in-out" });
    wave.remove();
  },
  async detective(art) {
    const lens = overlay(art, "egg-lens", h("span", { text: "🔍" }));
    await play(lens, [{ transform: "translate(-60%, -40%) scale(0.6)", opacity: 0 }, { transform: "translate(-30%, -30%) scale(1.2)", opacity: 1, offset: 0.2 }, { transform: "translate(30%, -10%) scale(1.2)", offset: 0.45 }, { transform: "translate(-20%, 30%) scale(1.2)", offset: 0.7 }, { transform: "translate(0, 0) scale(2)", opacity: 0 }], { duration: 2000, easing: "ease-in-out" });
    lens.remove();
  },
  async dragonfire(art) {
    burst(art, { count: 90, colors: ["#ff3d3d", "#ff8a3d", "#ffd23d", "#fff3b0"], kinds: ["dot", "dot", "star"], power: 1.3, emoji: ["🔥", "🐉"] });
    await play(box(art), [{ filter: "none", transform: "none" }, { filter: "sepia(1) saturate(4) hue-rotate(-20deg) brightness(1.3)", transform: "scale(1.08) rotate(-3deg)", offset: 0.3 }, { transform: "scale(1.08) rotate(3deg)", offset: 0.5 }, { filter: "none", transform: "none" }], { duration: 1300 });
  },
  async liftoff(art) {
    await play(box(art), [{ transform: "none" }, { transform: "translateY(4px)", offset: 0.1 }, { transform: "translateY(-2px) rotate(-1deg)", offset: 0.2 }, { transform: "translateY(2px) rotate(1deg)", offset: 0.3 }, { transform: "translateY(-140%) rotate(0)", opacity: 1, offset: 0.65 }, { transform: "translateY(-140%)", opacity: 0, offset: 0.66 }, { transform: "translateY(40px)", opacity: 0, offset: 0.67 }, { transform: "none", opacity: 1 }], { duration: 2200, easing: "cubic-bezier(.5,0,.5,1)" });
    burst(art, { count: 40, emoji: ["🚀", "⭐", "🪐"], kinds: ["star"] });
  },
  async heart(art) {
    burst(art, { count: 50, colors: ["#ff3d7f", "#ff6bd6", "#ffb3d1"], kinds: ["dot"], emoji: ["💖", "💘", "💕"] });
    await play(box(art), [{ transform: "scale(1)" }, { transform: "scale(1.15)", offset: 0.15 }, { transform: "scale(1)", offset: 0.3 }, { transform: "scale(1.2)", offset: 0.45 }, { transform: "scale(1)" }], { duration: 1100, easing: "ease-in-out" });
  },

  async flip(art) {
    await play(box(art), [{ transform: "rotateY(0) translateY(0)" }, { transform: "rotateY(180deg) translateY(-40px)", offset: 0.5 }, { transform: "rotateY(360deg) translateY(0)" }], { duration: 900, easing: "cubic-bezier(.4,0,.2,1)" });
    burst(art, { count: 24, kinds: ["star"] });
  },
  async open(art) {
    art.classList.add("peek");
    await wait(1500);
    art.classList.remove("peek");
    await wait(500);
  },
  async jelly(art) {
    await play(box(art), [{ transform: "scale(1,1)" }, { transform: "scale(1.25,0.75)" }, { transform: "scale(0.75,1.25)" }, { transform: "scale(1.15,0.85)" }, { transform: "scale(0.95,1.05)" }, { transform: "scale(1.05,0.95)" }, { transform: "scale(1,1)" }], { duration: 900 });
  },
  async disco(art) {
    burst(art, { count: 40, emoji: ["🪩", "💃", "🕺"], kinds: ["star", "dot"] });
    await play(art, [{ filter: "hue-rotate(0)" }, { filter: "hue-rotate(360deg) saturate(2)" }, { filter: "hue-rotate(720deg)" }], { duration: 1500 });
  },
  async boing(art) {
    await play(box(art), [{ transform: "translateY(0)" }, { transform: "translateY(-60px) scale(0.95,1.05)", offset: 0.3 }, { transform: "translateY(0) scale(1.2,0.8)", offset: 0.5 }, { transform: "translateY(-24px)", offset: 0.7 }, { transform: "translateY(0) scale(1.05,0.95)", offset: 0.85 }, { transform: "none" }], { duration: 1000, easing: "ease-out" });
  },
  async supernova(art) {
    burst(art, { count: 160, power: 1.6, spread: 2, emoji: ["💥", "🌟", "🤯"] });
    rain({ count: 120 });
    await play(box(art), [{ transform: "none", filter: "none" }, { transform: "scale(1.3) rotate(720deg)", filter: "brightness(2) saturate(2)", offset: 0.6 }, { transform: "none", filter: "none" }], { duration: 1400, easing: "cubic-bezier(.2,.8,.2,1)" });
  },
};

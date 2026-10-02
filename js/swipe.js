// "Pick my next read": your want-to-read pile as a stack of cards. Drag the top one right to
// start reading it, left to send it to the bottom of the pile. The card leans as you drag, a
// stamp fades in, and a fast flick counts even if it's short.

import { h, clamp, buzz, prefersReducedMotion, SPRING } from "./util.js";

export function createDeck(root, { cards, render, onRight, onLeft, onEmpty }) {
  let pile = [...cards];
  const stack = h("div", { class: "deck-stack" });
  const nope = h("button", { type: "button", class: "deck-btn nope", "aria-label": "Later" }, "👎");
  const yes = h("button", { type: "button", class: "deck-btn yes", "aria-label": "Start reading" }, "📖");
  const hint = h("p", { class: "deck-hint", text: "Swipe right to start · left for later" });
  root.replaceChildren(stack, h("div", { class: "deck-actions" }, nope, hint, yes));
  let busy = false;
  let drawn = false;

  function draw() {
    stack.replaceChildren();
    if (!pile.length) {
      stack.append(h("div", { class: "deck-empty" }, h("span", { class: "big", text: "🫙" }), h("b", { text: "The pile is empty" }), h("span", { text: "Add more books you want to read." })));
      onEmpty?.();
      return;
    }
    pile.slice(0, 3).forEach((book, i) => {
      const card = h(
        "div",
        { class: "deck-card", vars: { "--i": i }, "data-id": book.id },
        render(book),
        h("span", { class: "stamp yes", text: "READ NOW" }),
        h("span", { class: "stamp nope", text: "LATER" }),
      );
      stack.prepend(card);
    });
    // Everyone moves up a place.
    if (drawn && !prefersReducedMotion())
      [...stack.children].reverse().forEach((card, i) =>
        card.animate([{ translate: `0 ${(i + 1) * 26}px`, scale: String(1 - (i + 1) * 0.05), rotate: `${(i + 1) * 2.5}deg`, opacity: i === 2 ? 0 : 1 }, { translate: `0 ${i * 26}px`, scale: String(1 - i * 0.05), rotate: `${i * 2.5}deg`, opacity: 1 }], { duration: 480, easing: SPRING }),
      );
    drawn = true;
    grab(stack.lastElementChild);
  }

  function grab(card) {
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let dy = 0;
    let t0 = 0;
    let id = null;
    const stampY = card.querySelector(".stamp.yes");
    const stampN = card.querySelector(".stamp.nope");
    const paint = () => {
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.07}deg)`;
      stampY.style.opacity = String(clamp(dx / 110, 0, 1));
      stampN.style.opacity = String(clamp(-dx / 110, 0, 1));
      root.style.setProperty("--pull", String(clamp(Math.abs(dx) / 140, 0, 1)));
    };
    card.addEventListener("pointerdown", (e) => {
      if (busy || e.button > 0) return;
      id = e.pointerId;
      card.setPointerCapture(id);
      x0 = e.clientX;
      y0 = e.clientY;
      t0 = performance.now();
      card.classList.add("dragging");
    });
    card.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      dx = e.clientX - x0;
      dy = (e.clientY - y0) * 0.4;
      paint();
    });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      card.classList.remove("dragging");
      const v = dx / Math.max(1, performance.now() - t0);
      if (Math.abs(dx) > 110 || (Math.abs(v) > 0.6 && Math.abs(dx) > 30)) fling(card, dx > 0 ? 1 : -1, dx, dy);
      else {
        card.animate([{ transform: card.style.transform }, { transform: "none" }], { duration: 520, easing: SPRING });
        dx = dy = 0;
        card.style.transform = "";
        stampY.style.opacity = stampN.style.opacity = "0";
        root.style.setProperty("--pull", "0");
      }
    };
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
  }

  async function fling(card, dir, dx = 0, dy = 0) {
    if (busy || !card) return;
    busy = true;
    buzz(dir > 0 ? [8, 30, 12] : 8);
    const book = pile[0];
    card.querySelector(dir > 0 ? ".stamp.yes" : ".stamp.nope").style.opacity = "1";
    if (!prefersReducedMotion()) {
      await card
        .animate(
          [
            { transform: `translate(${dx}px, ${dy}px) rotate(${dx * 0.07}deg)` },
            { transform: `translate(${dir * innerWidth * 1.1}px, ${dy - 60}px) rotate(${dir * 32}deg)` },
          ],
          { duration: 380, easing: "cubic-bezier(.4,.1,.8,.6)", fill: "forwards" },
        )
        .finished.catch(() => {});
    }
    root.style.setProperty("--pull", "0");
    pile.shift();
    if (dir < 0) pile.push(book);
    busy = false;
    (dir > 0 ? onRight : onLeft)?.(book);
    draw();
  }

  nope.addEventListener("click", () => fling(stack.lastElementChild?.matches(".deck-card") ? stack.lastElementChild : null, -1));
  yes.addEventListener("click", () => fling(stack.lastElementChild?.matches(".deck-card") ? stack.lastElementChild : null, 1));
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") yes.click();
    if (e.key === "ArrowLeft") nope.click();
  });

  draw();
  return { get size() { return pile.length; } };
}

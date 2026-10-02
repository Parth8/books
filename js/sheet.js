// Bottom sheets on top of <dialog>, so focus, Escape and the back layer come for free.
// They spring up from the bottom, and you can drag them down (by the handle or the top edge)
// or tap outside to close.

import { prefersReducedMotion, SPRING } from "./util.js";

const open = new Set();

export function sheet(dialog, { onClose } = {}) {
  const card = dialog.querySelector(".sheet-card");
  let closing = false;

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) close();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });

  // Drag down to dismiss.
  let y0 = null;
  let dy = 0;
  let id = null;
  card.addEventListener("pointerdown", (e) => {
    const onHandle = e.target.closest(".grab") || (e.clientY - card.getBoundingClientRect().top < 56 && !e.target.closest("button, input, a, .wheel"));
    if (!onHandle || card.scrollTop > 0) return;
    id = e.pointerId;
    y0 = e.clientY;
    dy = 0;
    card.setPointerCapture(id);
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    dy = Math.max(0, e.clientY - y0);
    card.style.transform = `translateY(${dy}px)`;
    dialog.style.setProperty("--dim", String(Math.max(0, 1 - dy / 400)));
  });
  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    card.style.transition = "";
    if (dy > 110) close(dy);
    else {
      card.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, easing: SPRING });
      card.style.transform = "";
      dialog.style.removeProperty("--dim");
    }
  };
  card.addEventListener("pointerup", up);
  card.addEventListener("pointercancel", up);

  function backdrop([a, b], duration) {
    try {
      return dialog.animate([{ opacity: a }, { opacity: b }], { duration, fill: "forwards", pseudoElement: "::backdrop" }).finished;
    } catch {
      return Promise.resolve();
    }
  }

  function show() {
    closing = false;
    card.style.transform = "";
    dialog.style.removeProperty("--dim");
    if (!dialog.open) dialog.showModal();
    open.add(dialog);
    document.documentElement.classList.add("sheet-open");
    if (!prefersReducedMotion()) {
      card.animate([{ transform: "translateY(105%)" }, { transform: "none" }], { duration: 640, easing: SPRING });
      backdrop([0, 1], 260);
    }
  }

  async function close(from = 0) {
    if (closing || !dialog.open) return;
    closing = true;
    if (!prefersReducedMotion()) {
      await Promise.all([
        card.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(110%)" }], { duration: 300, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).finished,
        backdrop([1, 0], 300),
      ]).catch(() => {});
    }
    dialog.close();
    for (const a of dialog.getAnimations({ subtree: true })) if (!(a instanceof CSSAnimation || a instanceof CSSTransition)) a.cancel();
    card.style.transform = "";
    open.delete(dialog);
    if (!open.size) document.documentElement.classList.remove("sheet-open");
    onClose?.();
  }

  return { show, close, get isOpen() { return dialog.open; }, card };
}

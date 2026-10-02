// Pop-ups: chunky, fluorescent cards that spring in over a dimmed screen. One at a time,
// keyboard friendly (Escape cancels, Enter confirms, focus stays inside), and they resolve with
// the id of the button that was pressed.
//
//   const choice = await popup({ tone: "lime", icon: "👋", title: "HI!", text: "…",
//                                actions: [{ id: "no", label: "NOT NOW" }, { id: "yes", label: "YES", primary: true }] })

import { h, prefersReducedMotion } from "./util.js";
import { feel } from "./sfx.js";

const TONES = {
  lime: ["#e7ff3d", "#0d0d0d"],
  pink: ["#ff6ad5", "#0d0d0d"],
  orange: ["#ff5a1f", "#0d0d0d"],
  cyan: ["#25c7ff", "#0d0d0d"],
  yellow: ["#ffd60a", "#0d0d0d"],
  blue: ["#2b3bff", "#ffffff"],
  cream: ["#f6f1e6", "#0d0d0d"],
  danger: ["#1a0306", "#ffffff"],
};

const queue = [];
let busy = false;

export function popup(opts) {
  return new Promise((resolve) => {
    queue.push({ opts, resolve });
    if (!busy) next();
  });
}

function next() {
  const job = queue.shift();
  if (!job) return void (busy = false);
  busy = true;
  show(job.opts).then((v) => {
    job.resolve(v);
    setTimeout(next, 120);
  });
}

function show({ tone = "lime", icon = null, title = "", text = "", body = null, actions = [{ id: "ok", label: "GOT IT", primary: true }], input = null, danger = false, dismissable = true, sound = "pop" }) {
  return new Promise((resolve) => {
    const [bg, ink] = TONES[tone] || TONES.lime;
    const field = input
      ? h("input", {
          class: "pop-input",
          type: "text",
          autocomplete: "off",
          autocapitalize: input.capitalize || "off",
          spellcheck: "false",
          maxLength: input.max || 40,
          placeholder: input.placeholder || "",
          value: input.value || "",
          "aria-label": input.label || title,
          enterkeyhint: "done",
        })
      : null;
    const buttons = actions.map((a) =>
      h("button", { type: "button", class: `pop-btn${a.primary ? " primary" : ""}${a.danger ? " danger" : ""}`, "data-id": a.id, text: a.label }),
    );
    const card = h(
      "div",
      { class: `pop-card${danger ? " is-danger" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title, vars: { "--pop-bg": bg, "--pop-ink": ink } },
      icon ? h("div", { class: `pop-icon${danger ? " danger" : ""}`, "aria-hidden": "true" }, icon) : null,
      title ? h("h2", { class: "pop-title", text: title }) : null,
      text ? h("p", { class: "pop-text", text }) : null,
      body,
      field,
      h("div", { class: "pop-actions" }, buttons),
    );
    const wrap = h("div", { class: "pop", popover: "manual" }, h("div", { class: "pop-dim" }), card);
    document.body.append(wrap);
    try {
      wrap.showPopover?.();
    } catch {}
    const app = document.getElementById("app");
    const wasInert = app?.inert;
    if (app) app.inert = true;
    feel(sound, danger ? "warning" : "light");
    if (!prefersReducedMotion()) {
      card.animate([{ transform: "scale(.6) rotate(-6deg)", opacity: 0 }, { transform: "scale(1.04) rotate(1deg)", opacity: 1, offset: 0.6 }, { transform: "none", opacity: 1 }], { duration: 520, easing: "cubic-bezier(.2,1.4,.4,1)" });
      wrap.firstChild.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    }

    const primary = actions.find((a) => a.primary) || actions[actions.length - 1];
    const refresh = () => {
      if (!input?.match) return;
      const ok = input.match(field.value);
      for (const b of buttons) if (b.dataset.id === primary.id) b.disabled = !ok;
    };
    field?.addEventListener("input", refresh);
    refresh();

    let done = false;
    const close = (id) => {
      if (done) return;
      const a = actions.find((x) => x.id === id);
      if (a?.primary && input?.match && !input.match(field.value)) {
        feel("error", "error");
        if (!prefersReducedMotion()) card.animate([{ transform: "translateX(-10px)" }, { transform: "translateX(10px)" }, { transform: "translateX(-6px)" }, { transform: "none" }], { duration: 320 });
        return;
      }
      done = true;
      const value = field ? field.value : undefined;
      const finish = () => {
        wrap.remove();
        if (app) app.inert = !!wasInert;
        resolve(input ? { id, value } : id);
      };
      if (prefersReducedMotion()) return finish();
      card.animate([{ transform: "none", opacity: 1 }, { transform: "scale(.85) translateY(20px)", opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
      wrap.firstChild.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished.then(finish, finish);
    };
    for (const b of buttons) b.addEventListener("click", () => close(b.dataset.id));
    const cancelId = actions.find((a) => a.cancel)?.id || (dismissable ? "dismiss" : null);
    wrap.firstChild.addEventListener("click", () => cancelId && close(cancelId));
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && cancelId) close(cancelId);
      if (e.key === "Enter" && (e.target === field || !field)) {
        e.preventDefault();
        close(primary.id);
      }
      if (e.key === "Tab") {
        // Keep focus inside the pop-up.
        const f = [...card.querySelectorAll("input, button:not([disabled])")];
        const k = f.indexOf(document.activeElement);
        if (e.shiftKey && k <= 0) (e.preventDefault(), f[f.length - 1].focus());
        else if (!e.shiftKey && k === f.length - 1) (e.preventDefault(), f[0].focus());
      }
    });
    setTimeout(() => (field || buttons.find((b) => b.dataset.id === primary.id) || buttons[0])?.focus({ preventScroll: true }), 60);
  });
}

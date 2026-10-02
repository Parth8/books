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

function show({ tone = "lime", icon = null, title = "", text = "", body = null, actions = [{ id: "ok", label: "GOT IT", primary: true }], input = null, danger = false, dismissable = true, sound = "pop", hook = null, fields = null, submit = null, onInput = null, after = null }) {
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
    // A form (several fields): a real <form> with autocomplete hints, so password managers
    // can fill and save logins. Values come back as { id, values } (and `result` from submit).
    const inputs = (fields || []).map((f) => {
      const el = h("input", {
        class: "pop-input",
        type: f.type || "text",
        name: f.name,
        autocomplete: f.autocomplete || "off",
        autocapitalize: f.capitalize || "off",
        spellcheck: "false",
        maxLength: f.max || 128,
        placeholder: f.placeholder || "",
        value: f.value || "",
        "aria-label": f.label || f.placeholder || f.name,
        inputmode: f.inputmode || null,
        enterkeyhint: f.enter || "next",
      });
      if (f.type !== "password") return { f, el, row: el };
      const eye = h("button", { type: "button", class: "pop-eye", "aria-label": "Show password", text: "👁" });
      eye.addEventListener("click", () => {
        const show = el.type === "password";
        el.type = show ? "text" : "password";
        eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
        eye.classList.toggle("on", show);
        el.focus();
      });
      return { f, el, row: h("div", { class: "pop-pw" }, el, eye) };
    });
    const values = () => Object.fromEntries(inputs.map(({ f, el }) => [f.name, el.value]));
    const error = fields ? h("p", { class: "pop-error", role: "alert" }) : null;
    const form = fields ? h("form", { class: "pop-form", novalidate: true }, inputs.map((i) => i.row)) : null;
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
      form,
      after,
      error,
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
    for (const { el } of inputs) el.addEventListener("input", () => {
      if (error) error.textContent = "";
      onInput?.(values(), card);
    });

    let done = false;
    let working = false;
    const shake = () => {
      feel("error", "error");
      if (!prefersReducedMotion()) card.animate([{ transform: "translateX(-10px)" }, { transform: "translateX(10px)" }, { transform: "translateX(-6px)" }, { transform: "none" }], { duration: 320 });
    };
    const close = async (id) => {
      if (done || working) return;
      const a = actions.find((x) => x.id === id);
      let result;
      if (a?.primary && input?.match && !input.match(field.value)) return shake();
      if (a?.primary && submit) {
        // Do the work with the pop-up still open: errors show here, and you can fix and retry.
        const btn = buttons.find((b) => b.dataset.id === id);
        const label = btn.textContent;
        working = true;
        btn.disabled = true;
        btn.classList.add("busy");
        btn.textContent = a.busy || "ONE MOMENT…";
        card.classList.add("working");
        try {
          result = await submit(values());
        } catch (err) {
          working = false;
          btn.disabled = false;
          btn.classList.remove("busy");
          btn.textContent = label;
          card.classList.remove("working");
          if (error) error.textContent = String(err?.message || err);
          shake();
          return;
        }
        working = false;
      }
      done = true;
      const value = field ? field.value : undefined;
      const finish = () => {
        wrap.remove();
        if (app) app.inert = !!wasInert;
        resolve(fields ? { id, values: values(), result } : input ? { id, value } : id);
      };
      if (prefersReducedMotion()) return finish();
      card.animate([{ transform: "none", opacity: 1 }, { transform: "scale(.85) translateY(20px)", opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
      wrap.firstChild.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" }).finished.then(finish, finish);
    };
    for (const b of buttons) b.addEventListener("click", () => close(b.dataset.id));
    // Content inside the pop-up (a button in its body) can close it with an id of its own.
    hook?.((id) => {
      if (!actions.some((x) => x.id === id)) actions.push({ id });
      close(id);
    });
    const cancelId = actions.find((a) => a.cancel)?.id || (dismissable ? "dismiss" : null);
    wrap.firstChild.addEventListener("click", () => cancelId && close(cancelId));
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && cancelId) close(cancelId);
      if (e.key === "Enter" && fields && e.target.tagName === "INPUT") {
        // Enter moves to the next field, and submits from the last one.
        e.preventDefault();
        const k = inputs.findIndex((i) => i.el === e.target);
        if (k >= 0 && k < inputs.length - 1) inputs[k + 1].el.focus();
        else close(primary.id);
      } else if (e.key === "Enter" && !fields && (e.target === field || !field)) {
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
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      close(primary.id);
    });
    setTimeout(() => (inputs.find((i) => !i.el.value)?.el || inputs[0]?.el || field || buttons.find((b) => b.dataset.id === primary.id) || buttons[0])?.focus({ preventScroll: true }), 60);
  });
}

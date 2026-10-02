// "Put Shelfie on your home screen" and "chip in for a chai": the two asks, kept polite.
//
// Install: the guide matches the browser in front of you (pictures for iPhone, iPad and Mac
// Safari, steps for everything else, a one-tap button where Chrome or Edge offer one). It's
// offered once on its own, after you've used the app a bit, and again at most once a fortnight
// later; after that only the key in Stats offers it.

import { h, svg } from "./util.js";
import { popup } from "./modal.js";
import { installWay, installPlace, promptInstall, appleGuide, canOpenSafari, onInstallChange } from "./install.js";
import { guideArt } from "./guide.js";

export const CHAI_URL = "https://buymeacoffee.com/parth8";
const ASKED = "shelfie.a2hs";

const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  share: icon('<path d="M12 4v11M7 9l5-5 5 5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>'),
  globe: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
};

export const canInstall = () => installWay() !== null;
export { onInstallChange };

/** The steps for this browser, as an element for a pop-up's body. */
export function installGuide(onDone) {
  const way = installWay();
  const b = (text) => h("b", { text });
  const steps = (...items) => h("ol", { class: "install-steps" }, items.map((parts) => h("li", {}, h("span", {}, parts))));
  if (way === "prompt") {
    return h(
      "button",
      {
        type: "button",
        class: "install-go",
        on: {
          click: async () => {
            const ok = await promptInstall();
            onDone?.(ok);
          },
        },
      },
      installPlace === "home" ? "📲 ADD TO HOME SCREEN" : "💻 INSTALL SHELFIE",
    );
  }
  if ((way === "ios" || way === "mac") && appleGuide) return appleSteps(appleGuide);
  if (way === "ios") return steps(["Open your browser's ", b("Share"), " menu ", svg(ICONS.share), "."], ["Choose ", b("Add to Home Screen"), "."]);
  if (way === "android") return steps(["Open your browser's menu ", b("⋮"), "."], ["Choose ", b("Add to Home screen"), " or ", b("Install app"), "."]);
  if (way === "chrome") return steps(["Open Chrome's menu ", b("⋮"), " and choose ", b("Cast, save, and share"), "."], ["Choose ", b("Install page as app"), "."]);
  if (way === "edge") return steps(["Open Edge's menu ", b("…"), " and choose ", b("Apps"), "."], ["Choose ", b("Install this site as an app"), "."]);
  return null;
}

function appleSteps(kind) {
  const b = (text) => h("b", { text });
  const addHome = ["Scroll down and choose ", b("Add to Home Screen"), "."];
  const here = location.origin + location.pathname;
  const openSafari = () => (canOpenSafari ? h("a", { class: "install-go", href: `x-safari-${here}`, rel: "noopener" }, svg(ICONS.globe), " OPEN IN SAFARI") : null);
  const copy = h("button", { type: "button", class: "install-go quiet", text: "COPY LINK" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(here);
      copy.textContent = "COPIED. PASTE IT IN SAFARI";
    } catch {
      copy.textContent = "LONG-PRESS THE ADDRESS BAR TO COPY";
    }
  });
  if (kind === "open-safari") {
    return h(
      "div",
      { class: "install-safari" },
      h("p", { class: "pop-text", text: canOpenSafari ? "Apps' built-in browsers can't add to the home screen. Open Shelfie in Safari, then add it from there in two taps." : "Only Safari can add Shelfie to your home screen from here. Copy the link, open Safari, and paste it in." }),
      h("div", { class: "install-actions" }, openSafari(), copy),
    );
  }
  const textSteps = {
    firefox: [["Tap the menu ", b("☰"), " at the bottom right."], ["Tap ", b("Share"), ", then ", b("Add to Home Screen"), "."]],
    edge: [["Tap ", b("•••"), " at the bottom of the screen."], ["Tap ", b("Share"), ", then ", b("Add to Home Screen"), "."]],
    other: [["Open your browser's ", b("Share"), " menu."], ["Choose ", b("Add to Home Screen"), "."]],
  }[kind];
  if (textSteps) {
    return h(
      "div",
      { class: "install-safari" },
      h("ol", { class: "install-steps" }, textSteps.map((t) => h("li", {}, h("span", {}, t)))),
      canOpenSafari ? h("p", { class: "pop-text", text: "Don't see it? Safari always can:" }) : null,
      canOpenSafari ? h("div", { class: "install-actions" }, openSafari()) : null,
    );
  }
  const captions = {
    safari: [["Tap ", b("Share"), " in the toolbar."], addHome],
    safari26: [["Tap ", b("•••"), ", then ", b("Share"), "."], addHome],
    ipad: [["Tap ", b("Share"), " at the top right."], addHome],
    chrome: [["Tap ", b("Share"), " in the address bar."], addHome],
    mac: [["In the menu bar, open ", b("File"), "."], ["Choose ", b("Add to Dock"), "."]],
  }[kind];
  return h("ol", { class: "guide" }, guideArt[kind].map((art, i) => h("li", {}, h("span", { class: "guide-art" }, svg(art)), h("span", { class: "guide-cap" }, captions[i]))));
}

/** The pop-up. Resolves when it closes. */
export async function showInstall({ name = "" } = {}) {
  const onHome = installPlace === "home";
  let closeWith = null;
  const guide = installGuide((ok) => closeWith?.(ok));
  const why = h("p", {
    class: "pop-text",
    text: `${name ? `${name}, k` : "K"}eep Shelfie one tap away. It opens full-screen like a real app: no app store, nothing to update, and your streak is always right there.`,
  });
  const res = popup({
    tone: "cyan",
    icon: onHome ? "📲" : "💻",
    title: onHome ? "PUT ME ON YOUR HOME SCREEN" : "INSTALL SHELFIE",
    body: h("div", { class: "install-body" }, why, guide),
    actions: [{ id: "later", label: "MAYBE LATER", cancel: true }],
    hook: (close) => (closeWith = (ok) => close(ok ? "installed" : "later")),
  });
  return res;
}

/** Offer it by itself, politely: never twice in a fortnight, never more than twice ever. */
export function shouldOffer(now = Date.now()) {
  if (!canInstall()) return false;
  let rec = { n: 0, at: 0 };
  try {
    rec = { ...rec, ...JSON.parse(localStorage.getItem(ASKED) || "{}") };
  } catch {}
  return rec.n < 2 && now - rec.at > 14 * 86400000;
}
export function markOffered(now = Date.now()) {
  try {
    const rec = JSON.parse(localStorage.getItem(ASKED) || "{}");
    localStorage.setItem(ASKED, JSON.stringify({ n: (rec.n || 0) + 1, at: now }));
  } catch {}
}

/** The chai card for the bottom of Stats. */
export function chaiCard(name = "") {
  return h(
    "div",
    { class: "chai-card" },
    h("span", { class: "chai-cup", "aria-hidden": "true", text: "☕" }),
    h("b", { class: "chai-title", text: "CHIP IN FOR A CHAI" }),
    h("p", {
      class: "chai-text",
      text: `Shelfie is free, has no ads, and never sells your data${name ? `, ${name}` : ""}. Servers for search, covers and backups cost a little as more readers join. If it keeps you reading, a chai keeps it running.`,
    }),
    h("a", { class: "chai-btn", href: CHAI_URL, target: "_blank", rel: "noopener noreferrer" }, "☕ BUY ME A CHAI ↗"),
    h("small", { class: "chai-note", text: "TOTALLY OPTIONAL. EVERYTHING STAYS FREE." }),
  );
}

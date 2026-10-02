// Renders the app icon in every size the site needs, from the one mark below.
//   NODE_PATH=$(npm root -g) node tools/build-icons.mjs
//
// The mark: a neon book leaning on nothing, a lime bookmark ribbon and a spark. Same palette as
// the app: hot pink into sunshine on near-black.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** full: fill the whole square (iOS and Android round the corners themselves). k: scale about the centre. */
export function mark({ full = false, k = 1, id = "s" } = {}) {
  const rx = full ? 0 : 15;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="${id}g" cx="0.3" cy="0.25" r="0.9"><stop offset="0" stop-color="#3a1030"/><stop offset="1" stop-color="#0b0a12"/></radialGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3d7f"/><stop offset="1" stop-color="#ffb81f"/></linearGradient>
  </defs>
  <rect width="64" height="64" rx="${rx}" fill="url(#${id}g)"/>
  <g transform="translate(32 32) scale(${k}) translate(-32 -32)">
    <g transform="rotate(-10 32 34)">
      <rect x="20" y="13" width="27" height="38" rx="3.5" fill="#f3ecdd"/>
      <rect x="18" y="12" width="26" height="38" rx="3.5" fill="url(#${id}b)"/>
      <rect x="18" y="12" width="4" height="38" rx="2" fill="#000" opacity="0.22"/>
      <path d="M34 12 v15 l3.5 -3 l3.5 3 v-15 z" fill="#c6ff3d"/>
      <rect x="25" y="36" width="13" height="2.6" rx="1.3" fill="#fff" opacity="0.9"/>
      <rect x="25" y="41" width="9" height="2.6" rx="1.3" fill="#fff" opacity="0.6"/>
    </g>
    <path d="M51 8 l1.6 4.4 l4.4 1.6 l-4.4 1.6 l-1.6 4.4 l-1.6 -4.4 l-4.4 -1.6 l4.4 -1.6 z" fill="#2de2ff"/>
  </g>
</svg>`;
}

const ROOT = new URL("../", import.meta.url);
const pngs = {
  "icons/apple-touch-icon.png": [180, mark({ full: true })],
  "icons/icon-192.png": [192, mark()],
  "icons/icon-512.png": [512, mark()],
  "icons/icon-maskable-512.png": [512, mark({ full: true, k: 0.78 })],
};

writeFileSync(new URL("favicon.svg", ROOT), mark().replace(/\n\s*/g, ""));

const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, [size, svgText]] of Object.entries(pngs)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svgText}`);
  writeFileSync(new URL(file, ROOT), await page.screenshot({ omitBackground: true }));
}
await browser.close();
console.log("icons written");

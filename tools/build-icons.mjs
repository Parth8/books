// Renders the app icon in every size the site needs, from the one mark below.
//   NODE_PATH=$(npm root -g) node tools/build-icons.mjs
//
// The mark: a cream postage stamp with a perforated edge, tilted on electric blue, its window
// half full of lime liquid, like a book you're halfway through.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** full: fill the whole square (iOS and Android round the corners themselves). k: scale about the centre. */
export function mark({ full = false, k = 1 } = {}) {
  const rx = full ? 0 : 15;
  // Perforations: little circles punched along the stamp's edge.
  const holes = [];
  for (let i = 0; i <= 8; i++) holes.push([19 + i * 3.25, 13], [19 + i * 3.25, 51]);
  for (let i = 0; i <= 11; i++) holes.push([19, 13 + i * 3.45], [45, 13 + i * 3.45]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><mask id="m"><rect width="64" height="64" fill="#fff"/>${holes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25" fill="#000"/>`).join("")}</mask></defs>
  <rect width="64" height="64" rx="${rx}" fill="#2b3bff"/>
  <g transform="translate(32 32) scale(${k}) translate(-32 -32) rotate(-8 32 32)">
    <rect x="19" y="13" width="26" height="38" fill="#000" opacity=".25" transform="translate(1.5 2)"/>
    <rect x="19" y="13" width="26" height="38" fill="#f6f1e6" mask="url(#m)"/>
    <rect x="22.5" y="20" width="19" height="22" fill="#111"/>
    <path d="M22.5 31 q2.4 -1.6 4.75 0 t4.75 0 t4.75 0 t4.75 0 V42 H22.5 Z" fill="#e7ff3d"/>
    <rect x="22.5" y="15.5" width="7" height="2.6" fill="#111"/>
    <rect x="22.5" y="44.5" width="14" height="2.4" fill="#111"/>
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

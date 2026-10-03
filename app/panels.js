// Which panels are up, and how far. While any is up, the stage behind it holds still (body.panel-up),
// so the panel gets the whole frame budget. Kept on its own because panels report in while they
// are being built, before the rest of the screen exists.

import { liquid } from "./boot.js";

const panelsUp = new Map(); // how far each panel is open

/**
 * While a panel is up, everything behind it holds still (the liquid, the marquee, the drift),
 * so the panel itself gets the whole frame budget: no jank on the way up or down.
 */
export function panelProgress(name, p) {
  panelsUp.set(name, p);
  const up = [...panelsUp.values()].some((v) => v > 0.02);
  if (up === document.body.classList.contains("panel-up")) return;
  document.body.classList.toggle("panel-up", up);
  if (!up) liquid?.wake?.();
}

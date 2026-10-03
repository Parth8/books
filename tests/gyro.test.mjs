import { test } from "node:test";
import assert from "node:assert/strict";
import { gestureReader } from "../js/gyro.js";

// A gesture as the gyroscope reports it: a quick turn one way, the swing back, then still.
// (rate in degrees a second, one sample every 16 ms)
function play(read, axis, peak, { ms = 160, back = true, t0 = 0 } = {}) {
  const out = [];
  let t = t0;
  const step = (v) => {
    t += 16;
    const g = read(t, { alpha: 0, beta: 0, gamma: 0, [axis]: v });
    if (g) out.push(g);
  };
  const n = Math.round(ms / 16);
  for (let i = 0; i < n; i++) step(peak * Math.sin((Math.PI * (i + 0.5)) / n));
  if (back) for (let i = 0; i < n; i++) step(-peak * Math.sin((Math.PI * (i + 0.5)) / n));
  for (let i = 0; i < 15; i++) step(0);
  return { out, t };
}

test("a flick right then left: next, then previous (the swing back never counts)", () => {
  const read = gestureReader();
  let r = play(read, "gamma", 400);
  assert.deepEqual(r.out, ["next"]);
  r = play(read, "gamma", -400, { t0: r.t });
  assert.deepEqual(r.out, ["prev"]);
});

test("a twist goes through shelves; a tip of the top towards you adds", () => {
  const read = gestureReader();
  let r = play(read, "alpha", -500);
  assert.deepEqual(r.out, ["shelfNext"]);
  r = play(read, "alpha", 500, { t0: r.t });
  assert.deepEqual(r.out, ["shelfPrev"]);
  r = play(read, "beta", 400, { t0: r.t });
  assert.deepEqual(r.out, ["add"]);
  r = play(read, "beta", -400, { t0: r.t });
  assert.deepEqual(r.out, [], "tipping it away is just how people hold phones");
});

test("small wobbles and slow turns do nothing", () => {
  const read = gestureReader();
  assert.deepEqual(play(read, "gamma", 90).out, []);
  // 40° turned over two seconds: reading in bed, not a gesture.
  assert.deepEqual(play(read, "gamma", 20, { ms: 2000, back: false }).out, []);
});

test("a turn about two axes at once is not mistaken for either", () => {
  const read = gestureReader();
  let t = 0;
  const out = [];
  for (let i = 0; i < 10; i++) {
    t += 16;
    const g = read(t, { alpha: 380, beta: 0, gamma: 330 });
    if (g) out.push(g);
  }
  assert.deepEqual(out, []);
});

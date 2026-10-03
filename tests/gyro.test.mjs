import { test } from "node:test";
import assert from "node:assert/strict";
import { gestureReader, toDevice, AXES, bounceOf } from "../js/gyro.js";

// A gesture as the gyroscope reports it: a quick turn one way, the swing back, then still.
// (rate in degrees a second about the phone's own axes, one sample every 16 ms)
function play(read, axis, peak, { ms = 160, back = true, t0 = 0, still = 70 } = {}) {
  const out = [];
  let t = t0;
  const step = (v, bounce) => {
    t += 16;
    const g = read(t, { x: 0, y: 0, z: 0, [axis]: v }, 16, bounce);
    if (g) out.push(g);
  };
  const n = Math.round(ms / 16);
  for (let i = 0; i < n; i++) step(peak * Math.sin((Math.PI * (i + 0.5)) / n));
  if (back) for (let i = 0; i < n; i++) step(-peak * Math.sin((Math.PI * (i + 0.5)) / n));
  for (let i = 0; i < still; i++) step(0);
  return { out, t };
}

test("turning to face right then left: next, then previous (the swing back never counts)", () => {
  const read = gestureReader();
  let r = play(read, "y", 400);
  assert.deepEqual(r.out, ["next"]);
  r = play(read, "y", -400, { t0: r.t });
  assert.deepEqual(r.out, ["prev"]);
});

test("a twist moves one shelf, however wobbly the wrist", () => {
  const read = gestureReader();
  let r = play(read, "z", -500);
  assert.deepEqual(r.out, ["shelfNext"]);
  r = play(read, "z", 500, { t0: r.t });
  assert.deepEqual(r.out, ["shelfPrev"]);
  // A big twist with a wobbly return and a second wobble: still one shelf.
  const out = [];
  let t = r.t;
  const seq = [...Array(10)].map((_, i) => -600 * Math.sin((Math.PI * (i + 0.5)) / 10));
  for (const v of [...seq, ...seq.map((x) => -x * 0.8), ...seq.map((x) => x * 0.7), ...Array(10).fill(0)]) {
    t += 16;
    const g = read(t, { x: 0, y: 0, z: v }, 16);
    if (g) out.push(g);
  }
  assert.deepEqual(out, ["shelfNext"]);
});

test("flicking the top towards you or away adds a book", () => {
  const read = gestureReader();
  let r = play(read, "x", 400);
  assert.deepEqual(r.out, ["add"]);
  r = play(read, "x", -400, { t0: r.t });
  assert.deepEqual(r.out, ["add"]);
});

test("bouncing the phone up or down adds a book", () => {
  for (const sign of [1, -1]) {
    const read = gestureReader();
    const out = [];
    let t = 0;
    for (const v of [0, 4, 9, 12, 8, -6, -10, -4, 0, 0]) {
      t += 16;
      const g = read(t, { x: 5, y: -4, z: 3 }, 16, { v: v * sign, h: 1.5 });
      if (g) out.push(g);
    }
    assert.deepEqual(out, ["add"]);
  }
});

test("small wobbles, slow turns, and walking about do nothing", () => {
  const read = gestureReader();
  assert.deepEqual(play(read, "y", 90).out, []);
  assert.deepEqual(play(read, "y", 20, { ms: 2000, back: false }).out, []); // reading in bed
  let t = 1e5;
  const out = [];
  for (let i = 0; i < 100; i++) {
    t += 16;
    const g = read(t, { x: 0, y: 0, z: 0 }, 16, { v: 3 * Math.sin(i / 3), h: 2 }); // footsteps
    if (g) out.push(g);
  }
  assert.deepEqual(out, []);
});

test("a turn about two axes at once is not mistaken for either", () => {
  const read = gestureReader();
  const out = [];
  for (let i = 0, t = 0; i < 10; i++) {
    t += 16;
    const g = read(t, { x: 0, y: 330, z: 380 }, 16);
    if (g) out.push(g);
  }
  assert.deepEqual(out, []);
});

test("iPhone's order: a front-and-back flick reads as a flick, not a twist", () => {
  // Safari on iPhone reports the turn about the side-to-side axis as alpha.
  const r = toDevice({ alpha: 400, beta: 0, gamma: 0 }, AXES.apple);
  assert.deepEqual(r, { x: 400, y: 0, z: 0 });
  assert.deepEqual(toDevice({ alpha: 400, beta: 0, gamma: 0 }, AXES.standard), { x: 0, y: 0, z: 400 });
});

test("a bounce is measured along gravity, however the phone is held", () => {
  // Held upright (gravity along y) and pushed up.
  const up = bounceOf({ acceleration: { x: 0, y: 8, z: 0 }, accelerationIncludingGravity: { x: 0, y: 17.8, z: 0 } });
  assert.ok(Math.abs(up.v) > 7.9 && up.h < 0.1);
  // Held flat (gravity along z): the same push shows on z.
  const flat = bounceOf({ acceleration: { x: 0, y: 0, z: -8 }, accelerationIncludingGravity: { x: 0, y: 0, z: -17.8 } });
  assert.ok(Math.abs(flat.v) > 7.9 && flat.h < 0.1);
  assert.equal(bounceOf({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 } }), null);
});

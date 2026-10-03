import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gestureReader, toDevice, AXES, bounceOf, leanOf } from "../js/gyro.js";

// Two recordings of real moves on an iPhone (Safari, iOS 18), made with motion-lab.html on two
// different days: each step is one kind of move, done several times. The same instructions got
// different moves: "flick right" was a turn to face right in the first and a quick clockwise
// snap in the second, and the bounces in the second were gentler. Both have to work.
// m rows are [t ms, interval s, rotationRate alpha, beta, gamma, acceleration x, y, z,
// accelerationIncludingGravity x, y, z].
const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const recs = { first: load("motion-iphone.json"), second: load("motion-iphone-2.json") };

function replay(rec, id) {
  const read = gestureReader();
  const out = [];
  for (const [t, iv, ra, rb, rg, ax, ay, az, gx, gy, gz] of rec.steps.find((s) => s.id === id).m) {
    const e = { acceleration: { x: ax, y: ay, z: az }, accelerationIncludingGravity: { x: gx, y: gy, z: gz } };
    const name = read(t, toDevice({ alpha: ra, beta: rb, gamma: rg }, AXES.apple), iv, bounceOf(e)); // (iPhone: gravity already points down)
    if (name) out.push(name);
  }
  return out;
}

// What each step must give: the gesture, and how many at least (moves made in quick succession
// can merge while the phone hasn't settled; misreads are never allowed).
const expect = {
  "flick-right": ["next", 5],
  "flick-left": ["prev", 5],
  "tip-away": ["shelfNext", 5],
  "tip-toward": ["shelfPrev", 3],
  bounce: ["add", 2],
};
for (const [name, rec] of Object.entries(recs)) {
  for (const { id } of rec.steps) {
    if (expect[id]) {
      const [gesture, least] = expect[id];
      test(`${name} recording, "${id}": ${gesture} every time`, () => {
        const out = replay(rec, id);
        assert.ok(out.length >= least, `only ${out.length}: ${out}`);
        assert.deepEqual([...new Set(out)], [gesture]);
      });
    } else {
      test(`${name} recording, "${id}": no gestures`, () => {
        assert.deepEqual(replay(rec, id), []);
      });
    }
  }
}

// Made-up moves, for the edges the recording doesn't cover.
const upright = { v: 0, h: 0, g: { x: 0, y: -9.8, z: -1 } };
function play(read, seq, t0 = 0, axis = "y") {
  const out = [];
  let t = t0;
  for (const [w, sense = upright] of seq) {
    t += 16;
    const name = read(t, { x: 0, y: 0, z: 0, [axis]: w }, 0.016, sense);
    if (name) out.push(name);
  }
  return { out, t };
}
const lobe = (peak, n) => [...Array(n)].map((_, i) => [peak * Math.sin((Math.PI * (i + 0.5)) / n)]);
const rest = (n) => Array(n).fill([0]);

test("a flick out and back: one gesture, and the swing back never counts", () => {
  const read = gestureReader();
  let r = play(read, [...rest(40), ...lobe(600, 12), ...lobe(-300, 24), ...rest(40)]);
  assert.deepEqual(r.out, ["next"]);
  r = play(read, [...lobe(-600, 12), ...lobe(300, 24), ...rest(40)], r.t);
  assert.deepEqual(r.out, ["prev"]);
});

test("a snap like a steering wheel works as a flick too: clockwise is next", () => {
  const read = gestureReader();
  let r = play(read, [...rest(40), ...lobe(-600, 12), ...lobe(300, 24), ...rest(40)], 0, "z");
  assert.deepEqual(r.out, ["next"]);
  r = play(read, [...lobe(600, 12), ...lobe(-300, 24), ...rest(40)], r.t, "z");
  assert.deepEqual(r.out, ["prev"]);
});

test("tipping the top edge away and back: next shelf; towards you: the one before", () => {
  const read = gestureReader();
  let r = play(read, [...rest(40), ...lobe(-600, 12), ...lobe(300, 24), ...rest(40)], 0, "x");
  assert.deepEqual(r.out, ["shelfNext"]);
  r = play(read, [...lobe(600, 12), ...lobe(-300, 24), ...rest(40)], r.t, "x");
  assert.deepEqual(r.out, ["shelfPrev"]);
});

test("one tip, one shelf: an overshoot on the way back never counts as a second tip", () => {
  const read = gestureReader();
  // Tip away and back, then (still within a second) a sharp snap back towards you as the
  // phone overshoots, and a wobble: one shelf.
  const seq = [...rest(40), ...lobe(-600, 12), ...lobe(300, 14), ...rest(25), ...lobe(600, 10), ...lobe(-300, 14), ...rest(60)];
  assert.deepEqual(play(read, seq, 0, "x").out, ["shelfNext"]);
});

test("a slow twist (tilting to play with the light) is never a gesture", () => {
  const read = gestureReader();
  // 200°/s at most, ~75° over 0.6 s, and back.
  assert.deepEqual(play(read, [...rest(10), ...lobe(200, 38), ...lobe(-200, 38), ...rest(40)], 0, "z").out, []);
});

test("when a wrist turns about two axes at once, the one that turned furthest wins", () => {
  const read = gestureReader();
  const out = [];
  let t = 0;
  const n = 12;
  for (let i = 0; i < 3 * n + 40; i++) {
    t += 16;
    const k = i < n ? Math.sin((Math.PI * (i + 0.5)) / n) : i < 3 * n ? -0.5 * Math.sin((Math.PI * (i - n + 0.5)) / (2 * n)) : 0;
    const name = read(t, { x: 450 * k, y: -650 * k, z: 0 }, 0.016, upright); // a flick left that also tips
    if (name) out.push(name);
  }
  assert.deepEqual(out, ["prev"]);
});

test("just lifted off a table: a snap doesn't count", () => {
  const read = gestureReader();
  const table = Array(30).fill([0, { v: 0, h: 0, g: { x: 0, y: 0, z: -9.8 } }]);
  assert.deepEqual(play(read, [...table, ...rest(20), ...lobe(-600, 12), ...lobe(300, 24), ...rest(40)], 0, "x").out, []);
});

test("a turn with no swing back (putting the phone down sideways) does nothing", () => {
  const read = gestureReader();
  assert.deepEqual(play(read, [...rest(40), ...lobe(600, 12), ...rest(60)]).out, []);
});

test("small or slow turns do nothing", () => {
  const read = gestureReader();
  assert.deepEqual(play(read, [...rest(40), ...lobe(150, 12), ...lobe(-150, 12), ...rest(40)]).out, []); // 150°/s, ~17°
  assert.deepEqual(play(read, [...lobe(60, 120), ...lobe(-60, 120)]).out, []); // turning slowly in bed
});

test("a flick while the phone is being picked up does nothing", () => {
  const read = gestureReader();
  // Down swings from flat on the table to upright over the half second before the turn.
  const lift = [...Array(30)].map((_, i) => {
    const a = (i / 29) * (Math.PI / 2);
    return [0, { v: 0, h: 0, g: { x: 0, y: -9.8 * Math.sin(a), z: -9.8 * Math.cos(a) } }];
  });
  assert.deepEqual(play(read, [...lift, ...lobe(600, 12), ...lobe(-300, 24), ...rest(40)]).out, []);
});

test("a knock (one short spike along gravity) is not a bounce", () => {
  const read = gestureReader();
  const spike = [0, 6, 18, 6, 0].map((v) => [0, { ...upright, v }]);
  assert.deepEqual(play(read, [...rest(10), ...spike, ...rest(40)]).out, []);
});

test("a bounce up then down, or down then up, adds a book (gentle ones too)", () => {
  for (const [sign, peak] of [[1, 14], [-1, 14], [1, 8]]) {
    const read = gestureReader();
    const half = (s) => [...Array(9)].map((_, i) => [0, { ...upright, v: s * peak * Math.sin((Math.PI * (i + 0.5)) / 9) }]);
    assert.deepEqual(play(read, [...rest(10), ...half(sign), ...half(-sign), ...rest(40)]).out, ["add"]);
  }
});

test("iPhone's order: the turn about the top-to-bottom axis is beta", () => {
  assert.deepEqual(toDevice({ alpha: 400, beta: 0, gamma: 0 }, AXES.apple), { x: 400, y: 0, z: 0 });
  assert.deepEqual(toDevice({ alpha: 0, beta: 400, gamma: 0 }, AXES.apple), { x: 0, y: 400, z: 0 });
  assert.deepEqual(toDevice({ alpha: 400, beta: 0, gamma: 0 }, AXES.standard), { x: 0, y: 0, z: 400 });
});

test("a bounce is measured along gravity, however the phone is held", () => {
  const up = bounceOf({ acceleration: { x: 0, y: 8, z: 0 }, accelerationIncludingGravity: { x: 0, y: 17.8, z: 0 } });
  assert.ok(Math.abs(up.v) > 7.9 && up.h < 0.1);
  const flat = bounceOf({ acceleration: { x: 0, y: 0, z: -8 }, accelerationIncludingGravity: { x: 0, y: 0, z: -17.8 } });
  assert.ok(Math.abs(flat.v) > 7.9 && flat.h < 0.1);
  assert.equal(bounceOf({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 } }), null);
});

test("the lean doesn't jump when the phone passes upright (Euler angles do)", () => {
  // From the recording's tilt step, where the orientation event's gamma leapt by about 160°.
  let prev = null;
  let worst = 0;
  for (const r of recs.first.steps.find((s) => s.id === "tilt").m) {
    const g = { x: r[8] - r[5], y: r[9] - r[6], z: r[10] - r[7] };
    const l = Math.hypot(g.x, g.y, g.z);
    const { side, back } = leanOf({ x: g.x / l, y: g.y / l, z: g.z / l });
    if (prev) worst = Math.max(worst, Math.abs(side - prev.side), Math.abs(((back - prev.back + 540) % 360) - 180));
    prev = { side, back };
  }
  assert.ok(worst < 15, `lean jumped ${worst.toFixed(1)}° between readings`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gestureReader, toDevice, AXES, bounceOf, leanOf } from "../js/gyro.js";

// A recording of real moves on an iPhone (Safari, iOS 18), made with motion-lab.html: each step is
// one kind of move, done several times. m rows are
// [t ms, interval s, rotationRate alpha, beta, gamma, acceleration x, y, z, accelerationIncludingGravity x, y, z].
const rec = JSON.parse(readFileSync(new URL("./fixtures/motion-iphone.json", import.meta.url)));
const step = (id) => rec.steps.find((s) => s.id === id);

function replay(id) {
  const read = gestureReader();
  const out = [];
  for (const [t, iv, ra, rb, rg, ax, ay, az, gx, gy, gz] of step(id).m) {
    const e = { acceleration: { x: ax, y: ay, z: az }, accelerationIncludingGravity: { x: gx, y: gy, z: gz } };
    const name = read(t, toDevice({ alpha: ra, beta: rb, gamma: rg }, AXES.apple), iv, bounceOf(e));
    if (name) out.push(name);
  }
  return out;
}

test("the recording is the one the rules were tuned on", () => {
  assert.match(rec.ua, /iPhone/);
  assert.equal(rec.steps.length, 12);
});

test("recorded flicks to the right: every one is the next book, nothing else", () => {
  // Six flicks were made; a flick that starts before the last has settled may be skipped.
  const out = replay("flick-right");
  assert.ok(out.length >= 5, `only ${out.length} flicks seen`);
  assert.deepEqual([...new Set(out)], ["next"]);
});

test("recorded flicks to the left: back one each time, despite the wrist tipping too", () => {
  // Seven were made; one was half-hearted (31°), the rest must count.
  const out = replay("flick-left");
  assert.ok(out.length >= 5, `only ${out.length} flicks seen`);
  assert.deepEqual([...new Set(out)], ["prev"]);
});

test("recorded bouncing adds a book (once per burst, not once per bounce)", () => {
  const out = replay("bounce");
  assert.ok(out.length >= 1);
  assert.deepEqual([...new Set(out)], ["add"]);
});

for (const id of ["still", "tilt", "walk", "down-up", "scroll", "twist-cw", "twist-ccw", "tip-toward", "tip-away"]) {
  test(`recorded "${id}": no gestures`, () => {
    assert.deepEqual(replay(id), []);
  });
}

// Made-up moves, for the edges the recording doesn't cover.
const upright = { v: 0, h: 0, g: { x: 0, y: -9.8, z: -1 } };
function play(read, seq, t0 = 0) {
  const out = [];
  let t = t0;
  for (const [y, sense = upright] of seq) {
    t += 16;
    const name = read(t, { x: 0, y, z: 0 }, 0.016, sense);
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

test("a bounce up then down, or down then up, adds a book", () => {
  for (const sign of [1, -1]) {
    const read = gestureReader();
    const half = (s) => [...Array(9)].map((_, i) => [0, { ...upright, v: s * 14 * Math.sin((Math.PI * (i + 0.5)) / 9) }]);
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
  for (const r of step("tilt").m) {
    const g = { x: r[8] - r[5], y: r[9] - r[6], z: r[10] - r[7] };
    const l = Math.hypot(g.x, g.y, g.z);
    const { side, back } = leanOf({ x: g.x / l, y: g.y / l, z: g.z / l });
    if (prev) worst = Math.max(worst, Math.abs(side - prev.side), Math.abs(((back - prev.back + 540) % 360) - 180));
    prev = { side, back };
  }
  assert.ok(worst < 15, `lean jumped ${worst.toFixed(1)}° between readings`);
});

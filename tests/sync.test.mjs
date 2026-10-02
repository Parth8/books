// Sync crypto: codes, the address derived from them, and encryption.
//   node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCode, cleanCode, prettyCode, derive, seal, open } from "../js/sync.js";

test("codes are 24 unambiguous characters, and survive being typed sloppily", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = makeCode();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{24}$/);
    seen.add(c);
    assert.equal(cleanCode(prettyCode(c).toLowerCase().replace(/-/g, " - ")), c);
  }
  assert.equal(seen.size, 200);
  assert.equal(cleanCode("too short"), null);
  assert.equal(cleanCode("O".repeat(24)), null, "O is not in the alphabet");
});

test("the server address is a hash; the key never leaves", async () => {
  const code = makeCode();
  const { id } = await derive(code);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.ok(!id.includes(code.toLowerCase()));
  assert.equal((await derive(code)).id, id, "stable");
  assert.notEqual((await derive(makeCode())).id, id);
});

test("encrypt, decrypt, and the wrong code can't read it", async () => {
  const shelves = { v: 1, books: [{ id: "b1", title: "Dune" }], secret: "my reading" };
  const { key } = await derive(makeCode());
  const box = await seal(key, shelves);
  assert.match(box.iv, /^[A-Za-z0-9+/]{16}$/);
  assert.ok(!Buffer.from(box.ct, "base64").toString("latin1").includes("Dune"), "ciphertext hides the content");
  assert.deepEqual(await open(key, box), shelves);
  const other = (await derive(makeCode())).key;
  await assert.rejects(open(other, box));
  const tampered = { ...box, ct: box.ct.slice(0, -4) + (box.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
  await assert.rejects(open(key, tampered), "tampering is detected");
});

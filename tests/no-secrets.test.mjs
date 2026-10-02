// Guards the repository against committed keys: fails if anything that looks like a Google API
// key (or a private key) is in a tracked file. Keys belong in the Worker's secrets.
//   node --test tests/

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const PATTERNS = [/AIza[0-9A-Za-z_-]{35}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(sk|pk)_live_[0-9A-Za-z]{16,}/];

test("no API keys in tracked files", () => {
  const files = execSync("git ls-files", { cwd: ROOT }).toString().split("\n").filter((f) => f && !/\.(png|jpg|webp|woff2)$/.test(f));
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(new URL(f, ROOT), "utf8");
    } catch {
      continue;
    }
    if (PATTERNS.some((p) => p.test(text))) hits.push(f);
  }
  assert.deepEqual(hits, [], `possible secret in: ${hits.join(", ")}`);
});

test("the page carries no key setting", () => {
  const html = readFileSync(new URL("index.html", ROOT), "utf8");
  assert.ok(!/google-books-key/i.test(html));
  assert.ok(!/googleapis\.com/.test(html), "the page never talks to Google's API directly");
});

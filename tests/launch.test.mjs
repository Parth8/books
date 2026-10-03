// Before launch, nothing that's only for building Shelfie may be left on the site.
// Skipped normally; run with LAUNCH=1 (see docs/launch.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("launch: test pages are gone", { skip: !process.env.LAUNCH && "run with LAUNCH=1 before launch" }, () => {
  assert.ok(!existsSync(new URL("../motion-lab.html", import.meta.url)), "delete motion-lab.html");
});

test("the motion lab is never linked from the app", () => {
  for (const f of ["../index.html", "../manifest.webmanifest"]) assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes("motion-lab"), f);
});

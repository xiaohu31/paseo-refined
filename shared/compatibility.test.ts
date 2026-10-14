import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tryContribute } from "./compatibility";

test("an unavailable host contribution degrades without aborting plugin loading", () => {
  const warnings: Array<{ message: string; error: unknown }> = [];
  const failure = new Error("missing host API");

  const result = tryContribute(
    "future feature",
    () => {
      throw failure;
    },
    (message, error) => warnings.push({ message, error }),
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /continuing without it/);
  assert.equal(warnings[0]!.error, failure);
});

test("a supported host contribution returns its cleanup unchanged", () => {
  const cleanup = () => {};
  assert.equal(tryContribute("theme", () => cleanup), cleanup);
});

test("the manifest supports Paseo updates throughout the pre-1.0 series", () => {
  const manifest = JSON.parse(readFileSync("paseo-plugin.json", "utf8")) as {
    requirements?: { paseo?: string };
  };

  assert.equal(manifest.requirements?.paseo, ">=0.9.2 <1.0.0");
});

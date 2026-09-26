import assert from "node:assert/strict";
import test from "node:test";
import { migrateRefinedSettings } from "./settings";

test("settings migration preserves existing values and adds language", () => {
  assert.deepEqual(
    migrateRefinedSettings({ groupConsecutiveTools: false, toolGroupThreshold: 9 }),
    { groupConsecutiveTools: false, toolGroupThreshold: 9, uiLanguage: "auto" },
  );
});

test("settings migration tolerates malformed legacy values", () => {
  assert.deepEqual(migrateRefinedSettings(null), { uiLanguage: "auto" });
  assert.deepEqual(migrateRefinedSettings([]), { uiLanguage: "auto" });
});

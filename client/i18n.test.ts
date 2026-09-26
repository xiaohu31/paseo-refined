import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocaleLanguage, tr } from "./i18n";

test("automatic language only selects supported Simplified Chinese locales", () => {
  assert.equal(resolveLocaleLanguage("zh-CN"), "zh-CN");
  assert.equal(resolveLocaleLanguage("zh_Hans_SG"), "zh-CN");
  assert.equal(resolveLocaleLanguage("zh-SG"), "zh-CN");
  assert.equal(resolveLocaleLanguage("zh-TW"), "en");
  assert.equal(resolveLocaleLanguage("zh-HK"), "en");
  assert.equal(resolveLocaleLanguage("en-US"), "en");
});

test("message keys translate without an untyped fallback", () => {
  assert.equal(tr("zh-CN", "Action"), "操作");
  assert.equal(tr("en", "Action"), "Action");
});

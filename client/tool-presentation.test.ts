import assert from "node:assert/strict";
import test from "node:test";
import { toToolCardData } from "./tool-presentation";

test("timeline payload stays compact while details remain available on demand", () => {
  const content = "x".repeat(20_000);
  const item = {
    callId: "long-read",
    name: "read",
    status: "completed" as const,
    error: null,
    detail: { type: "read", filePath: "/tmp/long.ts", content },
  };

  const summary = toToolCardData(item, "en");
  const full = toToolCardData(item, "en", false);

  assert.equal(summary.secondaryTruncated, true);
  assert.ok(summary.secondary.length < content.length);
  assert.equal(full.secondaryTruncated, false);
  assert.equal(full.secondary, content);
});

test("terminal control sequences are removed from displayed output", () => {
  const data = toToolCardData({
    callId: "shell",
    name: "shell",
    status: "completed",
    error: null,
    detail: { type: "shell", command: "printf test", output: "\u001b[31mred\u001b[0m" },
  });
  assert.equal(data.secondary, "red");
});

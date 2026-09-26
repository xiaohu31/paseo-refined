import assert from "node:assert/strict";
import test from "node:test";
import { visibleToolCalls } from "./tool-list";

const calls = Array.from({ length: 20 }, (_, index) => ({ callId: String(index + 1) }));

test("short groups remain unchanged", () => {
  assert.deepEqual(visibleToolCalls(calls.slice(0, 6), 12), calls.slice(0, 6));
});

test("collapsed lists keep the newest tool visible", () => {
  assert.deepEqual(
    visibleToolCalls(calls, 12).map((call) => call.callId),
    [...calls.slice(0, 11).map((call) => call.callId), "20"],
  );
});

test("showing more eventually reveals every tool", () => {
  assert.deepEqual(visibleToolCalls(calls, 24), calls);
});

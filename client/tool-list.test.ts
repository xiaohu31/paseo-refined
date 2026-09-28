import assert from "node:assert/strict";
import test from "node:test";
import { aggregateToolStatuses, visibleToolCalls } from "./tool-list";

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

test("one failed call is a partial failure, not a failed group", () => {
  assert.deepEqual(
    aggregateToolStatuses([
      { status: "completed" },
      { status: "failed" },
      { status: "completed" },
    ]),
    { failed: 1, canceled: 0, running: 0, allFailed: false },
  );
});

test("a group is fully failed only when every call failed", () => {
  assert.deepEqual(
    aggregateToolStatuses([{ status: "failed" }, { status: "failed" }]),
    { failed: 2, canceled: 0, running: 0, allFailed: true },
  );
});

test("running and failed calls remain independently visible", () => {
  assert.deepEqual(
    aggregateToolStatuses([{ status: "running" }, { status: "failed" }]),
    { failed: 1, canceled: 0, running: 1, allFailed: false },
  );
});

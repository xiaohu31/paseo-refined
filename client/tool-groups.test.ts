import assert from "node:assert/strict";
import test from "node:test";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { UiLanguage } from "./i18n";
import { ToolGroupingController, type SourceToolCall } from "./tool-groups";
import type { ToolCardData } from "./tool-presentation";

type Transform = (input: { item: SourceToolCall; phase: "streaming" | "complete" }) => unknown;

function tool(callId: string, status: SourceToolCall["status"] = "completed"): SourceToolCall & { type: "tool_call" } {
  return {
    type: "tool_call",
    callId,
    name: "read",
    status,
    error: null,
    detail: { type: "read", filePath: `/tmp/${callId}.ts`, content: callId },
  };
}

function present(item: SourceToolCall, language: UiLanguage): ToolCardData {
  return {
    callId: item.callId,
    kind: "read",
    title: language === "zh-CN" ? "读取文件" : "Read file",
    subtitle: item.callId,
    primaryLabel: "File",
    primary: String(item.detail.filePath ?? ""),
    primaryTruncated: false,
    secondaryLabel: "Content",
    secondary: String(item.detail.content ?? ""),
    secondaryTruncated: false,
    metadata: [],
    isDiff: false,
    additions: 0,
    deletions: 0,
    icon: "FileText",
    status: item.status,
  };
}

function harness(entries: Array<{ item: unknown; turnId: string; seqStart: number }>) {
  const transforms: Transform[] = [];
  let onMessage: ((message: { event: Record<string, unknown> }) => void) | null = null;
  const subscription = Object.assign(() => {}, { ready: Promise.resolve() });
  const client = {
    addTimelineTransformer(registration: { transform: Transform }) {
      transforms.push(registration.transform);
      return () => {};
    },
    paseo: {
      agents: {
        ref() {
          return {
            timeline: {
              subscribe(callback: typeof onMessage) {
                onMessage = callback;
                return subscription;
              },
              async refetch() {
                return {
                  epoch: "epoch",
                  entries,
                  startCursor: entries.length ? { epoch: "epoch", seq: entries[0]!.seqStart } : null,
                  hasOlder: false,
                  error: null,
                };
              },
            },
          };
        },
      },
    },
  } as unknown as PluginClientContext;
  const controller = new ToolGroupingController(client, present);
  return {
    controller,
    transforms,
    emit(item: SourceToolCall, turnId = "turn-a") {
      onMessage?.({ event: { type: "timeline", item, turnId } });
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("controller stays compatible with Hermes runtime evaluation", () => {
  assert.match(Function.prototype.toString.call(ToolGroupingController), /^function ToolGroupingController/);
});

test("groups at the threshold but not below it", async () => {
  for (const count of [6, 7]) {
    const entries = Array.from({ length: count }, (_, index) => ({
      item: tool(String(index + 1)),
      turnId: "turn-a",
      seqStart: index + 1,
    }));
    const { controller } = harness(entries);
    controller.attach("agent", "1");
    await settle();
    assert.equal(Boolean(controller.getGroup("agent", "agent:1")), count === 7);
    controller.dispose();
  }
});

test("does not merge tools across turns", async () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({
    item: tool(String(index + 1)),
    turnId: index < 4 ? "turn-a" : "turn-b",
    seqStart: index + 1,
  }));
  const { controller } = harness(entries);
  controller.attach("agent", "1");
  await settle();
  assert.equal(controller.getGroup("agent", "agent:1"), null);
  assert.equal(controller.getGroup("agent", "agent:5"), null);
  controller.dispose();
});

test("transformers capture immutable language and membership snapshots", async () => {
  const entries = Array.from({ length: 7 }, (_, index) => ({
    item: tool(String(index + 1)),
    turnId: "turn-a",
    seqStart: index + 1,
  }));
  const { controller, transforms, emit } = harness(entries);
  controller.attach("agent", "1");
  await settle();

  const groupedTransform = transforms.at(-1)!;
  assert.deepEqual(groupedTransform({ item: tool("2"), phase: "complete" }), { items: [] });

  emit(tool("8"));
  const beforeRefresh = groupedTransform({ item: tool("8"), phase: "complete" }) as { items: Array<{ data: ToolCardData }> };
  assert.equal(beforeRefresh.items[0]!.data.title, "Read file");
  await settle();
  assert.deepEqual(transforms.at(-1)!({ item: tool("8"), phase: "complete" }), { items: [] });

  controller.configure({ enabled: true, threshold: 7, language: "zh-CN" });
  await settle();
  const standalone = tool("outside");
  const oldResult = groupedTransform({ item: standalone, phase: "complete" }) as { items: Array<{ data: ToolCardData }> };
  const newResult = transforms.at(-1)!({ item: standalone, phase: "complete" }) as { items: Array<{ data: ToolCardData }> };
  assert.equal(oldResult.items[0]!.data.title, "Read file");
  assert.equal(newResult.items[0]!.data.title, "读取文件");
  controller.dispose();
});

test("unknown tool statuses fall back to Paseo's original renderer", () => {
  const { controller, transforms } = harness([]);
  const invalid = { ...tool("bad"), status: "queued" } as unknown as SourceToolCall;
  assert.equal(transforms.at(-1)!({ item: invalid, phase: "complete" }), undefined);
  controller.dispose();
});

test("only the changed group notifies its subscribers", async () => {
  const entries = [
    ...Array.from({ length: 7 }, (_, index) => ({
      item: tool(String(index + 1)),
      turnId: "turn-a",
      seqStart: index + 1,
    })),
    { item: { type: "assistant_message", text: "boundary" }, turnId: "turn-a", seqStart: 8 },
    ...Array.from({ length: 7 }, (_, index) => ({
      item: tool(String(index + 8)),
      turnId: "turn-a",
      seqStart: index + 9,
    })),
  ];
  const { controller, emit } = harness(entries);
  controller.attach("agent", "1");
  await settle();
  let firstUpdates = 0;
  let secondUpdates = 0;
  controller.subscribe("agent", "agent:1", () => { firstUpdates += 1; });
  controller.subscribe("agent", "agent:8", () => { secondUpdates += 1; });

  emit(tool("1", "failed"));
  assert.equal(firstUpdates, 1);
  assert.equal(secondUpdates, 0);
  controller.dispose();
});

test("group expansion state survives renderer refreshes", () => {
  const { controller } = harness([]);
  controller.setGroupUiState("group", { expanded: true, visibleCount: 24 });
  assert.deepEqual(controller.getGroupUiState("group"), { expanded: true, visibleCount: 24 });
  controller.dispose();
});

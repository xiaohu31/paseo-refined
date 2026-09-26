import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { UiLanguage } from "./i18n";
import type { ToolCardData } from "./timeline";

export type SourceToolCall = {
  type?: "tool_call";
  callId: string;
  name: string;
  status: "running" | "completed" | "failed" | "canceled";
  error: unknown;
  detail: Record<string, unknown> & { type: string };
};

export type ToolGroupSnapshot = {
  id: string;
  anchorCallId: string;
  calls: readonly ToolCardData[];
};

type TimelineCursor = { epoch: string; seq: number };

type TimelineToken =
  | {
      kind: "tool";
      key: string;
      order: number;
      turnId: string | null;
      item: SourceToolCall;
    }
  | {
      kind: "boundary";
      key: string;
      order: number;
    };

type AgentGroupState = {
  agentId: string;
  tokens: TimelineToken[];
  targets: Set<string>;
  groups: Map<string, ToolGroupSnapshot>;
  epoch: string | null;
  startCursor: TimelineCursor | null;
  hasOlder: boolean;
  loaded: boolean;
  loading: Promise<void> | null;
  subscription: (() => void) | null;
  syntheticOrder: number;
};

type Membership = { groupId: string; role: "anchor" | "member" };
type GroupingConfig = { enabled: boolean; threshold: number; language: UiLanguage };

const controllers = new Map<string, ToolGroupingController>();
let controllerSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isSourceToolCall(value: unknown): value is SourceToolCall & { type: "tool_call" } {
  if (!isRecord(value) || value.type !== "tool_call") return false;
  return (
    typeof value.callId === "string" &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    isRecord(value.detail) &&
    typeof value.detail.type === "string"
  );
}

function isGroupableTool(item: SourceToolCall) {
  return item.detail.type !== "plan" && item.name.trim().toLocaleLowerCase() !== "speak";
}

function projectionRequiresRefresh(
  left: Map<string, Membership>,
  right: Map<string, Membership>,
  allowMemberAppend: boolean,
) {
  if (!allowMemberAppend && left.size !== right.size) return true;
  for (const [callId, membership] of left) {
    const other = right.get(callId);
    if (!other || other.groupId !== membership.groupId || other.role !== membership.role) return true;
  }
  if (!allowMemberAppend) return false;

  const existingGroups = new Set([...left.values()].map((membership) => membership.groupId));
  for (const [callId, membership] of right) {
    if (left.has(callId)) continue;
    if (membership.role !== "member" || !existingGroups.has(membership.groupId)) return true;
  }
  return false;
}

export class ToolGroupingController {
  readonly id = `tool-groups-${++controllerSequence}`;
  private readonly client: PluginClientContext;
  private readonly present: (item: SourceToolCall, language: UiLanguage) => ToolCardData;
  private readonly agents = new Map<string, AgentGroupState>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private membership = new Map<string, Membership>();
  private config: GroupingConfig = { enabled: true, threshold: 7, language: "en" };
  private removeTransformer: (() => void) | null = null;
  private refreshScheduled = false;
  private disposed = false;

  constructor(client: PluginClientContext, present: (item: SourceToolCall, language: UiLanguage) => ToolCardData) {
    this.client = client;
    this.present = present;
    controllers.set(this.id, this);
    this.installTransformer();
  }

  configure(next: GroupingConfig) {
    const threshold = Math.max(3, Math.min(30, Math.round(next.threshold)));
    if (
      this.config.enabled === next.enabled &&
      this.config.threshold === threshold &&
      this.config.language === next.language
    ) return;
    this.config = { enabled: next.enabled, threshold, language: next.language };
    this.recompute();
  }

  attach(agentId: string, callId: string) {
    if (this.disposed) return () => {};
    const state = this.ensureAgent(agentId);
    state.targets.add(callId);
    if (!state.subscription) this.startAgent(state);
    else void this.ensureTargets(state);
    if (this.membership.get(callId)?.role === "member") this.scheduleTransformerRefresh();
    return () => {};
  }

  subscribe(agentId: string, listener: () => void) {
    const listeners = this.listeners.get(agentId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(agentId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(agentId);
    };
  }

  getGroup(agentId: string, groupId: string) {
    return this.agents.get(agentId)?.groups.get(groupId) ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeTransformer?.();
    this.removeTransformer = null;
    for (const state of this.agents.values()) state.subscription?.();
    this.agents.clear();
    this.listeners.clear();
    controllers.delete(this.id);
  }

  private ensureAgent(agentId: string) {
    const existing = this.agents.get(agentId);
    if (existing) return existing;
    const state: AgentGroupState = {
      agentId,
      tokens: [],
      targets: new Set(),
      groups: new Map(),
      epoch: null,
      startCursor: null,
      hasOlder: false,
      loaded: false,
      loading: null,
      subscription: null,
      syntheticOrder: 1,
    };
    this.agents.set(agentId, state);
    return state;
  }

  private startAgent(state: AgentGroupState) {
    const timeline = this.client.paseo.agents.ref(state.agentId).timeline;
    const subscription = timeline.subscribe((message) => {
      if (this.disposed) return;
      const event = message.event;
      if (event.type === "timeline") {
        this.applyLiveItem(state, event.item, event.turnId ?? null);
        return;
      }
      if (
        event.type === "replacement" ||
        event.type === "subscription_restored"
      ) {
        void this.loadTail(state, true);
      }
    });
    state.subscription = subscription;
    void subscription.ready.then(
      () => this.loadTail(state, true),
      () => undefined,
    );
  }

  private async loadTail(state: AgentGroupState, reset: boolean): Promise<void> {
    if (state.loading) {
      await state.loading;
      if (reset && !this.disposed) await this.loadTail(state, true);
      return;
    }
    let loaded = false;
    const operation = (async () => {
      try {
        const result = await this.client.paseo.agents.ref(state.agentId).timeline.refetch({
          direction: "tail",
          limit: 250,
          projection: "canonical",
        });
        if (result.error) return;
        this.mergePage(state, result, reset || state.epoch !== result.epoch);
        state.loaded = true;
        loaded = true;
        this.recompute(state.agentId);
      } catch {
        // Keep the ordinary cards when the host cannot provide canonical history.
      }
    })();
    state.loading = operation;
    try {
      await operation;
    } finally {
      if (state.loading === operation) state.loading = null;
    }
    if (loaded) await this.ensureTargets(state);
  }

  private async ensureTargets(state: AgentGroupState) {
    if (!state.loaded || state.loading || !state.hasOlder || !state.startCursor) return;
    const operation = (async () => {
      let pages = 0;
      while (pages < 4 && state.hasOlder && state.startCursor && this.needsOlderPage(state)) {
        pages += 1;
        try {
          const result = await this.client.paseo.agents.ref(state.agentId).timeline.refetch({
            direction: "before",
            cursor: state.startCursor,
            limit: 200,
            projection: "canonical",
          });
          if (result.error || result.entries.length === 0) break;
          this.mergePage(state, result, state.epoch !== result.epoch);
          this.recompute(state.agentId);
        } catch {
          break;
        }
      }
    })();
    state.loading = operation;
    try {
      await operation;
    } finally {
      if (state.loading === operation) state.loading = null;
    }
  }

  private needsOlderPage(state: AgentGroupState) {
    const known = new Set(
      state.tokens.flatMap((token) => (token.kind === "tool" ? [token.item.callId] : [])),
    );
    if ([...state.targets].some((callId) => !known.has(callId))) return true;
    if (state.tokens[0]?.kind !== "tool") return false;
    const leading = new Set<string>();
    for (const token of state.tokens) {
      if (token.kind !== "tool" || !isGroupableTool(token.item)) break;
      leading.add(token.item.callId);
    }
    return [...state.targets].some((callId) => leading.has(callId));
  }

  private mergePage(
    state: AgentGroupState,
    result: {
      epoch: string;
      entries: readonly {
        item: unknown;
        turnId?: string;
        seqStart: number;
      }[];
      startCursor: TimelineCursor | null;
      hasOlder: boolean;
    },
    reset: boolean,
  ) {
    const page = result.entries.map<TimelineToken>((entry) =>
      isSourceToolCall(entry.item)
        ? {
            kind: "tool",
            key: `${result.epoch}:${entry.seqStart}`,
            order: entry.seqStart,
            turnId: entry.turnId ?? null,
            item: entry.item,
          }
        : {
            kind: "boundary",
            key: `${result.epoch}:${entry.seqStart}`,
            order: entry.seqStart,
          },
    );

    if (reset) {
      state.tokens = page;
      state.epoch = result.epoch;
    } else {
      const byKey = new Map(state.tokens.map((token) => [token.key, token]));
      for (const token of page) byKey.set(token.key, token);
      state.tokens = [...byKey.values()].sort((left, right) => left.order - right.order);
    }
    state.startCursor = result.startCursor;
    state.hasOlder = result.hasOlder;
    state.syntheticOrder = Math.max(1, ...state.tokens.map((token) => token.order + 1));
  }

  private applyLiveItem(state: AgentGroupState, value: unknown, turnId: string | null) {
    let appendedGroupableTool = false;
    if (isSourceToolCall(value)) {
      const existing = state.tokens.findIndex(
        (token) => token.kind === "tool" && token.item.callId === value.callId,
      );
      if (existing >= 0) {
        const token = state.tokens[existing] as Extract<TimelineToken, { kind: "tool" }>;
        state.tokens[existing] = { ...token, turnId: turnId ?? token.turnId, item: value };
      } else {
        appendedGroupableTool = isGroupableTool(value);
        const order = state.syntheticOrder++;
        state.tokens.push({
          kind: "tool",
          key: `live:${value.callId}`,
          order,
          turnId,
          item: value,
        });
      }
    } else if (state.tokens.at(-1)?.kind !== "boundary") {
      const order = state.syntheticOrder++;
      state.tokens.push({ kind: "boundary", key: `live:boundary:${order}`, order });
    }
    this.recompute(state.agentId, appendedGroupableTool);
  }

  private recompute(notifyAgentId?: string, allowMemberAppend = false) {
    const nextMembership = new Map<string, Membership>();
    for (const state of this.agents.values()) {
      const nextGroups = new Map<string, ToolGroupSnapshot>();
      if (this.config.enabled) {
        let pending: Extract<TimelineToken, { kind: "tool" }>[] = [];
        let pendingStartsAtOpenEdge = false;
        const flush = () => {
          if (pending.length >= this.config.threshold && !pendingStartsAtOpenEdge) {
            const anchor = pending[0]!.item.callId;
            const id = `${state.agentId}:${anchor}`;
            const calls = pending.map((token) => this.present(token.item, this.config.language));
            nextGroups.set(id, { id, anchorCallId: anchor, calls });
            for (const token of pending) {
              nextMembership.set(token.item.callId, {
                groupId: id,
                role: token.item.callId === anchor ? "anchor" : "member",
              });
            }
          }
          pending = [];
          pendingStartsAtOpenEdge = false;
        };

        for (const [index, token] of state.tokens.entries()) {
          if (token.kind !== "tool" || !isGroupableTool(token.item)) {
            flush();
            continue;
          }
          const previous = pending.at(-1);
          if (
            previous &&
            previous.turnId !== null &&
            token.turnId !== null &&
            previous.turnId !== token.turnId
          ) {
            flush();
          }
          if (pending.length === 0) pendingStartsAtOpenEdge = index === 0 && state.hasOlder;
          pending.push(token);
        }
        flush();
      }
      state.groups = nextGroups;
    }

    const projectionChanged = projectionRequiresRefresh(this.membership, nextMembership, allowMemberAppend);
    this.membership = nextMembership;
    const listeners = notifyAgentId
      ? [this.listeners.get(notifyAgentId)]
      : [...this.listeners.values()];
    for (const group of listeners) {
      if (!group) continue;
      for (const listener of group) listener();
    }
    if (projectionChanged) this.scheduleTransformerRefresh();
  }

  private scheduleTransformerRefresh() {
    if (this.refreshScheduled || this.disposed) return;
    this.refreshScheduled = true;
    void Promise.resolve().then(() => {
      this.refreshScheduled = false;
      if (!this.disposed) this.installTransformer();
    });
  }

  private installTransformer() {
    this.removeTransformer?.();
    this.removeTransformer = this.client.addTimelineTransformer({
      id: "polished-tool-call",
      query: { itemType: "tool_call" },
      transform: ({ item }) => {
        const membership = this.membership.get(item.callId);
        if (membership?.role === "member") return { items: [] };
        if (membership?.role === "anchor") {
          return {
            items: [
              {
                type: "plugin",
                kind: "polished-tool-group",
                version: 1,
                data: { groupId: membership.groupId, anchorCallId: item.callId, controllerId: this.id },
              },
            ],
          };
        }
        return {
          items: [
            {
              type: "plugin",
              kind: "polished-tool-call",
              version: 1,
              data: { ...this.present(item, this.config.language), controllerId: this.id },
            },
          ],
        };
      },
    });
  }
}

export function createToolGroupingController(
  client: PluginClientContext,
  present: (item: SourceToolCall, language: UiLanguage) => ToolCardData,
) {
  return new ToolGroupingController(client, present);
}

export function getToolGroupingController(controllerId: string | undefined) {
  return controllerId ? controllers.get(controllerId) ?? null : null;
}

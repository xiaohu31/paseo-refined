import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { UiLanguage } from "./i18n";
import type { ToolCardData } from "./tool-presentation";

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

type InternalToolGroupSnapshot = ToolGroupSnapshot & {
  sourceItems: readonly SourceToolCall[];
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
  targetRefs: Map<string, number>;
  groups: Map<string, InternalToolGroupSnapshot>;
  presentationLanguage: UiLanguage | null;
  epoch: string | null;
  startCursor: TimelineCursor | null;
  hasOlder: boolean;
  loaded: boolean;
  loading: Promise<void> | null;
  subscription: (() => void) | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  syntheticOrder: number;
};

type Membership = { groupId: string; role: "anchor" | "member" };
type GroupingConfig = { enabled: boolean; threshold: number; language: UiLanguage };
type GroupUiState = { expanded: boolean; visibleCount: number };
type PresentToolCall = (
  item: SourceToolCall,
  language: UiLanguage,
  truncateDetails?: boolean,
) => ToolCardData;

const MAX_RETAINED_TOKENS = 1000;
const TARGET_CONTEXT_TOKENS = 50;
const TOOL_STATUSES = new Set(["running", "completed", "failed", "canceled"]);

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
    TOOL_STATUSES.has(value.status) &&
    isRecord(value.detail) &&
    typeof value.detail.type === "string"
  );
}

function isGroupableTool(item: SourceToolCall) {
  return item.detail.type !== "plan" && item.name.trim().toLocaleLowerCase() !== "speak";
}

function projectionRequiresRefresh(left: Map<string, Membership>, right: Map<string, Membership>) {
  const establishedGroups = new Set(
    [...left.values()]
      .filter((membership) => membership.role === "anchor")
      .map((membership) => membership.groupId),
  );
  for (const [callId, membership] of left) {
    const other = right.get(callId);
    if (!other || other.groupId !== membership.groupId || other.role !== membership.role) return true;
  }
  for (const [callId, membership] of right) {
    if (left.has(callId)) continue;
    // A newly arriving member of an existing group has no cached projection yet,
    // so the installed transformer can classify it from the live membership map.
    // Every other membership change affects an already projected source item.
    if (membership.role !== "member" || !establishedGroups.has(membership.groupId)) return true;
  }
  return false;
}

function sameSourceItems(left: readonly SourceToolCall[], right: readonly SourceToolCall[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export interface ToolGroupingController {
  id: string;
  configure(next: GroupingConfig): void;
  attach(agentId: string, callId: string): () => void;
  subscribe(agentId: string, groupId: string, listener: () => void): () => void;
  getGroup(agentId: string, groupId: string): ToolGroupSnapshot | null;
  getCallDetails(agentId: string, callId: string): ToolCardData | null;
  isGroupedMember(callId: string): boolean;
  getGroupUiState(groupId: string): GroupUiState;
  setGroupUiState(groupId: string, state: GroupUiState): void;
  dispose(): void;
}

type ToolGroupingControllerInternal = ToolGroupingController & {
  client: PluginClientContext;
  present: PresentToolCall;
  agents: Map<string, AgentGroupState>;
  listeners: Map<string, Set<() => void>>;
  groupUiStates: Map<string, GroupUiState>;
  membership: Map<string, Membership>;
  config: GroupingConfig;
  removeTransformer: (() => void) | null;
  transformerGeneration: number;
  refreshScheduled: boolean;
  disposed: boolean;
  ensureAgent(agentId: string): AgentGroupState;
  startAgent(state: AgentGroupState): void;
  loadTail(state: AgentGroupState, reset: boolean): Promise<void>;
  ensureTargets(state: AgentGroupState): Promise<void>;
  needsOlderPage(state: AgentGroupState): boolean;
  mergePage(
    state: AgentGroupState,
    result: {
      epoch: string;
      entries: readonly { item: unknown; turnId?: string; seqStart: number }[];
      startCursor: TimelineCursor | null;
      hasOlder: boolean;
    },
    reset: boolean,
  ): void;
  applyLiveItem(state: AgentGroupState, value: unknown, turnId: string | null): void;
  recompute(notifyAgentId?: string): void;
  listenerKey(agentId: string, groupId: string): string;
  pruneTokens(state: AgentGroupState): void;
  scheduleTransformerRefresh(): void;
  installTransformer(): void;
};

type ToolGroupingControllerConstructor = new (
  client: PluginClientContext,
  present: PresentToolCall,
) => ToolGroupingControllerInternal;

// Paseo 0.9.2 evaluates client bundles through Hermes at runtime. Hermes' eval
// path does not reliably initialize class expressions, so keep this controller
// as an ordinary function constructor instead of emitting `class { ... }`.
export const ToolGroupingController = function ToolGroupingController(
  this: ToolGroupingControllerInternal,
  client: PluginClientContext,
  present: PresentToolCall,
) {
  this.id = `tool-groups-${++controllerSequence}`;
  this.client = client;
  this.present = present;
  this.agents = new Map();
  this.listeners = new Map();
  this.groupUiStates = new Map();
  this.membership = new Map();
  this.config = { enabled: true, threshold: 7, language: "en" };
  this.removeTransformer = null;
  this.transformerGeneration = 0;
  this.refreshScheduled = false;
  this.disposed = false;
  controllers.set(this.id, this);
  this.installTransformer();
} as unknown as ToolGroupingControllerConstructor;

ToolGroupingController.prototype.configure = function configure(
  this: ToolGroupingControllerInternal,
  next: GroupingConfig,
) {
    const threshold = Math.max(3, Math.min(30, Math.round(next.threshold)));
    if (
      this.config.enabled === next.enabled &&
      this.config.threshold === threshold &&
      this.config.language === next.language
    ) return;
    const languageChanged = this.config.language !== next.language;
    this.config = { enabled: next.enabled, threshold, language: next.language };
    this.recompute();
    if (languageChanged) this.scheduleTransformerRefresh();
};

ToolGroupingController.prototype.attach = function attach(
  this: ToolGroupingControllerInternal,
  agentId: string,
  callId: string,
) {
    if (this.disposed) return () => {};
    const state = this.ensureAgent(agentId);
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    state.targetRefs.set(callId, (state.targetRefs.get(callId) ?? 0) + 1);
    if (!state.subscription) this.startAgent(state);
    else void this.ensureTargets(state);
    if (this.membership.get(callId)?.role === "member") {
      // A member renderer can only mount when Paseo projected the item just
      // before our timeline subscription classified it. Refresh synchronously;
      // attach runs in a layout effect, so the stale standalone card is replaced
      // before paint instead of surviving until the next microtask.
      this.refreshScheduled = false;
      this.installTransformer();
    }
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      const count = state.targetRefs.get(callId) ?? 0;
      if (count <= 1) state.targetRefs.delete(callId);
      else state.targetRefs.set(callId, count - 1);
      this.pruneTokens(state);
      if (state.targetRefs.size === 0 && !state.idleTimer) {
        state.idleTimer = setTimeout(() => {
          state.idleTimer = null;
          if (state.targetRefs.size > 0) return;
          state.subscription?.();
          state.subscription = null;
        }, 30_000);
      }
    };
};

ToolGroupingController.prototype.subscribe = function subscribe(
  this: ToolGroupingControllerInternal,
  agentId: string,
  groupId: string,
  listener: () => void,
) {
    const key = this.listenerKey(agentId, groupId);
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
};

ToolGroupingController.prototype.getGroup = function getGroup(
  this: ToolGroupingControllerInternal,
  agentId: string,
  groupId: string,
) {
    return this.agents.get(agentId)?.groups.get(groupId) ?? null;
};

ToolGroupingController.prototype.getCallDetails = function getCallDetails(
  this: ToolGroupingControllerInternal,
  agentId: string,
  callId: string,
) {
    const token = this.agents
      .get(agentId)
      ?.tokens.find((candidate) => candidate.kind === "tool" && candidate.item.callId === callId);
  return token?.kind === "tool" ? this.present(token.item, this.config.language, false) : null;
};

ToolGroupingController.prototype.isGroupedMember = function isGroupedMember(
  this: ToolGroupingControllerInternal,
  callId: string,
) {
  return this.membership.get(callId)?.role === "member";
};

ToolGroupingController.prototype.getGroupUiState = function getGroupUiState(
  this: ToolGroupingControllerInternal,
  groupId: string,
): GroupUiState {
    return this.groupUiStates.get(groupId) ?? { expanded: false, visibleCount: 12 };
};

ToolGroupingController.prototype.setGroupUiState = function setGroupUiState(
  this: ToolGroupingControllerInternal,
  groupId: string,
  state: GroupUiState,
) {
    this.groupUiStates.set(groupId, state);
};

ToolGroupingController.prototype.dispose = function dispose(this: ToolGroupingControllerInternal) {
    if (this.disposed) return;
    this.disposed = true;
    this.removeTransformer?.();
    this.removeTransformer = null;
    for (const state of this.agents.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      state.subscription?.();
    }
    this.agents.clear();
    this.listeners.clear();
    this.groupUiStates.clear();
    controllers.delete(this.id);
};

ToolGroupingController.prototype.ensureAgent = function ensureAgent(
  this: ToolGroupingControllerInternal,
  agentId: string,
) {
    const existing = this.agents.get(agentId);
    if (existing) return existing;
    const state: AgentGroupState = {
      agentId,
      tokens: [],
      targetRefs: new Map(),
      groups: new Map(),
      presentationLanguage: null,
      epoch: null,
      startCursor: null,
      hasOlder: false,
      loaded: false,
      loading: null,
      subscription: null,
      idleTimer: null,
      syntheticOrder: 1,
    };
    this.agents.set(agentId, state);
    return state;
};

ToolGroupingController.prototype.startAgent = function startAgent(
  this: ToolGroupingControllerInternal,
  state: AgentGroupState,
) {
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
};

ToolGroupingController.prototype.loadTail = async function loadTail(
  this: ToolGroupingControllerInternal,
  state: AgentGroupState,
  reset: boolean,
): Promise<void> {
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
};

ToolGroupingController.prototype.ensureTargets = async function ensureTargets(
  this: ToolGroupingControllerInternal,
  state: AgentGroupState,
) {
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
};

ToolGroupingController.prototype.needsOlderPage = function needsOlderPage(
  this: ToolGroupingControllerInternal,
  state: AgentGroupState,
) {
    const known = new Set(
      state.tokens.flatMap((token) => (token.kind === "tool" ? [token.item.callId] : [])),
    );
    if ([...state.targetRefs.keys()].some((callId) => !known.has(callId))) return true;
    if (state.tokens[0]?.kind !== "tool") return false;
    const leading = new Set<string>();
    for (const token of state.tokens) {
      if (token.kind !== "tool" || !isGroupableTool(token.item)) break;
      leading.add(token.item.callId);
    }
    return [...state.targetRefs.keys()].some((callId) => leading.has(callId));
};

ToolGroupingController.prototype.mergePage = function mergePage(
    this: ToolGroupingControllerInternal,
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
    this.pruneTokens(state);
};

ToolGroupingController.prototype.applyLiveItem = function applyLiveItem(
  this: ToolGroupingControllerInternal,
  state: AgentGroupState,
  value: unknown,
  turnId: string | null,
) {
    if (isSourceToolCall(value)) {
      const existing = state.tokens.findIndex(
        (token) => token.kind === "tool" && token.item.callId === value.callId,
      );
      if (existing >= 0) {
        const token = state.tokens[existing] as Extract<TimelineToken, { kind: "tool" }>;
        state.tokens[existing] = { ...token, turnId: turnId ?? token.turnId, item: value };
      } else {
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
    this.pruneTokens(state);
    this.recompute(state.agentId);
};

ToolGroupingController.prototype.recompute = function recompute(
  this: ToolGroupingControllerInternal,
  notifyAgentId?: string,
) {
    const nextMembership = new Map<string, Membership>();
    const changedGroups: Array<{ agentId: string; groupIds: Set<string> }> = [];
    const activeGroupIds = new Set<string>();
    for (const state of this.agents.values()) {
      const nextGroups = new Map<string, InternalToolGroupSnapshot>();
      if (this.config.enabled) {
        let pending: Extract<TimelineToken, { kind: "tool" }>[] = [];
        let pendingStartsAtOpenEdge = false;
        const flush = () => {
          if (pending.length >= this.config.threshold && !pendingStartsAtOpenEdge) {
            const anchor = pending[0]!.item.callId;
            const id = `${state.agentId}:${anchor}`;
            const sourceItems = pending.map((token) => token.item);
            const previous = state.groups.get(id);
            const group = previous &&
              state.presentationLanguage === this.config.language &&
              sameSourceItems(previous.sourceItems, sourceItems)
              ? previous
              : {
                  id,
                  anchorCallId: anchor,
                  calls: sourceItems.map((item) => this.present(item, this.config.language)),
                  sourceItems,
                };
            nextGroups.set(id, group);
            activeGroupIds.add(id);
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
      const changed = new Set<string>();
      for (const groupId of new Set([...state.groups.keys(), ...nextGroups.keys()])) {
        if (state.groups.get(groupId) !== nextGroups.get(groupId)) changed.add(groupId);
      }
      state.groups = nextGroups;
      state.presentationLanguage = this.config.language;
      if (changed.size > 0) changedGroups.push({ agentId: state.agentId, groupIds: changed });
    }

    const projectionChanged = projectionRequiresRefresh(this.membership, nextMembership);
    this.membership = nextMembership;
    for (const { agentId, groupIds } of changedGroups) {
      if (notifyAgentId && agentId !== notifyAgentId) continue;
      for (const groupId of groupIds) {
        for (const listener of this.listeners.get(this.listenerKey(agentId, groupId)) ?? []) listener();
      }
    }
    for (const groupId of this.groupUiStates.keys()) {
      if (!activeGroupIds.has(groupId)) this.groupUiStates.delete(groupId);
    }
    if (projectionChanged) this.scheduleTransformerRefresh();
};

ToolGroupingController.prototype.listenerKey = function listenerKey(
  this: ToolGroupingControllerInternal,
  agentId: string,
  groupId: string,
) {
    return `${agentId}\u0000${groupId}`;
};

ToolGroupingController.prototype.pruneTokens = function pruneTokens(
  this: ToolGroupingControllerInternal,
  state: AgentGroupState,
) {
    if (state.tokens.length <= MAX_RETAINED_TOKENS) return;
    let cutoff = state.tokens.length - MAX_RETAINED_TOKENS;
    for (const callId of state.targetRefs.keys()) {
      const index = state.tokens.findIndex(
        (token) => token.kind === "tool" && token.item.callId === callId,
      );
      if (index >= 0) cutoff = Math.min(cutoff, Math.max(0, index - TARGET_CONTEXT_TOKENS));
    }
    if (cutoff <= 0) return;
    const boundary = state.tokens
      .slice(Math.max(0, cutoff - TARGET_CONTEXT_TOKENS), cutoff + 1)
      .findLastIndex((token) => token.kind === "boundary");
    const start = boundary >= 0 ? Math.max(0, cutoff - TARGET_CONTEXT_TOKENS) + boundary : cutoff;
    state.tokens = state.tokens.slice(start);
    state.hasOlder = true;
    const first = state.tokens[0];
    if (first && state.epoch && first.key.startsWith(`${state.epoch}:`)) {
      state.startCursor = { epoch: state.epoch, seq: Math.trunc(first.order) };
    } else if (!state.loading) {
      // Synthetic live entries do not expose canonical cursors. Refresh the tail
      // instead of guessing a cursor that could skip history needed by a target.
      void this.loadTail(state, true);
    }
};

ToolGroupingController.prototype.scheduleTransformerRefresh = function scheduleTransformerRefresh(
  this: ToolGroupingControllerInternal,
) {
    if (this.refreshScheduled || this.disposed) return;
    this.refreshScheduled = true;
    void Promise.resolve().then(() => {
      if (!this.refreshScheduled) return;
      this.refreshScheduled = false;
      if (!this.disposed) this.installTransformer();
    });
};

ToolGroupingController.prototype.installTransformer = function installTransformer(
  this: ToolGroupingControllerInternal,
) {
    const previousTransformer = this.removeTransformer;
    const language = this.config.language;
    const generation = ++this.transformerGeneration;
    const nextTransformer = this.client.addTimelineTransformer({
      // Paseo publishes the plugin registry synchronously on both registration
      // and removal. Keep the previous generation installed until this one is
      // active so a refresh never exposes the untransformed tool cards.
      id: `polished-tool-call-${generation}`,
      query: { itemType: "tool_call" },
      transform: ({ item }) => {
        if (!isSourceToolCall(item)) return undefined;
        // Paseo caches projections for existing source item identities. Reading
        // live membership lets brand-new calls join an established group without
        // reinstalling the transformer, while structural changes still refresh
        // the cache through projectionRequiresRefresh above.
        const groupMembership = this.membership.get(item.callId);
        if (groupMembership?.role === "member") return { items: [] };
        if (groupMembership?.role === "anchor") {
          return {
            items: [
              {
                type: "plugin",
                kind: "polished-tool-group",
                version: 1,
                data: { groupId: groupMembership.groupId, anchorCallId: item.callId, controllerId: this.id },
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
              data: { ...this.present(item, language), controllerId: this.id },
            },
          ],
        };
      },
    });
    this.removeTransformer = nextTransformer;
    previousTransformer?.();
};

export function createToolGroupingController(
  client: PluginClientContext,
  present: PresentToolCall,
) {
  return new ToolGroupingController(client, present);
}

export function getToolGroupingController(controllerId: string | undefined) {
  return controllerId ? controllers.get(controllerId) ?? null : null;
}

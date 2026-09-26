import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, useRevealedText } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { refinedSettings } from "../shared/settings";
import { resolveUiLanguage, tr, type UiLanguage } from "./i18n";
import {
  CompletionGlint,
  CompletionMark,
  CompletedToolSummary,
  isDarkColor,
  RunningStatusDot,
  RunningToolSummary,
  ToolSummaryText,
  useSmoothedRunning,
} from "./animations";
import { visibleToolCalls } from "./tool-list";
import { getToolGroupingController } from "./tool-groups";
import { alpha, ToolDetails } from "./tool-details";
import {
  statusLabel,
  toolCallSchema,
  toolGroupSchema,
  type ToolCardData,
} from "./tool-presentation";

export const reasoningSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

function useUiLanguage() {
  const settings = useSettings(refinedSettings);
  return resolveUiLanguage(settings.status === "ready" ? settings.values.uiLanguage : "auto");
}


type ToolCardTheme = PluginTimelineItemProps<ToolCardData>["theme"];
type ToolCardLayout = PluginTimelineItemProps<ToolCardData>["layout"];


export function ReasoningCard({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<z.output<typeof reasoningSchema>>) {
  const { text, phase } = item.data;
  const language = useUiLanguage();
  const [expanded, setExpanded] = useState(phase === "streaming");
  const revealedText = useRevealedText(text, phase);
  useEffect(() => {
    if (phase === "complete") setExpanded(false);
  }, [phase]);
  const styles = useMemo(
    () => ({
      card: {
        marginVertical: 1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        minHeight: 40,
        paddingHorizontal: layout.compact ? 10 : 12,
        paddingVertical: 7,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      state: { color: theme.colors.foregroundMuted, fontSize: 11 },
      body: {
        paddingHorizontal: layout.compact ? 10 : 12,
        paddingBottom: 10,
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 18,
      },
    }),
    [theme, layout.compact],
  );

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          language === "zh-CN"
            ? `${expanded ? "收起" : "展开"}思考内容`
            : `${expanded ? "Collapse" : "Expand"} reasoning`
        }
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <Icon name="Brain" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.title}>{tr(language, "Reasoning")}</Text>
        {phase === "streaming" && <Text style={styles.state}>{tr(language, "Thinking…")}</Text>}
        <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
      {expanded && <Text selectable style={styles.body}>{revealedText || tr(language, "Thinking…")}</Text>}
    </View>
  );
}

function useToolGrouping(agentId: string, callId: string, controllerId: string | undefined) {
  const settings = useSettings(refinedSettings);
  const controller = useMemo(() => getToolGroupingController(controllerId), [controllerId]);
  const enabled = settings.status === "ready" ? settings.values.groupConsecutiveTools : true;
  const threshold = settings.status === "ready" ? settings.values.toolGroupThreshold : 7;
  const language = resolveUiLanguage(settings.status === "ready" ? settings.values.uiLanguage : "auto");

  useEffect(() => {
    controller?.configure({ enabled, threshold, language });
  }, [controller, enabled, language, threshold]);

  useEffect(() => controller?.attach(agentId, callId), [agentId, callId, controller]);
  return { controller, language };
}

function groupBreakdown(calls: readonly ToolCardData[], language: UiLanguage) {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const label =
      call.kind === "shell"
        ? "command"
        : call.kind === "read"
          ? "read"
          : call.kind === "edit" || call.kind === "write"
            ? "edit"
            : call.kind === "search"
              ? "search"
              : call.kind === "fetch"
                ? "fetch"
                : "other";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const plural = new Map([
    ["command", "commands"],
    ["read", "reads"],
    ["edit", "edits"],
    ["search", "searches"],
    ["fetch", "fetches"],
    ["other", "other"],
  ]);
  if (language === "zh-CN") {
    const chineseLabels = new Map([
      ["command", "次命令"],
      ["read", "次读取"],
      ["edit", "次编辑"],
      ["search", "次搜索"],
      ["fetch", "次获取"],
      ["other", "次其他调用"],
    ]);
    return [...counts.entries()]
      .map(([label, count]) => `${count} ${chineseLabels.get(label) ?? label}`)
      .join(" · ");
  }
  return [...counts.entries()]
    .map(([label, count]) => `${count} ${count === 1 ? label : plural.get(label) ?? label}`)
    .join(" · ");
}

function GroupToolList({
  calls,
  onSelect,
  visibleCount,
  onShowMore,
  language,
  theme,
  layout,
}: {
  calls: readonly ToolCardData[];
  onSelect(callId: string): void;
  visibleCount: number;
  onShowMore(): void;
  language: UiLanguage;
  theme: ToolCardTheme;
  layout: ToolCardLayout;
}) {
  const visibleCalls = visibleToolCalls(calls, visibleCount);
  const remaining = calls.length - visibleCalls.length;

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      }}
    >
      {visibleCalls.map((call, index) => {
        const canExpand = Boolean(call.primary || call.secondary || call.metadata.length > 0);
        const color =
          call.status === "failed"
            ? theme.colors.statusDanger
            : call.status === "running"
              ? theme.colors.foregroundMuted
              : call.status === "completed"
                ? theme.colors.statusSuccess
                : theme.colors.foregroundMuted;
        return (
          <Pressable
            key={call.callId}
            accessibilityRole={canExpand ? "button" : undefined}
            accessibilityLabel={
              canExpand
                ? language === "zh-CN"
                  ? `打开${call.title}详情，${statusLabel(call.status, language)}`
                  : `Open ${call.title} details, ${statusLabel(call.status, language)}`
                : `${call.title}, ${statusLabel(call.status, language)}`
            }
            disabled={!canExpand}
            onPress={() => onSelect(call.callId)}
            style={({ pressed }) => ({
              minHeight: 42,
              paddingHorizontal: layout.compact ? 10 : 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
              backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface0,
            })}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Icon name={call.icon} size={13} color={theme.colors.foregroundMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ToolSummaryText
                data={call}
                color={theme.colors.foregroundMuted}
                labelColor={theme.colors.foreground}
              />
            </View>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
            {canExpand && <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />}
          </Pressable>
        );
      })}
      {remaining > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === "zh-CN" ? `再显示 ${remaining} 个工具调用` : `Show ${remaining} more tool calls`}
          onPress={onShowMore}
          style={({ pressed }) => ({
            minHeight: 38,
            paddingHorizontal: layout.compact ? 10 : 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface0,
          })}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
            {language === "zh-CN" ? `再显示 ${Math.min(12, remaining)} 项` : `Show ${Math.min(12, remaining)} more`}
          </Text>
          <Icon name="ChevronDown" size={13} color={theme.colors.foregroundMuted} />
        </Pressable>
      )}
    </View>
  );
}

export function ToolGroupCard({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<z.output<typeof toolGroupSchema>>) {
  const { groupId, anchorCallId, controllerId } = item.data;
  const { controller, language } = useToolGrouping(agentId, anchorCallId, controllerId);
  const [, setRevision] = useState(0);
  const initialUiState = controller?.getGroupUiState(groupId) ?? { expanded: false, visibleCount: 12 };
  const [expanded, setExpanded] = useState(initialUiState.expanded);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(initialUiState.visibleCount);

  useEffect(() => {
    if (!controller) return;
    return controller.subscribe(agentId, groupId, () => setRevision((value) => value + 1));
  }, [agentId, controller, groupId]);

  useEffect(() => {
    controller?.setGroupUiState(groupId, { expanded, visibleCount });
  }, [controller, expanded, groupId, visibleCount]);

  const group = controller?.getGroup(agentId, groupId) ?? null;
  const running = group?.calls.some((call) => call.status === "running") ?? false;
  const smoothedRunning = useSmoothedRunning(running);
  if (!group || group.calls.length === 0) {
    return (
      <View
        style={{
          minHeight: 40,
          paddingHorizontal: 12,
          borderRadius: 10,
          justifyContent: "center",
          backgroundColor: theme.colors.surface1,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{tr(language, "Preparing tool group…")}</Text>
      </View>
    );
  }

  const calls = group.calls;
  const breakdown = groupBreakdown(calls, language);
  const failed = calls.filter((call) => call.status === "failed").length;
  const canceled = calls.filter((call) => call.status === "canceled").length;
  const showRunning = smoothedRunning && failed === 0;
  const runningColor = theme.colors.foregroundMuted;
  const statusColor = failed
    ? theme.colors.statusDanger
    : showRunning
      ? runningColor
      : canceled
        ? theme.colors.foregroundMuted
        : theme.colors.statusSuccess;
  const statusText = showRunning
    ? tr(language, "Running")
    : failed
      ? language === "zh-CN" ? `${failed} 项失败` : `${failed} failed`
      : canceled
        ? language === "zh-CN" ? `${canceled} 项已取消` : `${canceled} canceled`
        : tr(language, "Done");
  const dark = isDarkColor(theme.colors.surface0);
  const selectedCallSummary = calls.find((call) => call.callId === selectedCallId) ?? null;
  const selectedCall = selectedCallId
    ? controller?.getCallDetails(agentId, selectedCallId) ?? selectedCallSummary
    : null;
  const summaryData: ToolCardData = {
    ...calls[calls.length - 1]!,
    title: language === "zh-CN" ? `${calls.length} 次工具调用` : `${calls.length} tool calls`,
    subtitle: breakdown,
  };

  return (
    <View
      style={{
        marginVertical: 1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: failed
          ? alpha(theme.colors.statusDanger, "48")
          : showRunning
            ? alpha(runningColor, "38")
            : alpha(theme.colors.border, "B8"),
        backgroundColor: showRunning || failed ? theme.colors.surface1 : theme.colors.surface0,
        overflow: "hidden",
      }}
    >
      {(showRunning || failed > 0) && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            zIndex: 1,
            left: 0,
            top: 7,
            bottom: 7,
            width: 2,
            borderRadius: 1,
            backgroundColor: failed ? theme.colors.statusDanger : runningColor,
            opacity: failed ? 0.55 : 0.35,
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          language === "zh-CN"
            ? `${expanded ? "收起" : "展开"}${calls.length} 次工具调用，${statusText}`
            : `${expanded ? "Collapse" : "Expand"} ${calls.length} grouped tool calls, ${statusText}`
        }
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({
          minHeight: 42,
          paddingHorizontal: layout.compact ? 10 : 12,
          paddingVertical: 7,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: pressed ? theme.colors.surface2 : "transparent",
        })}
      >
        <View
          style={{
            width: 23,
            height: 23,
            borderRadius: 7,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.surface2,
          }}
        >
          <Icon name="Layers" size={13} color={theme.colors.foregroundMuted} />
        </View>
        <RunningToolSummary
          data={summaryData}
          dark={dark}
          foreground={theme.colors.foreground}
          mutedForeground={theme.colors.foregroundMuted}
          platform={layout.platform}
          active={showRunning}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          {showRunning ? (
            <RunningStatusDot color={statusColor} dark={dark} platform={layout.platform} />
          ) : (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
          )}
          {!layout.compact && (
            <Text style={{ color: failed ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 11 }}>
              {statusText}
            </Text>
          )}
          {layout.compact && failed > 0 && (
            <Text style={{ color: theme.colors.statusDanger, fontSize: 10, fontWeight: "600" }}>
              {statusText}
            </Text>
          )}
          <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
        </View>
      </Pressable>
      {expanded && (
        <GroupToolList
          calls={calls}
          onSelect={setSelectedCallId}
          visibleCount={visibleCount}
          onShowMore={() => setVisibleCount((value) => value + 12)}
          language={language}
          theme={theme}
          layout={layout}
        />
      )}
      {selectedCall && (
        <Modal
          title={language === "zh-CN" ? `${selectedCall.title}详情` : `${selectedCall.title} details`}
          icon={<Icon name={selectedCall.icon} size={17} color={theme.colors.foreground} />}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedCallId(null);
          }}
        >
        <Modal.Content
          style={{ backgroundColor: theme.colors.surface0 }}
          contentContainerStyle={{ padding: layout.compact ? 12 : 16, gap: 0 }}
        >
          <ToolDetails data={selectedCall} theme={theme} layout={layout} language={language} standalone />
        </Modal.Content>
      </Modal>
      )}
    </View>
  );
}

export function ToolCallCard({
  agentId,
  item,
  timestamp,
  theme,
  layout,
}: PluginTimelineItemProps<z.output<typeof toolCallSchema>>) {
  const data = item.data;
  const { controller, language } = useToolGrouping(agentId, data.callId, data.controllerId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const previousStatus = useRef(data.status);
  const [completionSweep, setCompletionSweep] = useState(() => {
    const age = Date.now() - timestamp.getTime();
    return data.status === "completed" && age >= -1_000 && age <= 6_000 ? 1 : 0;
  });
  const detailData = detailsOpen
    ? controller?.getCallDetails(agentId, data.callId) ?? data
    : data;
  const canExpand = Boolean(data.primary || data.secondary || data.metadata.length > 0);
  const dark = isDarkColor(theme.colors.surface0);
  const lightweight = data.status === "completed" && ["read", "search", "fetch"].includes(data.kind);
  const runningColor = theme.colors.foregroundMuted;

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = data.status;
    if (previous === "running" && data.status === "completed") {
      setCompletionSweep((value) => value + 1);
    }
  }, [data.status]);

  const statusColor =
    data.status === "failed"
      ? theme.colors.statusDanger
      : data.status === "running"
        ? runningColor
        : data.status === "completed"
          ? theme.colors.statusSuccess
          : theme.colors.foregroundMuted;
  const styles = useMemo(
    () => ({
      card: {
        marginVertical: 1,
        borderRadius: lightweight ? 8 : 10,
        borderWidth: 1,
        borderColor:
          data.status === "running"
            ? alpha(runningColor, "38")
            : data.status === "failed"
              ? alpha(theme.colors.statusDanger, "48")
              : alpha(theme.colors.border, lightweight ? "B0" : "C8"),
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        minHeight: lightweight ? 34 : 40,
        paddingHorizontal: layout.compact ? 10 : 12,
        paddingVertical: lightweight ? 5 : 7,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      icon: {
        width: lightweight ? 20 : 22,
        height: lightweight ? 20 : 22,
        borderRadius: 6,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        borderWidth: 1,
        borderColor: alpha(theme.colors.border, data.status === "completed" ? "88" : "B8"),
        backgroundColor: theme.colors.surface2,
      },
      status: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5 },
      dot: {
        width: data.status === "completed" ? 5 : 6,
        height: data.status === "completed" ? 5 : 6,
        borderRadius: 3,
        backgroundColor: statusColor,
      },
      statusText: { color: theme.colors.foregroundMuted, fontSize: 11 },
    }),
    [data.status, lightweight, theme, layout.compact, statusColor],
  );

  return (
    <View style={styles.card}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          zIndex: 1,
          top: 0,
          left: 10,
          right: 10,
          height: 1,
          borderRadius: 1,
          backgroundColor: alpha(theme.colors.foreground, dark ? "24" : "0D"),
        }}
      />
      {data.status === "completed" && (
        <CompletionGlint
          color={theme.colors.foreground}
          dark={dark}
          platform={layout.platform}
          trigger={completionSweep}
        />
      )}
      {(data.status === "running" || data.status === "failed") && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            zIndex: 1,
            left: 0,
            top: 7,
            bottom: 7,
            width: 2,
            borderRadius: 1,
            backgroundColor: data.status === "failed" ? theme.colors.statusDanger : runningColor,
            opacity: data.status === "failed" ? 0.55 : 0.35,
          }}
        />
      )}
      <Pressable
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityLabel={
          canExpand
            ? language === "zh-CN"
              ? `打开${data.title}详情，${statusLabel(data.status, language)}`
              : `Open ${data.title} details, ${statusLabel(data.status, language)}`
            : `${data.title}, ${statusLabel(data.status, language)}`
        }
        disabled={!canExpand}
        onPress={() => setDetailsOpen(true)}
        style={({ pressed }) => [styles.header, pressed && { backgroundColor: theme.colors.surface2 }]}
      >
        <View style={styles.icon}>
          <Icon name={data.icon} size={lightweight ? 12 : 13} color={theme.colors.foregroundMuted} />
        </View>
        {data.status === "running" ? (
          <RunningToolSummary
            data={data}
            dark={dark}
            foreground={theme.colors.foreground}
            mutedForeground={theme.colors.foregroundMuted}
            platform={layout.platform}
          />
        ) : data.status === "completed" ? (
          <CompletedToolSummary
            data={data}
            dark={dark}
            foreground={theme.colors.foreground}
            mutedForeground={theme.colors.foregroundMuted}
            platform={layout.platform}
            trigger={completionSweep}
          />
        ) : (
          <View style={{ flex: 1, minWidth: 0, height: 18 }}>
            <ToolSummaryText
              data={data}
              color={theme.colors.foregroundMuted}
              labelColor={theme.colors.foreground}
            />
          </View>
        )}
        <View style={styles.status}>
          {data.status === "running" ? (
            <RunningStatusDot color={statusColor} dark={dark} platform={layout.platform} />
          ) : data.status === "completed" ? (
            <CompletionMark platform={layout.platform} trigger={completionSweep}>
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: alpha(theme.colors.border, "88"),
                  backgroundColor: theme.colors.surface2,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="Check" size={11} color={theme.colors.foregroundMuted} />
              </View>
            </CompletionMark>
          ) : (
            <View style={styles.dot} />
          )}
          {!layout.compact && <Text style={styles.statusText}>{statusLabel(data.status, language)}</Text>}
          {canExpand && (
            <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />
          )}
        </View>
      </Pressable>
      {canExpand && (
        <Modal
          title={language === "zh-CN" ? `${data.title}详情` : `${data.title} details`}
          icon={<Icon name={data.icon} size={17} color={theme.colors.foreground} />}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        >
          <Modal.Content
            style={{ backgroundColor: theme.colors.surface0 }}
            contentContainerStyle={{ padding: layout.compact ? 12 : 16, gap: 0 }}
          >
            <ToolDetails data={detailData} theme={theme} layout={layout} language={language} standalone />
          </Modal.Content>
        </Modal>
      )}
    </View>
  );
}

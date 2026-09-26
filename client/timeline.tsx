import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { copyText, Icon, Modal, ScrollView, TextInput, useRevealedText, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { refinedSettings } from "../shared/settings";
import { getToolGroupingController } from "./tool-groups";

export const reasoningSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});

export const toolCallSchema = z.object({
  callId: z.string(),
  controllerId: z.string().optional(),
  kind: z.enum([
    "shell",
    "read",
    "edit",
    "write",
    "search",
    "fetch",
    "worktree_setup",
    "sub_agent",
    "plan",
    "plain_text",
    "unknown",
  ]),
  title: z.string(),
  subtitle: z.string(),
  primaryLabel: z.string(),
  primary: z.string(),
  secondaryLabel: z.string(),
  secondary: z.string(),
  metadata: z.array(z.object({ label: z.string(), value: z.string() })),
  isDiff: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  icon: z.enum(["Terminal", "FileText", "Pencil", "Search", "Globe", "GitBranch", "Bot", "Wrench"]),
  status: z.enum(["running", "completed", "failed", "canceled"]),
});

export const toolGroupSchema = z.object({
  groupId: z.string(),
  anchorCallId: z.string(),
  controllerId: z.string(),
});

type ToolCallItem = {
  callId: string;
  name: string;
  status: "running" | "completed" | "failed" | "canceled";
  error: unknown;
  detail: Record<string, unknown> & { type: string };
};

const MAX_DETAIL_LENGTH = 16000;

function compact(value: unknown): string {
  if (typeof value === "string") {
    return value
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\r(?!\n)/g, "\n")
      .trim();
  }
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatStructuredText(value: unknown) {
  const text = compact(value);
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function formatSearchResults(detail: ToolCallItem["detail"]) {
  const content = formatStructuredText(detail.content);
  if (content) return content;
  if (Array.isArray(detail.filePaths)) return detail.filePaths.map((path) => String(path)).join("\n");
  if (Array.isArray(detail.webResults)) {
    return detail.webResults
      .map((result) => {
        if (!result || typeof result !== "object") return compact(result);
        const item = result as Record<string, unknown>;
        return [compact(item.title), compact(item.url)].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

function formatActions(value: unknown) {
  if (!Array.isArray(value)) return compact(value);
  return value
    .map((action) => {
      if (!action || typeof action !== "object") return compact(action);
      const item = action as Record<string, unknown>;
      const tool = compact(item.toolName) || "Action";
      const summary = compact(item.summary);
      return summary ? `• ${tool} — ${summary}` : `• ${tool}`;
    })
    .join("\n");
}

function summarizeCommand(value: unknown) {
  const command = compact(value);
  return command.replace(/^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "") || command;
}

function summarizePath(value: unknown) {
  const path = compact(value);
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : path;
}

function clip(value: string): string {
  if (value.length <= MAX_DETAIL_LENGTH) return value;
  return `${value.slice(0, MAX_DETAIL_LENGTH)}\n…`;
}

function first(...values: unknown[]): string {
  for (const value of values) {
    const text = compact(value);
    if (text) return text;
  }
  return "";
}

function metadata(...entries: Array<[string, unknown]>) {
  return entries.flatMap(([label, value]) => {
    const text = compact(value);
    return text ? [{ label, value: text }] : [];
  });
}

function diffStats(diff: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function toolPresentation(detail: ToolCallItem["detail"]) {
  switch (detail.type) {
    case "shell":
      return {
        kind: "shell" as const,
        title: "Command",
        subtitle: first(summarizeCommand(detail.command), "Shell command"),
        primaryLabel: "Command",
        primary: compact(detail.command),
        secondaryLabel: "Output",
        secondary: formatStructuredText(detail.output),
        metadata: metadata(["Working directory", detail.cwd], ["Exit code", detail.exitCode]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Terminal" as const,
      };
    case "read":
      return {
        kind: "read" as const,
        title: "Read file",
        subtitle: first(summarizePath(detail.filePath), "File"),
        primaryLabel: "File",
        primary: compact(detail.filePath),
        secondaryLabel: "Content",
        secondary: formatStructuredText(detail.content),
        metadata: metadata(["Offset", detail.offset], ["Limit", detail.limit]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "FileText" as const,
      };
    case "edit":
    case "write": {
      const diff = compact(detail.unifiedDiff);
      const stats = diffStats(diff);
      const filePath = first(summarizePath(detail.filePath), "File");
      const suffix = diff ? ` · +${stats.additions} −${stats.deletions}` : "";
      return {
        kind: detail.type as "edit" | "write",
        title: detail.type === "edit" ? "Edit file" : "Write file",
        subtitle: `${filePath}${suffix}`,
        primaryLabel: "File",
        primary: compact(detail.filePath),
        secondaryLabel: diff ? "Changes" : "Content",
        secondary: first(diff, formatStructuredText(detail.content), formatStructuredText(detail.newString)),
        metadata: [],
        isDiff: Boolean(diff),
        ...stats,
        icon: "Pencil" as const,
      };
    }
    case "search":
      {
      const matches = compact(detail.numMatches);
      return {
        kind: "search" as const,
        title: "Search",
        subtitle: `${first(detail.query, "Search workspace")}${matches ? ` · ${matches} matches` : ""}`,
        primaryLabel: "Query",
        primary: compact(detail.query),
        secondaryLabel: "Results",
        secondary: formatSearchResults(detail),
        metadata: metadata(["Matches", detail.numMatches], ["Files", detail.numFiles], ["Duration", detail.durationMs]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Search" as const,
      };
      }
    case "fetch":
      {
      const status = compact(detail.code);
      return {
        kind: "fetch" as const,
        title: "Fetch",
        subtitle: `${first(detail.url, "Remote resource")}${status ? ` · ${status}` : ""}`,
        primaryLabel: "URL",
        primary: compact(detail.url),
        secondaryLabel: "Response",
        secondary: first(formatStructuredText(detail.result), detail.codeText),
        metadata: metadata(["Status", detail.code], ["Bytes", detail.bytes], ["Duration", detail.durationMs]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Globe" as const,
      };
      }
    case "worktree_setup":
      return {
        kind: "worktree_setup" as const,
        title: "Prepare worktree",
        subtitle: first(detail.branchName, detail.worktreePath),
        primaryLabel: "Worktree",
        primary: first(detail.worktreePath, detail.branchName),
        secondaryLabel: "Setup log",
        secondary: first(formatStructuredText(detail.log), formatStructuredText(detail.commands)),
        metadata: metadata(["Branch", detail.branchName]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "GitBranch" as const,
      };
    case "sub_agent":
      return {
        kind: "sub_agent" as const,
        title: "Subagent",
        subtitle: first(detail.description, detail.subAgentType, "Delegated task"),
        primaryLabel: "Task",
        primary: first(detail.description, detail.subAgentType),
        secondaryLabel: "Activity",
        secondary: first(formatStructuredText(detail.log), formatActions(detail.actions)),
        metadata: metadata(["Agent", detail.subAgentType]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Bot" as const,
      };
    case "plan":
      return {
        kind: "plan" as const,
        title: "Plan",
        subtitle: first(detail.text, "Implementation plan"),
        primaryLabel: "Plan",
        primary: compact(detail.text),
        secondaryLabel: "",
        secondary: "",
        metadata: [],
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "FileText" as const,
      };
    case "plain_text":
      return {
        kind: "plain_text" as const,
        title: first(detail.label, "Tool"),
        subtitle: first(detail.text, "Tool activity"),
        primaryLabel: first(detail.label, "Details"),
        primary: compact(detail.text),
        secondaryLabel: "",
        secondary: "",
        metadata: [],
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Wrench" as const,
      };
    default:
      return {
        kind: "unknown" as const,
        title: "Tool",
        subtitle: detail.type || "Tool activity",
        primaryLabel: "Raw details",
        primary: compact(detail),
        secondaryLabel: "",
        secondary: "",
        metadata: [],
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Wrench" as const,
      };
  }
}

export function toToolCardData(item: ToolCallItem) {
  const presentation = toolPresentation(item.detail);
  const error = item.status === "failed" ? compact(item.error) : "";
  return {
    ...presentation,
    callId: item.callId,
    title: presentation.title || item.name,
    primary: clip(presentation.primary),
    secondaryLabel: error ? "Error" : presentation.secondaryLabel,
    secondary: clip(error || presentation.secondary),
    isDiff: error ? false : presentation.isDiff,
    status: item.status,
  };
}

function statusLabel(status: z.output<typeof toolCallSchema>["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
  }
}

function useReduceMotionPreference() {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active) setReduceMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function useSmoothedRunning(running: boolean, enterDelay = 180, minimumVisible = 450) {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const visibleSince = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;

    if (running) {
      if (!visibleRef.current) {
        timer.current = setTimeout(() => {
          visibleRef.current = true;
          visibleSince.current = Date.now();
          setVisible(true);
        }, enterDelay);
      }
    } else if (visibleRef.current) {
      const remaining = Math.max(0, minimumVisible - (Date.now() - visibleSince.current));
      timer.current = setTimeout(() => {
        visibleRef.current = false;
        setVisible(false);
      }, remaining);
    }

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enterDelay, minimumVisible, running]);

  return visible;
}

function isDarkColor(color: string) {
  const match = color.match(/^#([0-9a-f]{6})/i);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255 < 0.5;
}

function mixColors(from: string, to: string, amount: number) {
  const start = from.match(/^#([0-9a-f]{6})/i);
  const end = to.match(/^#([0-9a-f]{6})/i);
  if (!start || !end) return to;
  const a = Number.parseInt(start[1], 16);
  const b = Number.parseInt(end[1], 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `#${[channel(16), channel(8), channel(0)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function RunningStatusDot({
  color,
  dark,
  platform,
}: {
  color: string;
  dark: boolean;
  platform: "ios" | "android" | "web";
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotionPreference();

  useEffect(() => {
    progress.stopAnimation();
    if (reduceMotion !== false) {
      progress.setValue(0);
      return;
    }

    const inhale = Easing.bezier(0.32, 0, 0.2, 1);
    const exhale = Easing.bezier(0.4, 0, 0.68, 1);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1450,
          easing: inhale,
          useNativeDriver: platform !== "web",
          isInteraction: false,
        }),
        Animated.delay(150),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1950,
          easing: exhale,
          useNativeDriver: platform !== "web",
          isInteraction: false,
        }),
        Animated.delay(550),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      progress.stopAnimation();
    };
  }, [platform, progress, reduceMotion]);

  return (
    <View accessible={false} style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.02, dark ? 0.14 : 0.08] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.15] }) }],
        }}
      />
      <Animated.View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }),
        }}
      />
    </View>
  );
}

function ToolSummaryText({
  data,
  color,
  labelColor,
  glowRadius = 0,
}: {
  data: z.output<typeof toolCallSchema>;
  color: string;
  labelColor: string;
  glowRadius?: number;
}) {
  return (
    <Text
      numberOfLines={1}
      style={{
        color,
        fontSize: 12,
        lineHeight: 18,
        textShadowColor: glowRadius > 0 ? color : "transparent",
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: glowRadius,
      }}
    >
      {data.title === "Command" ? null : (
        <Text style={{ color: labelColor, fontWeight: "500" }}>{`${data.title.replace(" file", "")} · `}</Text>
      )}
      {data.subtitle}
    </Text>
  );
}

function RunningToolSummary({
  data,
  dark,
  foreground,
  mutedForeground,
  platform,
  active = true,
}: {
  data: z.output<typeof toolCallSchema>;
  dark: boolean;
  foreground: string;
  mutedForeground: string;
  platform: "ios" | "android" | "web";
  active?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotionPreference();

  useEffect(() => {
    sweep.stopAnimation();
    if (!active || reduceMotion !== false || width <= 0) {
      sweep.setValue(0);
      return;
    }

    sweep.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: platform !== "web",
          isInteraction: false,
        }),
        Animated.delay(1800),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      sweep.stopAnimation();
    };
  }, [active, platform, reduceMotion, sweep, width]);

  const travel = sweep.interpolate({ inputRange: [0, 1], outputRange: [-84, width + 84] });
  const softColor = mixColors(mutedForeground, foreground, dark ? 0.5 : 0.35);
  const coreColor = dark ? foreground : mixColors(mutedForeground, foreground, 0.58);
  const renderBand = (bandWidth: number, offset: number, opacity: number, color: string, glowRadius = 0) => (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: offset,
        width: bandWidth,
        opacity,
        overflow: "hidden",
        transform: [{ translateX: travel }],
      }}
    >
      <Animated.View
        style={{
          width,
          transform: [{ translateX: Animated.add(Animated.multiply(travel, -1), -offset) }],
        }}
      >
        <ToolSummaryText data={data} color={color} labelColor={color} glowRadius={glowRadius} />
      </Animated.View>
    </Animated.View>
  );

  return (
    <View
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{ flex: 1, minWidth: 0, height: 18, overflow: "hidden" }}
    >
      <ToolSummaryText data={data} color={mutedForeground} labelColor={foreground} />
      {active && reduceMotion === false && width > 0 && (
        <>
          {renderBand(84, 0, dark ? 0.12 : 0.08, softColor)}
          {renderBand(50, 17, dark ? 0.26 : 0.16, softColor)}
          {renderBand(18, 33, dark ? 0.55 : 0.32, coreColor, dark ? 2 : 0)}
        </>
      )}
    </View>
  );
}

export type ToolCardData = z.output<typeof toolCallSchema>;
type ToolCardTheme = PluginTimelineItemProps<ToolCardData>["theme"];
type ToolCardLayout = PluginTimelineItemProps<ToolCardData>["layout"];

function alpha(color: string, suffix: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${suffix}` : "transparent";
}

function DetailSearch({
  query,
  onChange,
  count,
  theme,
}: {
  query: string;
  onChange(value: string): void;
  count: number;
  theme: ToolCardTheme;
}) {
  return (
    <View
      style={{
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Icon name="Search" size={13} color={theme.colors.foregroundMuted} />
      <TextInput
        accessibilityLabel="Search details"
        value={query}
        onChangeText={onChange}
        placeholder="Find in details"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, minHeight: 34, padding: 0, color: theme.colors.foreground, fontSize: 12 }}
      />
      {query.length > 0 && <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{count}</Text>}
    </View>
  );
}

function CodeBlock({
  label,
  value,
  theme,
  layout,
  tail = false,
}: {
  label: string;
  value: string;
  theme: ToolCardTheme;
  layout: ToolCardLayout;
  tail?: boolean;
}) {
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const lines = useMemo(() => value.split("\n"), [value]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingLines = normalizedQuery
    ? lines.filter((line) => line.toLocaleLowerCase().includes(normalizedQuery))
    : lines;
  const hasMore = matchingLines.length > 18;
  const visible = showAll || !hasMore ? matchingLines : tail ? matchingLines.slice(-18) : matchingLines.slice(0, 18);
  const mono = layout.platform === "ios" ? "Menlo" : "monospace";

  async function copy() {
    try {
      await copyText(value);
      toast.show("Copied", { variant: "success" });
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ minHeight: 24, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
          {label.toUpperCase()}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label}`}
          onPress={copy}
          style={{ minWidth: 44, minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 }}
        >
          <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Copy</Text>
        </Pressable>
      </View>
      {lines.length > 8 && (
        <DetailSearch query={query} onChange={setQuery} count={matchingLines.length} theme={theme} />
      )}
      <View
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 8,
          paddingHorizontal: layout.compact ? 10 : 12,
          paddingVertical: 9,
          backgroundColor: theme.colors.surface1,
        }}
      >
        {normalizedQuery ? (
          visible.length > 0 ? (
            visible.map((line, index) => (
              <Text
                key={`${index}-${line.slice(0, 16)}`}
                selectable
                style={{ color: theme.colors.foreground, fontFamily: mono, fontSize: 12, lineHeight: 18, backgroundColor: theme.colors.surface2 }}
              >
                {line || " "}
              </Text>
            ))
          ) : (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>No matches</Text>
          )
        ) : (
          <Text selectable style={{ color: theme.colors.foreground, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
            {visible.join("\n") || "No output"}
          </Text>
        )}
        {hasMore && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showAll ? `Collapse ${label}` : `Show all ${label}`}
            onPress={() => setShowAll((value) => !value)}
            style={{ minHeight: 32, justifyContent: "flex-end", paddingTop: 8 }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
              {showAll ? "Show less" : `Show all · ${matchingLines.length} lines`}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DiffViewer({ data, theme, layout }: { data: ToolCardData; theme: ToolCardTheme; layout: ToolCardLayout }) {
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const lines = useMemo(() => data.secondary.split("\n"), [data.secondary]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingLines = normalizedQuery
    ? lines.filter((line) => line.toLocaleLowerCase().includes(normalizedQuery))
    : lines;
  const hasMore = matchingLines.length > 200;
  const visible = showAll || !hasMore ? matchingLines : matchingLines.slice(0, 200);
  const mono = layout.platform === "ios" ? "Menlo" : "monospace";

  async function copy() {
    try {
      await copyText(data.secondary);
      toast.show("Diff copied", { variant: "success" });
    } catch {
      toast.error("Could not copy diff");
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ minHeight: 24, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
          CHANGES
          <Text style={{ color: theme.colors.statusSuccess }}>{`  +${data.additions}`}</Text>
          <Text style={{ color: theme.colors.statusDanger }}>{`  −${data.deletions}`}</Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy diff"
          onPress={copy}
          style={{ minWidth: 44, minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 }}
        >
          <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Copy</Text>
        </Pressable>
      </View>
      {lines.length > 12 && (
        <DetailSearch query={query} onChange={setQuery} count={matchingLines.length} theme={theme} />
      )}
      <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, overflow: "hidden", backgroundColor: theme.colors.surface1 }}>
        <ScrollView horizontal contentContainerStyle={{ minWidth: "100%" }}>
          <View style={{ minWidth: "100%", paddingVertical: 6 }}>
            {visible.length === 0 && (
              <Text style={{ paddingHorizontal: 10, color: theme.colors.foregroundMuted, fontSize: 12 }}>
                No matches
              </Text>
            )}
            {visible.map((line, index) => {
              const addition = line.startsWith("+") && !line.startsWith("+++");
              const deletion = line.startsWith("-") && !line.startsWith("---");
              const hunk = line.startsWith("@@") || line.startsWith("+++") || line.startsWith("---");
              const color = addition
                ? theme.colors.statusSuccess
                : deletion
                  ? theme.colors.statusDanger
                  : hunk
                    ? theme.colors.accent
                    : theme.colors.foregroundMuted;
              const backgroundColor = addition
                ? alpha(theme.colors.statusSuccess, "12")
                : deletion
                  ? alpha(theme.colors.statusDanger, "12")
                  : hunk
                    ? theme.colors.surface2
                    : normalizedQuery
                      ? theme.colors.surface2
                      : "transparent";
              return (
                <View key={`${index}-${line.slice(0, 12)}`} style={{ minHeight: 18, paddingHorizontal: 10, backgroundColor }}>
                  <Text selectable style={{ color, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
                    {line || " "}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
        {hasMore && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showAll ? "Collapse diff" : "Show full diff"}
            onPress={() => setShowAll((value) => !value)}
            style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: theme.colors.border }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
              {showAll ? "Show less" : `Show all · ${matchingLines.length} lines`}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ToolDetails({
  data,
  theme,
  layout,
  standalone = false,
}: {
  data: ToolCardData;
  theme: ToolCardTheme;
  layout: ToolCardLayout;
  standalone?: boolean;
}) {
  const tailOutput = data.kind === "shell" || data.secondaryLabel === "Error";
  return (
    <View
      style={{
        borderTopWidth: standalone ? 0 : 1,
        borderTopColor: theme.colors.border,
        paddingHorizontal: standalone ? 0 : layout.compact ? 10 : 12,
        paddingVertical: standalone ? 0 : 10,
        gap: 12,
        backgroundColor: theme.colors.surface0,
      }}
    >
      {data.metadata.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {data.metadata.map((entry) => (
            <View
              key={entry.label}
              style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, minHeight: 25, borderRadius: 7, backgroundColor: theme.colors.surface2 }}
            >
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>{entry.label}</Text>
              <Text selectable style={{ color: theme.colors.foreground, fontSize: 10, fontWeight: "600" }}>{entry.value}</Text>
            </View>
          ))}
        </View>
      )}
      {data.primary && <CodeBlock label={data.primaryLabel || "Input"} value={data.primary} theme={theme} layout={layout} />}
      {data.secondary &&
        (data.isDiff ? (
          <DiffViewer data={data} theme={theme} layout={layout} />
        ) : (
          <CodeBlock label={data.secondaryLabel || "Result"} value={data.secondary} theme={theme} layout={layout} tail={tailOutput} />
        ))}
    </View>
  );
}

export function ReasoningCard({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<z.output<typeof reasoningSchema>>) {
  const { text, phase } = item.data;
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
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} reasoning`}
        onPress={() => setExpanded((value) => !value)}
        style={styles.header}
      >
        <Icon name="Brain" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.title}>Reasoning</Text>
        {phase === "streaming" && <Text style={styles.state}>Thinking…</Text>}
        <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
      {expanded && <Text selectable style={styles.body}>{revealedText || "Thinking…"}</Text>}
    </View>
  );
}

function useToolGrouping(agentId: string, callId: string, controllerId: string | undefined) {
  const settings = useSettings(refinedSettings);
  const controller = useMemo(() => getToolGroupingController(controllerId), [controllerId]);
  const enabled = settings.status === "ready" ? settings.values.groupConsecutiveTools : true;
  const threshold = settings.status === "ready" ? settings.values.toolGroupThreshold : 7;

  useEffect(() => {
    controller?.configure({ enabled, threshold });
  }, [controller, enabled, threshold]);

  useEffect(() => controller?.attach(agentId, callId), [agentId, callId, controller]);
  return controller;
}

function groupBreakdown(calls: readonly ToolCardData[]) {
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
  return [...counts.entries()]
    .map(([label, count]) => `${count} ${count === 1 ? label : plural.get(label) ?? label}`)
    .join(" · ");
}

function GroupToolList({
  calls,
  onSelect,
  visibleCount,
  onShowMore,
  theme,
  layout,
}: {
  calls: readonly ToolCardData[];
  onSelect(callId: string): void;
  visibleCount: number;
  onShowMore(): void;
  theme: ToolCardTheme;
  layout: ToolCardLayout;
}) {
  const visibleCalls = calls.slice(0, visibleCount);
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
              ? theme.colors.accent
              : call.status === "completed"
                ? theme.colors.statusSuccess
                : theme.colors.foregroundMuted;
        return (
          <Pressable
            key={call.callId}
            accessibilityRole={canExpand ? "button" : undefined}
            accessibilityLabel={canExpand ? `Open ${call.title} details` : call.title}
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
          accessibilityLabel={`Show ${remaining} more tool calls`}
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
            {`Show ${Math.min(12, remaining)} more`}
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
  const controller = useToolGrouping(agentId, anchorCallId, controllerId);
  const [, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);

  useEffect(() => {
    if (!controller) return;
    return controller.subscribe(agentId, () => setRevision((value) => value + 1));
  }, [agentId, controller]);

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
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Preparing tool group…</Text>
      </View>
    );
  }

  const calls = group.calls;
  const breakdown = groupBreakdown(calls);
  const failed = calls.filter((call) => call.status === "failed").length;
  const canceled = calls.filter((call) => call.status === "canceled").length;
  const showRunning = smoothedRunning && failed === 0;
  const statusColor = failed
    ? theme.colors.statusDanger
    : showRunning
      ? theme.colors.accent
      : canceled
        ? theme.colors.foregroundMuted
        : theme.colors.statusSuccess;
  const statusText = showRunning ? "Running" : failed ? `${failed} failed` : canceled ? `${canceled} canceled` : "Done";
  const dark = isDarkColor(theme.colors.surface0);
  const selectedCall = calls.find((call) => call.callId === selectedCallId) ?? null;
  const summaryData: ToolCardData = {
    ...calls[calls.length - 1]!,
    title: `${calls.length} tool calls`,
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
            ? alpha(theme.colors.accent, "38")
            : alpha(theme.colors.border, "B8"),
        backgroundColor: showRunning || failed ? theme.colors.surface1 : theme.colors.surface0,
        overflow: "hidden",
      }}
    >
      {(showRunning || failed) && (
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
            backgroundColor: failed ? theme.colors.statusDanger : theme.colors.accent,
            opacity: failed ? 0.55 : 0.35,
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${calls.length} grouped tool calls`}
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
              {failed} failed
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
          theme={theme}
          layout={layout}
        />
      )}
      {selectedCall && (
        <Modal
          title={`${selectedCall.title} details`}
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
          <ToolDetails data={selectedCall} theme={theme} layout={layout} standalone />
        </Modal.Content>
      </Modal>
      )}
    </View>
  );
}

export function ToolCallCard({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<z.output<typeof toolCallSchema>>) {
  const data = item.data;
  useToolGrouping(agentId, data.callId, data.controllerId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const canExpand = Boolean(data.primary || data.secondary || data.metadata.length > 0);
  const dark = isDarkColor(theme.colors.surface0);
  const lightweight = data.status === "completed" && ["read", "search", "fetch"].includes(data.kind);
  const statusColor =
    data.status === "failed"
      ? theme.colors.statusDanger
      : data.status === "running"
        ? theme.colors.accent
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
            ? alpha(theme.colors.accent, "38")
            : data.status === "failed"
              ? alpha(theme.colors.statusDanger, "48")
              : alpha(theme.colors.border, lightweight ? "78" : "B8"),
        backgroundColor: data.status === "completed" ? theme.colors.surface0 : theme.colors.surface1,
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
        backgroundColor: data.status === "completed" ? "transparent" : theme.colors.surface2,
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
            backgroundColor: data.status === "failed" ? theme.colors.statusDanger : theme.colors.accent,
            opacity: data.status === "failed" ? 0.55 : 0.35,
          }}
        />
      )}
      <Pressable
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityLabel={canExpand ? `Open ${data.title} details` : data.title}
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
          ) : (
            <View style={styles.dot} />
          )}
          {!layout.compact && <Text style={styles.statusText}>{statusLabel(data.status)}</Text>}
          {canExpand && (
            <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />
          )}
        </View>
      </Pressable>
      {canExpand && (
        <Modal
          title={`${data.title} details`}
          icon={<Icon name={data.icon} size={17} color={theme.colors.foreground} />}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        >
          <Modal.Content
            style={{ backgroundColor: theme.colors.surface0 }}
            contentContainerStyle={{ padding: layout.compact ? 12 : 16, gap: 0 }}
          >
            <ToolDetails data={data} theme={theme} layout={layout} standalone />
          </Modal.Content>
        </Modal>
      )}
    </View>
  );
}

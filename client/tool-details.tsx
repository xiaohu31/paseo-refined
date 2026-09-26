import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { tr, type UiLanguage } from "./i18n";
import type { ToolCardData } from "./tool-presentation";

type ToolCardTheme = PluginTimelineItemProps<ToolCardData>["theme"];
type ToolCardLayout = PluginTimelineItemProps<ToolCardData>["layout"];

export function alpha(color: string, suffix: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${suffix}` : "transparent";
}

function DetailSearch({
  query,
  onChange,
  count,
  language,
  theme,
}: {
  query: string;
  onChange(value: string): void;
  count: number;
  language: UiLanguage;
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
        accessibilityLabel={tr(language, "Search details")}
        value={query}
        onChangeText={onChange}
        placeholder={tr(language, "Find in details")}
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
  language,
  tail = false,
}: {
  label: string;
  value: string;
  theme: ToolCardTheme;
  layout: ToolCardLayout;
  language: UiLanguage;
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
      toast.show(tr(language, "Copied"), { variant: "success" });
    } catch {
      toast.error(tr(language, "Could not copy"));
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
          accessibilityLabel={language === "zh-CN" ? `复制${label}` : `Copy ${label}`}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          onPress={copy}
          style={{ minWidth: 44, minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 }}
        >
          <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{tr(language, "Copy")}</Text>
        </Pressable>
      </View>
      {lines.length > 8 && (
        <DetailSearch query={query} onChange={setQuery} count={matchingLines.length} language={language} theme={theme} />
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
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{tr(language, "No matches")}</Text>
          )
        ) : (
          <Text selectable style={{ color: theme.colors.foreground, fontFamily: mono, fontSize: 12, lineHeight: 18 }}>
            {visible.join("\n") || tr(language, "No output")}
          </Text>
        )}
        {hasMore && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              language === "zh-CN"
                ? `${showAll ? "收起" : "显示全部"}${label}`
                : showAll ? `Collapse ${label}` : `Show all ${label}`
            }
            onPress={() => setShowAll((value) => !value)}
            style={{ minHeight: 32, justifyContent: "flex-end", paddingTop: 8 }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
              {showAll
                ? tr(language, "Show less")
                : language === "zh-CN"
                  ? `显示全部 · ${matchingLines.length} 行`
                  : `Show all · ${matchingLines.length} lines`}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DiffViewer({
  data,
  theme,
  layout,
  language,
}: {
  data: ToolCardData;
  theme: ToolCardTheme;
  layout: ToolCardLayout;
  language: UiLanguage;
}) {
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
      toast.show(tr(language, "Diff copied"), { variant: "success" });
    } catch {
      toast.error(tr(language, "Could not copy diff"));
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ minHeight: 24, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
          {tr(language, "CHANGES")}
          <Text style={{ color: theme.colors.statusSuccess }}>{`  +${data.additions}`}</Text>
          <Text style={{ color: theme.colors.statusDanger }}>{`  −${data.deletions}`}</Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === "zh-CN" ? "复制差异" : "Copy diff"}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
          onPress={copy}
          style={{ minWidth: 44, minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 }}
        >
          <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{tr(language, "Copy")}</Text>
        </Pressable>
      </View>
      {lines.length > 12 && (
        <DetailSearch query={query} onChange={setQuery} count={matchingLines.length} language={language} theme={theme} />
      )}
      <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, overflow: "hidden", backgroundColor: theme.colors.surface1 }}>
        <ScrollView horizontal contentContainerStyle={{ minWidth: "100%" }}>
          <View style={{ minWidth: "100%", paddingVertical: 6 }}>
            {visible.length === 0 && (
              <Text style={{ paddingHorizontal: 10, color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {tr(language, "No matches")}
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
            accessibilityLabel={tr(language, showAll ? "Collapse diff" : "Show full diff")}
            onPress={() => setShowAll((value) => !value)}
            style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: theme.colors.border }}
          >
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
              {showAll
                ? tr(language, "Show less")
                : language === "zh-CN"
                  ? `显示全部 · ${matchingLines.length} 行`
                  : `Show all · ${matchingLines.length} lines`}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function ToolDetails({
  data,
  theme,
  layout,
  language,
  standalone = false,
}: {
  data: ToolCardData;
  theme: ToolCardTheme;
  layout: ToolCardLayout;
  language: UiLanguage;
  standalone?: boolean;
}) {
  const tailOutput = data.kind === "shell" || data.status === "failed";
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
      {(data.primaryTruncated || data.secondaryTruncated) && (
        <View
          style={{
            minHeight: 34,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingHorizontal: 10,
            borderRadius: 8,
            backgroundColor: theme.colors.surface2,
          }}
        >
          <Icon name="Info" size={13} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {tr(language, "Content truncated")}
          </Text>
        </View>
      )}
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
      {data.primary && <CodeBlock label={data.primaryLabel || tr(language, "Input")} value={data.primary} theme={theme} layout={layout} language={language} />}
      {data.secondary &&
        (data.isDiff ? (
          <DiffViewer data={data} theme={theme} layout={layout} language={language} />
        ) : (
          <CodeBlock label={data.secondaryLabel || tr(language, "Result")} value={data.secondary} theme={theme} layout={layout} language={language} tail={tailOutput} />
        ))}
    </View>
  );
}

import { z } from "zod";
import { tr, type UiLanguage } from "./i18n";

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
  primaryTruncated: z.boolean(),
  secondaryTruncated: z.boolean(),
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

export type ToolCardData = z.output<typeof toolCallSchema>;
export type ToolGroupData = z.output<typeof toolGroupSchema>;

type ToolCallItem = {
  callId: string;
  name: string;
  status: ToolCardData["status"];
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

function formatActions(value: unknown, language: UiLanguage) {
  if (!Array.isArray(value)) return compact(value);
  return value
    .map((action) => {
      if (!action || typeof action !== "object") return compact(action);
      const item = action as Record<string, unknown>;
      const tool = compact(item.toolName) || tr(language, "Action");
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

function clip(value: string) {
  return value.length <= MAX_DETAIL_LENGTH
    ? { value, truncated: false }
    : { value: `${value.slice(0, MAX_DETAIL_LENGTH)}\n…`, truncated: true };
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

function toolPresentation(detail: ToolCallItem["detail"], language: UiLanguage) {
  switch (detail.type) {
    case "shell":
      return {
        kind: "shell" as const,
        title: tr(language, "Command"),
        subtitle: first(summarizeCommand(detail.command), tr(language, "Shell command")),
        primaryLabel: tr(language, "Command"),
        primary: compact(detail.command),
        secondaryLabel: tr(language, "Output"),
        secondary: formatStructuredText(detail.output),
        metadata: metadata([tr(language, "Working directory"), detail.cwd], [tr(language, "Exit code"), detail.exitCode]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Terminal" as const,
      };
    case "read":
      return {
        kind: "read" as const,
        title: tr(language, "Read file"),
        subtitle: first(summarizePath(detail.filePath), tr(language, "File")),
        primaryLabel: tr(language, "File"),
        primary: compact(detail.filePath),
        secondaryLabel: tr(language, "Content"),
        secondary: formatStructuredText(detail.content),
        metadata: metadata([tr(language, "Offset"), detail.offset], [tr(language, "Limit"), detail.limit]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "FileText" as const,
      };
    case "edit":
    case "write": {
      const diff = compact(detail.unifiedDiff);
      const stats = diffStats(diff);
      const filePath = first(summarizePath(detail.filePath), tr(language, "File"));
      const suffix = diff ? ` · +${stats.additions} −${stats.deletions}` : "";
      return {
        kind: detail.type as "edit" | "write",
        title: tr(language, detail.type === "edit" ? "Edit file" : "Write file"),
        subtitle: `${filePath}${suffix}`,
        primaryLabel: tr(language, "File"),
        primary: compact(detail.filePath),
        secondaryLabel: tr(language, diff ? "Changes" : "Content"),
        secondary: first(diff, formatStructuredText(detail.content), formatStructuredText(detail.newString)),
        metadata: [],
        isDiff: Boolean(diff),
        ...stats,
        icon: "Pencil" as const,
      };
    }
    case "search": {
      const matches = compact(detail.numMatches);
      return {
        kind: "search" as const,
        title: tr(language, "Search"),
        subtitle: `${first(detail.query, tr(language, "Search workspace"))}${matches ? language === "zh-CN" ? ` · ${matches} 个匹配` : ` · ${matches} matches` : ""}`,
        primaryLabel: tr(language, "Query"),
        primary: compact(detail.query),
        secondaryLabel: tr(language, "Results"),
        secondary: formatSearchResults(detail),
        metadata: metadata([tr(language, "Matches"), detail.numMatches], [tr(language, "Files"), detail.numFiles], [tr(language, "Duration"), detail.durationMs]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Search" as const,
      };
    }
    case "fetch": {
      const status = compact(detail.code);
      return {
        kind: "fetch" as const,
        title: tr(language, "Fetch"),
        subtitle: `${first(detail.url, tr(language, "Remote resource"))}${status ? ` · ${status}` : ""}`,
        primaryLabel: tr(language, "URL"),
        primary: compact(detail.url),
        secondaryLabel: tr(language, "Response"),
        secondary: first(formatStructuredText(detail.result), detail.codeText),
        metadata: metadata([tr(language, "Status"), detail.code], [tr(language, "Bytes"), detail.bytes], [tr(language, "Duration"), detail.durationMs]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Globe" as const,
      };
    }
    case "worktree_setup":
      return {
        kind: "worktree_setup" as const,
        title: tr(language, "Prepare worktree"),
        subtitle: first(detail.branchName, detail.worktreePath),
        primaryLabel: tr(language, "Worktree"),
        primary: first(detail.worktreePath, detail.branchName),
        secondaryLabel: tr(language, "Setup log"),
        secondary: first(formatStructuredText(detail.log), formatStructuredText(detail.commands)),
        metadata: metadata([tr(language, "Branch"), detail.branchName]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "GitBranch" as const,
      };
    case "sub_agent":
      return {
        kind: "sub_agent" as const,
        title: tr(language, "Subagent"),
        subtitle: first(detail.description, detail.subAgentType, tr(language, "Delegated task")),
        primaryLabel: tr(language, "Task"),
        primary: first(detail.description, detail.subAgentType),
        secondaryLabel: tr(language, "Activity"),
        secondary: first(formatStructuredText(detail.log), formatActions(detail.actions, language)),
        metadata: metadata([tr(language, "Agent"), detail.subAgentType]),
        isDiff: false,
        additions: 0,
        deletions: 0,
        icon: "Bot" as const,
      };
    case "plan":
      return {
        kind: "plan" as const,
        title: tr(language, "Plan"),
        subtitle: first(detail.text, tr(language, "Implementation plan")),
        primaryLabel: tr(language, "Plan"),
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
        title: first(detail.label, tr(language, "Tool")),
        subtitle: first(detail.text, tr(language, "Tool activity")),
        primaryLabel: first(detail.label, tr(language, "Details")),
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
        title: tr(language, "Tool"),
        subtitle: detail.type || tr(language, "Tool activity"),
        primaryLabel: tr(language, "Raw details"),
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

export function toToolCardData(
  item: ToolCallItem,
  language: UiLanguage = "en",
  truncateDetails = true,
): ToolCardData {
  const presentation = toolPresentation(item.detail, language);
  const error = item.status === "failed" ? compact(item.error) : "";
  const primary = truncateDetails ? clip(presentation.primary) : { value: presentation.primary, truncated: false };
  const secondaryValue = error || presentation.secondary;
  const secondary = truncateDetails ? clip(secondaryValue) : { value: secondaryValue, truncated: false };
  return {
    ...presentation,
    callId: item.callId,
    title: presentation.title || item.name,
    primary: primary.value,
    primaryTruncated: primary.truncated,
    secondaryLabel: error ? tr(language, "Error") : presentation.secondaryLabel,
    secondary: secondary.value,
    secondaryTruncated: secondary.truncated,
    isDiff: error ? false : presentation.isDiff,
    status: item.status,
  };
}

export function statusLabel(status: ToolCardData["status"], language: UiLanguage): string {
  switch (status) {
    case "running":
      return tr(language, "Running");
    case "completed":
      return tr(language, "Done");
    case "failed":
      return tr(language, "Failed");
    case "canceled":
      return tr(language, "Canceled");
  }
}

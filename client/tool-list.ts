export function visibleToolCalls<T>(calls: readonly T[], visibleCount: number): readonly T[] {
  if (calls.length <= visibleCount) return calls;
  const leadingCount = Math.max(1, visibleCount - 1);
  return [...calls.slice(0, leadingCount), calls[calls.length - 1]!];
}

export function aggregateToolStatuses(
  calls: readonly { status: "running" | "completed" | "failed" | "canceled" }[],
) {
  const failed = calls.filter((call) => call.status === "failed").length;
  const canceled = calls.filter((call) => call.status === "canceled").length;
  const running = calls.filter((call) => call.status === "running").length;
  return {
    failed,
    canceled,
    running,
    allFailed: calls.length > 0 && failed === calls.length,
  };
}

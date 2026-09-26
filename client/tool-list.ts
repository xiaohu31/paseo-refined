export function visibleToolCalls<T>(calls: readonly T[], visibleCount: number): readonly T[] {
  if (calls.length <= visibleCount) return calls;
  const leadingCount = Math.max(1, visibleCount - 1);
  return [...calls.slice(0, leadingCount), calls[calls.length - 1]!];
}

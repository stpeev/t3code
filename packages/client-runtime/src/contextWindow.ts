export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 999_500) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function formatContextWindowPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

/** Answered by the client from the latest snapshot; the provider never sees it. */
export const CONTEXT_USAGE_COMMAND = {
  name: "context-usage",
  description: "Show how full this thread's context window is",
} as const;

/** Only the bare command counts; anything with arguments stays an ordinary prompt. */
export function isContextUsageCommand(prompt: string): boolean {
  return prompt.trim().toLowerCase() === `/${CONTEXT_USAGE_COMMAND.name}`;
}

export interface ContextUsageRow {
  readonly label: string;
  readonly value: string;
}

export interface ContextUsageSummary {
  /** "34% · 68k/200k", or just the used tokens when the window size is unknown. */
  readonly headline: string;
  /** 0–100 for the bar, or null when the window size is unknown. */
  readonly usedPercentage: number | null;
  readonly rows: ReadonlyArray<ContextUsageRow>;
  /** The token split of the most recent model request. */
  readonly lastRequestRows: ReadonlyArray<ContextUsageRow>;
}

function tokenRows(
  entries: ReadonlyArray<readonly [label: string, value: number | null | undefined]>,
): ContextUsageRow[] {
  return entries.flatMap(([label, value]) =>
    value == null ? [] : [{ label, value: formatContextWindowTokens(value) }],
  );
}

export function summarizeContextUsage(snapshot: ContextWindowSnapshot): ContextUsageSummary {
  const { autoCompactThreshold, maxTokens, toolUses, totalProcessedTokens } = snapshot;
  const percentage = formatContextWindowPercentage(snapshot.usedPercentage);
  const used = formatContextWindowTokens(snapshot.usedTokens);
  const rows = tokenRows([
    ["Remaining", snapshot.remainingTokens],
    [
      "Until auto-compact",
      autoCompactThreshold == null ? null : Math.max(0, autoCompactThreshold - snapshot.usedTokens),
    ],
    ["Total processed", totalProcessedTokens ? totalProcessedTokens : null],
  ]);
  if (toolUses) {
    rows.push({ label: "Tool uses", value: toolUses.toLocaleString("en-US") });
  }

  return {
    headline:
      maxTokens != null && percentage !== null
        ? `${percentage} · ${used}/${formatContextWindowTokens(maxTokens)}`
        : `${used} tokens`,
    usedPercentage: maxTokens != null ? snapshot.usedPercentage : null,
    rows,
    // Adapters disagree on whether the unprefixed split is cumulative, so it only backs up `last*`.
    lastRequestRows: tokenRows([
      ["Input", snapshot.lastInputTokens ?? snapshot.inputTokens],
      ["Cached input", snapshot.lastCachedInputTokens ?? snapshot.cachedInputTokens],
      ["Output", snapshot.lastOutputTokens ?? snapshot.outputTokens],
      ["Reasoning", snapshot.lastReasoningOutputTokens ?? snapshot.reasoningOutputTokens],
    ]),
  };
}

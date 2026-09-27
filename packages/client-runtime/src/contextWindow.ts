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

export interface ContextUsageSummary {
  /** "68k of 200k", or "68k tokens" when the window size is unknown. */
  readonly tokens: string;
  /** The bar's figures; all null when the window size is unknown. */
  readonly usedPercentage: number | null;
  readonly percentage: string | null;
  readonly remaining: string | null;
  /** The most recent model request, such as "68k in · 40k cached · 500 out". */
  readonly lastRequest: string | null;
  readonly totalProcessed: string | null;
  /** Occasional facts that ride along with `tokens`, such as "compacts in 99k". */
  readonly notes: ReadonlyArray<string>;
}

function joinTokenParts(
  parts: ReadonlyArray<readonly [value: number | null | undefined, suffix: string]>,
): string | null {
  const present = parts.flatMap(([value, suffix]) =>
    value == null ? [] : [`${formatContextWindowTokens(value)} ${suffix}`],
  );
  return present.length > 0 ? present.join(" · ") : null;
}

export function summarizeContextUsage(snapshot: ContextWindowSnapshot): ContextUsageSummary {
  const { autoCompactThreshold, maxTokens, toolUses, totalProcessedTokens } = snapshot;
  const percentage =
    maxTokens == null ? null : formatContextWindowPercentage(snapshot.usedPercentage);
  const used = formatContextWindowTokens(snapshot.usedTokens);
  const notes: string[] = [];
  if (autoCompactThreshold != null) {
    const untilCompact = Math.max(0, autoCompactThreshold - snapshot.usedTokens);
    notes.push(`compacts in ${formatContextWindowTokens(untilCompact)}`);
  }
  if (toolUses) {
    notes.push(`${toolUses.toLocaleString("en-US")} tool ${toolUses === 1 ? "use" : "uses"}`);
  }

  return {
    tokens:
      maxTokens == null ? `${used} tokens` : `${used} of ${formatContextWindowTokens(maxTokens)}`,
    usedPercentage: percentage === null ? null : snapshot.usedPercentage,
    percentage,
    remaining:
      percentage === null || snapshot.remainingTokens == null
        ? null
        : formatContextWindowTokens(snapshot.remainingTokens),
    // Adapters disagree on whether the unprefixed split is cumulative, so it only backs up `last*`.
    lastRequest: joinTokenParts([
      [snapshot.lastInputTokens ?? snapshot.inputTokens, "in"],
      [snapshot.lastCachedInputTokens ?? snapshot.cachedInputTokens, "cached"],
      [snapshot.lastOutputTokens ?? snapshot.outputTokens, "out"],
      [snapshot.lastReasoningOutputTokens ?? snapshot.reasoningOutputTokens, "reasoning"],
    ]),
    totalProcessed: totalProcessedTokens ? formatContextWindowTokens(totalProcessedTokens) : null,
    notes,
  };
}

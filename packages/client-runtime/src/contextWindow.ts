import type {
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
  ThreadTokenUsageSnapshot,
  TurnId,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly turnId: TurnId | null;
  readonly updatedAt: string;
};

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    const maxTokens = asFiniteNumber(payload?.maxTokens);
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: asFiniteNumber(payload?.inputTokens),
      cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
      outputTokens: asFiniteNumber(payload?.outputTokens),
      reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
      lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
      turnOutputTokens: asFiniteNumber(payload?.turnOutputTokens),
      toolUses: asFiniteNumber(payload?.toolUses),
      durationMs: asFiniteNumber(payload?.durationMs),
      compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
      autoCompactThreshold: asFiniteNumber(payload?.autoCompactThreshold),
      turnId: activity.turnId,
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

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
  if (value < 1_000_000) {
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
  /** "Last turn (#384)" with the turn's whole output; snapshots without it only know the last request. */
  readonly recent: {
    readonly label: string;
    /** Such as "68k in · 40k cached · 500 out". */
    readonly tokens: string;
  } | null;
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

/** The turn number rewind and the diff panel use; an uncheckpointed latest turn is one past the last. */
export function contextWindowTurnNumber(
  snapshot: ContextWindowSnapshot,
  thread: {
    readonly checkpoints: ReadonlyArray<
      Pick<OrchestrationCheckpointSummary, "turnId" | "checkpointTurnCount">
    >;
    readonly latestTurn: Pick<OrchestrationLatestTurn, "turnId"> | null;
  },
): number | null {
  const { turnId } = snapshot;
  if (turnId === null) return null;
  const checkpoint = thread.checkpoints.find((candidate) => candidate.turnId === turnId);
  if (checkpoint) return checkpoint.checkpointTurnCount;
  if (thread.latestTurn?.turnId !== turnId || thread.checkpoints.length === 0) return null;
  return (
    thread.checkpoints.reduce((max, candidate) => Math.max(max, candidate.checkpointTurnCount), 0) +
    1
  );
}

export function summarizeContextUsage(
  snapshot: ContextWindowSnapshot,
  turnNumber: number | null = null,
): ContextUsageSummary {
  const { autoCompactThreshold, maxTokens, toolUses, turnOutputTokens } = snapshot;
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
  // Adapters disagree on whether the unprefixed split is cumulative, so it only backs up `last*`.
  // Input stays the last request's either way, since that is what fills the window.
  const input = [
    [snapshot.lastInputTokens ?? snapshot.inputTokens, "in"],
    [snapshot.lastCachedInputTokens ?? snapshot.cachedInputTokens, "cached"],
  ] as const;
  const recentTokens =
    turnOutputTokens == null
      ? joinTokenParts([
          ...input,
          [snapshot.lastOutputTokens ?? snapshot.outputTokens, "out"],
          [snapshot.lastReasoningOutputTokens ?? snapshot.reasoningOutputTokens, "reasoning"],
        ])
      : joinTokenParts([...input, [turnOutputTokens, "out"]]);

  return {
    tokens:
      maxTokens == null ? `${used} tokens` : `${used} of ${formatContextWindowTokens(maxTokens)}`,
    usedPercentage: percentage === null ? null : snapshot.usedPercentage,
    percentage,
    remaining:
      percentage === null || snapshot.remainingTokens == null
        ? null
        : formatContextWindowTokens(snapshot.remainingTokens),
    recent:
      recentTokens === null
        ? null
        : {
            label:
              turnOutputTokens == null
                ? "Last request"
                : turnNumber === null
                  ? "Last turn"
                  : `Last turn (#${turnNumber})`,
            tokens: recentTokens,
          },
    notes,
  };
}

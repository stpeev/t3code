import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2ProviderThread,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  readonly updatedAt: string;
};

/** Prefers the provider's live usage report (#8144); falls back to the last compaction item. */
export function deriveLatestContextWindowSnapshot(
  entries: ReadonlyArray<{
    readonly item: OrchestrationV2TurnItem;
  }>,
  liveUsage?: OrchestrationV2ProviderTurnTokenUsage | null,
  providerThread?: Pick<OrchestrationV2ProviderThread, "contextUsage" | "updatedAt"> | null,
): ContextWindowSnapshot | null {
  if (liveUsage != null) {
    const usedTokens = Math.max(0, liveUsage.usedTokens);
    const maxTokens = liveUsage.maxTokens ?? null;
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;
    return {
      usedTokens,
      totalProcessedTokens: null,
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: liveUsage.inputTokens ?? null,
      cachedInputTokens: liveUsage.cachedInputTokens ?? null,
      outputTokens: liveUsage.outputTokens ?? null,
      reasoningOutputTokens: liveUsage.reasoningOutputTokens ?? null,
      lastUsedTokens: null,
      lastInputTokens: null,
      lastCachedInputTokens: null,
      lastOutputTokens: null,
      lastReasoningOutputTokens: null,
      toolUses: null,
      durationMs: null,
      compactsAutomatically: true,
      autoCompactThreshold: null,
      cost: null,
      updatedAt: liveUsage.updatedAt,
    };
  }
  const providerUsage = providerThread?.contextUsage;
  const providerUsageUpdatedAt = providerThread?.updatedAt;
  if (
    providerUsage !== null &&
    providerUsage !== undefined &&
    providerUsageUpdatedAt !== undefined
  ) {
    const maxTokens = asFiniteNumber(providerUsage.maxTokens);
    const usedTokens = providerUsage.usedTokens;
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(providerUsage.totalProcessedTokens),
      maxTokens,
      remainingTokens: maxTokens === null ? null : Math.max(0, Math.round(maxTokens - usedTokens)),
      usedPercentage,
      remainingPercentage: usedPercentage === null ? null : Math.max(0, 100 - usedPercentage),
      inputTokens: asFiniteNumber(providerUsage.inputTokens),
      cachedInputTokens: asFiniteNumber(providerUsage.cachedInputTokens),
      outputTokens: asFiniteNumber(providerUsage.outputTokens),
      reasoningOutputTokens: asFiniteNumber(providerUsage.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(providerUsage.lastUsedTokens),
      lastInputTokens: asFiniteNumber(providerUsage.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(providerUsage.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(providerUsage.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(providerUsage.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(providerUsage.toolUses),
      durationMs: asFiniteNumber(providerUsage.durationMs),
      compactsAutomatically: providerUsage.compactsAutomatically ?? null,
      cost: providerUsage.cost ?? null,
      autoCompactThreshold: providerUsage.autoCompactThreshold ?? null,
      updatedAt: DateTime.formatIso(providerUsageUpdatedAt),
    };
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.item.type !== "compaction") {
      continue;
    }
    const payload = entry.item;
    const usedTokens = asFiniteNumber(payload.afterTokenCount);
    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    const maxTokens = null;
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload.beforeTokenCount),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      lastUsedTokens: null,
      lastInputTokens: null,
      lastCachedInputTokens: null,
      lastOutputTokens: null,
      lastReasoningOutputTokens: null,
      toolUses: null,
      durationMs: null,
      compactsAutomatically: true,
      autoCompactThreshold: null,
      cost: null,
      updatedAt: DateTime.formatIso(payload.startedAt ?? payload.updatedAt),
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
  /** "Last turn (#12)" once the turn settles with its whole output; until then the last request. */
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

export interface LastTurnUsage {
  /** The run's ordinal, which the diff panel shows as "Turn N". */
  readonly turnNumber: number | null;
  /** Main-agent output across every request of the turn, reasoning included. */
  readonly outputTokens: number;
}

/** The latest main-agent turn's whole output, or null while that turn has not settled. */
export function deriveLastTurnUsage(
  projection: Pick<OrchestrationV2ThreadProjection, "thread" | "providerTurns" | "nodes" | "runs">,
): LastTurnUsage | null {
  const providerThreadId = projection.thread.activeProviderThreadId;
  if (providerThreadId === null) return null;
  let latest: OrchestrationV2ProviderTurn | undefined;
  for (const turn of projection.providerTurns) {
    if (turn.providerThreadId !== providerThreadId) continue;
    if (latest === undefined || turn.ordinal > latest.ordinal) latest = turn;
  }
  const outputTokens = latest?.turnTokenUsage?.outputTokens;
  if (latest === undefined || outputTokens === undefined) return null;
  const runId = projection.nodes.find((node) => node.id === latest.nodeId)?.runId;
  const turnNumber = projection.runs.find((run) => run.id === runId)?.ordinal ?? null;
  return { turnNumber, outputTokens };
}

export function summarizeContextUsage(
  snapshot: ContextWindowSnapshot,
  lastTurn: LastTurnUsage | null = null,
): ContextUsageSummary {
  const { autoCompactThreshold, maxTokens, toolUses } = snapshot;
  const turnOutputTokens = lastTurn?.outputTokens;
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
              lastTurn === null
                ? "Last request"
                : lastTurn.turnNumber === null
                  ? "Last turn"
                  : `Last turn (#${lastTurn.turnNumber})`,
            tokens: recentTokens,
          },
    notes,
  };
}

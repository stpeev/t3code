import { describe, expect, it } from "vite-plus/test";
import type { ThreadTokenUsageSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  deriveLatestContextWindowSnapshot,
  isContextUsageCommand,
  summarizeContextUsage,
} from "./contextWindow.ts";

function summarize(contextUsage: ThreadTokenUsageSnapshot) {
  const snapshot = deriveLatestContextWindowSnapshot([], undefined, {
    contextUsage,
    updatedAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
  });
  if (!snapshot) throw new Error("expected a snapshot");
  return summarizeContextUsage(snapshot);
}

describe("summarizeContextUsage", () => {
  it("summarizes a Claude snapshot against its auto-compact threshold", () => {
    const summary = summarize({
      usedTokens: 68_000,
      maxTokens: 200_000,
      totalProcessedTokens: 420_000,
      inputTokens: 67_500,
      outputTokens: 500,
      compactsAutomatically: true,
      autoCompactThreshold: 167_000,
      toolUses: 12,
    });

    expect(summary).toEqual({
      tokens: "68k of 200k",
      usedPercentage: 34,
      percentage: "34%",
      remaining: "132k",
      lastRequest: "68k in · 500 out",
      totalProcessed: "420k",
      notes: ["compacts in 99k", "12 tool uses"],
    });
  });

  it("prefers the last-request split over the unprefixed one", () => {
    const summary = summarize({
      usedTokens: 30_000,
      maxTokens: 258_000,
      inputTokens: 900_000,
      cachedInputTokens: 800_000,
      lastInputTokens: 29_000,
      lastCachedInputTokens: 20_000,
      lastOutputTokens: 1_000,
      lastReasoningOutputTokens: 0,
    });

    expect(summary.lastRequest).toBe("29k in · 20k cached · 1k out · 0 reasoning");
  });

  it("falls back to used tokens when the window size is unknown", () => {
    const summary = summarize({ usedTokens: 4_200, totalProcessedTokens: 0 });

    expect(summary).toEqual({
      tokens: "4.2k tokens",
      usedPercentage: null,
      percentage: null,
      remaining: null,
      lastRequest: null,
      totalProcessed: null,
      notes: [],
    });
  });
});

describe("isContextUsageCommand", () => {
  it("matches only the bare command", () => {
    expect(isContextUsageCommand(" /Context-Usage ")).toBe(true);
    expect(isContextUsageCommand("/context-usage why so full?")).toBe(false);
    expect(isContextUsageCommand("explain /context-usage")).toBe(false);
    expect(isContextUsageCommand("/context")).toBe(false);
  });
});

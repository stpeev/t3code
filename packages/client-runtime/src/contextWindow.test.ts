import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  isContextUsageCommand,
  summarizeContextUsage,
} from "./contextWindow.ts";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
        autoCompactThreshold: 200_000,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
    expect(snapshot?.autoCompactThreshold).toBe(200_000);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("keeps valid zero-usage snapshots", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 0,
        maxTokens: 100_000,
      }),
    ]);

    expect(snapshot).toMatchObject({
      usedTokens: 0,
      maxTokens: 100_000,
      remainingTokens: 100_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });
});

function summarize(payload: Record<string, unknown>) {
  const snapshot = deriveLatestContextWindowSnapshot([
    makeActivity("activity-1", "context-window.updated", payload),
  ]);
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

    expect(summary.headline).toBe("34% · 68k/200k");
    expect(summary.usedPercentage).toBe(34);
    expect(summary.rows).toEqual([
      { label: "Remaining", value: "132k" },
      { label: "Until auto-compact", value: "99k" },
      { label: "Total processed", value: "420k" },
      { label: "Tool uses", value: "12" },
    ]);
    expect(summary.lastRequestRows).toEqual([
      { label: "Input", value: "68k" },
      { label: "Output", value: "500" },
    ]);
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

    expect(summary.lastRequestRows).toEqual([
      { label: "Input", value: "29k" },
      { label: "Cached input", value: "20k" },
      { label: "Output", value: "1k" },
      { label: "Reasoning", value: "0" },
    ]);
  });

  it("falls back to used tokens when the window size is unknown", () => {
    const summary = summarize({ usedTokens: 4_200, totalProcessedTokens: 0 });

    expect(summary.headline).toBe("4.2k tokens");
    expect(summary.usedPercentage).toBeNull();
    expect(summary.rows).toEqual([]);
    expect(summary.lastRequestRows).toEqual([]);
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

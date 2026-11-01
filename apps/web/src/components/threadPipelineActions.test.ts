import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

// Pipeline menu cases, kept out of threadActionMenu.logic.test.ts so that
// upstream test file stays untouched by the fork.

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
  moveTargets: [],
};

describe("buildThreadActionMenuItems pipeline entries", () => {
  it("offers the next stage, any stage, a pipeline to start and leaving, as allowed", () => {
    const stages = [
      { id: "plan", name: "Plan" },
      { id: "develop", name: "Develop" },
    ];
    const pipelines = [
      { id: "ticket", name: "Ticket" },
      { id: "bugfix", name: "Bugfix" },
    ];
    const menu = (
      pipeline: ThreadActionMenuState["pipeline"],
      overrides: Partial<ThreadActionMenuState> = {},
    ) =>
      buildThreadActionMenuItems({ ...baseState, ...overrides, pipeline }).filter((item) =>
        item.id.startsWith("pipeline-"),
      );
    const summary = (items: ReturnType<typeof menu>) =>
      items.map((item) => ({
        label: item.label,
        disabled: item.disabled ?? false,
        children: item.children?.map((child) => child.id),
      }));

    expect(menu(undefined)).toEqual([]);
    expect(summary(menu({ pipelines, current: null, busy: false }))).toEqual([
      {
        label: "Start pipeline",
        disabled: false,
        children: ["pipeline-start:ticket", "pipeline-start:bugfix"],
      },
    ]);
    expect(
      summary(menu({ pipelines, current: { stages, next: stages[1] ?? null }, busy: false })),
    ).toEqual([
      { label: "Start Develop", disabled: false, children: undefined },
      {
        label: "Run stage",
        disabled: false,
        children: ["pipeline-stage:plan", "pipeline-stage:develop"],
      },
      {
        label: "Start pipeline",
        disabled: false,
        children: ["pipeline-start:ticket", "pipeline-start:bugfix"],
      },
      { label: "Leave pipeline", disabled: false, children: undefined },
    ]);
    expect(
      summary(menu({ pipelines, current: { stages, next: null }, busy: true })).map(
        ({ label, disabled }) => [label, disabled],
      ),
    ).toEqual([
      ["Run stage", true],
      ["Start pipeline", true],
      ["Leave pipeline", false],
    ]);
    expect(
      menu(
        { pipelines, current: { stages, next: null }, busy: false },
        { canOperate: false },
      ).every((item) => item.disabled && (item.children ?? []).every((child) => child.disabled)),
    ).toBe(true);
  });
});

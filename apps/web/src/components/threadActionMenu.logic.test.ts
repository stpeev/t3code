import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadActionMenuItems,
  moveTargetProjectId,
  threadMoveTargets,
  type ThreadActionMenuState,
} from "./threadActionMenu.logic";

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

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });

  it("offers other projects as move targets, disabled while the thread is running", () => {
    const targets = threadMoveTargets(
      [
        { id: "p-current", environmentId: "env", title: "Current" },
        { id: "p-zeta", environmentId: "env", title: "Zeta" },
        { id: "p-alpha", environmentId: "env", title: "Alpha" },
        { id: "p-remote", environmentId: "other-env", title: "Remote" },
      ],
      { environmentId: "env", projectId: "p-current" },
    );
    const move = (isRunning: boolean) =>
      buildThreadActionMenuItems({ ...baseState, moveTargets: targets, isRunning }).find(
        (item) => item.id === "move-to-project",
      );
    expect(move(false)?.children?.map((child) => child.label)).toEqual(["Alpha", "Zeta"]);
    expect(move(false)?.disabled).toBe(false);
    expect(move(true)?.disabled).toBe(true);
    expect(moveTargetProjectId("move-to-project:p-alpha")).toBe("p-alpha");
    expect(
      buildThreadActionMenuItems(baseState).some((item) => item.id === "move-to-project"),
    ).toBe(false);
  });
});

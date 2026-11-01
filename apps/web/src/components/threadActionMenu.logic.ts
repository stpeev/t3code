import type { ContextMenuItem } from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";

import { pipelineMenuItems, type ThreadPipelineMenuState } from "./threadPipelineActions";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";

export type ThreadActionMenuId =
  | "find"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "share-guest"
  | "move-to-project"
  | `move-to-project:${string}`
  | "pipeline-next"
  | "pipeline-stage"
  | `pipeline-stage:${string}`
  | "pipeline-start"
  | `pipeline-start:${string}`
  | "pipeline-leave"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(options: {
  readonly hasPath: boolean;
  readonly hasBranch: boolean;
  readonly hasProject: boolean;
}): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: m(msg("Copy")),
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath
          ? [{ id: "copy-path" as const, label: m(msg("Path")), icon: "folder" }]
          : []),
        ...(options.hasBranch
          ? [{ id: "copy-branch" as const, label: m(msg("Branch")), icon: "git-branch" }]
          : []),
      ],
    },
    ...(options.hasProject
      ? [{ id: "project-settings" as const, label: m(msg("Project settings")), icon: "settings" }]
      : []),
    {
      id: "discard",
      label: m(msg("Discard draft")),
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  /** Settle, snooze and their undo stay available until the host denies the operate scope. */
  readonly canTriage?: boolean;
  readonly canFind?: boolean;
  readonly canRename?: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  /** The server marks unread against the latest run's completion, so in-flight runs cannot be. */
  readonly hasCompletedRun: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Other projects in the thread's environment. */
  readonly moveTargets: ReadonlyArray<{ readonly projectId: string; readonly label: string }>;
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
  /** Absent until the thread's server reports its pipelines. */
  readonly pipeline?: ThreadPipelineMenuState | undefined;
}

export function threadMoveTargets(
  projects: ReadonlyArray<{
    readonly id: string;
    readonly environmentId: string;
    readonly title: string;
  }>,
  thread: { readonly environmentId: string; readonly projectId: string },
): ThreadActionMenuState["moveTargets"] {
  return projects
    .filter(
      (project) =>
        project.environmentId === thread.environmentId && project.id !== thread.projectId,
    )
    .map((project) => ({ projectId: project.id, label: project.title }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

export function moveTargetProjectId(action: ThreadActionMenuId): string | null {
  return action.startsWith("move-to-project:") ? action.slice("move-to-project:".length) : null;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "share-guest",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
  ].includes(action);
}

export function isThreadTriageAction(action: string): boolean {
  return (
    action === "settle" ||
    action === "unsettle" ||
    action === "snooze" ||
    action === "unsnooze" ||
    action.startsWith("snooze:")
  );
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [{ id: "find" as const, label: m(msg("Find in thread")), icon: "text-search" }]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: m(msg("New thread on {arg0}", { arg0: state.branch })),
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: m(msg("Unpin thread")), icon: "pin-off" }
            : { id: "pin" as const, label: m(msg("Pin thread")), icon: "pin" },
        ]
      : []),
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? { id: "unsettle" as const, label: m(msg("Un-settle thread")), icon: "circle-check" }
            : { id: "settle" as const, label: m(msg("Settle thread")), icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: m(msg("Wake thread")), icon: "clock" }
            : {
                id: "snooze" as const,
                label: m(msg("Snooze")),
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: preset.label,
                    detail: preset.whenLabel,
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: m(msg("Custom…")),
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    ...pipelineMenuItems(state.pipeline),
    {
      id: "rename",
      label: m(msg("Rename thread")),
      icon: "pencil",
      separatorBefore: true,
      disabled: state.canRename === false,
    },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle ? m(msg("Regenerating…")) : m(msg("Regenerate title")),
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    ...(state.hasCompletedRun && !state.isRunning
      ? [{ id: "mark-unread" as const, label: m(msg("Mark unread")), icon: "mail-open" }]
      : []),
    ...(state.canShareWithGuest
      ? [{ id: "share-guest" as const, label: m(msg("Share with guest")), icon: "user-plus" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? m(msg("Show all projects"))
              : m(msg("Filter by {arg0}", { arg0: state.projectFilter.label })),
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: m(msg("Turn into project")),
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: m(msg("Auto-settle behavior")),
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: m(msg("Follow settings")),
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: m(msg("Never")),
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    ...(state.moveTargets.length > 0
      ? [
          {
            id: "move-to-project" as const,
            label: m(msg("Move to project")),
            icon: "folder",
            disabled: state.isRunning,
            children: state.moveTargets.map((target) => ({
              id: `move-to-project:${target.projectId}` as const,
              label: target.label,
            })),
          },
        ]
      : []),
    {
      id: "copy",
      label: m(msg("Copy")),
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: m(msg("Path")), icon: "folder" },
        ...(state.branch
          ? [{ id: "copy-branch" as const, label: m(msg("Branch")), icon: "git-branch" }]
          : []),
        { id: "copy-thread", label: m(msg("Thread")), icon: "message-square" },
        { id: "copy-thread-id", label: m(msg("Thread ID")), icon: "hash" },
      ],
    },
    { id: "project-settings", label: m(msg("Project settings")), icon: "settings" },
    {
      id: "archive",
      label: m(msg("Archive thread")),
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id) &&
        !(state.canTriage === true && isThreadTriageAction(item.id))
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}

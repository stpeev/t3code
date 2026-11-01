import {
  resolveThreadPipelineProgress,
  type ThreadPipelineProgress,
} from "@t3tools/client-runtime/pipelines";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type ContextMenuItem,
  type EnvironmentId,
  type PipelineDefinition,
  type PipelineId,
  type PipelinesSnapshot,
  type PipelineStage,
  renderPipelineStagePrompt,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { useComposerDraftStore } from "../composerDraftStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import type { ThreadActionMenuId } from "./threadActionMenu.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

export interface PipelineMenuEntry {
  readonly id: string;
  readonly name: string;
}

export interface ThreadPipelineMenuState {
  readonly pipelines: ReadonlyArray<PipelineMenuEntry>;
  /** Null while the thread is in no pipeline; no stages once pipelines.json drops its pipeline. */
  readonly current: {
    readonly stages: ReadonlyArray<PipelineMenuEntry>;
    readonly next: PipelineMenuEntry | null;
  } | null;
  /** A turn runs or a request waits, so the server would refuse a stage. */
  readonly busy: boolean;
}

// Lives here, not in threadActionMenu.logic.ts, so the upstream file only calls it.
export function pipelineMenuItems(
  pipeline: ThreadPipelineMenuState | undefined,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  if (pipeline === undefined) return [];
  const { current, busy } = pipeline;
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(current?.next
      ? [
          {
            id: "pipeline-next" as const,
            label: `Start ${current.next.name}`,
            icon: "workflow",
            disabled: busy,
          },
        ]
      : []),
    ...(current && current.stages.length > 0
      ? [
          {
            id: "pipeline-stage" as const,
            label: "Run stage",
            icon: "workflow",
            disabled: busy,
            children: current.stages.map((stage, index) => ({
              id: `pipeline-stage:${stage.id}` as const,
              label: `${index + 1}. ${stage.name}`,
            })),
          },
        ]
      : []),
    ...(pipeline.pipelines.length > 0
      ? [
          {
            id: "pipeline-start" as const,
            label: "Start pipeline",
            icon: "workflow",
            disabled: busy,
            children: pipeline.pipelines.map((entry) => ({
              id: `pipeline-start:${entry.id}` as const,
              label: entry.name,
            })),
          },
        ]
      : []),
    ...(current
      ? [{ id: "pipeline-leave" as const, label: "Leave pipeline", icon: "workflow" }]
      : []),
  ];
  return items.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item));
}

type PipelineThread = Pick<EnvironmentThreadShell, "environmentId" | "id" | "source" | "title">;

/** The server refuses a stage on these same two fields. */
export function isThreadPipelineBusy(thread: Pick<EnvironmentThreadShell, "source">): boolean {
  return thread.source.activeRunId !== null || thread.source.pendingRuntimeRequest !== null;
}

/** Reads the subscription that the sidebar row or composer banner keeps open. */
function readPipelinesSnapshot(environmentId: EnvironmentId): PipelinesSnapshot | null {
  return AsyncResult.getOrElse(
    appAtomRegistry.get(serverEnvironment.pipelinesLive({ environmentId, input: {} })),
    () => null,
  );
}

export function readThreadPipelineMenuState(
  thread: PipelineThread,
): ThreadPipelineMenuState | undefined {
  const snapshot = readPipelinesSnapshot(thread.environmentId);
  if (snapshot === null) return undefined;
  const progress = resolveThreadPipelineProgress(snapshot, thread.id);
  return {
    pipelines: snapshot.pipelines,
    current: progress && { stages: progress.pipeline?.stages ?? [], next: progress.next },
    busy: isThreadPipelineBusy(thread),
  };
}

/** Toasts a failure; true when the request succeeded. */
async function reportFailure(
  title: string,
  request: Promise<AtomCommandResult<unknown, unknown>>,
): Promise<boolean> {
  const result = await request;
  if (result._tag === "Success") return true;
  if (isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
  return false;
}

/** Saves the stage a new thread's first message already started. */
export function recordThreadPipelineStage(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
  pipelineId: PipelineId,
  stage: PipelineStage,
  input: string,
): Promise<boolean> {
  return reportFailure(
    `Could not save the thread's ${stage.name} stage`,
    runAtomCommand(
      appAtomRegistry,
      serverEnvironment.recordPipelineStage,
      {
        environmentId: thread.environmentId,
        input: { pipelineId, stageId: stage.id, threadId: thread.id, input },
      },
      { reportFailure: false },
    ),
  );
}

export function leaveThreadPipeline(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
): Promise<boolean> {
  return reportFailure(
    "Could not leave the pipeline",
    runAtomCommand(
      appAtomRegistry,
      serverEnvironment.leavePipeline,
      { environmentId: thread.environmentId, input: { threadId: thread.id } },
      { reportFailure: false },
    ),
  );
}

/**
 * Records the stage server-side and puts its rendered prompt into the thread's
 * composer without sending it, so the user reads it and presses Send.
 */
export async function stagePipelineAsDraft(
  thread: PipelineThread,
  progress: ThreadPipelineProgress | null,
  pipeline: PipelineDefinition,
  stage: PipelineStage,
  onDrafted?: () => void,
): Promise<boolean> {
  if (isThreadPipelineBusy(thread)) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Wait for the current turn to end",
        description: "The server refuses a stage while a turn runs.",
      }),
    );
    return false;
  }
  const input = progress?.state.pipelineId === pipeline.id ? progress.state.input : thread.title;
  const recorded = await recordThreadPipelineStage(thread, pipeline.id, stage, input);
  if (!recorded) return false;
  useComposerDraftStore
    .getState()
    .setPrompt(
      { environmentId: thread.environmentId, threadId: thread.id },
      renderPipelineStagePrompt(stage.prompt, input),
    );
  onDrafted?.();
  return true;
}

/** Runs a thread menu's pipeline item; false when `action` is not one. */
export async function runThreadPipelineMenuAction(
  thread: PipelineThread,
  action: ThreadActionMenuId,
  onStageDrafted?: () => void,
): Promise<boolean> {
  if (!action.startsWith("pipeline-")) return false;
  if (action === "pipeline-leave") {
    await leaveThreadPipeline(thread);
    return true;
  }
  const snapshot = readPipelinesSnapshot(thread.environmentId);
  const progress = snapshot && resolveThreadPipelineProgress(snapshot, thread.id);
  const startedPipeline = action.startsWith("pipeline-start:")
    ? snapshot?.pipelines.find((entry) => entry.id === action.slice("pipeline-start:".length))
    : undefined;
  const target =
    startedPipeline !== undefined
      ? { pipeline: startedPipeline, stage: startedPipeline.stages[0] }
      : action === "pipeline-next"
        ? { pipeline: progress?.pipeline, stage: progress?.next }
        : action.startsWith("pipeline-stage:")
          ? {
              pipeline: progress?.pipeline,
              stage: progress?.pipeline?.stages.find(
                (entry) => entry.id === action.slice("pipeline-stage:".length),
              ),
            }
          : null;
  if (target?.pipeline && target.stage) {
    await stagePipelineAsDraft(thread, progress, target.pipeline, target.stage, onStageDrafted);
  }
  return true;
}

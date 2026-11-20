import {
  planPipelineAutomationCommand,
  planPipelineCommand,
  resolveThreadPipelineProgress,
} from "@t3tools/client-runtime/pipelines";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type PipelineDefinition,
  type PipelineStage,
  type PipelinesSnapshot,
  renderPipelineStagePrompt,
} from "@t3tools/contracts";

import type { ComposerThreadTarget } from "../../composerDraftStore";
import { recordThreadPipelineStage, setThreadPipelineAutomation } from "../threadPipelineActions";
import { stackedThreadToast, toastManager } from "../ui/toast";

export interface ComposerPipelineStart {
  readonly pipeline: PipelineDefinition;
  readonly stage: PipelineStage;
  readonly task: string;
}

/** What a `/pipeline` prompt resolves to before the send continues. */
export type ComposerPipelineResolution =
  /** The prompt was rejected (toasted) or the stage started in the open thread; the send stops. */
  | { readonly type: "handled" }
  /** A new thread's first message carries the stage; the send continues with its prompt. */
  | { readonly type: "outgoing"; readonly start: ComposerPipelineStart }
  | { readonly type: "none" };

function blockPipeline(reason: string): ComposerPipelineResolution {
  toastManager.add(
    stackedThreadToast({
      type: "warning",
      title: "Pipeline not started",
      description: reason,
    }),
  );
  return { type: "handled" };
}

// The `/pipeline` interception, kept out of useComposerSend.ts so that file
// carries a single call instead of the whole block.
export async function resolveComposerPipeline(input: {
  readonly skip: boolean;
  readonly snapshot: PipelinesSnapshot | null | undefined;
  readonly isServerThread: boolean;
  readonly activeThread: EnvironmentThreadShell;
  readonly hasMultipleModelSelections: boolean;
  readonly draftTarget: ComposerThreadTarget;
  readonly hasNonPromptDraftContent: boolean;
  readonly promptRef: { current: string };
  readonly setDraftPrompt: (target: ComposerThreadTarget, prompt: string) => void;
}): Promise<ComposerPipelineResolution> {
  const { snapshot } = input;
  // A server without pipelines gets `/pipeline` as typed, so a provider command of that name works.
  if (input.skip || snapshot === undefined || snapshot === null) return { type: "none" };
  const plan = planPipelineCommand({
    prompt: input.promptRef.current,
    pipelines: snapshot.pipelines,
    newThread: !input.isServerThread,
  });
  if (plan === null) return { type: "none" };
  if (!plan.ok) return blockPipeline(plan.message);
  if (input.hasNonPromptDraftContent) {
    return blockPipeline(
      "A pipeline starts from text alone. Remove the attachments and context first.",
    );
  }
  if (input.hasMultipleModelSelections) {
    return blockPipeline("Choose one model to start a pipeline.");
  }
  const start: ComposerPipelineStart = plan;
  // An existing thread gets the stage's prompt as a draft the user sends
  // themselves; a new thread's first message carries it.
  if (input.isServerThread) {
    const progress = resolveThreadPipelineProgress(snapshot, input.activeThread.id);
    const task =
      start.task !== ""
        ? start.task
        : progress?.state.pipelineId === start.pipeline.id
          ? progress.state.input
          : input.activeThread.title;
    const recorded = await recordThreadPipelineStage(
      input.activeThread,
      start.pipeline.id,
      start.stage,
      task,
    );
    if (recorded) {
      input.setDraftPrompt(
        input.draftTarget,
        renderPipelineStagePrompt(
          start.stage.prompt,
          task,
          start.stage.id,
          ((progress?.state.pipelineId === start.pipeline.id ? progress.state.automation : undefined) ??
            start.pipeline.automation ??
            "manual") === "auto",
        ),
      );
    }
    return { type: "handled" };
  }
  return { type: "outgoing", start };
}

/**
 * The `/pipeline-automation <auto|manual>` interception: switches the open
 * thread's pipeline mode and stops the send. Anything else passes through.
 */
export async function resolveComposerPipelineAutomation(input: {
  readonly skip: boolean;
  readonly snapshot: PipelinesSnapshot | null | undefined;
  readonly isServerThread: boolean;
  readonly activeThread: EnvironmentThreadShell;
  readonly promptRef: { current: string };
}): Promise<"handled" | "none"> {
  if (input.skip || input.snapshot === undefined || input.snapshot === null) return "none";
  const automation = planPipelineAutomationCommand(input.promptRef.current);
  if (automation === null) return "none";
  if (!input.isServerThread) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Automation is per thread",
        description: "Run /pipeline-automation in a thread that is in a pipeline.",
      }),
    );
    return "handled";
  }
  const progress = resolveThreadPipelineProgress(input.snapshot, input.activeThread.id);
  if (progress === null) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Not in a pipeline",
        description: "Start one first: /pipeline <id> <task>",
      }),
    );
    return "handled";
  }
  const switched = await setThreadPipelineAutomation(input.activeThread, automation);
  if (switched) {
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Pipeline automation: ${automation}`,
        description: `This thread's pipeline now runs ${automation}.`,
      }),
    );
  }
  return "handled";
}

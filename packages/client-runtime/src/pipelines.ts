import type {
  PipelineDefinition,
  PipelineId,
  PipelineStage,
  PipelinesSnapshot,
  ThreadId,
  ThreadPipelineState,
} from "@t3tools/contracts";

/** A thread's saved stage, read against the pipelines.json the server has now. */
export interface ThreadPipelineProgress {
  readonly state: ThreadPipelineState;
  /** Null once pipelines.json no longer defines the thread's pipeline. */
  readonly pipeline: PipelineDefinition | null;
  /** Null once the pipeline no longer has the thread's stage. */
  readonly stage: PipelineStage | null;
  /** 1-based place of `stage` in its pipeline. */
  readonly position: number;
  readonly next: PipelineStage | null;
}

export function resolveThreadPipelineProgress(
  snapshot: Pick<PipelinesSnapshot, "pipelines" | "threads">,
  threadId: ThreadId,
): ThreadPipelineProgress | null {
  const state = snapshot.threads.find((entry) => entry.threadId === threadId);
  if (state === undefined) return null;
  const pipeline = snapshot.pipelines.find((entry) => entry.id === state.pipelineId) ?? null;
  const index = pipeline?.stages.findIndex((entry) => entry.id === state.stageId) ?? -1;
  const stage = pipeline?.stages[index] ?? null;
  return {
    state,
    pipeline,
    stage,
    position: index + 1,
    next: stage === null ? null : (pipeline?.stages[index + 1] ?? null),
  };
}

const PIPELINE_COMMAND = /^\/pipeline(?=\s|$)\s*(\S*)\s*([\s\S]*)$/;

export type PipelineCommandPlan =
  | {
      readonly ok: true;
      readonly pipeline: PipelineDefinition;
      readonly stage: PipelineStage;
      readonly task: string;
    }
  | { readonly ok: false; readonly message: string };

/** Reads `/pipeline <id> <task>`; null for any other prompt. A new thread has no title to fall back on. */
export function planPipelineCommand(input: {
  readonly prompt: string;
  readonly pipelines: ReadonlyArray<PipelineDefinition>;
  readonly newThread: boolean;
}): PipelineCommandPlan | null {
  const match = PIPELINE_COMMAND.exec(input.prompt.trim());
  if (match === null) return null;
  const pipelineId = match[1] ?? "";
  const task = (match[2] ?? "").trim();
  if (pipelineId === "") return { ok: false, message: "Name a pipeline: /pipeline <id> <task>" };
  const pipeline = input.pipelines.find((entry) => entry.id === pipelineId);
  const stage = pipeline?.stages[0];
  if (pipeline === undefined || stage === undefined) {
    return { ok: false, message: `There is no pipeline "${pipelineId}" in pipelines.json.` };
  }
  if (input.newThread && task === "") {
    return {
      ok: false,
      message: `Add the task after the pipeline: /pipeline ${pipelineId} <task>`,
    };
  }
  return { ok: true, pipeline, stage, task };
}

export interface PipelineStageLabels {
  /** "Develop 2/4" */
  readonly short: string;
  /** "pipeline Ticket, stage Develop, 2 of 4" */
  readonly spoken: string;
  /** Drives the chip's hue, so one pipeline's rows share a color. */
  readonly pipelineId: PipelineId;
  readonly stageName: string;
  /** The stage's own `color` from pipelines.json, null to fall back to the pipeline hue. */
  readonly color: string | null;
  /** 1-based; 0 once the stage left pipelines.json. */
  readonly position: number;
  readonly stageCount: number;
}

/** A stage pipelines.json no longer lists keeps its saved id and loses its place. */
export function labelThreadPipelineStage(progress: ThreadPipelineProgress): PipelineStageLabels {
  const { pipeline, stage, state } = progress;
  const pipelineName = pipeline?.name ?? state.pipelineId;
  const base = {
    pipelineId: state.pipelineId,
    stageName: stage?.name ?? state.stageId,
    color: stage?.color ?? null,
    position: progress.position,
    stageCount: pipeline?.stages.length ?? 0,
  };
  if (pipeline === null || stage === null) {
    return {
      ...base,
      short: state.stageId,
      spoken: `pipeline ${pipelineName}, stage ${state.stageId}, no longer in pipelines.json`,
    };
  }
  const count = pipeline.stages.length;
  return {
    ...base,
    short: `${stage.name} ${progress.position}/${count}`,
    spoken: `pipeline ${pipelineName}, stage ${stage.name}, ${progress.position} of ${count}`,
  };
}

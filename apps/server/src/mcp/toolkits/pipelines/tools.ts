import {
  OrchestratorMcpFailure,
  PipelineAutomation,
  PipelineId,
  PipelineStageId,
  ThreadId,
  ThreadPipelineState,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import * as McpSchema from "effect/ai/McpSchema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as PipelineService from "../../../pipelines/PipelineService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  PipelineService.PipelineService,
  SecureRandom.SecureRandom,
];

const PipelineStatusTool = Tool.make("pipeline_status", {
  description:
    "List the pipelines in pipelines.json with their stage ids, and where threads are in them: stage, status, history. `threadIds` narrows the threads.",
  parameters: Schema.Struct({
    threadIds: Schema.optional(Schema.Array(ThreadId).check(Schema.isMaxLength(100))),
  }),
  success: Schema.Struct({
    pipelines: Schema.Array(
      Schema.Struct({
        id: PipelineId,
        name: Schema.String,
        automation: Schema.optional(PipelineAutomation),
        stages: Schema.Array(Schema.Struct({ id: PipelineStageId, name: Schema.String })),
      }),
    ),
    threads: Schema.Array(ThreadPipelineState),
    issues: Schema.Array(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read pipeline progress")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PipelineStartTool = Tool.make("pipeline_start", {
  description:
    "Start a pipeline stage in another, idle thread, as `/pipeline` does: its prompt is sent there and an `auto` pipeline then advances by itself. For a new thread, `t3_thread_launch` without `message` first. Default stage: the first. `input` fills `{input}`; omitted, the thread's saved input or title.",
  parameters: Schema.Struct({
    threadId: ThreadId,
    pipelineId: PipelineId,
    stageId: Schema.optional(PipelineStageId),
    input: Schema.optional(Schema.String.check(Schema.isMaxLength(20000))),
  }),
  success: ThreadPipelineState,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Start a pipeline stage")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

export const PipelinesToolkit = Toolkit.make(PipelineStatusTool, PipelineStartTool);

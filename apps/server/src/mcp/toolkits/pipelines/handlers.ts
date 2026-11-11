import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PipelineService from "../../../pipelines/PipelineService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { newCommandId, readCaller } from "../../threadAccess.ts";
import { PipelinesToolkit } from "./tools.ts";

const handlers = {
  pipeline_status: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      const snapshot = yield* (yield* PipelineService.PipelineService).current;
      const wanted = input.threadIds === undefined ? undefined : new Set(input.threadIds);
      return {
        pipelines: snapshot.pipelines.map(({ id, name, automation, stages }) => ({
          id,
          name,
          ...(automation === undefined ? {} : { automation }),
          stages: stages.map((stage) => ({ id: stage.id, name: stage.name })),
        })),
        threads: snapshot.threads.filter((state) => wanted?.has(state.threadId) ?? true),
        issues: snapshot.issues,
      };
    }),
  ),
  pipeline_start: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        yield* readCaller();
        const service = yield* PipelineService.PipelineService;
        const snapshot = yield* service.current;
        const stageId =
          input.stageId ??
          snapshot.pipelines.find((pipeline) => pipeline.id === input.pipelineId)?.stages[0]?.id;
        if (stageId === undefined) {
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: `There is no pipeline "${input.pipelineId}" in pipelines.json.`,
          });
        }
        // An agent starts from where the thread is now; the stale-view guard is for clients.
        const current = snapshot.threads.find((state) => state.threadId === input.threadId);
        return yield* service
          .startStage({
            pipelineId: input.pipelineId,
            stageId,
            commandId: yield* newCommandId(),
            threadId: input.threadId,
            expected:
              current === undefined
                ? null
                : { pipelineId: current.pipelineId, stageId: current.stageId },
            ...(input.input === undefined ? {} : { input: input.input }),
            creationSource: "mcp",
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
            ),
          );
      }),
  ),
} satisfies McpToolAccess.Handlers<typeof PipelinesToolkit.tools>;

export const layer = McpToolAccess.toLayer(PipelinesToolkit, handlers);

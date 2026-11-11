import {
  EnvironmentId,
  PipelineError,
  PipelineId,
  PipelineStageId,
  type PipelinesSnapshot,
  type PipelinesStartStageInput,
  ProviderInstanceId,
  ThreadId,
  type ThreadPipelineState,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as PipelineService from "../../../pipelines/PipelineService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as PipelinesHandlers from "./handlers.ts";
import { PipelinesToolkit } from "./tools.ts";

const CALLER = ThreadId.make("thread-epic");
const STORY = ThreadId.make("thread-story");
const story = PipelineId.make("story");
const plan = PipelineStageId.make("plan");
const develop = PipelineStageId.make("develop");

const storyState: ThreadPipelineState = {
  threadId: STORY,
  pipelineId: story,
  stageId: plan,
  input: "ABI-1",
  enteredStages: [plan],
  status: "waiting_input",
  detail: null,
  history: [],
  continuations: 0,
  updatedAt: "2026-11-11T00:00:00.000Z",
};

const snapshot: PipelinesSnapshot = {
  configPath: "/unused/pipelines.json",
  pipelines: [
    {
      id: story,
      name: "Story",
      automation: "auto",
      stages: [
        { id: plan, name: "Plan", prompt: "Plan {input}." },
        { id: develop, name: "Develop", prompt: "Build {input}." },
      ],
    },
  ],
  issues: [],
  threads: [storyState],
};

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "provider-session-1",
  thread: {
    threadId: CALLER,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const makeHarness = Effect.fn("makePipelinesToolkitHarness")(function* () {
  const started = yield* Ref.make<ReadonlyArray<PipelinesStartStageInput>>([]);
  const layerDependencies = Layer.mergeAll(
    Layer.mock(PipelineService.PipelineService)({
      current: Effect.succeed(snapshot),
      startStage: (input) =>
        Ref.update(started, (all) => [...all, input]).pipe(
          Effect.andThen(
            input.stageId === develop
              ? Effect.succeed({ ...storyState, stageId: develop, status: "running" as const })
              : Effect.fail(new PipelineError({ message: "Wait for the current turn to end." })),
          ),
        ),
    }),
    Layer.succeed(
      SecureRandom.SecureRandom,
      SecureRandom.make((size) => new Uint8Array(size).fill(7)),
    ),
    McpToolAccessTestkit.liveThreadsLayer,
  );
  const toolkit = yield* PipelinesToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(PipelinesHandlers.layer).pipe(
        Layer.provide(layerDependencies),
      ),
    ),
  );
  const call = <Name extends keyof typeof PipelinesToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["orchestration"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof PipelinesToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provide(layerDependencies),
    );
  return { started, call };
});

describe("pipeline toolkit handlers", () => {
  it.effect("starts a stage from where the thread is, and the first stage by default", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const advanced = yield* harness.call("pipeline_start", {
        threadId: STORY,
        pipelineId: story,
        stageId: develop,
      });
      expect(advanced).toMatchObject({ stageId: develop, status: "running" });

      const refused = yield* harness.call("pipeline_start", { threadId: STORY, pipelineId: story });
      expect(refused).toMatchObject({
        _tag: "OrchestratorMcpFailure",
        code: "invalid_request",
        message: "Wait for the current turn to end.",
      });

      const unknown = yield* harness.call("pipeline_start", {
        threadId: STORY,
        pipelineId: PipelineId.make("nope"),
      });
      expect(unknown).toMatchObject({ code: "invalid_request" });

      expect(
        (yield* Ref.get(harness.started)).map(({ stageId, expected, creationSource }) => ({
          stageId,
          expected,
          creationSource,
        })),
      ).toEqual([
        { stageId: develop, expected: { pipelineId: story, stageId: plan }, creationSource: "mcp" },
        { stageId: plan, expected: { pipelineId: story, stageId: plan }, creationSource: "mcp" },
      ]);
    }),
  );

  it.effect("refuses a credential that cannot control threads", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const status = yield* harness.call("pipeline_status", {}, ["preview"]);
      const start = yield* harness.call("pipeline_start", { threadId: STORY, pipelineId: story }, [
        "preview",
      ]);
      expect(status).toMatchObject({ code: "capability_denied" });
      expect(start).toMatchObject({ code: "capability_denied" });
      expect(yield* Ref.get(harness.started)).toEqual([]);
    }),
  );
});

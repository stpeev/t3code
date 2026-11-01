import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  PipelineId,
  PipelineStageId,
  type PipelinesStartStageInput,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as PipelineDefinitions from "./PipelineDefinitions.ts";
import * as PipelineService from "./PipelineService.ts";

const threadId = ThreadId.make("thread-1");
const ticket = PipelineId.make("ticket");
const plan = PipelineStageId.make("plan");
const develop = PipelineStageId.make("develop");
const definitions: PipelineDefinitions.PipelineDefinitionsState = {
  pipelines: [
    {
      id: ticket,
      name: "Ticket",
      stages: [
        { id: plan, name: "Plan", prompt: "Plan {input}." },
        { id: develop, name: "Develop", prompt: "Build {input}." },
      ],
    },
  ],
  issues: [],
};

interface FakeThread {
  title: string;
  activeRunId: string | null;
  pendingRuntimeRequest: object | null;
  deletedAt: string | null;
}

const makeThread = (): FakeThread => ({
  title: "Fix the login bug",
  activeRunId: null,
  pendingRuntimeRequest: null,
  deletedAt: null,
});

const layerConfig = () =>
  Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-pipeline-threads-test-" }));

/** Builds the service fresh, so two calls against one state dir are a server restart. */
const withService = <A, E, R>(
  thread: FakeThread | null,
  body: (
    service: PipelineService.PipelineService["Service"],
    sent: ReadonlyArray<ThreadManagementService.ThreadManagementSendInput>,
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.suspend(() => {
    const sent: Array<ThreadManagementService.ThreadManagementSendInput> = [];
    const layerFakes = Layer.mergeAll(
      Layer.mock(PipelineDefinitions.PipelineDefinitions)({
        configPath: "/unused/pipelines.json",
        current: Effect.succeed(definitions),
        changes: Stream.make(definitions),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.sync(() =>
            thread === null ? null : ({ ...thread, projectId: ProjectId.make("p") } as never),
          ),
        sendToThread: (input) =>
          Effect.sync(() => {
            sent.push(input);
            return {} as never;
          }),
      }),
    );
    return PipelineService.PipelineService.pipe(
      Effect.flatMap((service) => body(service, sent)),
      Effect.provide(PipelineService.layer.pipe(Layer.provide(layerFakes))),
    );
  });

const startInput = (
  stageId: PipelineStageId,
  expected: PipelinesStartStageInput["expected"],
  extra: Partial<PipelinesStartStageInput> = {},
): PipelinesStartStageInput => ({
  pipelineId: ticket,
  stageId,
  commandId: CommandId.make(`command:${stageId}`),
  threadId,
  expected,
  creationSource: "web",
  ...extra,
});

const at = (stageId: PipelineStageId) => ({ pipelineId: ticket, stageId });

const savedStages = (service: PipelineService.PipelineService["Service"]) =>
  Stream.runHead(service.subscribe).pipe(
    Effect.map((snapshot) =>
      Option.getOrThrow(snapshot).threads.map(({ updatedAt: _updatedAt, ...state }) => state),
    ),
  );

it.layer(NodeServices.layer)("PipelineService", (it) => {
  it.effect("sends each stage's prompt into the thread and remembers the stage it reached", () => {
    const thread = makeThread();
    const composerModel = { instanceId: ProviderInstanceId.make("devReplay"), model: "showcase" };
    return withService(thread, (service, sent) =>
      Effect.gen(function* () {
        yield* service.startStage(startInput(plan, null));
        thread.title = "A title the agent wrote later";
        yield* service.startStage(startInput(develop, at(plan), { modelSelection: composerModel }));
        yield* service.startStage(startInput(plan, at(develop), { input: "Ship the signup flow" }));

        assert.deepEqual(
          sent.map(({ text, mode, createdBy, modelSelection }) => ({
            text,
            mode,
            createdBy,
            modelSelection,
          })),
          [
            {
              text: "Plan Fix the login bug.",
              mode: "queue",
              createdBy: "user",
              modelSelection: undefined,
            },
            {
              text: "Build Fix the login bug.",
              mode: "queue",
              createdBy: "user",
              modelSelection: composerModel,
            },
            {
              text: "Plan Ship the signup flow.",
              mode: "queue",
              createdBy: "user",
              modelSelection: undefined,
            },
          ],
        );
        assert.deepEqual(yield* savedStages(service), [
          { threadId, pipelineId: ticket, stageId: plan, input: "Ship the signup flow" },
        ]);
      }),
    ).pipe(Effect.provide(layerConfig()));
  });

  it.effect("starts a stage once when two clients advance from the same view", () =>
    withService(makeThread(), (service, sent) =>
      Effect.gen(function* () {
        yield* service.startStage(startInput(plan, null));

        const results = yield* Effect.forEach(
          ["command:a", "command:b"],
          (commandId) =>
            Effect.result(
              service.startStage(
                startInput(develop, at(plan), { commandId: CommandId.make(commandId) }),
              ),
            ),
          { concurrency: "unbounded" },
        );

        assert.lengthOf(results.filter(Result.isSuccess), 1);
        assert.deepEqual(
          results.filter(Result.isFailure).map((result) => result.failure.message),
          ["This thread's pipeline stage changed since you looked."],
        );
        assert.lengthOf(sent, 2);
      }),
    ).pipe(Effect.provide(layerConfig())),
  );

  it.effect(
    "refuses to start a stage while a turn runs, a question waits, or the thread is gone",
    () =>
      Effect.gen(function* () {
        const busy = "Wait for the current turn to end before starting a stage.";
        const gone = "This thread no longer exists.";
        const cases: ReadonlyArray<readonly [FakeThread | null, string]> = [
          [{ ...makeThread(), activeRunId: "run-1" }, busy],
          [{ ...makeThread(), pendingRuntimeRequest: { type: "user_input" } }, busy],
          [{ ...makeThread(), deletedAt: "2026-10-29T00:00:00.000Z" }, gone],
          [null, gone],
        ];
        for (const [thread, message] of cases) {
          yield* withService(thread, (service, sent) =>
            Effect.gen(function* () {
              const error = yield* Effect.flip(service.startStage(startInput(plan, null)));

              assert.equal(error.message, message);
              assert.lengthOf(sent, 0);
              assert.deepEqual(yield* savedStages(service), []);
            }),
          );
        }
      }).pipe(Effect.provide(layerConfig())),
  );

  it.effect("refuses pipelines and stages that pipelines.json doesn't define", () =>
    withService(makeThread(), (service, sent) =>
      Effect.gen(function* () {
        const unknownPipeline = yield* Effect.flip(
          service.startStage(startInput(plan, null, { pipelineId: PipelineId.make("bugfix") })),
        );
        const unknownStage = yield* Effect.flip(
          service.recordStage({
            pipelineId: ticket,
            stageId: PipelineStageId.make("deploy"),
            threadId,
            input: "Fix the login bug",
          }),
        );

        assert.equal(unknownPipeline.message, 'There is no pipeline "bugfix" in pipelines.json.');
        assert.equal(unknownStage.message, 'Pipeline "Ticket" has no stage "deploy".');
        assert.lengthOf(sent, 0);
        assert.deepEqual(yield* savedStages(service), []);
      }),
    ).pipe(Effect.provide(layerConfig())),
  );

  it.effect("keeps each thread's stage across a restart, until the thread leaves", () =>
    Effect.gen(function* () {
      const otherThreadId = ThreadId.make("thread-2");
      const other = {
        threadId: otherThreadId,
        pipelineId: ticket,
        stageId: develop,
        input: "Ship",
      };
      yield* withService(makeThread(), (service) =>
        Effect.all([service.startStage(startInput(plan, null)), service.recordStage({ ...other })]),
      );

      const afterRestart = yield* withService(makeThread(), (service) =>
        savedStages(service).pipe(Effect.tap(service.leave({ threadId }))),
      );
      const afterLeaving = yield* withService(makeThread(), savedStages);

      assert.deepEqual(afterRestart, [
        { threadId, pipelineId: ticket, stageId: plan, input: "Fix the login bug" },
        other,
      ]);
      assert.deepEqual(afterLeaving, [other]);
    }).pipe(Effect.provide(layerConfig())),
  );

  it.effect("sets aside a state file it can't read instead of failing or overwriting it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const unreadable = `{ "threads": "not a list" }`;
      yield* fs.writeFileString(
        path.join(stateDir, PipelineService.PIPELINE_THREADS_FILE_NAME),
        unreadable,
      );

      const stages = yield* withService(makeThread(), (service) =>
        service.startStage(startInput(plan, null)).pipe(Effect.andThen(savedStages(service))),
      );
      const asideNames = (yield* fs.readDirectory(stateDir)).filter((name) =>
        name.startsWith(`${PipelineService.PIPELINE_THREADS_FILE_NAME}.corrupt-`),
      );

      assert.deepEqual(
        stages.map((state) => state.stageId),
        [plan],
      );
      assert.lengthOf(asideNames, 1);
      assert.equal(yield* fs.readFileString(path.join(stateDir, asideNames[0] ?? "")), unreadable);
    }).pipe(Effect.provide(layerConfig())),
  );
});

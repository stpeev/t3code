import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  type OrchestrationV2DomainEvent,
  PipelineId,
  PipelineStageId,
  type PipelinesStartStageInput,
  ProjectId,
  renderPipelineStagePrompt,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as PipelineDefinitions from "./PipelineDefinitions.ts";
import * as PipelineService from "./PipelineService.ts";

const threadId = ThreadId.make("thread-1");
const ticket = PipelineId.make("ticket");
const plan = PipelineStageId.make("plan");
const develop = PipelineStageId.make("develop");
const review = PipelineStageId.make("review");
const goal = PipelineId.make("goal");
const work = PipelineStageId.make("work");
const epic = PipelineId.make("epic");
const breakdown = PipelineStageId.make("breakdown");
const dispatch = PipelineStageId.make("dispatch");
const definitions: PipelineDefinitions.PipelineDefinitionsState = {
  pipelines: [
    {
      id: ticket,
      name: "Ticket",
      stages: [
        { id: plan, name: "Plan", prompt: "Plan {input}." },
        { id: develop, name: "Develop", prompt: "Build {input}." },
        { id: review, name: "Review", prompt: "Review {input}." },
      ],
    },
    {
      id: goal,
      name: "Goal",
      automation: "auto",
      maxContinuations: 2,
      stages: [{ id: work, name: "Work", prompt: "Work on {input}." }],
    },
    {
      id: epic,
      name: "Epic",
      automation: "auto",
      stages: [
        {
          id: breakdown,
          name: "Breakdown",
          prompt: "Split {input}.",
          verifyPrompt: "Each story is one PR.",
          approval: true,
        },
        { id: dispatch, name: "Dispatch", prompt: "Start {input}." },
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
    publish: (event: OrchestrationV2DomainEvent) => Effect.Effect<boolean>,
    takeSent: Effect.Effect<ThreadManagementService.ThreadManagementSendInput>,
  ) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const sent: Array<ThreadManagementService.ThreadManagementSendInput> = [];
    const sentQueue = yield* Queue.unbounded<ThreadManagementService.ThreadManagementSendInput>();
    const events = yield* PubSub.unbounded<OrchestrationV2DomainEvent>();
    const layerFakes = Layer.mergeAll(
      Layer.mock(PipelineDefinitions.PipelineDefinitions)({
        configPath: "/unused/pipelines.json",
        current: Effect.succeed(definitions),
        changes: Stream.make(definitions),
      }),
      Layer.mock(Orchestrator.OrchestratorV2)({
        streamDomainEvents: Stream.fromPubSub(events),
        streamStoredEventsFrom: () => Stream.empty,
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.sync(() =>
            thread === null ? null : ({ ...thread, projectId: ProjectId.make("p") } as never),
          ),
        sendToThread: (input) =>
          Effect.sync(() => {
            sent.push(input);
          }).pipe(Effect.andThen(Queue.offer(sentQueue, input)), Effect.as({} as never)),
      }),
    );
    return yield* PipelineService.PipelineService.pipe(
      Effect.flatMap((service) =>
        body(service, sent, (event) => PubSub.publish(events, event), Queue.take(sentQueue)),
      ),
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
              text: renderPipelineStagePrompt("Plan {input}.", "Fix the login bug", plan),
              mode: "queue",
              createdBy: "user",
              modelSelection: undefined,
            },
            {
              text: renderPipelineStagePrompt("Build {input}.", "Fix the login bug", develop),
              mode: "queue",
              createdBy: "user",
              modelSelection: composerModel,
            },
            {
              text: renderPipelineStagePrompt("Plan {input}.", "Ship the signup flow", plan),
              mode: "queue",
              createdBy: "user",
              modelSelection: undefined,
            },
          ],
        );
        assert.deepEqual(yield* savedStages(service), [
          {
            threadId,
            pipelineId: ticket,
            stageId: plan,
            input: "Ship the signup flow",
            enteredStages: [plan, develop],
            status: "running",
            detail: null,
            history: [],
            continuations: 0,
          },
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
        {
          threadId,
          pipelineId: ticket,
          stageId: plan,
          input: "Fix the login bug",
          enteredStages: [plan],
          status: "running",
          detail: null,
          history: [],
          continuations: 0,
        },
        {
          ...other,
          enteredStages: [develop],
          status: "running",
          detail: null,
          history: [],
          continuations: 0,
        },
      ]);
      assert.deepEqual(afterLeaving, [
        {
          ...other,
          enteredStages: [develop],
          status: "running",
          detail: null,
          history: [],
          continuations: 0,
        },
      ]);
    }).pipe(Effect.provide(layerConfig())),
  );

  it.effect("records a stage jumped to as entered while the skipped one stays unentered", () =>
    withService(makeThread(), (service) =>
      Effect.gen(function* () {
        yield* service.startStage(startInput(plan, null));
        yield* service.startStage(startInput(review, at(plan)));

        assert.deepEqual(yield* savedStages(service), [
          {
            threadId,
            pipelineId: ticket,
            stageId: review,
            input: "Fix the login bug",
            enteredStages: [plan, review],
            status: "running",
            detail: null,
            history: [],
            continuations: 0,
          },
        ]);
      }),
    ).pipe(Effect.provide(layerConfig())),
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

  it.effect(
    "an auto pipeline re-prompts a quiet stage up to maxContinuations, then waits for a person",
    () =>
      withService(makeThread(), (service, sent, publish, takeSent) =>
        Effect.gen(function* () {
          yield* service.startStage({
            pipelineId: goal,
            stageId: work,
            commandId: CommandId.make("command:work"),
            threadId,
            expected: null,
            creationSource: "web",
          });
          const turn = (text: string | null) =>
            Effect.gen(function* () {
              if (text !== null) {
                yield* publish({
                  type: "message.updated",
                  threadId,
                  payload: { threadId, role: "assistant", streaming: false, text },
                } as never);
              }
              yield* publish({
                type: "run.updated",
                threadId,
                payload: { status: "completed" },
              } as never);
            });
          const quietTurn = turn("still working on it");
          const waitForStatus = (status: string) =>
            service.subscribe.pipe(
              Stream.filter((snapshot) => snapshot.threads[0]?.status === status),
              Stream.runHead,
            );

          yield* quietTurn;
          yield* takeSent;
          yield* quietTurn;
          yield* takeSent;
          // Budget (2) exhausted: the next quiet turn stops the pipeline.
          yield* quietTurn;
          yield* waitForStatus("waiting_input");

          const continuations = sent.slice(1).map((input) => input.text);
          assert.lengthOf(continuations, 2);
          assert.isTrue(continuations[0]!.includes("Continue where you left off"));
          assert.isTrue(continuations.every((text) => text.includes("PIPELINE: DONE")));
          assert.lengthOf(sent, 3);
          const states = yield* savedStages(service);
          assert.equal(states[0]?.status, "waiting_input");
          assert.equal(states[0]?.continuations, 2);

          // A later turn (an answer, a PR watch wake-up) resumes the stage only with a new verdict.
          yield* turn("PIPELINE: WAITING on review");
          yield* turn(null);
          yield* turn("merged.\nPIPELINE: DONE");
          yield* waitForStatus("done");
          assert.lengthOf(sent, 3);
        }),
      ).pipe(Effect.provide(layerConfig())),
  );

  it.effect("an auto pipeline advances on DONE without a human", () =>
    withService(makeThread(), (service, sent, publish) =>
      Effect.gen(function* () {
        yield* service.startStage({
          pipelineId: goal,
          stageId: work,
          commandId: CommandId.make("command:work"),
          threadId,
          expected: null,
          creationSource: "web",
        });
        yield* publish({
          type: "message.updated",
          threadId,
          payload: {
            threadId,
            role: "assistant",
            streaming: false,
            text: "finished.\nPIPELINE: DONE",
          },
        } as never);
        yield* publish({
          type: "run.updated",
          threadId,
          payload: { status: "completed" },
        } as never);
        yield* service.subscribe.pipe(
          Stream.filter((snapshot) => snapshot.threads[0]?.status === "done"),
          Stream.runHead,
        );

        const states = yield* savedStages(service);
        assert.equal(states[0]?.status, "done");
        assert.lengthOf(sent, 1);
      }),
    ).pipe(Effect.provide(layerConfig())),
  );

  it.effect("a stage with a verifier and approval is verified before it waits for approval", () =>
    withService(makeThread(), (service, sent, publish, takeSent) =>
      Effect.gen(function* () {
        yield* service.startStage({
          pipelineId: epic,
          stageId: breakdown,
          commandId: CommandId.make("command:breakdown"),
          threadId,
          expected: null,
          creationSource: "web",
        });
        yield* takeSent;
        const turn = (text: string) =>
          publish({
            type: "message.updated",
            threadId,
            payload: { threadId, role: "assistant", streaming: false, text },
          } as never).pipe(
            Effect.andThen(
              publish({ type: "run.updated", threadId, payload: { status: "completed" } } as never),
            ),
          );

        yield* turn("split.\nPIPELINE: DONE");
        const verify = yield* takeSent;
        assert.isTrue(verify.text.includes("Each story is one PR."));

        yield* turn("PIPELINE: VERIFIED");
        yield* service.subscribe.pipe(
          Stream.filter((snapshot) => snapshot.threads[0]?.status === "waiting_approval"),
          Stream.runHead,
        );
        const states = yield* savedStages(service);
        assert.equal(states[0]?.stageId, breakdown);
        assert.deepEqual(
          states[0]?.history.map(({ stageId, outcome }) => ({ stageId, outcome })),
          [{ stageId: breakdown, outcome: "done" }],
        );
        assert.lengthOf(sent, 2);
      }),
    ).pipe(Effect.provide(layerConfig())),
  );
});

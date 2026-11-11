import {
  CommandId,
  MessageId,
  PipelineError,
  type PipelineDefinition,
  type PipelineId,
  type PipelinesLeaveInput,
  type PipelinesRecordStageInput,
  type PipelinesSnapshot,
  type PipelinesStartStageInput,
  type PipelineStage,
  type PipelineStageId,
  type OrchestrationV2DomainEvent,
  type ProjectId,
  type ThreadId,
  ThreadPipelineState,
  pipelineVerdictOf,
  renderPipelineContinuationPrompt,
  renderPipelineStagePrompt,
  renderPipelineVerifyPrompt,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as PipelineDefinitions from "./PipelineDefinitions.ts";

export const PIPELINE_THREADS_FILE_NAME = "pipeline-threads.json";

export class PipelineService extends Context.Service<
  PipelineService,
  {
    readonly subscribe: Stream.Stream<PipelinesSnapshot>;
    /** Sends the stage's prompt into the thread, then saves the thread as at that stage. */
    readonly startStage: (
      input: PipelinesStartStageInput,
    ) => Effect.Effect<ThreadPipelineState, PipelineError>;
    readonly recordStage: (
      input: PipelinesRecordStageInput,
    ) => Effect.Effect<ThreadPipelineState, PipelineError>;
    readonly leave: (input: PipelinesLeaveInput) => Effect.Effect<void, PipelineError>;
  }
>()("t3/pipelines/PipelineService") {}

const ThreadsFileJson = fromJsonStringPretty(
  Schema.Struct({ threads: Schema.Array(ThreadPipelineState) }),
);
const decodeThreadsFile = Schema.decodeEffect(ThreadsFileJson);
const encodeThreadsFile = Schema.encodeEffect(ThreadsFileJson);

type ThreadStates = ReadonlyMap<ThreadId, ThreadPipelineState>;

const failure = (message: string, cause?: unknown) =>
  new PipelineError({ message, ...(cause === undefined ? {} : { cause }) });

const findStage = (
  pipelines: ReadonlyArray<PipelineDefinition>,
  pipelineId: PipelineId,
  stageId: PipelineStageId,
) => {
  const pipeline = pipelines.find((entry) => entry.id === pipelineId);
  if (pipeline === undefined) {
    return Effect.fail(failure(`There is no pipeline "${pipelineId}" in pipelines.json.`));
  }
  const stage = pipeline.stages.find((entry) => entry.id === stageId);
  return stage === undefined
    ? Effect.fail(failure(`Pipeline "${pipeline.name}" has no stage "${stageId}".`))
    : Effect.succeed(stage);
};

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const definitions = yield* PipelineDefinitions.PipelineDefinitions;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const statePath = path.join(stateDir, PIPELINE_THREADS_FILE_NAME);

  // A file this build can't decode is set aside rather than overwritten, so nothing is lost.
  const setAsideUnreadableStates = Effect.fn("PipelineService.setAsideUnreadableStates")(function* (
    error: Schema.SchemaError,
  ) {
    const asidePath = `${statePath}.corrupt-${DateTime.toEpochMillis(yield* DateTime.now)}`;
    yield* Effect.logWarning("setting aside an unreadable pipeline state file", {
      path: statePath,
      asidePath,
      error: error.message,
    });
    yield* fs.rename(statePath, asidePath).pipe(Effect.ignore({ log: true }));
    return new Map<ThreadId, ThreadPipelineState>();
  });
  const loadStates = fs.readFileString(statePath).pipe(
    Effect.flatMap(decodeThreadsFile),
    Effect.map(({ threads }): ThreadStates => new Map(threads.map((t) => [t.threadId, t]))),
    Effect.catchTags({
      PlatformError: (error) =>
        (error.reason._tag === "NotFound"
          ? Effect.void
          : Effect.logWarning("could not read the pipeline state file", {
              path: statePath,
              error: error.message,
            })
        ).pipe(Effect.as<ThreadStates>(new Map())),
      SchemaError: setAsideUnreadableStates,
    }),
  );
  const statesRef = yield* SubscriptionRef.make(yield* loadStates);
  const lock = yield* Semaphore.make(1);

  const persist = (states: ThreadStates) =>
    encodeThreadsFile({ threads: [...states.values()] }).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath: statePath, contents })),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => failure(`Could not save ${PIPELINE_THREADS_FILE_NAME}.`, cause)),
      Effect.andThen(SubscriptionRef.set(statesRef, states)),
    );

  const save = Effect.fn("PipelineService.save")(function* (
    fields: Omit<ThreadPipelineState, "updatedAt" | "enteredStages">,
  ) {
    const states = yield* SubscriptionRef.get(statesRef);
    const previous = states.get(fields.threadId);
    // Switching pipelines starts a fresh set; staying in one accumulates, so a
    // skipped stage stays unentered.
    const entered =
      previous !== undefined && previous.pipelineId === fields.pipelineId
        ? new Set([...previous.enteredStages, fields.stageId])
        : new Set([fields.stageId]);
    const state: ThreadPipelineState = {
      ...fields,
      enteredStages: [...entered],
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* persist(new Map(states).set(state.threadId, state));
    return state;
  });

  const historyOf = (previous: ThreadPipelineState | undefined, pipelineId: PipelineId) =>
    previous !== undefined && previous.pipelineId === pipelineId ? previous.history : [];

  /**
   * Sends the stage's prompt into the thread and saves the thread as at that
   * stage, running. Caller holds the lock and has checked `expected` and that
   * the thread is idle.
   */
  const sendStage = Effect.fn("PipelineService.sendStage")(function* (input: {
    readonly pipelineId: PipelineId;
    readonly stage: PipelineStage;
    readonly commandId: CommandId;
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly input: string;
    readonly creationSource: PipelinesStartStageInput["creationSource"];
    readonly modelSelection?: PipelinesStartStageInput["modelSelection"];
  }) {
    const previous = (yield* SubscriptionRef.get(statesRef)).get(input.threadId);
    yield* threadManagement
      .sendToThread({
        projectId: input.projectId,
        commandId: input.commandId,
        threadId: input.threadId,
        messageId: MessageId.make(`pipeline-message:${input.commandId}`),
        text: renderPipelineStagePrompt(input.stage.prompt, input.input, input.stage.id),
        attachments: [],
        ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
        mode: "queue",
        createdBy: "user",
        creationSource: input.creationSource,
      })
      .pipe(Effect.mapError((cause) => failure(`Could not send ${input.stage.name}.`, cause)));
    return yield* save({
      threadId: input.threadId,
      pipelineId: input.pipelineId,
      stageId: input.stage.id,
      input: input.input,
      status: "running",
      detail: null,
      history: historyOf(previous, input.pipelineId),
      continuations: 0,
    });
  });

  const startStage: PipelineService["Service"]["startStage"] = Effect.fn(
    "PipelineService.startStage",
  )(function* (input) {
    const { pipelines } = yield* definitions.current;
    const stage = yield* findStage(pipelines, input.pipelineId, input.stageId);
    const current = (yield* SubscriptionRef.get(statesRef)).get(input.threadId);
    const seenCurrent =
      input.expected === null
        ? current === undefined
        : current?.pipelineId === input.expected.pipelineId &&
          current.stageId === input.expected.stageId;
    if (!seenCurrent) {
      return yield* failure("This thread's pipeline stage changed since you looked.");
    }
    const thread = yield* threadManagement
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError((cause) => failure("Could not read the thread.", cause)));
    if (thread === null || thread.deletedAt !== null) {
      return yield* failure("This thread no longer exists.");
    }
    if (thread.activeRunId !== null || thread.pendingRuntimeRequest !== null) {
      return yield* failure("Wait for the current turn to end before starting a stage.");
    }
    const pipelineInput =
      input.input ?? (current?.pipelineId === input.pipelineId ? current.input : thread.title);
    return yield* sendStage({
      pipelineId: input.pipelineId,
      stage,
      commandId: input.commandId,
      threadId: input.threadId,
      projectId: thread.projectId,
      input: pipelineInput,
      creationSource: input.creationSource,
      ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
    });
  }, lock.withPermits(1));

  const recordStage: PipelineService["Service"]["recordStage"] = Effect.fn(
    "PipelineService.recordStage",
  )(function* (input) {
    const { pipelines } = yield* definitions.current;
    yield* findStage(pipelines, input.pipelineId, input.stageId);
    const previous = (yield* SubscriptionRef.get(statesRef)).get(input.threadId);
    return yield* save({
      ...input,
      status: "running",
      detail: null,
      history: historyOf(previous, input.pipelineId),
      continuations: 0,
    });
  }, lock.withPermits(1));

  const leave: PipelineService["Service"]["leave"] = Effect.fn("PipelineService.leave")(function* (
    input,
  ) {
    const states = new Map(yield* SubscriptionRef.get(statesRef));
    if (states.delete(input.threadId)) yield* persist(states);
  }, lock.withPermits(1));

  // In an "auto" pipeline, when the turn of the current stage (or its
  // verifier) ends, the server reads the PIPELINE: verdict from the last
  // assistant reply and sends the next stage itself — no human in the loop.

  const orchestrator = yield* Orchestrator.OrchestratorV2;

  /** Last finished assistant reply per pipeline thread, tracked from events. */
  const lastAssistantText = yield* Ref.make(new Map<ThreadId, string>());

  const TERMINAL_RUN_STATUSES = new Set([
    "completed",
    "failed",
    "interrupted",
    "cancelled",
    "rolled_back",
  ]);

  /** Sends the next stage's prompt, or marks the pipeline done / waits for approval. */
  const advanceOrWait = Effect.fn("PipelineService.advanceOrWait")(function* (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly pipeline: PipelineDefinition;
    readonly stage: PipelineStage;
    readonly index: number;
    readonly state: ThreadPipelineState;
  }) {
    const { pipeline, stage, index, state } = input;
    const next = pipeline.stages[index + 1];
    if (next === undefined) {
      yield* save({
        threadId: state.threadId,
        pipelineId: state.pipelineId,
        stageId: state.stageId,
        input: state.input,
        status: "done",
        detail: null,
        history: state.history,
        continuations: state.continuations,
      });
      return;
    }
    if (stage.approval === true) {
      yield* save({
        threadId: state.threadId,
        pipelineId: state.pipelineId,
        stageId: state.stageId,
        input: state.input,
        status: "waiting_approval",
        detail: null,
        history: state.history,
        continuations: state.continuations,
      });
      return;
    }
    yield* sendStage({
      pipelineId: pipeline.id,
      stage: next,
      commandId: CommandId.make(`pipeline-auto:${SecureRandom.uuidV4Unsafe()}`),
      threadId: input.threadId,
      projectId: input.projectId,
      input: state.input,
      creationSource: "server",
    });
  });

  /**
   * Evaluates a pipeline thread whose turn just ended, in an "auto" pipeline:
   * reads the PIPELINE: verdict from the last assistant reply and advances,
   * verifies, waits for approval, or stops on FAILED/WAITING. Caller must not
   * hold the lock; evaluate takes it and re-reads the state.
   */
  const evaluate = Effect.fn("PipelineService.evaluate")(function* (
    threadId: ThreadId,
    runStatus: string,
  ) {
    const { pipelines } = yield* definitions.current;
    const state = (yield* SubscriptionRef.get(statesRef)).get(threadId);
    if (state === undefined || (state.status !== "running" && state.status !== "verifying")) {
      return;
    }
    const pipeline = pipelines.find((entry) => entry.id === state.pipelineId);
    if (pipeline === undefined || (pipeline.automation ?? "manual") !== "auto") return;
    const index = pipeline.stages.findIndex((entry) => entry.id === state.stageId);
    const stage = index === -1 ? undefined : pipeline.stages[index];
    if (stage === undefined) return;
    const thread = yield* threadManagement.getThreadShell(threadId).pipe(Effect.orDie);
    if (thread === null || thread.deletedAt !== null) return;
    if (thread.activeRunId !== null || thread.pendingRuntimeRequest !== null) return;

    const lastText = (yield* Ref.get(lastAssistantText)).get(threadId);
    const reading = lastText === undefined ? null : pipelineVerdictOf(lastText);
    const now = DateTime.formatIso(yield* DateTime.now);

    if (state.status === "verifying") {
      if (reading?.verdict === "verified") {
        yield* save({
          threadId,
          pipelineId: state.pipelineId,
          stageId: state.stageId,
          input: state.input,
          status: "running",
          detail: null,
          history: [...state.history, { stageId: state.stageId, outcome: "done", at: now }],
          continuations: state.continuations,
        });
        yield* advanceOrWait({
          threadId,
          projectId: thread.projectId,
          pipeline,
          stage,
          index,
          state,
        });
      } else if (reading?.verdict === "rejected") {
        yield* save({
          threadId,
          pipelineId: state.pipelineId,
          stageId: state.stageId,
          input: state.input,
          status: "failed",
          detail: reading.detail || "Verification rejected the stage.",
          history: [
            ...state.history,
            {
              stageId: state.stageId,
              outcome: "failed",
              detail: reading.detail || undefined,
              at: now,
            },
          ],
          continuations: state.continuations,
        });
      } else {
        yield* save({
          threadId,
          pipelineId: state.pipelineId,
          stageId: state.stageId,
          input: state.input,
          status: "waiting_input",
          detail: reading?.detail ?? "The verifier left no PIPELINE: verdict line.",
          history: state.history,
          continuations: state.continuations,
        });
      }
      return;
    }

    // A stage work turn ended.
    if (reading?.verdict === "done") {
      if (stage.approval === true) {
        yield* save({
          threadId,
          pipelineId: state.pipelineId,
          stageId: state.stageId,
          input: state.input,
          status: "waiting_approval",
          detail: null,
          history: [...state.history, { stageId: state.stageId, outcome: "done", at: now }],
          continuations: state.continuations,
        });
        return;
      }
      if (stage.verifyPrompt !== undefined) {
        const commandId = CommandId.make(`pipeline-verify:${SecureRandom.uuidV4Unsafe()}`);
        yield* threadManagement
          .sendToThread({
            projectId: thread.projectId,
            commandId,
            threadId,
            messageId: MessageId.make(`pipeline-verify-message:${commandId}`),
            text: renderPipelineVerifyPrompt(stage.name, stage.id, stage.verifyPrompt, state.input),
            attachments: [],
            mode: "queue",
            createdBy: "agent",
            creationSource: "server",
          })
          .pipe(Effect.mapError((cause) => failure("Could not send the verifier prompt.", cause)));
        yield* save({
          threadId,
          pipelineId: state.pipelineId,
          stageId: state.stageId,
          input: state.input,
          status: "verifying",
          detail: null,
          history: state.history,
          continuations: state.continuations,
        });
        return;
      }
      yield* advanceOrWait({
        threadId,
        projectId: thread.projectId,
        pipeline,
        stage,
        index,
        state,
      });
      return;
    }
    if (reading?.verdict === "failed") {
      yield* save({
        threadId,
        pipelineId: state.pipelineId,
        stageId: state.stageId,
        input: state.input,
        status: "failed",
        detail: reading.detail || "The stage reported FAILED.",
        history: [
          ...state.history,
          {
            stageId: state.stageId,
            outcome: "failed",
            detail: reading.detail || undefined,
            at: now,
          },
        ],
        continuations: state.continuations,
      });
      return;
    }
    if (reading?.verdict === "waiting" || reading === null) {
      // A quiet completed turn in an auto pipeline with continuation budget
      // left gets a "continue" turn (like a /goal's idle continuation); only
      // WAITING or an exhausted budget stops for a person.
      const canContinue =
        reading === null &&
        runStatus === "completed" &&
        state.continuations < (pipeline.maxContinuations ?? 0);
      if (canContinue) {
        const commandId = CommandId.make(`pipeline-continue:${SecureRandom.uuidV4Unsafe()}`);
        yield* threadManagement
          .sendToThread({
            projectId: thread.projectId,
            commandId,
            threadId,
            messageId: MessageId.make(`pipeline-continue-message:${commandId}`),
            text: renderPipelineContinuationPrompt(stage.name),
            attachments: [],
            mode: "queue",
            createdBy: "agent",
            creationSource: "server",
          })
          .pipe(
            Effect.mapError((cause) => failure("Could not send the continuation prompt.", cause)),
          );
        yield* save({
          threadId,
          pipelineId: state.pipelineId,
          stageId: state.stageId,
          input: state.input,
          status: state.status,
          detail: null,
          history: state.history,
          continuations: state.continuations + 1,
        });
        return;
      }
      yield* save({
        threadId,
        pipelineId: state.pipelineId,
        stageId: state.stageId,
        input: state.input,
        status: "waiting_input",
        detail:
          reading?.detail ??
          (runStatus === "completed" ? "No PIPELINE: verdict line in the final reply." : null),
        history: state.history,
        continuations: state.continuations,
      });
      return;
    }
    // The run itself failed without a verdict line.
    yield* save({
      threadId,
      pipelineId: state.pipelineId,
      stageId: state.stageId,
      input: state.input,
      status: "failed",
      detail: `The run ended as ${runStatus}.`,
      history: state.history,
      continuations: state.continuations,
    });
  }, lock.withPermits(1));

  const handleEvent = Effect.fn("PipelineService.handleEvent")(function* (
    event: OrchestrationV2DomainEvent,
  ) {
    if (
      event.type === "message.updated" &&
      event.payload.role === "assistant" &&
      !event.payload.streaming
    ) {
      const states = yield* SubscriptionRef.get(statesRef);
      if (states.has(event.payload.threadId)) {
        yield* Ref.update(lastAssistantText, (map) =>
          new Map(map).set(event.payload.threadId, event.payload.text),
        );
      }
      return;
    }
    if (event.type === "run.updated" && TERMINAL_RUN_STATUSES.has(event.payload.status)) {
      const states = yield* SubscriptionRef.get(statesRef);
      if (states.has(event.threadId)) {
        yield* Effect.forkDetach(evaluate(event.threadId, event.payload.status));
      }
    }
  });

  // Seed the last-reply map by replaying each pipeline thread's stored
  // message events (the stream then stays live for that thread, which is
  // harmless: the update is idempotent), and follow all events live.
  yield* Effect.gen(function* () {
    const states = yield* SubscriptionRef.get(statesRef);
    for (const threadId of states.keys()) {
      yield* Effect.forkDetach(
        orchestrator
          .streamStoredEventsFrom({ threadId, afterSequence: 0, eventType: "message.updated" })
          .pipe(
            Stream.filter(
              (
                stored,
              ): stored is typeof stored & {
                event: Extract<OrchestrationV2DomainEvent, { type: "message.updated" }>;
              } => stored.event.type === "message.updated",
            ),
            Stream.filter(
              (stored) =>
                stored.event.payload.role === "assistant" && !stored.event.payload.streaming,
            ),
            Stream.runForEach((stored) =>
              Ref.update(lastAssistantText, (map) =>
                new Map(map).set(threadId, stored.event.payload.text),
              ),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("pipeline watcher seed failed", { threadId, cause }),
            ),
          ),
      );
    }
  }).pipe(Effect.forkScoped);
  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) => handleEvent(event)).pipe(
      Effect.catchCause((cause) => Effect.logWarning("pipeline watcher stream failed", { cause })),
    ),
  );

  const subscribe = Stream.zipLatest(definitions.changes, SubscriptionRef.changes(statesRef)).pipe(
    Stream.map(([{ pipelines, issues }, states]) => ({
      configPath: definitions.configPath,
      pipelines,
      issues,
      threads: [...states.values()],
    })),
  );

  return PipelineService.of({ subscribe, startStage, recordStage, leave });
});

export const layer = Layer.effect(PipelineService, make);

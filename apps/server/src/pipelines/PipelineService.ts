import {
  MessageId,
  PipelineError,
  type PipelineDefinition,
  type PipelineId,
  type PipelinesLeaveInput,
  type PipelinesRecordStageInput,
  type PipelinesSnapshot,
  type PipelinesStartStageInput,
  type PipelineStageId,
  type ThreadId,
  ThreadPipelineState,
  renderPipelineStagePrompt,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
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
    fields: Omit<ThreadPipelineState, "updatedAt">,
  ) {
    const state: ThreadPipelineState = {
      ...fields,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* persist(new Map(yield* SubscriptionRef.get(statesRef)).set(state.threadId, state));
    return state;
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
    yield* threadManagement
      .sendToThread({
        projectId: thread.projectId,
        commandId: input.commandId,
        threadId: input.threadId,
        messageId: MessageId.make(`pipeline-message:${input.commandId}`),
        text: renderPipelineStagePrompt(stage.prompt, pipelineInput),
        attachments: [],
        ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
        mode: "queue",
        createdBy: "user",
        creationSource: input.creationSource,
      })
      .pipe(Effect.mapError((cause) => failure(`Could not send ${stage.name}.`, cause)));
    return yield* save({
      threadId: input.threadId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      input: pipelineInput,
    });
  }, lock.withPermits(1));

  const recordStage: PipelineService["Service"]["recordStage"] = Effect.fn(
    "PipelineService.recordStage",
  )(function* (input) {
    const { pipelines } = yield* definitions.current;
    yield* findStage(pipelines, input.pipelineId, input.stageId);
    return yield* save(input);
  }, lock.withPermits(1));

  const leave: PipelineService["Service"]["leave"] = Effect.fn("PipelineService.leave")(function* (
    input,
  ) {
    const states = new Map(yield* SubscriptionRef.get(statesRef));
    if (states.delete(input.threadId)) yield* persist(states);
  }, lock.withPermits(1));

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

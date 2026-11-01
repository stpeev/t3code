import {
  PIPELINES_FILE_NAME,
  type PipelineDefinition,
  PipelineError,
  type PipelinesConfigText,
  type PipelinesEnsureConfigFileResult,
  type PipelinesSaveConfigTextInput,
  type PipelinesSaveConfigTextResult,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { decodePipelinesFile } from "@t3tools/shared/pipelines";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerConfig from "../config.ts";

export interface PipelineDefinitionsState {
  readonly pipelines: ReadonlyArray<PipelineDefinition>;
  readonly issues: ReadonlyArray<string>;
}

export class PipelineDefinitions extends Context.Service<
  PipelineDefinitions,
  {
    readonly configPath: string;
    readonly current: Effect.Effect<PipelineDefinitionsState>;
    /** The current definitions, then the definitions after each change to pipelines.json. */
    readonly changes: Stream.Stream<PipelineDefinitionsState>;
    /** Writes the starter file when there is none, so there is always one to open. */
    readonly ensureConfigFile: Effect.Effect<PipelinesEnsureConfigFileResult, PipelineError>;
    /** The file as written, even when it has problems, for an editor to start from. */
    readonly readConfigText: Effect.Effect<PipelinesConfigText, PipelineError>;
    /** Replaces the file, valid or not, unless it changed since the editor's revision. */
    readonly saveConfigText: (
      input: PipelinesSaveConfigTextInput,
    ) => Effect.Effect<PipelinesSaveConfigTextResult, PipelineError>;
  }
>()("t3/pipelines/PipelineDefinitions") {}

const STARTER_PIPELINES_CONFIG = `// Pipelines for T3 Code. Each stage's prompt is sent as-is into
// the thread; {input} is the task you gave /pipeline, or the
// thread's title. Saved changes apply right away.
{
  "pipelines": [
    {
      "id": "ticket",
      "name": "Ticket",
      "stages": [
        { "id": "plan", "name": "Plan",
          "prompt": "Plan {input}. Change no code yet." },
        { "id": "develop", "name": "Develop",
          "prompt": "Implement the plan, tests first." },
        { "id": "review", "name": "Review",
          "prompt": "/code-review" },
        { "id": "pr", "name": "PR", "prompt": "/pr-push" }
      ]
    }
  ]
}
`;

const EMPTY_STATE: PipelineDefinitionsState = { pipelines: [], issues: [] };

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const digest = yield* Digest.Digest;
  const revisionOf = (text: string) =>
    digest.digest(Digest.sha256, new TextEncoder().encode(text)).pipe(
      Effect.map(Hex.encode),
      Effect.mapError(
        (cause) => new PipelineError({ message: "Could not read pipelines.json.", cause }),
      ),
    );
  const configPath = path.join(stateDir, PIPELINES_FILE_NAME);

  const load = fs.readFileString(configPath).pipe(
    Effect.map(decodePipelinesFile),
    Effect.catchTags({
      PlatformError: (error) =>
        Effect.succeed(
          error.reason._tag === "NotFound"
            ? EMPTY_STATE
            : { pipelines: [], issues: [`Could not read pipelines.json: ${error.message}`] },
        ),
    }),
  );
  const stateRef = yield* SubscriptionRef.make(yield* load);
  const reload = load.pipe(Effect.flatMap((state) => SubscriptionRef.set(stateRef, state)));

  // Saves emit several events, and fs.watch can fire before the content is flushed.
  yield* fs.watch(stateDir).pipe(
    Stream.filter((event) => path.resolve(stateDir, event.path) === path.resolve(configPath)),
    Stream.debounce(Duration.millis(100)),
    Stream.runForEach(() => reload),
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );

  const writeLock = yield* Semaphore.make(1);
  const ensureConfigFile = writeLock.withPermits(1)(
    Effect.gen(function* () {
      if (yield* fs.exists(configPath)) return { path: configPath, created: false };
      yield* writeFileStringAtomically({
        filePath: configPath,
        contents: STARTER_PIPELINES_CONFIG,
      });
      yield* reload;
      return { path: configPath, created: true };
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) => new PipelineError({ message: "Could not create pipelines.json.", cause }),
      ),
    ),
  );

  const readConfigText = fs.readFileString(configPath).pipe(
    Effect.flatMap((text) =>
      revisionOf(text).pipe(Effect.map((revision): PipelinesConfigText => ({ text, revision }))),
    ),
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed<PipelinesConfigText>({ text: "", revision: null })
          : Effect.fail(
              new PipelineError({ message: "Could not read pipelines.json.", cause: error }),
            ),
    }),
  );

  const saveConfigText: PipelineDefinitions["Service"]["saveConfigText"] = Effect.fn(
    "PipelineDefinitions.saveConfigText",
  )(function* (input) {
    const found = yield* readConfigText;
    if (found.revision !== input.expectedRevision) {
      return { saved: false, current: found } satisfies PipelinesSaveConfigTextResult;
    }
    yield* writeFileStringAtomically({ filePath: configPath, contents: input.text }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) => new PipelineError({ message: "Could not save pipelines.json.", cause }),
      ),
    );
    yield* reload;
    return {
      saved: true,
      current: { text: input.text, revision: yield* revisionOf(input.text) },
    } satisfies PipelinesSaveConfigTextResult;
  }, writeLock.withPermits(1));

  return PipelineDefinitions.of({
    configPath,
    current: SubscriptionRef.get(stateRef),
    changes: SubscriptionRef.changes(stateRef),
    ensureConfigFile,
    readConfigText,
    saveConfigText,
  });
});

export const layer = Layer.effect(PipelineDefinitions, make);

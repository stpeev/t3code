import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { renderPipelineStagePrompt } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as PipelineDefinitions from "./PipelineDefinitions.ts";

const layerConfig = () =>
  Layer.mergeAll(
    NodeCrypto.layer,
    Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-pipelines-test-" })),
  );

const layerDefinitions = () => PipelineDefinitions.layer.pipe(Layer.provideMerge(layerConfig()));

const pipeline = (id: string, stageIds: ReadonlyArray<string> = ["plan"]) => ({
  id,
  name: `Pipeline ${id}`,
  stages: stageIds.map((stageId) => ({ id: stageId, name: stageId, prompt: `Do ${stageId}.` })),
});

const pipelineIds = (state: PipelineDefinitions.PipelineDefinitionsState) =>
  state.pipelines.map((entry) => entry.id);

it.layer(NodeServices.layer)("PipelineDefinitions", (it) => {
  it.effect("fills in every {input} and leaves other braces alone", () =>
    Effect.sync(() => {
      const rendered = renderPipelineStagePrompt(
        "Plan {input}; keep {input} and {title} as {they} are.",
        "X",
      );
      // The stage prompt itself is unchanged; the verdict/reports rule is appended after it.
      assert.isTrue(rendered.startsWith("Plan X; keep X and {title} as {they} are.\n"));
      assert.isTrue(rendered.includes("PIPELINE: DONE"));
    }),
  );

  it.effect("has no pipelines and no problem while the file is missing", () =>
    Effect.gen(function* () {
      const definitions = yield* PipelineDefinitions.PipelineDefinitions;
      const state = yield* definitions.current;

      assert.deepEqual(state, { pipelines: [], issues: [] });
    }).pipe(Effect.provide(layerDefinitions())),
  );

  it.effect("writes the starter file and loads its pipeline", () =>
    Effect.gen(function* () {
      const definitions = yield* PipelineDefinitions.PipelineDefinitions;

      const result = yield* definitions.ensureConfigFile;
      const state = yield* definitions.current;

      assert.deepEqual(result, { path: definitions.configPath, created: true });
      assert.deepEqual(pipelineIds(state), ["ticket"]);
      assert.deepEqual(state.issues, []);
    }).pipe(Effect.provide(layerDefinitions())),
  );

  it.effect("leaves an existing file as it is", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const definitions = yield* PipelineDefinitions.PipelineDefinitions;
      const contents = JSON.stringify({ pipelines: [pipeline("mine")] });
      yield* fs.writeFileString(definitions.configPath, contents);

      const result = yield* definitions.ensureConfigFile;

      assert.deepEqual(result, { path: definitions.configPath, created: false });
      assert.equal(yield* fs.readFileString(definitions.configPath), contents);
    }).pipe(Effect.provide(layerDefinitions())),
  );

  it.effect("reports a pipelines.json it can't read as a problem, not a failure", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig.ServerConfig;
      yield* fs.makeDirectory(path.join(stateDir, "pipelines.json"), { recursive: true });

      const definitions = yield* PipelineDefinitions.PipelineDefinitions.pipe(
        Effect.provide(PipelineDefinitions.layer),
      );
      const state = yield* definitions.current;

      assert.deepEqual(state.pipelines, []);
      assert.lengthOf(state.issues, 1);
      assert.match(state.issues[0] ?? "", /^Could not read pipelines\.json: /);
    }).pipe(Effect.provide(layerConfig())),
  );

  it.effect("saves text an editor sends, valid or not, and refuses a save over a newer file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const definitions = yield* PipelineDefinitions.PipelineDefinitions;
      const valid = JSON.stringify({ pipelines: [pipeline("mine")] });

      assert.deepEqual(yield* definitions.readConfigText, { text: "", revision: null });

      const first = yield* definitions.saveConfigText({ text: valid, expectedRevision: null });
      assert.isTrue(first.saved);
      assert.equal(yield* fs.readFileString(definitions.configPath), valid);
      assert.deepEqual(yield* definitions.readConfigText, first.current);
      assert.deepEqual(pipelineIds(yield* definitions.current), ["mine"]);

      // Another machine's edit lands first, so this editor's revision is stale.
      yield* fs.writeFileString(definitions.configPath, `{ "pipelines": [] }`);
      const stale = yield* definitions.saveConfigText({
        text: "mine",
        expectedRevision: first.current.revision,
      });
      assert.isFalse(stale.saved);
      assert.equal(stale.current.text, `{ "pipelines": [] }`);
      assert.equal(yield* fs.readFileString(definitions.configPath), `{ "pipelines": [] }`);

      const broken = yield* definitions.saveConfigText({
        text: "{ not json",
        expectedRevision: stale.current.revision,
      });
      assert.isTrue(broken.saved);
      assert.equal(yield* fs.readFileString(definitions.configPath), "{ not json");
      assert.lengthOf((yield* definitions.current).issues, 1);
    }).pipe(Effect.provide(layerDefinitions())),
  );
});

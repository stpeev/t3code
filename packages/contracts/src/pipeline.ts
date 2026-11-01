import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import { CommandId, IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2CreationSource } from "./orchestrationV2.ts";

export const PIPELINES_FILE_NAME = "pipelines.json";
export const MAX_PIPELINES = 50;
const MAX_PIPELINE_STAGES = 20;
const MAX_PIPELINES_CONFIG_CHARS = 200_000;

// Typed after `/pipeline` in the composer, so ids stay lowercase words.
const PipelineSlug = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);

export const PipelineId = PipelineSlug.pipe(Schema.brand("PipelineId"));
export type PipelineId = typeof PipelineId.Type;

export const PipelineStageId = PipelineSlug.pipe(Schema.brand("PipelineStageId"));
export type PipelineStageId = typeof PipelineStageId.Type;

/**
 * Optional CSS color for the stage chip's background. Any valid CSS color is
 * accepted (`#rrggbb`, names, `hsl(…)`, …) and passed through to the browser;
 * the schema only bounds the length, since validating CSS colors needs a CSS
 * engine, not a regex. Invalid values simply don't paint.
 */
export const PipelineStageColor = TrimmedNonEmptyString.check(Schema.isMaxLength(48));
export type PipelineStageColor = typeof PipelineStageColor.Type;

export const PipelineStage = Schema.Struct({
  id: PipelineStageId,
  name: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  color: Schema.optional(PipelineStageColor),
});
export type PipelineStage = typeof PipelineStage.Type;

export const PipelineDefinition = Schema.Struct({
  id: PipelineId,
  name: TrimmedNonEmptyString,
  stages: Schema.Array(PipelineStage).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_PIPELINE_STAGES),
  ),
});
export type PipelineDefinition = typeof PipelineDefinition.Type;

const ThreadPipelinePosition = Schema.Struct({
  pipelineId: PipelineId,
  stageId: PipelineStageId,
});

/** The pipeline a thread is in, at the last stage sent to it. */
export const ThreadPipelineState = Schema.Struct({
  ...ThreadPipelinePosition.fields,
  threadId: ThreadId,
  /** What `{input}` becomes in each of the pipeline's stages. */
  input: Schema.String,
  updatedAt: IsoDateTime,
});
export type ThreadPipelineState = typeof ThreadPipelineState.Type;

export const PipelinesSnapshot = Schema.Struct({
  configPath: TrimmedNonEmptyString,
  pipelines: Schema.Array(PipelineDefinition),
  /** Problems found in pipelines.json; the pipelines without one are still offered. */
  issues: Schema.Array(Schema.String),
  threads: Schema.Array(ThreadPipelineState),
});
export type PipelinesSnapshot = typeof PipelinesSnapshot.Type;

export const PipelinesStartStageInput = Schema.Struct({
  ...ThreadPipelinePosition.fields,
  commandId: CommandId,
  threadId: ThreadId,
  /** Omitted: the saved input when the thread stays in this pipeline, else the thread's title. */
  input: Schema.optional(Schema.String),
  /** Where the client saw the thread, null for in no pipeline; a start from a stale view is refused. */
  expected: Schema.NullOr(ThreadPipelinePosition),
  /** The model picked in the thread's composer; omitted, the thread keeps its own. */
  modelSelection: Schema.optional(ModelSelection),
  creationSource: OrchestrationV2CreationSource,
});
export type PipelinesStartStageInput = typeof PipelinesStartStageInput.Type;

/** Saves a stage the client sent itself, as the first message of a new thread. */
export const PipelinesRecordStageInput = Schema.Struct({
  ...ThreadPipelinePosition.fields,
  threadId: ThreadId,
  input: Schema.String,
});
export type PipelinesRecordStageInput = typeof PipelinesRecordStageInput.Type;

export const PipelinesLeaveInput = Schema.Struct({ threadId: ThreadId });
export type PipelinesLeaveInput = typeof PipelinesLeaveInput.Type;

export const PipelinesSubscribeInput = Schema.Struct({});
export type PipelinesSubscribeInput = typeof PipelinesSubscribeInput.Type;

export const PipelinesEnsureConfigFileInput = Schema.Struct({});
export type PipelinesEnsureConfigFileInput = typeof PipelinesEnsureConfigFileInput.Type;

export const PipelinesEnsureConfigFileResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  created: Schema.Boolean,
});
export type PipelinesEnsureConfigFileResult = typeof PipelinesEnsureConfigFileResult.Type;

export const PipelinesGetConfigTextInput = Schema.Struct({});
export type PipelinesGetConfigTextInput = typeof PipelinesGetConfigTextInput.Type;

/** What pipelines.json holds right now; `revision` is null while there is no file. */
export const PipelinesConfigText = Schema.Struct({
  text: Schema.String,
  revision: Schema.NullOr(Schema.String),
});
export type PipelinesConfigText = typeof PipelinesConfigText.Type;

export const PipelinesSaveConfigTextInput = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(MAX_PIPELINES_CONFIG_CHARS)),
  /** The revision the editor started from; a save over a newer one is refused. */
  expectedRevision: Schema.NullOr(Schema.String),
});
export type PipelinesSaveConfigTextInput = typeof PipelinesSaveConfigTextInput.Type;

export const PipelinesSaveConfigTextResult = Schema.Struct({
  saved: Schema.Boolean,
  /** The file after the call: what was saved, or what is there instead when `saved` is false. */
  current: PipelinesConfigText,
});
export type PipelinesSaveConfigTextResult = typeof PipelinesSaveConfigTextResult.Type;

export class PipelineError extends Schema.TaggedError<PipelineError>()("PipelineError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export function renderPipelineStagePrompt(prompt: string, input: string): string {
  return prompt.replaceAll("{input}", input);
}

// RPC registration lives here, and rpc.ts plus the auth/metrics maps spread it in.
// One seam line per upstream file keeps rebases onto upstream conflict-free.
export const PIPELINE_WS_METHODS = {
  pipelinesSubscribe: "pipelines.subscribe",
  pipelinesEnsureConfigFile: "pipelines.ensureConfigFile",
  pipelinesGetConfigText: "pipelines.getConfigText",
  pipelinesSaveConfigText: "pipelines.saveConfigText",
  pipelinesStartStage: "pipelines.startStage",
  pipelinesRecordStage: "pipelines.recordStage",
  pipelinesLeave: "pipelines.leave",
} as const;

const WsPipelinesSubscribeRpc = Rpc.make(PIPELINE_WS_METHODS.pipelinesSubscribe, {
  payload: PipelinesSubscribeInput,
  success: PipelinesSnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});

const WsPipelinesEnsureConfigFileRpc = Rpc.make(PIPELINE_WS_METHODS.pipelinesEnsureConfigFile, {
  payload: PipelinesEnsureConfigFileInput,
  success: PipelinesEnsureConfigFileResult,
  error: Schema.Union([PipelineError, EnvironmentAuthorizationError]),
});

const WsPipelinesGetConfigTextRpc = Rpc.make(PIPELINE_WS_METHODS.pipelinesGetConfigText, {
  payload: PipelinesGetConfigTextInput,
  success: PipelinesConfigText,
  error: Schema.Union([PipelineError, EnvironmentAuthorizationError]),
});

const WsPipelinesSaveConfigTextRpc = Rpc.make(PIPELINE_WS_METHODS.pipelinesSaveConfigText, {
  payload: PipelinesSaveConfigTextInput,
  success: PipelinesSaveConfigTextResult,
  error: Schema.Union([PipelineError, EnvironmentAuthorizationError]),
});

const WsPipelinesStartStageRpc = Rpc.make(PIPELINE_WS_METHODS.pipelinesStartStage, {
  payload: PipelinesStartStageInput,
  success: ThreadPipelineState,
  error: Schema.Union([PipelineError, EnvironmentAuthorizationError]),
});

const WsPipelinesRecordStageRpc = Rpc.make(PIPELINE_WS_METHODS.pipelinesRecordStage, {
  payload: PipelinesRecordStageInput,
  success: ThreadPipelineState,
  error: Schema.Union([PipelineError, EnvironmentAuthorizationError]),
});

const WsPipelinesLeaveRpc = Rpc.make(PIPELINE_WS_METHODS.pipelinesLeave, {
  payload: PipelinesLeaveInput,
  error: Schema.Union([PipelineError, EnvironmentAuthorizationError]),
});

export const pipelineWsRpcs = [
  WsPipelinesSubscribeRpc,
  WsPipelinesEnsureConfigFileRpc,
  WsPipelinesGetConfigTextRpc,
  WsPipelinesSaveConfigTextRpc,
  WsPipelinesStartStageRpc,
  WsPipelinesRecordStageRpc,
  WsPipelinesLeaveRpc,
] as const;

// Writes the starter pipelines.json into the server's home, as keybinding edits do.
export const PIPELINE_CLIENT_GUARDED_RPC_SCOPES = {
  [PIPELINE_WS_METHODS.pipelinesEnsureConfigFile]: AuthSettingsWriteScope,
  [PIPELINE_WS_METHODS.pipelinesSaveConfigText]: AuthSettingsWriteScope,
  [PIPELINE_WS_METHODS.pipelinesStartStage]: AuthOrchestrationOperateScope,
  [PIPELINE_WS_METHODS.pipelinesRecordStage]: AuthOrchestrationOperateScope,
  [PIPELINE_WS_METHODS.pipelinesLeave]: AuthOrchestrationOperateScope,
} as const;

export const PIPELINE_RPC_REQUIRED_SCOPES = {
  [PIPELINE_WS_METHODS.pipelinesSubscribe]: AuthOrchestrationReadScope,
  [PIPELINE_WS_METHODS.pipelinesGetConfigText]: AuthOrchestrationReadScope,
} as const;

export const PIPELINE_RPC_AGGREGATES = {
  [PIPELINE_WS_METHODS.pipelinesSubscribe]: "pipelines",
  [PIPELINE_WS_METHODS.pipelinesEnsureConfigFile]: "pipelines",
  [PIPELINE_WS_METHODS.pipelinesGetConfigText]: "pipelines",
  [PIPELINE_WS_METHODS.pipelinesSaveConfigText]: "pipelines",
  [PIPELINE_WS_METHODS.pipelinesStartStage]: "pipelines",
  [PIPELINE_WS_METHODS.pipelinesRecordStage]: "pipelines",
  [PIPELINE_WS_METHODS.pipelinesLeave]: "pipelines",
} as const;

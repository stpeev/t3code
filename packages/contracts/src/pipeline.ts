import * as Effect from "effect/Effect";
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "./auth.ts";
import {
  CommandId,
  IsoDateTime,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
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
  /**
   * When true, the pipeline stops after this stage's DONE verdict until a
   * person accepts it — even in an `auto` pipeline. Approval always wins
   * over automation.
   */
  approval: Schema.optional(Schema.Boolean),
  /**
   * Sent as a separate verifier turn after the stage reports DONE: the
   * verifier judges the stage's report and diff against these acceptance
   * criteria and answers `PIPELINE: VERIFIED` or `PIPELINE: REJECTED: <why>`.
   * Only a VERIFIED stage advances automatically.
   */
  verifyPrompt: Schema.optional(TrimmedNonEmptyString),
});
export type PipelineStage = typeof PipelineStage.Type;

export const PipelineAutomation = Schema.Literals(["manual", "auto"]);
export type PipelineAutomation = typeof PipelineAutomation.Type;

export const PipelineDefinition = Schema.Struct({
  id: PipelineId,
  name: TrimmedNonEmptyString,
  stages: Schema.Array(PipelineStage).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_PIPELINE_STAGES),
  ),
  /**
   * "auto" lets the server send the next stage's prompt as soon as the
   * current one ends with `PIPELINE: DONE` (and passes verification), with
   * no human in the loop. Absent or "manual": stages start only from the UI.
   */
  automation: Schema.optional(PipelineAutomation),
  /**
   * In an "auto" pipeline, how many times the server re-prompts a stage whose
   * turn ended without a verdict line before waiting on a person. Absent: 0.
   * Makes a one-stage auto pipeline behave like a /goal: the runtime keeps
   * the thread going until it says DONE.
   */
  maxContinuations: Schema.optional(PositiveInt),
});
export type PipelineDefinition = typeof PipelineDefinition.Type;

const ThreadPipelinePosition = Schema.Struct({
  pipelineId: PipelineId,
  stageId: PipelineStageId,
});

export const PipelineStageStatus = Schema.Literals([
  /** A stage's (or verifier's) prompt was sent and its turn has not ended yet. */
  "running",
  /** The verifier prompt was sent after a DONE verdict; its turn has not ended. */
  "verifying",
  /** DONE on an `approval` stage: waiting for a person to accept the next stage. */
  "waiting_approval",
  /** WAITING verdict, no verdict line, or the run needs input: waiting on a person. */
  "waiting_input",
  /** FAILED verdict, REJECTED verification, or the run itself failed. */
  "failed",
  /** The last stage's verdict was DONE (and verified, when a verifier is set). */
  "done",
]);
export type PipelineStageStatus = typeof PipelineStageStatus.Type;

export const PipelineStageRun = Schema.Struct({
  stageId: PipelineStageId,
  outcome: Schema.Literals(["done", "failed"]),
  /** The FAILED/REJECTED reason, when there was one. */
  detail: Schema.optional(Schema.String),
  at: IsoDateTime,
});
export type PipelineStageRun = typeof PipelineStageRun.Type;

/** The pipeline a thread is in, at the last stage sent to it. */
export const ThreadPipelineState = Schema.Struct({
  ...ThreadPipelinePosition.fields,
  threadId: ThreadId,
  /** What `{input}` becomes in each of the pipeline's stages. */
  input: Schema.String,
  /**
   * Every stage the thread has been at, so a stage skipped by jumping ahead
   * keeps an empty dot. Defaults to empty for state files written before this
   * field existed; the current stage always counts as entered.
   */
  enteredStages: Schema.Array(PipelineStageId)
    .check(Schema.isMaxLength(MAX_PIPELINE_STAGES))
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /**
   * Where the thread is in the pipeline. Defaults to "running" for state
   * files written before this field existed: their stage prompt was sent and
   * unanswered at the time.
   */
  status: PipelineStageStatus.pipe(Schema.withDecodingDefaultKey(Effect.succeed("running"))),
  /** The last FAILED/REJECTED/waiting detail, null while healthy. */
  detail: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  /** Finished stages in order. Defaults to empty for older state files. */
  history: Schema.Array(PipelineStageRun).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /**
   * Continuation turns sent for the current stage because it ended without a
   * verdict line. Reset to 0 whenever a stage (or the verifier) is sent.
   * Defaults to 0 for older state files.
   */
  continuations: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
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

export function renderPipelineStagePrompt(
  prompt: string,
  input: string,
  stageId?: PipelineStageId,
): string {
  const body = prompt.replaceAll("{input}", input);
  const reportLine =
    stageId === undefined
      ? "write a short report of this stage to pipeline-reports/"
      : `write a short report of this stage to pipeline-reports/${stageId}.md`;
  // Appended to every stage prompt so the server can read the stage's outcome
  // from the final reply (see pipelineVerdictOf) in both manual and auto modes.
  const rule =
    "\n\nPipeline rule: this stage is finished only when its work is complete and verified, " +
    "not when it has been started. Don't end your turn while anything it depends on still runs: " +
    "run tests, builds and checks in the foreground and wait for their result. Before your " +
    `verdict, read the earlier reports in pipeline-reports/ and ${reportLine} (what you did, ` +
    "decisions, open questions, how to verify). End your final reply with exactly one of these " +
    "lines:\n`PIPELINE: DONE` (all of it is finished and verified)\n" +
    "`PIPELINE: FAILED: <why>` (it can't be finished)\n" +
    "`PIPELINE: WAITING` (it can't go on until someone acts: my answer to a question, or a " +
    "reviewer, an author or a merge)";
  return `${body}\n${rule}`;
}

/** The verifier turn sent after a stage reports DONE on a stage with verifyPrompt. */
export function renderPipelineVerifyPrompt(
  stageName: string,
  stageId: PipelineStageId,
  verifyPrompt: string,
  input: string,
): string {
  return (
    `Verify the "${stageName}" stage of this pipeline, which just reported DONE. ` +
    "Read pipeline-reports/ (especially the stage's own report and any earlier ones) and the " +
    `diff this stage produced. Acceptance criteria: ${verifyPrompt.replaceAll("{input}", input)}\n\n` +
    `Append your verdict to pipeline-reports/${stageId}.verify.md. End your final reply with ` +
    "exactly one of these lines:\n`PIPELINE: VERIFIED` (the stage meets the criteria)\n" +
    "`PIPELINE: REJECTED: <what is missing or wrong>`"
  );
}

/**
 * Sent when an auto pipeline's stage turn ends without a verdict line, up to
 * the pipeline's maxContinuations: like a /goal, the runtime keeps the thread
 * going instead of stopping on a quiet turn.
 */
export function renderPipelineContinuationPrompt(stageName: string): string {
  return (
    `The previous turn ended without a verdict, so the "${stageName}" stage is not finished. ` +
    "Continue where you left off: don't repeat work that already took effect, finish what " +
    "remains (running tests, builds and checks in the foreground), and end your final reply " +
    "with exactly one of these lines:\n`PIPELINE: DONE`\n`PIPELINE: FAILED: <why>`\n" +
    "`PIPELINE: WAITING` (only if a person or something outside this session must act first)"
  );
}

export const PipelineVerdict = Schema.Literals([
  "done",
  "failed",
  "waiting",
  "verified",
  "rejected",
]);
export type PipelineVerdict = typeof PipelineVerdict.Type;

export interface PipelineVerdictReading {
  readonly verdict: PipelineVerdict;
  /** The text after `FAILED:` / `REJECTED:`, empty for the others. */
  readonly detail: string;
}

const VERDICT_LINE = /PIPELINE:[\s*_`]*(DONE|FAILED|WAITING|VERIFIED|REJECTED)\b[ \t]*:?([^\n]*)/gi;

/**
 * The verdict a stage left in its final reply: the last `PIPELINE: …` line,
 * so a quoted or mentioned line earlier in the reply doesn't win. Null when
 * the reply has none — a quiet turn is not a finished stage.
 */
export function pipelineVerdictOf(text: string): PipelineVerdictReading | null {
  let last: PipelineVerdictReading | null = null;
  for (const match of text.matchAll(VERDICT_LINE)) {
    const verdict = match[1]!.toLowerCase() as PipelineVerdict;
    last = { verdict, detail: (match[2] ?? "").trim().replace(/[\s*_`]+$/u, "") };
  }
  return last;
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

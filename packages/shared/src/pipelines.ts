import { MAX_PIPELINES, PipelineDefinition } from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { fromLenientJson } from "./schemaJson.ts";

export interface PipelinesFileState {
  readonly pipelines: ReadonlyArray<PipelineDefinition>;
  readonly issues: ReadonlyArray<string>;
}

const decodeFile = Schema.decodeUnknownResult(
  fromLenientJson(Schema.Struct({ pipelines: Schema.Array(Schema.Unknown) })),
);
const decodeDefinition = Schema.decodeUnknownResult(PipelineDefinition);

const firstDuplicate = (values: ReadonlyArray<string>) =>
  values.find((value, index) => values.indexOf(value) !== index);

/** Checks each pipeline on its own, so a mistake skips only the pipeline it is in. */
export function decodePipelinesFile(raw: string): PipelinesFileState {
  const file = decodeFile(raw);
  if (Result.isFailure(file)) {
    return {
      pipelines: [],
      issues: [`pipelines.json must be { "pipelines": [ … ] }: ${file.failure.message}`],
    };
  }
  const pipelines: PipelineDefinition[] = [];
  const issues: string[] = [];
  for (const [index, entry] of file.success.pipelines.entries()) {
    const label = `Pipeline ${index + 1}`;
    if (pipelines.length === MAX_PIPELINES) {
      issues.push(`${label} and the ones after it are skipped: the limit is ${MAX_PIPELINES}.`);
      break;
    }
    const decoded = decodeDefinition(entry);
    if (Result.isFailure(decoded)) {
      issues.push(`${label}: ${decoded.failure.message}`);
      continue;
    }
    const pipeline = decoded.success;
    const duplicateStageId = firstDuplicate(pipeline.stages.map((stage) => stage.id));
    if (pipelines.some((other) => other.id === pipeline.id)) {
      issues.push(`${label}: id "${pipeline.id}" is already used by another pipeline.`);
    } else if (duplicateStageId !== undefined) {
      issues.push(`${label} ("${pipeline.id}"): stage id "${duplicateStageId}" is used twice.`);
    } else {
      pipelines.push(pipeline);
    }
  }
  return { pipelines, issues };
}

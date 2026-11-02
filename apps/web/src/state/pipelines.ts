import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  labelThreadPipelineStage,
  resolveThreadPipelineProgress,
  type PipelineStageLabels,
} from "@t3tools/client-runtime/pipelines";
import { AsyncResult, Atom } from "effect/reactivity";

import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

/** The primary server's pipelines.json and its problems, null until its pipelines load. */
export const primaryPipelinesConfigAtom = Atom.make((get) => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return null;
  const snapshot = AsyncResult.getOrElse(
    get(serverEnvironment.pipelinesLive({ environmentId, input: {} })),
    () => null,
  );
  return snapshot === null
    ? null
    : { environmentId, configPath: snapshot.configPath, issues: snapshot.issues };
}).pipe(Atom.withLabel("web-primary-pipelines-config"));

/** Per thread, so one thread's stage change doesn't re-render every sidebar row. */
const threadPipelineStageLabelsAtom = Atom.family((threadRef: ScopedThreadRef) =>
  Atom.make((get): PipelineStageLabels | null => {
    const snapshot = AsyncResult.getOrElse(
      get(serverEnvironment.pipelinesLive({ environmentId: threadRef.environmentId, input: {} })),
      () => null,
    );
    const progress = snapshot && resolveThreadPipelineProgress(snapshot, threadRef.threadId);
    return progress ? labelThreadPipelineStage(progress) : null;
  }).pipe(
    Atom.withEquality<PipelineStageLabels | null>(
      (a, b) =>
        a?.short === b?.short &&
        a?.pipelineId === b?.pipelineId &&
        a?.color === b?.color &&
        String(a?.entered) === String(b?.entered),
    ),
    Atom.withLabel(`web-thread-pipeline-stage:${threadRef.environmentId}:${threadRef.threadId}`),
  ),
);

export function useThreadPipelineStageLabels(threadRef: ScopedThreadRef) {
  return useAtomValue(threadPipelineStageLabelsAtom(threadRef));
}

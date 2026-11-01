import { useAtomValue } from "@effect/atom-react";
import { resolveThreadPipelineProgress } from "@t3tools/client-runtime/pipelines";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { PipelineStage, ThreadId } from "@t3tools/contracts";
import { EllipsisIcon, WorkflowIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import {
  isThreadPipelineBusy,
  leaveThreadPipeline,
  stagePipelineAsDraft,
} from "../threadPipelineActions";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { composerFloatingLayerProps } from "./composerEventScope";

/** The thread's pipeline stage, shown above the composer while the thread is in a pipeline. */
export function useComposerPipelineBanner(
  thread: EnvironmentThreadShell | null,
): ComposerBannerStackItem | null {
  const environmentId = thread?.environmentId ?? null;
  const snapshot = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.pipelinesLive({ environmentId, input: {} }),
  ).data;
  const canOperate = useAtomValue(
    serverEnvironment.startPipelineStage.permissionAtom(environmentId),
  );
  const [pendingThreadId, setPendingThreadId] = useState<ThreadId | null>(null);

  const progress = thread && snapshot && resolveThreadPipelineProgress(snapshot, thread.id);
  if (!thread || !progress) return null;
  const { pipeline, stage, next, state } = progress;
  const busy = isThreadPipelineBusy(thread);
  const pending = pendingThreadId === thread.id;

  const run = async (request: () => Promise<unknown>) => {
    setPendingThreadId(thread.id);
    await request();
    setPendingThreadId((current) => (current === thread.id ? null : current));
  };
  // The stage's prompt lands in the composer as a draft; the user presses Send.
  const runStage = (target: PipelineStage) =>
    void run(() =>
      pipeline === null
        ? Promise.resolve(false)
        : stagePipelineAsDraft(thread, progress, pipeline, target),
    );
  const leavePipeline = () => void run(() => leaveThreadPipeline(thread));

  const startBlockedReason = !canOperate
    ? "This connection cannot change threads."
    : thread.source.pendingRuntimeRequest !== null
      ? "Answer the agent's pending request first."
      : busy
        ? "Wait for the current turn to end."
        : null;
  const startButton =
    stage === null ? null : next === null ? (
      <Button size="xs" variant="outline" disabled={!canOperate || pending} onClick={leavePipeline}>
        Finish
      </Button>
    ) : (
      <Button
        size="xs"
        variant="outline"
        disabled={startBlockedReason !== null || pending}
        onClick={() => runStage(next)}
      >
        Next: {next.name}
      </Button>
    );
  const pipelineName = pipeline?.name ?? state.pipelineId;

  return {
    id: `pipeline:${thread.environmentId}:${thread.id}`,
    variant: stage === null ? "warning" : "default",
    icon: <WorkflowIcon />,
    title: `${pipelineName}: ${stage?.name ?? state.stageId}`,
    description:
      pipeline === null
        ? "pipelines.json no longer has this pipeline."
        : stage === null
          ? "pipelines.json no longer has this stage."
          : `Stage ${progress.position} of ${pipeline.stages.length}`,
    actions: (
      <>
        {startButton !== null && next !== null && startBlockedReason !== null ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex">{startButton}</span>} />
            <TooltipPopup side="top">{startBlockedReason}</TooltipPopup>
          </Tooltip>
        ) : (
          startButton
        )}
        <Menu>
          <MenuTrigger
            disabled={!canOperate || pending}
            render={<Button size="icon-xs" variant="ghost" aria-label="Pipeline actions" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup {...composerFloatingLayerProps} side="top" align="end" width="content">
            {pipeline === null ? null : (
              <MenuSub>
                <MenuSubTrigger disabled={busy}>Run another stage</MenuSubTrigger>
                <MenuSubPopup {...composerFloatingLayerProps}>
                  {pipeline.stages.map((entry, index) => (
                    <MenuItem key={entry.id} onClick={() => runStage(entry)}>
                      {index + 1}. {entry.name}
                    </MenuItem>
                  ))}
                </MenuSubPopup>
              </MenuSub>
            )}
            <MenuItem onClick={leavePipeline}>Leave pipeline</MenuItem>
          </MenuPopup>
        </Menu>
      </>
    ),
  };
}

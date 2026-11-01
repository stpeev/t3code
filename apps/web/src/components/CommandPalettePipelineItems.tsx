import { useAtomValue } from "@effect/atom-react";
import { resolveThreadPipelineProgress } from "@t3tools/client-runtime/pipelines";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { FileJsonIcon, WorkflowIcon } from "lucide-react";

import { useOpenInPreferredEditor } from "../editorPreferences";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import {
  isThreadPipelineBusy,
  leaveThreadPipeline,
  stagePipelineAsDraft,
} from "./threadPipelineActions";
import { toastManager } from "./ui/toast";

const SEARCH_TERMS = ["pipeline", "stage", "workflow"];

/** The open thread's pipeline commands, and pipelines.json for the thread's server or the primary. */
export function useCommandPalettePipelineItems(input: {
  readonly activeThread: EnvironmentThreadShell | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> {
  const { activeThread } = input;
  const configEnvironmentId = activeThread?.environmentId ?? input.primaryEnvironmentId;
  // Null too on a server without pipelines, which would refuse every pipelines request.
  const snapshot = useEnvironmentQuery(
    configEnvironmentId === null
      ? null
      : serverEnvironment.pipelinesLive({ environmentId: configEnvironmentId, input: {} }),
  ).data;
  const canStartStage = useAtomValue(
    serverEnvironment.startPipelineStage.permissionAtom(activeThread?.environmentId ?? null),
  );
  const canWriteConfig = useAtomValue(
    serverEnvironment.ensurePipelinesConfigFile.permissionAtom(configEnvironmentId),
  );
  const ensureConfigFile = useAtomCommand(serverEnvironment.ensurePipelinesConfigFile, {
    reportFailure: false,
  });
  const serverConfigs = useServerConfigs();
  const openInEditor = useOpenInPreferredEditor(
    configEnvironmentId,
    configEnvironmentId === null
      ? []
      : (serverConfigs.get(configEnvironmentId)?.availableEditors ?? []),
  );

  const items: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];
  const icon = <WorkflowIcon className={ITEM_ICON_CLASS} />;
  if (activeThread !== null && snapshot !== null && canStartStage) {
    const progress = resolveThreadPipelineProgress(snapshot, activeThread.id);
    const busy = isThreadPipelineBusy(activeThread);
    const current = progress?.pipeline ?? null;
    if (current !== null && progress?.next) {
      const next = progress.next;
      items.push({
        kind: "action",
        value: "action:pipeline-next",
        searchTerms: [...SEARCH_TERMS, "next", next.name],
        title: `Start ${next.name}`,
        description: `${current.name} pipeline`,
        icon,
        disabled: busy,
        run: async () => {
          await stagePipelineAsDraft(activeThread, progress, current, next);
        },
      });
    }
    if (current !== null) {
      items.push({
        kind: "submenu",
        value: "action:pipeline-run-stage",
        searchTerms: [...SEARCH_TERMS, "run"],
        title: "Run pipeline stage…",
        description: `${current.name} pipeline`,
        icon,
        addonIcon: <WorkflowIcon className={ADDON_ICON_CLASS} />,
        disabled: busy,
        groups: [
          {
            value: "pipeline-stages",
            label: `${current.name} stages`,
            items: current.stages.map((stage, index) => ({
              kind: "action" as const,
              value: `action:pipeline-stage:${stage.id}`,
              searchTerms: [stage.name, stage.id],
              title: `${index + 1}. ${stage.name}`,
              icon,
              run: async () => {
                await stagePipelineAsDraft(activeThread, progress, current, stage);
              },
            })),
          },
        ],
      });
    }
    if (snapshot.pipelines.length > 0) {
      items.push({
        kind: "submenu",
        value: "action:pipeline-start",
        searchTerms: [...SEARCH_TERMS, "start"],
        title: "Start pipeline…",
        icon,
        addonIcon: <WorkflowIcon className={ADDON_ICON_CLASS} />,
        disabled: busy,
        groups: [
          {
            value: "pipelines",
            label: "Pipelines",
            items: snapshot.pipelines.flatMap((pipeline) => {
              const first = pipeline.stages[0];
              return first === undefined
                ? []
                : [
                    {
                      kind: "action" as const,
                      value: `action:pipeline-start:${pipeline.id}`,
                      searchTerms: [pipeline.name, pipeline.id],
                      title: pipeline.name,
                      description: pipeline.stages.map((stage) => stage.name).join(" → "),
                      icon,
                      run: async () => {
                        await stagePipelineAsDraft(activeThread, progress, pipeline, first);
                      },
                    },
                  ];
            }),
          },
        ],
      });
    }
    if (progress !== null) {
      items.push({
        kind: "action",
        value: "action:pipeline-leave",
        searchTerms: [...SEARCH_TERMS, "leave", "finish", "exit"],
        title: "Leave pipeline",
        description: `${current?.name ?? progress.state.pipelineId} pipeline`,
        icon,
        run: async () => {
          await leaveThreadPipeline(activeThread);
        },
      });
    }
  }
  if (configEnvironmentId !== null && snapshot !== null && canWriteConfig) {
    items.push({
      kind: "action",
      value: "action:open-pipelines-config",
      searchTerms: [...SEARCH_TERMS, "pipelines.json", "config", "define", "edit"],
      title: "Open pipelines.json",
      icon: <FileJsonIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        const ensured = await ensureConfigFile({ environmentId: configEnvironmentId, input: {} });
        if (ensured._tag === "Failure") throw squashAtomCommandFailure(ensured);
        const opened = await openInEditor(ensured.value.path);
        if (opened._tag === "Failure") throw squashAtomCommandFailure(opened);
        if (ensured.value.created) {
          toastManager.add({
            type: "success",
            title: "Created pipelines.json",
            description: "It starts with an example pipeline. Saving the file reloads it.",
          });
        }
      },
    });
  }
  return items;
}

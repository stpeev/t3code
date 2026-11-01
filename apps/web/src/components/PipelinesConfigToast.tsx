import {
  AuthOrchestrationOperateScope,
  type EditorId,
  type EnvironmentId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { useOpenInPreferredEditor } from "../editorPreferences";
import { appAtomRegistry, subscribeAtomChanges } from "../rpc/atomRegistry";
import { primaryPipelinesConfigAtom } from "../state/pipelines";
import { primaryServerConfigAtom } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { createPipelinesConfigToastFilter } from "./PipelinesConfigToast.logic";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";

const SHOWN_ISSUES = 3;

function PipelinesConfigWarning(props: {
  readonly issues: ReadonlyArray<string>;
  readonly environmentId: EnvironmentId;
  readonly configPath: string;
  readonly availableEditors: readonly EditorId[];
}) {
  const canOpenEditor = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const openInEditor = useOpenInPreferredEditor(props.environmentId, props.availableEditors);
  const hiddenCount = props.issues.length - SHOWN_ISSUES;

  return (
    <>
      <ul className="list-disc ps-4">
        {props.issues.slice(0, SHOWN_ISSUES).map((issue) => (
          <li key={issue} className="whitespace-pre-wrap">
            {issue}
          </li>
        ))}
        {hiddenCount > 0 ? <li>{hiddenCount} more</li> : null}
      </ul>
      <span className="mt-2 flex justify-end">
        <Button
          size="xs"
          variant="outline"
          disabled={!canOpenEditor || props.availableEditors.length === 0}
          onClick={async () => {
            const result = await openInEditor(props.configPath);
            if (result._tag === "Success") return;
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Unable to open pipelines.json",
                description: error instanceof Error ? error.message : "Unknown error opening file.",
              }),
            );
          }}
        >
          Open pipelines.json
        </Button>
      </span>
    </>
  );
}

/** Toasts the primary server's pipelines.json problems as they appear. */
export function startPipelinesConfigToasts(): () => void {
  const filter = createPipelinesConfigToastFilter();
  return subscribeAtomChanges(primaryPipelinesConfigAtom, (config) => {
    const issues = filter(config?.issues ?? null);
    if (config === null || issues === null) return;
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Invalid pipelines configuration",
        description: (
          <PipelinesConfigWarning
            issues={issues}
            environmentId={config.environmentId}
            configPath={config.configPath}
            availableEditors={appAtomRegistry.get(primaryServerConfigAtom)?.availableEditors ?? []}
          />
        ),
      }),
    );
  });
}

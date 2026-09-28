import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronDownIcon, FolderIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { ComposerControl } from "./chat/ComposerControl";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";

interface BranchToolbarMissingWorktreeProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  worktreePath: string;
  branch: string | null;
  projectCwd: string;
  hasSession: boolean;
}

function failureMessage(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

/** Stands in for the branch selector when the thread's worktree folder is gone. */
export const BranchToolbarMissingWorktree = memo(function BranchToolbarMissingWorktree({
  environmentId,
  threadId,
  worktreePath,
  branch,
  projectCwd,
  hasSession,
}: BranchToolbarMissingWorktreeProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const [pending, setPending] = useState(false);
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, "thread session stop");
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });

  const recreate = useCallback(async () => {
    if (!branch) return;
    setPending(true);
    const result = await createWorktree({
      environmentId,
      input: { cwd: projectCwd, refName: branch, path: worktreePath },
    });
    if (result._tag === "Success") {
      await refreshStatus({ environmentId, input: { cwd: worktreePath } });
    } else {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to recreate worktree",
          description: failureMessage(result),
        }),
      );
    }
    setPending(false);
  }, [branch, createWorktree, environmentId, projectCwd, refreshStatus, worktreePath]);

  const continueInProjectFolder = useCallback(async () => {
    setPending(true);
    // A live session is still bound to the deleted folder.
    if (hasSession) {
      await stopThreadSession({ environmentId, input: { threadId } });
    }
    const result = await updateThreadMetadata({
      environmentId,
      input: { threadId, branch: null, worktreePath: null },
    });
    if (result._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to move thread to the project folder",
          description: failureMessage(result),
        }),
      );
    }
    setPending(false);
  }, [environmentId, hasSession, stopThreadSession, threadId, updateThreadMetadata]);

  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl size="xs" />}
        className="min-w-0 flex-initial justify-end text-warning hover:text-warning @3xl/composer-surface:ml-auto"
        disabled={pending}
        data-composer-context-control
      >
        <TriangleAlertIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">Worktree missing</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup
        align="end"
        side="top"
        className="w-[min(21rem,calc(100vw-2rem))]"
        {...composerFloatingLayerProps}
      >
        <div className="px-2 py-1.5 text-muted-foreground text-xs">
          <span className="break-all">{worktreePath}</span> no longer exists.
        </div>
        <MenuItem disabled={!branch} onClick={() => void recreate()}>
          <RotateCcwIcon />
          <span className="min-w-0 truncate">
            {branch ? `Recreate worktree on ${branch}` : "Recreate worktree"}
          </span>
        </MenuItem>
        <MenuItem onClick={() => void continueInProjectFolder()}>
          <FolderIcon />
          <span className="min-w-0 truncate">Continue in project folder</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});

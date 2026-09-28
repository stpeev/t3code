import type { VcsCommit, VcsListCommitsResult } from "@t3tools/contracts";

import type { DiffPanelSelection } from "~/diffPanelStore";

/** One row of the Diff panel's Changes list. Selecting a row picks the diff the viewer shows. */
export type DiffChangesRow =
  | { readonly kind: "pinned"; readonly id: "pinned"; readonly label: string }
  | {
      readonly kind: "working-tree";
      readonly id: "working-tree";
      readonly fileCount: number;
      readonly additions: number;
      readonly deletions: number;
    }
  | {
      readonly kind: "commit";
      readonly id: string;
      readonly commit: VcsCommit;
      readonly onBranch: boolean;
    }
  | {
      readonly kind: "divider";
      readonly id: "divider";
      readonly baseRef: string;
      readonly mergeBaseShortSha: string | null;
      readonly upToDate: boolean;
    }
  | { readonly kind: "show-more"; readonly id: "show-more" };

export const commitRowId = (sha: string) => `commit:${sha}`;

/** A selection the list can't show (a turn, a commit off the branch) gets a pinned row to expand under. */
export function buildDiffChangesRows(input: {
  readonly workingTree: {
    readonly fileCount: number;
    readonly additions: number;
    readonly deletions: number;
  };
  readonly commits: VcsListCommitsResult | null;
  readonly pinnedLabel: string | null;
}): ReadonlyArray<DiffChangesRow> {
  const rows: DiffChangesRow[] = [];
  if (input.pinnedLabel !== null) {
    rows.push({ kind: "pinned", id: "pinned", label: input.pinnedLabel });
  }
  rows.push({ kind: "working-tree", id: "working-tree", ...input.workingTree });
  const commits = input.commits;
  if (!commits) return rows;
  for (const commit of commits.branchCommits) {
    rows.push({ kind: "commit", id: commitRowId(commit.sha), commit, onBranch: true });
  }
  if (commits.baseRef !== null) {
    const mergeBase = commits.contextCommits.find((commit) => commit.sha === commits.mergeBase);
    rows.push({
      kind: "divider",
      id: "divider",
      baseRef: commits.baseRef,
      mergeBaseShortSha: mergeBase?.shortSha ?? commits.mergeBase?.slice(0, 7) ?? null,
      upToDate: commits.branchCommits.length === 0,
    });
  }
  for (const commit of commits.contextCommits) {
    rows.push({ kind: "commit", id: commitRowId(commit.sha), commit, onBranch: false });
  }
  if (commits.hasMoreContext) rows.push({ kind: "show-more", id: "show-more" });
  return rows;
}

/** The row a selection lives on, matching an abbreviated commit sha by prefix. */
export function selectedDiffChangesRowId(
  selection: DiffPanelSelection,
  commits: VcsListCommitsResult | null,
): string | null {
  switch (selection.kind) {
    case "unstaged":
      return "working-tree";
    case "branch":
      return commits?.baseRef ? "divider" : null;
    case "turn":
      return "pinned";
    case "commit": {
      const listed = [...(commits?.branchCommits ?? []), ...(commits?.contextCommits ?? [])].find(
        (commit) => commit.sha.startsWith(selection.sha),
      );
      return listed ? commitRowId(listed.sha) : "pinned";
    }
  }
}

/** Rows a keyboard can land on; `show-more` is an action, not a diff. */
export function isSelectableDiffChangesRow(row: DiffChangesRow): boolean {
  return row.kind !== "show-more";
}

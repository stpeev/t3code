import type { VcsCommit, VcsListCommitsResult } from "@t3tools/contracts";
import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildDiffChangesRows, selectedDiffChangesRowId } from "./diffChanges.logic";

const commit = (sha: string, subject: string): VcsCommit => ({
  sha,
  shortSha: sha.slice(0, 7),
  subject,
  authorName: "Test",
  authoredAt: "2026-09-28T10:00:00Z",
  parentShas: [],
  unpushed: false,
});

const branchTip = commit("aaaaaaaaaaaa", "branch tip");
const branchFirst = commit("bbbbbbbbbbbb", "branch first");
const mergeBase = commit("cccccccccccc", "merge base");
const older = commit("dddddddddddd", "older");

const list = (overrides: Partial<VcsListCommitsResult> = {}): VcsListCommitsResult => ({
  baseRef: "origin/main",
  mergeBase: mergeBase.sha,
  hasRemote: true,
  branchCommits: [branchTip, branchFirst],
  branchCommitsTruncated: false,
  contextCommits: [mergeBase, older],
  hasMoreContext: true,
  ...overrides,
});

const workingTree = { fileCount: 2, additions: 5, deletions: 1 };

describe("buildDiffChangesRows", () => {
  it("puts the working tree first and the divider between branch and parent commits", () => {
    const rows = buildDiffChangesRows({ workingTree, commits: list(), pinnedLabel: null });

    expect(rows.map((row) => row.id)).toEqual([
      "working-tree",
      "branch-header",
      `commit:${branchTip.sha}`,
      `commit:${branchFirst.sha}`,
      "divider",
      `commit:${mergeBase.sha}`,
      `commit:${older.sha}`,
      "show-more",
    ]);
    expect(rows[1]).toMatchObject({ commitCount: 2, truncated: false, unpushedCount: 0 });
    expect(rows[4]).toMatchObject({ upToDate: false });
    expect(rows.filter((row) => row.kind === "commit").map((row) => row.onBranch)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("marks a branch with no commits of its own as up to date", () => {
    const rows = buildDiffChangesRows({
      workingTree,
      commits: list({ branchCommits: [], hasMoreContext: false }),
      pinnedLabel: null,
    });

    expect(rows.find((row) => row.kind === "divider")).toMatchObject({ upToDate: true });
    expect(rows.some((row) => row.kind === "branch-header")).toBe(false);
    expect(rows.at(-1)?.kind).toBe("commit");
  });

  it("omits the divider when no parent branch resolved", () => {
    const rows = buildDiffChangesRows({
      workingTree,
      commits: list({ baseRef: null, mergeBase: null, branchCommits: [] }),
      pinnedLabel: null,
    });

    expect(rows.some((row) => row.kind === "divider")).toBe(false);
  });

  it("pins a selection the list can't show above the working tree", () => {
    const rows = buildDiffChangesRows({ workingTree, commits: null, pinnedLabel: "Turn 3" });

    expect(rows.map((row) => row.id)).toEqual(["pinned", "working-tree"]);
  });
});

describe("selectedDiffChangesRowId", () => {
  it("maps each selection kind to its row", () => {
    const commits = list();
    expect(selectedDiffChangesRowId({ kind: "unstaged" }, commits)).toBe("working-tree");
    expect(selectedDiffChangesRowId({ kind: "branch", baseRef: null }, commits)).toBe("divider");
    expect(
      selectedDiffChangesRowId(
        { kind: "turn", turnId: RunId.make("turn-1"), filePath: null, revealRequestId: 0 },
        commits,
      ),
    ).toBe("pinned");
  });

  it("matches an abbreviated sha and falls back to the pinned row for unlisted commits", () => {
    const commits = list();
    expect(selectedDiffChangesRowId({ kind: "commit", sha: "bbbbbbb" }, commits)).toBe(
      `commit:${branchFirst.sha}`,
    );
    expect(selectedDiffChangesRowId({ kind: "commit", sha: "eeeeeee" }, commits)).toBe("pinned");
  });
});

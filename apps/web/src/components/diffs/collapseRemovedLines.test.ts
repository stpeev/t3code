import { DiffHunksRenderer, hydratePartialDiff, type FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { collapseRemovedLines } from "./collapseRemovedLines";

const OLD_FILE = ["a", "b", "old c", "old d", "e", "gone f", "g", "i"].join("\n") + "\n";
const NEW_FILE = ["a", "b", "new c", "e", "g", "added h", "i"].join("\n") + "\n";
const PATCH = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,8 +1,7 @@
 a
 b
-old c
-old d
+new c
 e
-gone f
 g
+added h
 i
`;

function parse(patch = PATCH) {
  return parsePatchFiles(patch)[0]!.files[0]!;
}

/** Rows as the renderer numbers them: counting from each hunk's start. */
function renderRows(fileDiff: FileDiffMetadata) {
  const rows: string[] = [];
  for (const hunk of fileDiff.hunks) {
    let additionLine = hunk.additionCount === 0 ? hunk.additionStart + 1 : hunk.additionStart;
    let deletionLine = hunk.deletionCount === 0 ? hunk.deletionStart + 1 : hunk.deletionStart;
    let additionIndex = fileDiff.isPartial ? hunk.additionLineIndex : additionLine - 1;
    let deletionIndex = fileDiff.isPartial ? hunk.deletionLineIndex : deletionLine - 1;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let index = 0; index < content.lines; index++) {
          const text = fileDiff.additionLines[additionIndex]!.trimEnd();
          expect(fileDiff.deletionLines[deletionIndex]!.trimEnd()).toBe(text);
          rows.push(`  ${deletionLine}/${additionLine} ${text}`);
          additionLine++;
          deletionLine++;
          additionIndex++;
          deletionIndex++;
        }
        continue;
      }
      for (let index = 0; index < content.deletions; index++) {
        rows.push(`- ${deletionLine++} ${fileDiff.deletionLines[deletionIndex++]!.trimEnd()}`);
      }
      for (let index = 0; index < content.additions; index++) {
        rows.push(`+ ${additionLine++} ${fileDiff.additionLines[additionIndex++]!.trimEnd()}`);
      }
    }
  }
  return rows;
}

describe("collapseRemovedLines", () => {
  it("hides removed runs while keeping both sides numbered", () => {
    const { fileDiff, runs } = collapseRemovedLines(parse(), new Set());

    expect(renderRows(fileDiff)).toEqual([
      "  1/1 a",
      "  2/2 b",
      "+ 3 new c",
      "  5/4 e",
      "  7/5 g",
      "+ 6 added h",
      "  8/7 i",
    ]);
    expect(runs).toEqual([
      { key: "0:1", lineCount: 2, expanded: false, side: "additions", lineNumber: 2 },
      { key: "0:3", lineCount: 1, expanded: false, side: "additions", lineNumber: 4 },
    ]);
    expect(fileDiff.unifiedLineCount).toBe(7);
    expect(fileDiff.hunks.reduce((total, hunk) => total + hunk.unifiedLineCount, 0)).toBe(7);
  });

  it("shows an expanded run in place and anchors it to its last removed line", () => {
    const { fileDiff, runs } = collapseRemovedLines(parse(), new Set(["0:3"]));

    expect(renderRows(fileDiff)).toEqual([
      "  1/1 a",
      "  2/2 b",
      "+ 3 new c",
      "  5/4 e",
      "- 6 gone f",
      "  7/5 g",
      "+ 6 added h",
      "  8/7 i",
    ]);
    expect(runs[1]).toEqual({
      key: "0:3",
      lineCount: 1,
      expanded: true,
      side: "deletions",
      lineNumber: 6,
    });
  });

  it("renders every fold state through the diff renderer", async () => {
    for (const expanded of [[], ["0:1"], ["0:3"], ["0:1", "0:3"]]) {
      const { fileDiff } = collapseRemovedLines(parse(), new Set(expanded));
      const result = await new DiffHunksRenderer({ diffStyle: "unified" }).asyncRender(fileDiff);

      expect(result?.rowCount).toBe(fileDiff.unifiedLineCount);
    }
  });

  it("renders every fold state after the renderer loads the full files", async () => {
    for (const expanded of [[], ["0:1"], ["0:3"], ["0:1", "0:3"]]) {
      const { fileDiff } = collapseRemovedLines(parse(), new Set(expanded));
      const hydrated = hydratePartialDiff("clone", fileDiff, {
        oldFile: { name: "x.ts", contents: OLD_FILE },
        newFile: { name: "x.ts", contents: NEW_FILE },
      });
      const result = await new DiffHunksRenderer({ diffStyle: "unified" }).asyncRender(hydrated);

      expect(renderRows(hydrated)).toEqual(renderRows(fileDiff));
      expect(result?.rowCount).toBe(fileDiff.unifiedLineCount);
    }
  });

  it("leaves a diff with loaded file contents unfolded", () => {
    const hydrated = hydratePartialDiff("clone", parse(), {
      oldFile: { name: "x.ts", contents: OLD_FILE },
      newFile: { name: "x.ts", contents: NEW_FILE },
    });

    expect(collapseRemovedLines(hydrated, new Set())).toEqual({ fileDiff: hydrated, runs: [] });
  });

  it("leaves a run with no new-file line above it in place", () => {
    const patch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,3 @@
-old a
+new a
 b
 c
`;
    const source = parse(patch);
    const { fileDiff, runs } = collapseRemovedLines(source, new Set());

    expect(runs).toEqual([]);
    expect(fileDiff).toBe(source);
  });

  it("leaves a run that ends its hunk in place, so both file sides still end together", () => {
    const patch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,4 +1,3 @@
 a
 b
 c
-gone
`;
    const source = parse(patch);
    const { fileDiff, runs } = collapseRemovedLines(source, new Set());

    expect(runs).toEqual([]);
    expect(fileDiff).toBe(source);
  });

  it("returns the same diff object until the expanded runs change", () => {
    const source = parse();
    const first = collapseRemovedLines(source, new Set(["0:1"]));

    expect(collapseRemovedLines(source, new Set(["0:1"]))).toBe(first);
    expect(collapseRemovedLines(source, new Set())).not.toBe(first);
  });

  it("gives each fold state its own render cache key", () => {
    const source = { ...parse(), cacheKey: "x.ts:abc" };
    const keys = [new Set<string>(), new Set(["0:1"]), new Set(["0:1", "0:3"])].map(
      (expanded) => collapseRemovedLines(source, expanded).fileDiff.cacheKey,
    );

    expect(new Set([...keys, source.cacheKey]).size).toBe(4);
  });
});

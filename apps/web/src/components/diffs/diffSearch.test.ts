import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import {
  diffSearchLineKey,
  findDiffMatches,
  firstMatchIndexFrom,
  indexDiffMatchesByLine,
  locateTextColumns,
  MAX_DIFF_SEARCH_MATCHES,
} from "./diffSearch";

function parse(id: string, patch: string) {
  return { id, fileDiff: parsePatchFiles(patch)[0]!.files[0]! };
}

const USER_PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -10,4 +10,4 @@
 const user = 1;
-old User user
+new User
 end
@@ -40,2 +40,3 @@
 tail
+user again
 done
`;

describe("findDiffMatches", () => {
  it("orders matches as the viewer renders them and numbers lines per side", () => {
    const { matches } = findDiffMatches([parse("a", USER_PATCH)], "user");
    expect(matches).toEqual([
      { fileId: "a", side: "additions", lineNumber: 10, contextLineNumber: 10, start: 6, end: 10 },
      { fileId: "a", side: "deletions", lineNumber: 11, start: 4, end: 8 },
      { fileId: "a", side: "deletions", lineNumber: 11, start: 9, end: 13 },
      { fileId: "a", side: "additions", lineNumber: 11, start: 4, end: 8 },
      { fileId: "a", side: "additions", lineNumber: 41, start: 0, end: 4 },
    ]);
  });

  it("matches case exactly once the query has an uppercase letter", () => {
    const { matches } = findDiffMatches([parse("a", USER_PATCH)], "User");
    expect(matches.map((match) => [match.side, match.lineNumber])).toEqual([
      ["deletions", 11],
      ["additions", 11],
    ]);
  });

  it("counts a context line once even though split view shows it on both sides", () => {
    const { matches } = findDiffMatches([parse("a", USER_PATCH)], "const");
    expect(matches).toHaveLength(1);
    const lines = indexDiffMatchesByLine(matches).get("a")!;
    expect(lines.get(diffSearchLineKey("additions", 10))).toEqual([0]);
    expect(lines.get(diffSearchLineKey("deletions", 10))).toEqual([0]);
  });

  it("finds nothing for an empty query or in a placeholder file without hunks", () => {
    const placeholder = { id: "p", fileDiff: { ...parse("p", USER_PATCH).fileDiff, hunks: [] } };
    expect(findDiffMatches([parse("a", USER_PATCH)], "").matches).toEqual([]);
    expect(findDiffMatches([placeholder], "user").matches).toEqual([]);
  });

  it("stops at the match cap and reports the result as truncated", () => {
    const lines = Array.from({ length: MAX_DIFF_SEARCH_MATCHES + 1 }, () => "+x");
    const patch = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -0,0 +1,${lines.length} @@
${lines.join("\n")}
`;
    const result = findDiffMatches([parse("b", patch)], "x");
    expect(result.matches).toHaveLength(MAX_DIFF_SEARCH_MATCHES);
    expect(result.truncated).toBe(true);
  });
});

describe("locateTextColumns", () => {
  it("spans a match across several token text nodes", () => {
    // "con" + "st u" + "ser"
    expect(locateTextColumns([3, 4, 3], 2, 8)).toEqual({
      start: { node: 0, offset: 2 },
      end: { node: 2, offset: 1 },
    });
  });

  it("skips empty text nodes and lands a boundary start in the following node", () => {
    expect(locateTextColumns([3, 0, 4], 3, 5)).toEqual({
      start: { node: 2, offset: 0 },
      end: { node: 2, offset: 2 },
    });
  });

  it("returns null when the rendered text is shorter than the match", () => {
    expect(locateTextColumns([3], 1, 6)).toBeNull();
  });
});

describe("firstMatchIndexFrom", () => {
  it("starts from the first match at or after the file in view", () => {
    const matches = findDiffMatches(
      [parse("a", USER_PATCH), parse("b", USER_PATCH.replaceAll("a.ts", "b.ts"))],
      "done",
    ).matches;
    const order = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    expect(firstMatchIndexFrom(matches, order, "b")).toBe(1);
    expect(firstMatchIndexFrom(matches, order, null)).toBe(0);
    expect(firstMatchIndexFrom([], order, "a")).toBe(-1);
  });
});

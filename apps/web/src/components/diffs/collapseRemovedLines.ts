import type { FileDiffMetadata, Hunk } from "@pierre/diffs";

export interface RemovedLineRun {
  /** `hunkIndex:contentIndex` of the change in the source diff. */
  readonly key: string;
  readonly lineCount: number;
  readonly expanded: boolean;
  /** Collapsed runs sit after a new-file line; expanded runs end at their last old-file line. */
  readonly side: "additions" | "deletions";
  readonly lineNumber: number;
}

export interface CollapsedRemovedLines {
  readonly fileDiff: FileDiffMetadata;
  readonly runs: ReadonlyArray<RemovedLineRun>;
}

interface Cursor {
  additionLine: number;
  deletionLine: number;
  additionIndex: number;
  unifiedRow: number;
  splitRow: number;
}

const cache = new WeakMap<FileDiffMetadata, { signature: string; result: CollapsedRemovedLines }>();

/** Drops each run of removed lines unless `expandedKeys` names it. Takes patch-parsed diffs; the renderer
 * loads full files into the result itself, which needs our `@pierre/diffs` patch to highlight around gaps. */
export function collapseRemovedLines(
  fileDiff: FileDiffMetadata,
  expandedKeys: ReadonlySet<string>,
): CollapsedRemovedLines {
  if (!fileDiff.isPartial) return { fileDiff, runs: [] };
  const signature = [...expandedKeys].toSorted().join(",");
  const cached = cache.get(fileDiff);
  if (cached?.signature === signature) return cached.result;
  const result = buildCollapsedDiff(fileDiff, expandedKeys, signature);
  cache.set(fileDiff, { signature, result });
  return result;
}

function buildCollapsedDiff(
  fileDiff: FileDiffMetadata,
  expandedKeys: ReadonlySet<string>,
  signature: string,
): CollapsedRemovedLines {
  const runs: RemovedLineRun[] = [];
  const hunks: Hunk[] = [];
  const deletionLines: string[] = [];
  let removedUnifiedRows = 0;
  let removedSplitRows = 0;
  const keepDeletions = (from: number, count: number) => {
    deletionLines.push(...fileDiff.deletionLines.slice(from, from + count));
  };

  for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
    const cursor: Cursor = {
      additionLine: hunk.additionCount === 0 ? hunk.additionStart + 1 : hunk.additionStart,
      deletionLine: hunk.deletionCount === 0 ? hunk.deletionStart + 1 : hunk.deletionStart,
      additionIndex: hunk.additionLineIndex,
      unifiedRow: hunk.unifiedLineStart - removedUnifiedRows,
      splitRow: hunk.splitLineStart - removedSplitRows,
    };
    const segments: Hunk[] = [];
    let segment = openSegment(hunk, cursor, deletionLines.length, true);

    for (const [contentIndex, content] of hunk.hunkContent.entries()) {
      if (content.type === "context") {
        segment.hunkContent.push({
          ...content,
          additionLineIndex: cursor.additionIndex,
          deletionLineIndex: deletionLines.length,
        });
        keepDeletions(content.deletionLineIndex, content.lines);
        segment.additionCount += content.lines;
        segment.deletionCount += content.lines;
        advance(cursor, content.lines, content.lines, content.lines, content.lines);
        continue;
      }

      const key = `${hunkIndex}:${contentIndex}`;
      // A run needs a rendered new-file line above it to anchor its bar, and rows after it so
      // both sides of the hunk still end on the same line.
      const collapsible =
        content.deletions > 0 &&
        segment.additionCount > 0 &&
        contentIndex < hunk.hunkContent.length - 1;
      if (collapsible && !expandedKeys.has(key)) {
        runs.push({
          key,
          lineCount: content.deletions,
          expanded: false,
          side: "additions",
          lineNumber: cursor.additionLine - 1,
        });
        segments.push(closeSegment(segment, cursor));
        cursor.deletionLine += content.deletions;
        removedUnifiedRows += content.deletions;
        removedSplitRows += Math.max(content.deletions, content.additions) - content.additions;
        segment = openSegment(hunk, cursor, deletionLines.length, false);
        if (content.additions > 0) {
          segment.hunkContent.push({
            type: "change",
            deletions: 0,
            deletionLineIndex: deletionLines.length,
            additions: content.additions,
            additionLineIndex: cursor.additionIndex,
          });
          segment.additionCount += content.additions;
          segment.additionLines += content.additions;
          advance(cursor, content.additions, 0, content.additions, content.additions);
        }
        continue;
      }

      if (collapsible) {
        runs.push({
          key,
          lineCount: content.deletions,
          expanded: true,
          side: "deletions",
          lineNumber: cursor.deletionLine + content.deletions - 1,
        });
      }
      segment.hunkContent.push({
        ...content,
        additionLineIndex: cursor.additionIndex,
        deletionLineIndex: deletionLines.length,
      });
      keepDeletions(content.deletionLineIndex, content.deletions);
      segment.additionCount += content.additions;
      segment.deletionCount += content.deletions;
      segment.additionLines += content.additions;
      segment.deletionLines += content.deletions;
      advance(
        cursor,
        content.additions,
        content.deletions,
        content.additions + content.deletions,
        Math.max(content.additions, content.deletions),
      );
    }

    segments.push(closeSegment(segment, cursor));
    const last = segments.at(-1)!;
    last.noEOFCRAdditions = hunk.noEOFCRAdditions;
    last.noEOFCRDeletions = hunk.noEOFCRDeletions;
    hunks.push(...segments);
  }

  if (runs.length === 0) return { fileDiff, runs };
  return {
    fileDiff: {
      ...fileDiff,
      hunks,
      deletionLines,
      deletionCharacterCount: deletionLines.reduce((total, line) => total + line.length, 0),
      unifiedLineCount: fileDiff.unifiedLineCount - removedUnifiedRows,
      splitLineCount: fileDiff.splitLineCount - removedSplitRows,
      // The renderer reuses highlighted rows by cache key, so each fold state needs its own.
      ...(fileDiff.cacheKey === undefined
        ? {}
        : { cacheKey: `${fileDiff.cacheKey}:removed:${signature}` }),
    },
    runs,
  };
}

function openSegment(hunk: Hunk, cursor: Cursor, deletionIndex: number, first: boolean): Hunk {
  const { hunkContext, hunkSpecs, ...rest } = hunk;
  return {
    ...rest,
    ...(first && hunkContext !== undefined ? { hunkContext } : {}),
    ...(first && hunkSpecs !== undefined ? { hunkSpecs } : {}),
    collapsedBefore: first ? hunk.collapsedBefore : 0,
    hunkContent: [],
    additionStart: cursor.additionLine,
    deletionStart: cursor.deletionLine,
    additionLineIndex: cursor.additionIndex,
    deletionLineIndex: deletionIndex,
    additionCount: 0,
    deletionCount: 0,
    additionLines: 0,
    deletionLines: 0,
    unifiedLineStart: cursor.unifiedRow,
    splitLineStart: cursor.splitRow,
    unifiedLineCount: 0,
    splitLineCount: 0,
    noEOFCRAdditions: false,
    noEOFCRDeletions: false,
  };
}

function closeSegment(segment: Hunk, cursor: Cursor): Hunk {
  segment.unifiedLineCount = cursor.unifiedRow - segment.unifiedLineStart;
  segment.splitLineCount = cursor.splitRow - segment.splitLineStart;
  // Git numbers an empty side from the line before it.
  if (segment.additionCount === 0) segment.additionStart -= 1;
  if (segment.deletionCount === 0) segment.deletionStart -= 1;
  return segment;
}

function advance(
  cursor: Cursor,
  additions: number,
  deletions: number,
  unifiedRows: number,
  splitRows: number,
) {
  cursor.additionLine += additions;
  cursor.additionIndex += additions;
  cursor.deletionLine += deletions;
  cursor.unifiedRow += unifiedRows;
  cursor.splitRow += splitRows;
}

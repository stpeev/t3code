import type { FileDiffMetadata } from "@pierre/diffs";

export type DiffSearchSide = "additions" | "deletions";

export interface DiffSearchFile {
  readonly id: string;
  readonly fileDiff: FileDiffMetadata;
}

export interface DiffSearchMatch {
  readonly fileId: string;
  readonly side: DiffSearchSide;
  readonly lineNumber: number;
  /** Deletion-side number of a context line, which split view renders a second time. */
  readonly contextLineNumber?: number;
  readonly start: number;
  readonly end: number;
}

export interface DiffSearchResult {
  readonly matches: ReadonlyArray<DiffSearchMatch>;
  readonly truncated: boolean;
}

export const MAX_DIFF_SEARCH_MATCHES = 5000;

const EMPTY_RESULT: DiffSearchResult = { matches: [], truncated: false };

/** Smart case: a query with any uppercase letter matches case exactly. */
export function isCaseSensitiveQuery(query: string): boolean {
  return query !== query.toLowerCase();
}

/** Finds matches in viewer order: files, then hunks, with deletions before additions per change. */
export function findDiffMatches(
  files: ReadonlyArray<DiffSearchFile>,
  query: string,
): DiffSearchResult {
  if (query.length === 0) return EMPTY_RESULT;
  const caseSensitive = isCaseSensitiveQuery(query);
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: DiffSearchMatch[] = [];

  const scanLine = (
    fileId: string,
    side: DiffSearchSide,
    text: string | undefined,
    lineNumber: number,
    contextLineNumber?: number,
  ) => {
    if (text === undefined) return true;
    const haystack = caseSensitive ? text : text.toLowerCase();
    let start = haystack.indexOf(needle);
    while (start >= 0) {
      if (matches.length >= MAX_DIFF_SEARCH_MATCHES) return false;
      matches.push({
        fileId,
        side,
        lineNumber,
        ...(contextLineNumber === undefined ? {} : { contextLineNumber }),
        start,
        end: start + needle.length,
      });
      start = haystack.indexOf(needle, start + needle.length);
    }
    return true;
  };

  for (const { id, fileDiff } of files) {
    const { additionLines, deletionLines } = fileDiff;
    for (const hunk of fileDiff.hunks) {
      const additionNumber = (index: number) => hunk.additionStart + index - hunk.additionLineIndex;
      const deletionNumber = (index: number) => hunk.deletionStart + index - hunk.deletionLineIndex;
      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          for (let offset = 0; offset < content.lines; offset += 1) {
            const additionIndex = content.additionLineIndex + offset;
            const deletionIndex = content.deletionLineIndex + offset;
            const scanned = scanLine(
              id,
              "additions",
              additionLines[additionIndex],
              additionNumber(additionIndex),
              deletionNumber(deletionIndex),
            );
            if (!scanned) return { matches, truncated: true };
          }
          continue;
        }
        for (let offset = 0; offset < content.deletions; offset += 1) {
          const index = content.deletionLineIndex + offset;
          if (!scanLine(id, "deletions", deletionLines[index], deletionNumber(index))) {
            return { matches, truncated: true };
          }
        }
        for (let offset = 0; offset < content.additions; offset += 1) {
          const index = content.additionLineIndex + offset;
          if (!scanLine(id, "additions", additionLines[index], additionNumber(index))) {
            return { matches, truncated: true };
          }
        }
      }
    }
  }
  return { matches, truncated: false };
}

export function diffSearchLineKey(side: DiffSearchSide, lineNumber: number): string {
  return `${side}:${lineNumber}`;
}

/** Indexes each file's matches by rendered line, so painting only visits mounted rows. */
export function indexDiffMatchesByLine(
  matches: ReadonlyArray<DiffSearchMatch>,
): Map<string, Map<string, number[]>> {
  const byFile = new Map<string, Map<string, number[]>>();
  const add = (fileId: string, key: string, index: number) => {
    let lines = byFile.get(fileId);
    if (!lines) {
      lines = new Map();
      byFile.set(fileId, lines);
    }
    const indices = lines.get(key);
    if (indices) indices.push(index);
    else lines.set(key, [index]);
  };
  matches.forEach((match, index) => {
    add(match.fileId, diffSearchLineKey(match.side, match.lineNumber), index);
    if (match.contextLineNumber !== undefined) {
      add(match.fileId, diffSearchLineKey("deletions", match.contextLineNumber), index);
    }
  });
  return byFile;
}

export interface TextColumnPosition {
  readonly node: number;
  readonly offset: number;
}

/** Maps a column range onto consecutive text nodes; a match can span several token spans. */
export function locateTextColumns(
  lengths: ReadonlyArray<number>,
  start: number,
  end: number,
): { start: TextColumnPosition; end: TextColumnPosition } | null {
  let startPosition: TextColumnPosition | null = null;
  let consumed = 0;
  for (let node = 0; node < lengths.length; node += 1) {
    const length = lengths[node]!;
    if (startPosition === null && start < consumed + length) {
      startPosition = { node, offset: start - consumed };
    }
    if (startPosition !== null && end <= consumed + length) {
      return { start: startPosition, end: { node, offset: end - consumed } };
    }
    consumed += length;
  }
  return null;
}

/** First match at or after a file position, so a new query keeps the reader where they are. */
export function firstMatchIndexFrom(
  matches: ReadonlyArray<DiffSearchMatch>,
  fileOrder: ReadonlyMap<string, number>,
  fileId: string | null,
): number {
  if (matches.length === 0) return -1;
  if (fileId === null) return 0;
  const target = fileOrder.get(fileId) ?? 0;
  const index = matches.findIndex((match) => (fileOrder.get(match.fileId) ?? 0) >= target);
  return index < 0 ? 0 : index;
}

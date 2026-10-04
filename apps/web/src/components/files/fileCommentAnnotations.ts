import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";

export interface FileCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  startLine: number;
  endLine: number;
  text: string;
}

export interface FileCommentAnnotationGroup {
  entries: FileCommentAnnotationEntry[];
}

export type FileCommentLineAnnotation = LineAnnotation<FileCommentAnnotationGroup>;

let fileCommentSequence = 0;

export function nextFileCommentId(): string {
  fileCommentSequence += 1;
  return `file-comment-${Date.now()}-${fileCommentSequence}`;
}

export function normalizeFileCommentRange(range: SelectedLineRange): {
  startLine: number;
  endLine: number;
} {
  return {
    startLine: Math.min(range.start, range.end),
    endLine: Math.max(range.start, range.end),
  };
}

export function formatFileCommentRange(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`;
}

/** Groups entries into one annotation per end line, keeping each line's entries in input order. */
export function groupFileCommentEntries(
  entries: ReadonlyArray<FileCommentAnnotationEntry>,
): FileCommentLineAnnotation[] {
  const byLine = new Map<number, FileCommentAnnotationEntry[]>();
  for (const entry of entries) {
    const lineEntries = byLine.get(entry.endLine);
    if (lineEntries) lineEntries.push(entry);
    else byLine.set(entry.endLine, [entry]);
  }
  return Array.from(byLine, ([lineNumber, lineEntries]) => ({
    lineNumber,
    metadata: { entries: lineEntries },
  }));
}

export function remapFileCommentAnnotations(
  annotations: ReadonlyArray<FileCommentLineAnnotation>,
): FileCommentLineAnnotation[] {
  return annotations.map((annotation) => ({
    ...annotation,
    metadata: {
      entries: annotation.metadata.entries.map((entry) => {
        const lineCount = entry.endLine - entry.startLine;
        return {
          ...entry,
          endLine: annotation.lineNumber,
          startLine: Math.max(1, annotation.lineNumber - lineCount),
        };
      }),
    },
  }));
}

import type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

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

export function formatFileCommentRange(
  startLine: number,
  endLine: number,
  resolve: MessageResolver = m,
): string {
  return startLine === endLine
    ? `L${startLine}`
    : resolve(msg("L{start} to L{end}", { start: String(startLine), end: String(endLine) }));
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

/** Drafts and the comments still in the prompt; sent or removed ones are not shown or re-added. */
export function promptFileCommentEntries(
  entries: ReadonlyArray<FileCommentAnnotationEntry>,
  promptCommentIds: ReadonlySet<string>,
): FileCommentAnnotationEntry[] {
  return entries.filter((entry) => entry.kind === "draft" || promptCommentIds.has(entry.id));
}

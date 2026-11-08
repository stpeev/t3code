/**
 * A fenced `mermaid` code block found inside a text file. `startLine`/`endLine`
 * are 1-based inclusive line numbers of the block's contents, so a comment
 * anchored to a diagram section can point back at the file.
 */
export interface MermaidCodeBlock {
  readonly source: string;
  readonly startLine: number;
  readonly endLine: number;
}

// JS/TS doc comments keep the fence after a leading `*` or `//`.
const FENCE_OPEN = /^(?:\s*(?:\*|\/\/)?\s*)(`{3,}|~{3,})[ \t]*mermaid(?:[ \t][^\n]*)?$/i;
// A closing fence is bare: same character, at least as long, no info string.
const FENCE_CLOSE = /^(?:\s*(?:\*|\/\/)?\s*)(`{3,}|~{3,})\s*$/;
// Doc-comment continuation prefix on a content line; mermaid ignores indentation.
const COMMENT_PREFIX = /^\s*(?:\*|\/\/)?\s*/;

/**
 * Extracts fenced mermaid code blocks from arbitrary text, such as the JSDoc
 * comments of a JS/TS file. Unclosed blocks are ignored; a fence closes only on
 * a fence of the same character and at least as many ticks.
 */
export function extractMermaidCodeBlocks(text: string): MermaidCodeBlock[] {
  const lines = text.split("\n");
  const blocks: MermaidCodeBlock[] = [];
  let open: { fence: string; startLine: number; body: string[] } | null = null;
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (open === null) {
      const fence = FENCE_OPEN.exec(line)?.[1];
      if (fence) open = { fence, startLine: lineNumber, body: [] };
      continue;
    }
    const closeFence = FENCE_CLOSE.exec(line)?.[1];
    if (closeFence && closeFence[0] === open.fence[0] && closeFence.length >= open.fence.length) {
      blocks.push({
        source: open.body.map((bodyLine) => bodyLine.replace(COMMENT_PREFIX, "")).join("\n"),
        startLine: open.startLine + 1,
        endLine: open.startLine + open.body.length,
      });
      open = null;
      continue;
    }
    open.body.push(line);
  }
  return blocks;
}

/**
 * Mermaid ignores leading indentation, so two renderings of the same block can
 * differ in per-line whitespace (doc-comment prefixes vs. fenced markdown).
 * Compares blocks line-wise, trimmed.
 */
export function mermaidSourcesMatch(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value
      .split("\n")
      .map((line) => line.replace(COMMENT_PREFIX, "").trim())
      .join("\n")
      .trim();
  return normalize(a) === normalize(b);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Best-effort source lines defining a diagram section (a node, edge or subgraph
 * id). Falls back to the enclosing block range when the id never appears in the
 * source, as happens with generated edge ids.
 */
export function findDiagramSectionLines(input: {
  readonly contents: string;
  readonly sectionId: string;
  readonly blockStartLine: number;
  readonly blockEndLine: number;
}): { startLine: number; endLine: number } {
  const { contents, sectionId, blockStartLine, blockEndLine } = input;
  if (sectionId.length === 0) {
    return { startLine: blockStartLine, endLine: Math.max(blockStartLine, blockEndLine) };
  }
  const pattern = new RegExp(`(^|[^A-Za-z0-9_"'-])${escapeRegExp(sectionId)}(?![A-Za-z0-9_])`);
  const lines = contents.split("\n");
  const from = Math.max(1, blockStartLine) - 1;
  const to = Math.min(lines.length, Math.max(blockStartLine, blockEndLine));
  for (const [index, line] of lines.entries()) {
    if (index >= from && index < to && pattern.test(line)) {
      return { startLine: index + 1, endLine: index + 1 };
    }
  }
  // Search the whole file before falling back to the block, so a node defined
  // outside the scanned range still anchors somewhere sensible.
  for (const [index, line] of lines.entries()) {
    if (index >= from && index < to) continue;
    if (pattern.test(line)) {
      return { startLine: index + 1, endLine: index + 1 };
    }
  }
  return { startLine: blockStartLine, endLine: Math.max(blockStartLine, blockEndLine) };
}

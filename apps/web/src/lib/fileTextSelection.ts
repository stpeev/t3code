/**
 * Maps text selected in a rendered document back to 1-based line numbers in the
 * source file. Rendered markdown collapses whitespace, so both sides are compared
 * with whitespace normalized to single spaces; each normalized character keeps the
 * source line it came from.
 */
export function findTextLineRange(
  contents: string,
  selected: string,
): { startLine: number; endLine: number } | null {
  const needle = selected.replace(/\s+/g, " ").trim();
  if (needle.length === 0) return null;
  const lines = contents.split("\n");
  let haystack = "";
  const lineOf: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      haystack += " ";
      lineOf.push(index + 1);
    }
    for (const character of line.replace(/\s+/g, " ")) {
      haystack += character;
      lineOf.push(index + 1);
    }
  }
  const start = haystack.indexOf(needle);
  if (start < 0) return null;
  const end = start + needle.length - 1;
  return { startLine: lineOf[start]!, endLine: lineOf[end]! };
}

export function formatTextLineRange(range: { startLine: number; endLine: number }): string {
  return range.startLine === range.endLine
    ? `L${range.startLine}`
    : `L${range.startLine} to L${range.endLine}`;
}

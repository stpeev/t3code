import { findThreadSearchOccurrences } from "@t3tools/shared/threadSearch";
import { THREAD_FIND_BLOCK_TAGS } from "@t3tools/shared/threadFindText";

/** Subtrees that never hold searchable rendered text; the find bar marks itself with the attribute. */
const MARKDOWN_FIND_SKIP_SELECTOR =
  "script, style, svg, noscript, template, [data-markdown-find-ignore]";

/**
 * Collect document-order ranges matching `query` inside a rendered markdown container.
 * Inline wrappers (bold, links, code spans) do not split a match; block elements do.
 */
export function collectMarkdownFindRanges(container: HTMLElement, query: string): Range[] {
  if (query.length === 0) return [];

  const ranges: Range[] = [];
  let text = "";
  let nodes: { node: Node; start: number; end: number }[] = [];
  const flush = () => {
    let startIndex = 0;
    let endIndex = 0;
    for (const offset of findThreadSearchOccurrences(text, query)) {
      while (startIndex < nodes.length && nodes[startIndex]!.end <= offset) startIndex++;
      if (endIndex < startIndex) endIndex = startIndex;
      while (endIndex < nodes.length && nodes[endIndex]!.end < offset + query.length) endIndex++;
      const start = nodes[startIndex];
      const end = nodes[endIndex];
      if (!start || !end) continue;
      const range = container.ownerDocument.createRange();
      range.setStart(start.node, offset - start.start);
      range.setEnd(end.node, offset + query.length - end.start);
      ranges.push(range);
    }
    text = "";
    nodes = [];
  };
  const visit = (node: Node, inPre = false) => {
    const element = node.nodeType === 1 ? (node as Element) : null;
    if (element?.matches(MARKDOWN_FIND_SKIP_SELECTOR)) return;
    const tag = element?.tagName.toLowerCase() ?? "";
    const block = THREAD_FIND_BLOCK_TAGS.has(tag);
    if (block) flush();
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? "";
      const start = text.length;
      text += inPre ? value : value.replace(/\r?\n/g, " ");
      nodes.push({ node, start, end: text.length });
    }
    for (const child of node.childNodes) visit(child, inPre || tag === "pre");
    if (block) flush();
  };
  visit(container);
  flush();
  return ranges;
}

export function stepMarkdownFindIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  const from = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (from + delta + count) % count;
}

/** The first match at or below the scroll container's top edge; wraps to the first match. */
export function firstMarkdownFindIndexAfterScroll(
  ranges: readonly Range[],
  scrollContainer: HTMLElement | null,
): number {
  if (ranges.length === 0) return -1;
  if (!scrollContainer) return 0;
  const top = scrollContainer.getBoundingClientRect().top + 8;
  for (let index = 0; index < ranges.length; index += 1) {
    if (ranges[index]!.getBoundingClientRect().bottom >= top) return index;
  }
  return 0;
}

import {
  diffSearchLineKey,
  locateTextColumns,
  type DiffSearchMatch,
  type DiffSearchSide,
} from "./diffSearch";

const MATCH_HIGHLIGHT = "t3-diff-search";
const ACTIVE_HIGHLIGHT = "t3-diff-search-active";

/** `::highlight()` rules only reach text inside the viewer when they live in its shadow root. */
export const DIFF_SEARCH_UNSAFE_CSS = `
::highlight(${MATCH_HIGHLIGHT}) {
  background-color: light-dark(rgb(234 179 8 / 0.32), rgb(234 179 8 / 0.3));
}

::highlight(${ACTIVE_HIGHLIGHT}) {
  background-color: light-dark(rgb(249 115 22 / 0.55), rgb(249 115 22 / 0.6));
}
`;

export function supportsDiffSearchHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

function sharedHighlight(name: string, priority: number): Highlight {
  const existing = CSS.highlights.get(name);
  if (existing) return existing;
  const highlight = new Highlight();
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
  return highlight;
}

function rowSide(row: HTMLElement): DiffSearchSide {
  const column = row.closest("[data-code]");
  if (column?.hasAttribute("data-deletions")) return "deletions";
  if (column?.hasAttribute("data-additions")) return "additions";
  return row.dataset.lineType === "change-deletion" ? "deletions" : "additions";
}

function textNodesOf(row: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** Owns one viewer's ranges inside the page-wide highlight registry. */
export function createDiffSearchHighlighter() {
  const rangesByFile = new Map<string, Range[]>();

  const clearFile = (fileId: string) => {
    const ranges = rangesByFile.get(fileId);
    if (!ranges) return;
    rangesByFile.delete(fileId);
    const matchHighlight = CSS.highlights.get(MATCH_HIGHLIGHT);
    const activeHighlight = CSS.highlights.get(ACTIVE_HIGHLIGHT);
    for (const range of ranges) {
      matchHighlight?.delete(range);
      activeHighlight?.delete(range);
    }
  };

  const paintFile = (
    fileId: string,
    container: HTMLElement,
    lines: ReadonlyMap<string, ReadonlyArray<number>> | undefined,
    matches: ReadonlyArray<DiffSearchMatch>,
    activeIndex: number,
  ) => {
    clearFile(fileId);
    const root = container.shadowRoot;
    if (!lines || !root || !supportsDiffSearchHighlights()) return;
    const matchHighlight = sharedHighlight(MATCH_HIGHLIGHT, 0);
    const activeHighlight = sharedHighlight(ACTIVE_HIGHLIGHT, 1);
    const ranges: Range[] = [];
    for (const row of root.querySelectorAll<HTMLElement>("[data-content] [data-line]")) {
      const indices = lines.get(diffSearchLineKey(rowSide(row), Number(row.dataset.line)));
      if (!indices) continue;
      const nodes = textNodesOf(row);
      const lengths = nodes.map((node) => node.data.length);
      for (const index of indices) {
        const match = matches[index];
        const located = match && locateTextColumns(lengths, match.start, match.end);
        if (!located) continue;
        const range = new Range();
        range.setStart(nodes[located.start.node]!, located.start.offset);
        range.setEnd(nodes[located.end.node]!, located.end.offset);
        (index === activeIndex ? activeHighlight : matchHighlight).add(range);
        ranges.push(range);
      }
    }
    if (ranges.length > 0) rangesByFile.set(fileId, ranges);
  };

  const clear = () => {
    for (const fileId of rangesByFile.keys()) clearFile(fileId);
  };

  return { paintFile, clearFile, clear };
}

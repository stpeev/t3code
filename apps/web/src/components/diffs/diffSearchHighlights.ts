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

type HighlightWindow = Window & typeof globalThis;

// Each window paints only its own registry, so a viewer in the popout must use the popout's.
function highlightWindowOf(container: HTMLElement): HighlightWindow | null {
  const view = container.ownerDocument.defaultView as HighlightWindow | null;
  if (!view || typeof view.Highlight === "undefined" || !view.CSS?.highlights) return null;
  return view;
}

function sharedHighlight(view: HighlightWindow, name: string, priority: number): Highlight {
  const existing = view.CSS.highlights.get(name);
  if (existing) return existing;
  const highlight = new view.Highlight();
  highlight.priority = priority;
  view.CSS.highlights.set(name, highlight);
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
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** Owns one viewer's ranges inside the page-wide highlight registry. */
export function createDiffSearchHighlighter() {
  const rangesByFile = new Map<string, { view: HighlightWindow; ranges: Range[] }>();

  const clearFile = (fileId: string) => {
    const painted = rangesByFile.get(fileId);
    if (!painted) return;
    rangesByFile.delete(fileId);
    const { view, ranges } = painted;
    if (view.closed) return;
    const matchHighlight = view.CSS.highlights.get(MATCH_HIGHLIGHT);
    const activeHighlight = view.CSS.highlights.get(ACTIVE_HIGHLIGHT);
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
    const view = highlightWindowOf(container);
    if (!lines || !root || !view) return;
    const matchHighlight = sharedHighlight(view, MATCH_HIGHLIGHT, 0);
    const activeHighlight = sharedHighlight(view, ACTIVE_HIGHLIGHT, 1);
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
        const range = row.ownerDocument.createRange();
        range.setStart(nodes[located.start.node]!, located.start.offset);
        range.setEnd(nodes[located.end.node]!, located.end.offset);
        (index === activeIndex ? activeHighlight : matchHighlight).add(range);
        ranges.push(range);
      }
    }
    if (ranges.length > 0) rangesByFile.set(fileId, { view, ranges });
  };

  const clear = () => {
    for (const fileId of rangesByFile.keys()) clearFile(fileId);
  };

  return { paintFile, clearFile, clear };
}

import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  collectMarkdownFindRanges,
  firstMarkdownFindIndexAfterScroll,
  stepMarkdownFindIndex,
} from "./markdownFind";

const HIGHLIGHT_NAME = "t3-markdown-find";
const ACTIVE_HIGHLIGHT_NAME = "t3-markdown-find-active";

function highlightsSupported(): boolean {
  return (
    typeof CSS !== "undefined" && CSS.highlights !== undefined && typeof Highlight !== "undefined"
  );
}

function paintHighlights(ranges: readonly Range[], activeIndex: number): void {
  if (!highlightsSupported()) return;
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  const active = activeIndex >= 0 && activeIndex < ranges.length ? ranges[activeIndex] : undefined;
  CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(...(active ? [active] : [])));
}

function clearHighlights(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_NAME);
  CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
}

/** The ScrollArea viewport scrolls the rendered markdown; fall back to the content wrapper. */
function scrollContainerOf(container: HTMLElement): HTMLElement | null {
  return container.closest('[data-slot="scroll-area-viewport"]');
}

function scrollRangeIntoView(range: Range): void {
  const element =
    range.startContainer.nodeType === 1
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  element?.scrollIntoView({ block: "center" });
}

/**
 * Find-in-page state for one rendered markdown surface: match ranges painted through the
 * CSS Highlight API, the active match, and the Cmd/Ctrl+F capture handler for the wrapper.
 */
export function useMarkdownFind(container: HTMLElement | null) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const [ranges, setRanges] = useState<readonly Range[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchedQuery = useDeferredValue(query);
  const scrollContainer = container ? scrollContainerOf(container) : null;
  const lastQueryRef = useRef<string | null>(null);
  const scrolledForRef = useRef<{ query: string; index: number } | null>(null);

  const openFind = () => {
    setOpen(true);
    setFocusToken((token) => token + 1);
  };
  const close = () => setOpen(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- collects match ranges for the deferred query, resets the active match on a new query, and re-collects when the rendered markdown mutates
  useEffect(() => {
    if (!container) return;
    let frame: number | null = null;
    let disposed = false;
    const collect = () => {
      if (disposed) return;
      const trimmed = searchedQuery.trim();
      const found = open && trimmed.length > 0 ? collectMarkdownFindRanges(container, trimmed) : [];
      if (lastQueryRef.current !== trimmed) {
        lastQueryRef.current = trimmed;
        setRanges(found);
        setActiveIndex(
          trimmed.length > 0 ? firstMarkdownFindIndexAfterScroll(found, scrollContainer) : -1,
        );
      } else {
        setRanges(found);
        setActiveIndex((current) =>
          found.length === 0 ? -1 : Math.min(current < 0 ? 0 : current, found.length - 1),
        );
      }
    };
    const schedule = () => {
      if (frame !== null || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        collect();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(container, { subtree: true, childList: true, characterData: true });
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      clearHighlights();
    };
  }, [container, searchedQuery, open, scrollContainer]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- repaints the CSS Highlight ranges whenever the matches or the active match change
  useEffect(() => {
    paintHighlights(ranges, activeIndex);
  }, [ranges, activeIndex]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the active match into view on a new query or step, but not on repaints of unchanged matches
  useEffect(() => {
    if (!open || activeIndex < 0 || !ranges[activeIndex]) return;
    const key = { query: searchedQuery, index: activeIndex };
    const scrolled = scrolledForRef.current;
    if (scrolled !== null && scrolled.query === key.query && scrolled.index === key.index) return;
    scrolledForRef.current = key;
    scrollRangeIntoView(ranges[activeIndex]);
  }, [open, activeIndex, ranges, searchedQuery]);

  const step = (delta: 1 | -1) => {
    setActiveIndex((current) => stepMarkdownFindIndex(current, ranges.length, delta));
  };

  const onKeyDownCapture = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      event.stopPropagation();
      openFind();
      return;
    }
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return {
    open,
    query,
    setQuery,
    focusToken,
    matchCount: ranges.length,
    activeIndex,
    next: () => step(1),
    previous: () => step(-1),
    openFind,
    close,
    onKeyDownCapture,
  };
}

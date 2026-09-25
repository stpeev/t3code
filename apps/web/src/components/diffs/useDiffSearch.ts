import { useAtomValue } from "@effect/atom-react";
import type { FileDiffMetadata, PostRenderPhase } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isDiffFindShortcut } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { findDiffMatches, firstMatchIndexFrom, indexDiffMatchesByLine } from "./diffSearch";
import { createDiffSearchHighlighter } from "./diffSearchHighlights";

export interface DiffSearchItem {
  readonly id: string;
  readonly fileDiff: FileDiffMetadata;
  readonly collapsed?: boolean;
}

interface PendingReveal {
  readonly index: number;
  readonly expand: boolean;
}

function firstVisibleFileId<LAnnotation>(
  viewer: CodeViewHandle<LAnnotation, undefined>,
): string | null {
  const instance = viewer.getInstance();
  if (!instance) return null;
  const scrollTop = instance.getScrollTop();
  let visible: { id: string; top: number } | null = null;
  for (const item of instance.getRenderedItems()) {
    const top = instance.getTopForItem(item.id);
    if (top === undefined || top > scrollTop + 1) continue;
    if (!visible || top > visible.top) visible = { id: item.id, top };
  }
  return visible?.id ?? null;
}

/** Find-in-diff state for one viewer: matches, the active match, and match highlighting. */
export function useDiffSearch<LAnnotation>({
  items,
  viewer,
  expandFile,
}: {
  items: ReadonlyArray<DiffSearchItem>;
  viewer: CodeViewHandle<LAnnotation, undefined> | null;
  expandFile: (fileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusToken, setFocusToken] = useState(0);
  const searchedQuery = useDeferredValue(open ? query : "");
  const result = useMemo(() => findDiffMatches(items, searchedQuery), [items, searchedQuery]);
  const lines = useMemo(() => indexDiffMatchesByLine(result.matches), [result.matches]);
  const fileOrder = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items]);
  const [active, setActive] = useState({ query: "", index: -1 });
  const activeIndex =
    active.query === searchedQuery ? Math.min(active.index, result.matches.length - 1) : -1;
  const pendingReveal = useRef<PendingReveal | null>(null);

  useEffect(() => {
    if (active.query === searchedQuery) return;
    const index = firstMatchIndexFrom(
      result.matches,
      fileOrder,
      viewer ? firstVisibleFileId(viewer) : null,
    );
    setActive({ query: searchedQuery, index });
    pendingReveal.current = index < 0 ? null : { index, expand: false };
  }, [active.query, searchedQuery, result.matches, fileOrder, viewer]);

  useEffect(() => {
    const pending = pendingReveal.current;
    if (!pending || !viewer?.getInstance()) return;
    const match = result.matches[pending.index];
    const item = match ? items.find((candidate) => candidate.id === match.fileId) : undefined;
    if (!match || !item) {
      pendingReveal.current = null;
      return;
    }
    if (item.collapsed) {
      // Typing never unfolds files; stepping does, and the scroll waits for the expanded item.
      if (pending.expand) expandFile(item.id);
      else pendingReveal.current = null;
      return;
    }
    pendingReveal.current = null;
    viewer.scrollTo({
      type: "line",
      id: match.fileId,
      lineNumber: match.lineNumber,
      side: match.side,
      align: "center",
    });
  }, [active, items, result.matches, viewer, expandFile]);

  const [highlighter] = useState(createDiffSearchHighlighter);
  const paintState = useRef({ lines, matches: result.matches, activeIndex });
  useEffect(() => {
    paintState.current = { lines, matches: result.matches, activeIndex };
    for (const item of viewer?.getInstance()?.getRenderedItems() ?? []) {
      highlighter.paintFile(item.id, item.element, lines.get(item.id), result.matches, activeIndex);
    }
  }, [highlighter, lines, result.matches, activeIndex, viewer]);
  useEffect(() => highlighter.clear, [highlighter]);

  // Stable so passing it to the viewer never invalidates its options.
  const onPostRender = useCallback(
    (
      node: HTMLElement,
      _instance: unknown,
      phase: PostRenderPhase,
      context?: { item: { id: string } },
    ) => {
      const fileId = context?.item.id;
      if (!fileId) return;
      if (phase === "unmount") {
        highlighter.clearFile(fileId);
        return;
      }
      const state = paintState.current;
      highlighter.paintFile(
        fileId,
        node,
        state.lines.get(fileId),
        state.matches,
        state.activeIndex,
      );
    },
    [highlighter],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      const count = result.matches.length;
      if (count === 0) return;
      const from = activeIndex < 0 ? (delta > 0 ? -1 : 0) : activeIndex;
      const index = (from + delta + count) % count;
      pendingReveal.current = { index, expand: true };
      setActive({ query: searchedQuery, index });
    },
    [activeIndex, result.matches.length, searchedQuery],
  );

  const openSearch = useCallback(() => {
    setOpen(true);
    setFocusToken((token) => token + 1);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    viewer?.getInstance()?.getContainerElement()?.focus({ preventScroll: true });
  }, [viewer]);

  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  // Attach to the element wrapping the viewer and the bar; inside it, find searches the diff.
  const onKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isDiffFindShortcut(event, keybindings, { context: { diffFocus: true } })) return;
      event.preventDefault();
      event.stopPropagation();
      openSearch();
    },
    [keybindings, openSearch],
  );

  return {
    open,
    query,
    setQuery,
    focusToken,
    matchCount: result.matches.length,
    truncated: result.truncated,
    activeIndex,
    next: useCallback(() => step(1), [step]),
    previous: useCallback(() => step(-1), [step]),
    openSearch,
    close,
    onKeyDownCapture,
    onPostRender,
  };
}

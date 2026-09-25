import { ChevronDownIcon, ChevronUpIcon, HistoryIcon, SearchIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { MAX_DIFF_SEARCH_MATCHES } from "./diffSearch";
import {
  type DiffSearchRecall,
  type DiffSearchRecallDirection,
  stepDiffSearchRecall,
} from "./diffSearchHistory";

function matchCountLabel(matchCount: number, activeIndex: number, truncated: boolean) {
  if (matchCount === 0) return "No results";
  const total = truncated ? `${MAX_DIFF_SEARCH_MATCHES}+` : `${matchCount}`;
  return activeIndex < 0 ? `${total} results` : `${activeIndex + 1} of ${total}`;
}

/** Bare Up/Down recall history; with a modifier or mid-IME composition they keep their usual job. */
function recallDirectionForKey(
  event: KeyboardEvent<HTMLInputElement>,
): DiffSearchRecallDirection | null {
  const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (modified || event.nativeEvent.isComposing) return null;
  if (event.key === "ArrowUp") return "older";
  if (event.key === "ArrowDown") return "newer";
  return null;
}

export function DiffSearchBar({
  query,
  onQueryChange,
  history,
  onClearHistory,
  focusToken,
  matchCount,
  activeIndex,
  truncated,
  onNext,
  onPrevious,
  onClose,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  history: ReadonlyArray<string>;
  onClearHistory: () => void;
  focusToken: number;
  matchCount: number;
  activeIndex: number;
  truncated: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [recall, setRecall] = useState<DiffSearchRecall | null>(null);

  const pickTerm = (term: string) => {
    setRecall(null);
    onQueryChange(term);
  };
  // Stepping saves the term to the front of the history, so a recall position would go stale.
  const stepMatch = (step: () => void) => {
    setRecall(null);
    step();
  };
  const recallTerm = (direction: DiffSearchRecallDirection) => {
    const next = stepDiffSearchRecall(history, recall, query, direction);
    if (!next) return;
    setRecall(next.recall);
    onQueryChange(next.query);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = recallDirectionForKey(event);
    if (direction) {
      event.preventDefault();
      recallTerm(direction);
    } else if (event.key === "Enter") {
      event.preventDefault();
      stepMatch(event.shiftKey ? onPrevious : onNext);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  // Every open request, including one while already open, lands in the input with it selected.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  return (
    <div className="flex w-80 items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg/5">
      <InputGroup variant="ghost">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          size="sm"
          aria-label="Find in diff"
          placeholder="Find in diff"
          value={query}
          onChange={(event) => pickTerm(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        {query.length > 0 ? (
          <InputGroupAddon align="inline-end">
            <span
              className="whitespace-nowrap text-2xs text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {matchCountLabel(matchCount, activeIndex, truncated)}
            </span>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Recent searches"
              disabled={history.length === 0}
            />
          }
        >
          <HistoryIcon />
        </MenuTrigger>
        <MenuPopup align="end" finalFocus={inputRef}>
          {history.map((term) => (
            <MenuItem key={term} onClick={() => pickTerm(term)}>
              <span className="max-w-64 truncate font-mono">{term}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={onClearHistory}>Clear recent searches</MenuItem>
        </MenuPopup>
      </Menu>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Previous match"
        disabled={matchCount === 0}
        onClick={() => stepMatch(onPrevious)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Next match"
        disabled={matchCount === 0}
        onClick={() => stepMatch(onNext)}
      >
        <ChevronDownIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Close find" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}

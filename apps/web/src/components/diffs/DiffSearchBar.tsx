import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { MAX_DIFF_SEARCH_MATCHES } from "./diffSearch";

function matchCountLabel(matchCount: number, activeIndex: number, truncated: boolean) {
  if (matchCount === 0) return "No results";
  const total = truncated ? `${MAX_DIFF_SEARCH_MATCHES}+` : `${matchCount}`;
  return activeIndex < 0 ? `${total} results` : `${activeIndex + 1} of ${total}`;
}

export function DiffSearchBar({
  query,
  onQueryChange,
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
  focusToken: number;
  matchCount: number;
  activeIndex: number;
  truncated: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Every open request, including one while already open, lands in the input with it selected.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  return (
    <div className="flex w-72 items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg/5">
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
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) onPrevious();
              else onNext();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
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
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Previous match"
        disabled={matchCount === 0}
        onClick={onPrevious}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Next match"
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <ChevronDownIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Close find" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}

import { useEffect, useRef, type KeyboardEvent } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { cn } from "~/lib/utils";

interface MarkdownFindBarProps {
  readonly query: string;
  readonly matchCount: number;
  readonly activeIndex: number;
  readonly focusToken: number;
  readonly onQueryChange: (query: string) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}

/** Floating find bar over a rendered markdown file preview; Cmd/Ctrl+F and Escape are handled by the surface wrapper. */
export function MarkdownFindBar(props: MarkdownFindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses and selects the input when the bar opens or the find shortcut refires
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- each find shortcut bumps the focus token, so an already-open bar refocuses and reselects its query
    props.focusToken,
  ]);

  const hasQuery = props.query.trim().length > 0;
  const noResults = hasQuery && props.matchCount === 0;
  const label = !hasQuery
    ? ""
    : noResults
      ? "No results"
      : `${Math.max(props.activeIndex + 1, 1)}/${props.matchCount}`;
  const navigationDisabled = props.matchCount === 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) props.onPrevious();
      else props.onNext();
    }
  };

  return (
    <div data-markdown-find-ignore="true" className="w-80 max-w-[calc(100%-1.5rem)]">
      <InputGroup
        variant="popover"
        size="lg"
        onContextMenu={(event) => event.stopPropagation()}
        role="search"
        aria-label="Find in file"
        className="w-full"
      >
        <InputGroupInput
          ref={inputRef}
          type="search"
          size="sm"
          value={props.query}
          aria-label="Find in file"
          placeholder="Find in file"
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <InputGroupAddon align="inline-end" inset="pill">
          <span
            aria-live="polite"
            className={cn(
              "min-w-10 text-center text-xs tabular-nums",
              noResults ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Previous match"
            disabled={navigationDisabled}
            onClick={props.onPrevious}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Next match"
            disabled={navigationDisabled}
            onClick={props.onNext}
          >
            <ChevronDownIcon />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Close find" onClick={props.onClose}>
            <XIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

import { ChevronDownIcon, ChevronRightIcon, CloudOffIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { DiffStatLabel } from "../chat/DiffStatLabel";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CommitDetails } from "./CommitDetails";
import { isSelectableDiffChangesRow, type DiffChangesRow } from "./diffChanges.logic";

const KEYBOARD_SELECT_DELAY_MS = 150;
const FILE_TREE_ROW_HEIGHT_PX = 24;
const FILE_TREE_CHROME_PX = 48;

const findRowElement = (scroller: HTMLElement | null, id: string) =>
  scroller?.querySelector<HTMLElement>(`[data-changes-row="${CSS.escape(id)}"]`) ?? null;

interface DiffChangesRailProps {
  readonly rows: ReadonlyArray<DiffChangesRow>;
  readonly selectedRowId: string | null;
  readonly hasRemote: boolean;
  /** While folded, the selected row keeps its files hidden, even across selections. */
  readonly filesFolded: boolean;
  readonly onFilesFoldedChange: (folded: boolean) => void;
  readonly onSelectRow: (row: DiffChangesRow) => void;
  readonly onShowMore: () => void;
  /** The file tree for the selected row, and how many tree rows it can grow to. */
  readonly fileTree: ReactNode;
  readonly fileTreeRowCount: number;
  readonly renderBasePicker: (baseRef: string) => ReactNode;
}

/** The working tree and the branch's commits as one list; the selected row expands to its files. */
export function DiffChangesRail({
  rows,
  selectedRowId,
  hasRemote,
  filesFolded,
  onFilesFoldedChange,
  onSelectRow,
  onShowMore,
  fileTree,
  fileTreeRowCount,
  renderBasePicker,
}: DiffChangesRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);
  const keyboardTimerRef = useRef<number | null>(null);

  const rowElement = (id: string) => findRowElement(scrollRef.current, id);

  const select = useCallback(
    (row: DiffChangesRow) => {
      if (row.id === selectedRowId) {
        onFilesFoldedChange(!filesFolded);
        return;
      }
      const element = findRowElement(scrollRef.current, row.id);
      anchorRef.current = element ? { id: row.id, top: element.getBoundingClientRect().top } : null;
      onSelectRow(row);
    },
    [filesFolded, onFilesFoldedChange, onSelectRow, selectedRowId],
  );

  // Collapsing the block above the clicked row would otherwise pull the row upward.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || anchor.id !== selectedRowId) return;
    anchorRef.current = null;
    const scroller = scrollRef.current;
    const element = findRowElement(scroller, anchor.id);
    if (!scroller || !element) return;
    scroller.scrollTop += element.getBoundingClientRect().top - anchor.top;
  }, [selectedRowId]);

  useEffect(
    () => () => {
      if (keyboardTimerRef.current !== null) window.clearTimeout(keyboardTimerRef.current);
    },
    [],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focusable = rows.filter(isSelectableDiffChangesRow);
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset.changesRow;
    const index = focusable.findIndex((row) => row.id === focusedId);
    if (index === -1) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (focusedId !== selectedRowId) return;
      event.preventDefault();
      onFilesFoldedChange(event.key === "ArrowLeft");
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const next = focusable[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    rowElement(next.id)?.focus();
    if (keyboardTimerRef.current !== null) window.clearTimeout(keyboardTimerRef.current);
    keyboardTimerRef.current = window.setTimeout(() => {
      keyboardTimerRef.current = null;
      if (next.id !== selectedRowId) onSelectRow(next);
    }, KEYBOARD_SELECT_DELAY_MS);
  };

  const fileTreeHeight = FILE_TREE_CHROME_PX + fileTreeRowCount * FILE_TREE_ROW_HEIGHT_PX;

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label="Changes"
      className="flex min-h-0 w-full flex-col overflow-y-auto py-1 [container-type:size]"
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        const selected = row.id === selectedRowId;
        const expanded = selected && !filesFolded;
        return (
          <div key={row.id} role="listitem" className="flex shrink-0 flex-col">
            {row.kind === "show-more" ? (
              <Button
                type="button"
                variant="ghost-muted"
                size="xs"
                className="mx-2 my-1 justify-start"
                onClick={onShowMore}
              >
                Show more
              </Button>
            ) : row.kind === "branch-header" ? (
              <div className="mx-1 mt-2 flex min-w-0 items-center gap-1.5 px-2 pb-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="truncate">This branch</span>
                <span className="shrink-0 tabular-nums normal-case">
                  · {row.commitCount}
                  {row.truncated ? "+" : ""}
                  {hasRemote && row.unpushedCount > 0 ? ` · ${row.unpushedCount} not pushed` : ""}
                </span>
              </div>
            ) : row.kind === "divider" ? (
              <div
                className={cn(
                  "mx-1 mt-3 mb-1 flex min-w-0 items-center gap-1 rounded-b-md border-t border-primary/40 bg-primary/5 px-2 py-1 text-2xs text-muted-foreground",
                  selected && "text-foreground ring-1 ring-primary/60 ring-inset",
                )}
              >
                <button
                  type="button"
                  data-changes-row={row.id}
                  aria-pressed={selected}
                  className="shrink-0 rounded-sm font-medium uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => select(row)}
                >
                  {row.upToDate ? "Up to date with" : "Branched from"}
                </button>
                {renderBasePicker(row.baseRef)}
              </div>
            ) : (
              <ChangesRowButton
                row={row}
                selected={selected}
                expanded={expanded}
                hasRemote={hasRemote}
                onSelect={() => select(row)}
                onToggleFolded={() => onFilesFoldedChange(!filesFolded)}
              />
            )}
            {expanded ? (
              <div
                className="mx-1 mb-1 flex min-h-0 overflow-hidden rounded-md border border-border/60"
                style={{ height: `min(60cqh, ${fileTreeHeight}px)` }}
              >
                {fileTree}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ChangesRowButton({
  row,
  selected,
  expanded,
  hasRemote,
  onSelect,
  onToggleFolded,
}: {
  readonly row: Exclude<
    DiffChangesRow,
    { kind: "branch-header" } | { kind: "divider" } | { kind: "show-more" }
  >;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly hasRemote: boolean;
  readonly onSelect: () => void;
  readonly onToggleFolded: () => void;
}) {
  const commit = row.kind === "commit" ? row.commit : null;
  const unpushed = hasRemote && commit?.unpushed === true;
  const accessibleName =
    row.kind === "commit"
      ? `${row.commit.subject || row.commit.shortSha}${unpushed ? ", not pushed" : ""}`
      : row.kind === "working-tree"
        ? "Working tree"
        : row.label;

  return (
    <div
      className={cn(
        "group mx-1 flex min-w-0 items-stretch rounded-md border-l-2 border-transparent",
        row.kind === "commit" && row.onBranch && "border-primary/70",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <Tooltip disabled={commit === null}>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-changes-row={row.id}
              aria-pressed={selected}
              aria-label={accessibleName}
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                row.kind === "commit" && !row.onBranch && !selected && "text-muted-foreground",
              )}
              onClick={onSelect}
            />
          }
        >
          {row.kind === "commit" ? (
            <>
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                {row.commit.parentShas.length > 1 ? (
                  <PullRequestGlyph.merged aria-hidden className="size-3 shrink-0 opacity-70" />
                ) : null}
                <span className="min-w-0 truncate">
                  {row.commit.subject || row.commit.shortSha}
                </span>
                {unpushed ? (
                  <CloudOffIcon
                    aria-hidden
                    className="ml-auto size-3 shrink-0 text-muted-foreground"
                  />
                ) : null}
              </span>
              <span className="flex min-w-0 gap-2 text-2xs text-muted-foreground">
                <span className="font-mono">{row.commit.shortSha}</span>
                <span className="truncate">{formatRelativeTimeLabel(row.commit.authoredAt)}</span>
              </span>
            </>
          ) : row.kind === "working-tree" ? (
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate font-medium">Working tree</span>
              {row.fileCount > 0 ? (
                <span className="ml-auto flex shrink-0 items-center gap-2 text-2xs text-muted-foreground">
                  <span className="tabular-nums">{row.fileCount}</span>
                  <DiffStatLabel
                    additions={row.additions}
                    deletions={row.deletions}
                    layout="inline"
                  />
                </span>
              ) : (
                <span className="ml-auto text-2xs text-muted-foreground">Clean</span>
              )}
            </span>
          ) : (
            <span className="truncate text-xs font-medium">{row.label}</span>
          )}
        </TooltipTrigger>
        {commit ? (
          <TooltipPopup side="left" align="start">
            <CommitDetails commit={commit} unpushed={unpushed} />
          </TooltipPopup>
        ) : null}
      </Tooltip>
      {selected ? (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="my-auto mr-1 shrink-0"
          aria-label={expanded ? "Hide files" : "Show files"}
          aria-expanded={expanded}
          onClick={onToggleFolded}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </Button>
      ) : null}
    </div>
  );
}

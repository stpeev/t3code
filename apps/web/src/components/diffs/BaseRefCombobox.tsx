import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { buildBaseRefChoices, filterBaseRefChoices } from "~/lib/baseRefChoices";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";

import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const AUTOMATIC_BASE_REF = "__automatic_base_ref__";

interface BaseRefComboboxProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** The branch being compared, left out of the choices. */
  readonly headRef: string | null;
  /** The explicitly chosen base, or null when the server resolves it. */
  readonly value: string | null;
  /** The base actually in use, shown on the trigger. */
  readonly displayRef: string;
  readonly onChange: (baseRef: string | null) => void;
}

/** Picks the parent branch a diff compares against. Refs are only fetched while the popup is open. */
export function BaseRefCombobox({
  environmentId,
  cwd,
  headRef,
  value,
  displayRef,
  onChange,
}: BaseRefComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const refsInput = (refKind: "local" | "remote") => ({
    cwd,
    includeMatchingRemoteRefs: true,
    refKind,
    ...(trimmedQuery.length > 0 ? { query: trimmedQuery } : {}),
    limit: 100,
  });
  const localRefs = useEnvironmentQuery(
    open ? vcsEnvironment.listRefs({ environmentId, input: refsInput("local") }) : null,
  );
  const remoteRefs = useEnvironmentQuery(
    open ? vcsEnvironment.listRefs({ environmentId, input: refsInput("remote") }) : null,
  );
  const choices = buildBaseRefChoices(
    localRefs.data?.refs.filter((ref) => ref.name !== headRef) ?? [],
    remoteRefs.data?.refs ?? [],
  );
  const valueForChoice = (choice: (typeof choices)[number]) =>
    value && value === choice.remote?.name
      ? value
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const items = [AUTOMATIC_BASE_REF, ...choices.map(valueForChoice)];
  const filteredItems = [
    ...(trimmedQuery.length === 0 ? [AUTOMATIC_BASE_REF] : []),
    ...filterBaseRefChoices(choices, query).map(valueForChoice),
  ];

  return (
    <Combobox
      items={items}
      filteredItems={filteredItems}
      value={value ?? AUTOMATIC_BASE_REF}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      onValueChange={(next) => {
        if (!next) return;
        onChange(next === AUTOMATIC_BASE_REF ? null : next);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={<Button variant="ghost-muted" size="xs" />}
              className="min-w-0 max-w-48 shrink"
              aria-label={`Change comparison target. Currently ${displayRef}`}
            />
          }
        >
          <span className="min-w-0 truncate">{displayRef}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
        </TooltipTrigger>
        <TooltipPopup side="top">{displayRef}</TooltipPopup>
      </Tooltip>
      <ComboboxPopup
        align="start"
        className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden"
      >
        <ComboboxSearchInput
          placeholder="Search refs..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-3xs text-muted-foreground uppercase tracking-wide">
          <span aria-hidden="true" />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
            <span>Branch</span>
            <span className="text-right">Remote</span>
          </div>
        </div>
        <ComboboxEmpty>No matching refs.</ComboboxEmpty>
        {/* The list is the scroller; one max-content wrapper keeps every row as wide as the longest name. */}
        <ComboboxList className="max-h-64 min-w-0 overflow-auto">
          <div className="w-max min-w-full">
            <ComboboxItem
              className="w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)]"
              value={AUTOMATIC_BASE_REF}
            >
              <span className="block min-w-0 truncate">Automatic</span>
            </ComboboxItem>
            {choices.map((choice) => {
              const item = valueForChoice(choice);
              const hasBoth = choice.local !== null && choice.remote !== null;
              const useRemote = choice.remote?.name === item;
              return (
                <ComboboxItem
                  key={choice.id}
                  className="w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)]"
                  value={item}
                >
                  <div className="grid w-full grid-cols-[1fr_auto] items-center">
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className="whitespace-nowrap pe-2">{choice.label}</span>}
                      />
                      <TooltipPopup side="top">{choice.label}</TooltipPopup>
                    </Tooltip>
                    {hasBoth || choice.remote ? (
                      // Pinned to the list's right edge; the opaque backing hides names scrolling beneath.
                      <div className="sticky right-0 -me-3 flex w-11 self-stretch items-center justify-end bg-popover pe-3 in-data-highlighted:bg-linear-to-r in-data-highlighted:from-accent in-data-highlighted:to-accent in-[[data-selected]:not([data-highlighted])]:bg-linear-to-r in-[[data-selected]:not([data-highlighted])]:from-foreground/8 in-[[data-selected]:not([data-highlighted])]:to-foreground/8">
                        {hasBoth ? (
                          <div
                            className="flex"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <Switch
                              aria-label={`Use remote version of ${choice.label}`}
                              checked={useRemote}
                              className="[--thumb-size:--spacing(3)]"
                              onCheckedChange={(checked) => {
                                const nextRef = checked ? choice.remote?.name : choice.local?.name;
                                if (nextRef) onChange(nextRef);
                              }}
                            />
                          </div>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="flex text-muted-foreground">
                                  <CheckIcon
                                    role="img"
                                    aria-label="Remote only"
                                    className="size-3"
                                  />
                                </span>
                              }
                            />
                            <TooltipPopup side="top">Remote only</TooltipPopup>
                          </Tooltip>
                        )}
                      </div>
                    ) : null}
                  </div>
                </ComboboxItem>
              );
            })}
          </div>
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

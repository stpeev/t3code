import * as Schema from "effect/Schema";

export const DIFF_SEARCH_HISTORY_KEY = "t3code:diff-search-history:v1";
export const DIFF_SEARCH_HISTORY_LIMIT = 20;
export const DiffSearchHistorySchema = Schema.Array(Schema.String);
export const EMPTY_DIFF_SEARCH_HISTORY: ReadonlyArray<string> = [];

/** Most recent first, without duplicates, capped at the history limit. */
export function rememberDiffSearchTerm(
  history: ReadonlyArray<string>,
  term: string,
): ReadonlyArray<string> {
  if (term.trim() === "" || history[0] === term) return history;
  return [term, ...history.filter((entry) => entry !== term)].slice(0, DIFF_SEARCH_HISTORY_LIMIT);
}

/** Where shell-style recall stands: the history entry shown, and the text typed before recall. */
export interface DiffSearchRecall {
  readonly index: number;
  readonly draft: string;
}

export type DiffSearchRecallDirection = "older" | "newer";

/** Up (`older`) walks back through history; `newer` walks forward and finally restores the draft. */
export function stepDiffSearchRecall(
  history: ReadonlyArray<string>,
  recall: DiffSearchRecall | null,
  query: string,
  direction: DiffSearchRecallDirection,
): { readonly recall: DiffSearchRecall | null; readonly query: string } | null {
  if (direction === "older") {
    const index = (recall?.index ?? -1) + 1;
    const term = history[index];
    if (term === undefined) return null;
    return { recall: { index, draft: recall?.draft ?? query }, query: term };
  }
  if (!recall) return null;
  const index = recall.index - 1;
  if (index < 0) return { recall: null, query: recall.draft };
  return { recall: { index, draft: recall.draft }, query: history[index] ?? recall.draft };
}

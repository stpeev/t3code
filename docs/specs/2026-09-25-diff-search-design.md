# Design spec: Find in diff (web / desktop Diff panel)

Status: draft for review · 2026-09-25

## Problem

The Diff tab has no way to find text. Browser Cmd/Ctrl+F doesn't help either. Pierre's `CodeView` is
virtualized (only visible rows are in the DOM) and renders each file inside a shadow root, so native find
misses most of the diff. The only search in the panel is the base-ref picker.

## Goal

Cmd/Ctrl+F inside the Diff panel opens a find bar. It searches every loaded file in the current diff and
shows `3 of 41`. Enter / Shift+Enter move between matches: the viewer scrolls to each one, expands a
collapsed file if needed, and highlights the match.

### Non-goals (v1)

- Replace (the diff is read-only).
- Searching unchanged lines outside hunks. Those lines aren't in the patch, and fetching whole files to
  search them is a different feature.
- Regex and whole-word matching. We can add them later without changing the design.
- Mobile. It has its own native diff renderer (`apps/mobile/src/features/review`).
- Truncated git diffs whose files haven't all loaded yet. v1 searches only the files already loaded.
  See [Follow-up work](#follow-up-work).

## Key findings (from reading `@pierre/diffs@1.3.0-beta.10`)

1. **Pierre's search panel can't be reused.** `editor/searchPanel` is bound to the editor's
   `TextDocument` and only works on a single item in edit mode.
2. **Search can run on the data, not the DOM.** `FileDiffMetadata` already holds every line we'd search:
   `additionLines` and `deletionLines` for each file, with `hunks[].hunkContent` saying which lines are
   context, deletion or addition. So we can search a 10k-line diff without rendering any of it.
3. **Scrolling is covered.** `CodeView.scrollTo({ type: "line", id, lineNumber, side, align: "center" })`
   already exists, and the handle is exposed through `AnnotatableCodeView`.
4. **There's a hook for highlighting.** `onPostRender(node, instance, phase)` fires on mount, update and
   unmount for each file, and it's already one of CodeView's shared callback keys. Rendered lines carry
   `data-line`, `data-line-type` and `data-line-index`, which we can use to find a line's element.
5. **Files load lazily only when the git diff is truncated** (`lazySource` in `DiffPanel.tsx:401`). In
   that case only 4 files load at first, and the rest load on scroll or on a file-tree click.
6. **Two consumers share the viewer:** `DiffPanel.tsx` and `pullRequest/PullRequestCodeTab.tsx`, both
   through `StyledDiffCodeView`.

## Design

### 1. Match model (pure, unit-tested)

`apps/web/src/components/diffs/diffSearch.ts`

```ts
type DiffSearchMatch = {
  fileKey: string;
  side: "additions" | "deletions";
  lineNumber: number; // file line number on that side, what scrollTo wants
  lineIndex: number;  // index into additionLines / deletionLines
  start: number;      // UTF-16 column range within the line
  end: number;
};

findDiffMatches(files: { fileKey; fileDiff }[], query, { caseSensitive }): DiffSearchMatch[]
```

- For each file, walk `hunks[].hunkContent` in order. Context lines are searched once, on the additions
  side, so a match isn't counted twice in split view. Within each change block, deletions come before
  additions, which is the order the unified view renders them in.
- Matching is a plain substring `indexOf` loop with smart case. An all-lowercase query ignores case, so
  `user` finds `user`, `User` and `USER`. A query with any capital letter matches case exactly, so
  `User` finds only `User`. This means there's no case toggle in the UI.
- The result is capped at **5,000 matches**, shown as `5000+`. This keeps the highlight set bounded.
- The result order is the order the viewer renders things in, which is what makes next/previous feel
  right.

### 2. State hook

`useDiffSearch({ files, codeView, revealFile })` returns
`{ open, query, setQuery, matches, activeIndex, next, prev, close, onPostRender }`.

- The query is debounced (about 120 ms). Matches are recomputed when the query or the `files` list
  changes.
- `next` and `prev` wrap around. When the active match changes:
  1. If the match's file is collapsed, expand it with the same state change `revealDiffFile` already
     makes.
  2. Call `codeView.scrollTo({ type: "line", id: fileKey, lineNumber, side, align: "center" })`.
- When a new query comes in, the active match is the first one at or after the current scroll
  position, so the view doesn't jump to the top.

### 3. Highlighting: CSS Custom Highlight API

The highlights never touch Pierre's DOM and never cause a re-render:

- Two registry entries, `CSS.highlights.set("t3-diff-search", …)` and `"t3-diff-search-active"`.
- `onPostRender(node, instance)` takes the matches for that file and finds each line element inside
  `node.shadowRoot` by `data-line` plus its side column. It then walks the line's text nodes to turn the
  `start`/`end` columns into a `Range`, since a match can span several syntax-token `<span>`s. Ranges
  from unmounted rows are dropped on `unmount` and `update`.
- The styles go in `DIFF_VIEW_UNSAFE_CSS`, because `::highlight()` rules have to be inside the shadow
  root. Plain background and no animation. The active match gets a stronger color.
- Support: Chromium 105+ (Electron), Safari 17.2+ and Firefox 140+. On older browsers, feature-detect
  and skip the highlights. Navigating still works, and the scrolled-to line is marked the same way
  `data-selected-line` is.

Cost: only mounted rows get ranges, so the work per render is bounded by the viewport, not by the
number of matches.

### 4. UI

- A find bar sits in the Diff panel, top-right, overlaying the code pane (no reflow). It has an input,
  the `n of m` count, previous and next buttons, and a close button. It's built from existing
  `components/ui` pieces (`Input`, `Button size="icon-micro"`, with no restyling).
- A search icon button goes in the toolbar next to wrap / whitespace. That makes the feature
  discoverable and gives touch and pointer users a way in.
- Keys while the input has focus: Enter = next, Shift+Enter = previous, Escape = close and return focus
  to the viewer. If text is selected in the diff when the bar opens, the query starts as that text.
- Empty or no-match states: the count shows `No results`. Nothing blocks and there's no spinner, since
  the search runs synchronously on data that's already loaded.

### 5. Entry points and keybinding

- New command `diff.find`, added to `STATIC_KEYBINDING_COMMANDS` in `packages/contracts`. The default
  binding is `{ key: "mod+f", command: "diff.find", when: "diffFocus" }`, in `packages/shared` defaults.
- New `when` context `diffFocus`, modeled on `previewFocus` (`lib/previewFocus.ts`). It's true when
  `document.activeElement` is inside the Diff panel. Outside the panel, Cmd+F is untouched, so the chat
  and the preview keep native find.
- `mod+g` / `mod+shift+g` as next/previous while the bar is open is optional. Note that `mod+shift+g`
  is already `composer.branch`, so we skip it and rely on Enter / Shift+Enter.
- Command palette: no entry. The command only makes sense when the panel has focus.

### 6. Surfaces

| Surface                                            | Decision                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Diff panel, turn diffs                             | Yes                                                                     |
| Diff panel, git/branch diffs                       | Yes. For truncated diffs, only the files already loaded (see follow-up) |
| Pull request view, Code tab (`PullRequestCodeTab`) | Yes. Same viewer and same hook, so wiring it in is roughly one file     |
| Desktop                                            | Same as web. Electron has no competing `findInPage` wiring              |
| Mobile                                             | No (separate native renderer)                                           |
| Providers / contracts / server                     | No change beyond the keybinding command literal                         |

Reverse states: every way in has a way out (close button, Escape, Cmd+F again to refocus or select the
query). Closing clears both highlight registry entries.

## Testing

- `diffSearch.test.ts` checks the ordering across context, deletion and addition lines. It also covers
  context lines not being double-counted, smart case, a match at the end of a line, several matches on
  one line, the 5,000-match cap, and placeholder `:pending` files being skipped.
- The column-to-Range mapper is tested against a small hand-built token DOM (a match split across 3
  spans). That's real logic, not markup snapshots.
- One manual pass in a real client, on request, using `test-t3-app`: split and unified, wrapped, a
  collapsed file, and the pull request Code tab.

## Risks and unknowns to prove first (a spike, before any UI work)

1. **Does `onPostRender` fire when rows scroll within one large file**, or only on each file's
   mount/update? If it doesn't, subscribe to `CodeView.subscribeToScroll` and re-apply the ranges for
   rendered items with `getRenderedItems()`, throttled to one run per animation frame.
2. **How to find a line's element in split vs. unified view.** Confirm that `data-line` plus the column
   container (`[data-additions]` / `[data-deletions]`) identifies one row per side. Then confirm
   `data-line-index` isn't needed.
3. **Does `::highlight()` in `unsafeCSS` apply inside Pierre's shadow root in Safari?** Ranges inside
   shadow trees are allowed by the spec. We still need to verify it in Safari.
4. **Does `scrollTo({type:"line"})` work straight after un-collapsing a file** in the same tick? The
   existing `useCodeViewFileReveal` waits for the item to be ready. We'll probably need the same wait.

## Follow-up work

### Search across truncated diffs

When a git diff is too large, the server truncates it, and the panel loads files 4 at a time as you
scroll (`lazySource`, `useReviewFilePatches`). v1 searches only the files loaded so far, so matches in
unloaded files are silently missed. To fix that:

- Show how many files weren't searched next to the count, for example `· 12 files not searched`.
- Add a **Load all** action that calls the existing `requestFiles` with every remaining index. Matches
  then grow as the patches arrive, since the match list is recomputed when `files` changes.
- Decide between that explicit action and fetching automatically when a search starts. Explicit is the
  safer default, because truncated diffs are exactly the large ones.

### Case toggle

If smart case turns out to be confusing, add a visible `Aa` toggle next to the input.

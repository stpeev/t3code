import type { CSSProperties } from "react";

/** Widest row width seen so far, written by `useFileTreeScrollWidth`. */
export const FILE_TREE_CONTENT_WIDTH_PROPERTY = "--t3-tree-content-width";

/** Shadow-root overrides that make a Pierre file tree read as part of the app chrome. */
export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }

  /* Names render in full and the tree scrolls sideways instead of middle-truncating them. */
  [data-file-tree-virtualized-scroll='true'] { overflow-x: auto; }
  [data-file-tree-virtualized-list='true'] {
    width: max-content;
    min-width: max(100%, var(${FILE_TREE_CONTENT_WIDTH_PROPERTY}, 0px));
  }
  [data-item-section='content'],
  [data-truncate-group-container='middle'] > div { flex: none; }
  [data-item-section='content'],
  [data-truncate-container] { overflow: visible; }
  [data-truncate-grid] { grid-template-columns: max-content; }
  [data-truncate-marker-cell],
  [data-truncate-fill],
  [data-truncate-content='overflow'] { display: none; }

  /* The status letter stays pinned to the visible edge, over the tree surface plus the row state. */
  [data-item-section='git'] {
    position: sticky;
    right: 0;
    box-sizing: content-box;
    margin-right: calc(-1 * var(--trees-item-padding-x));
    padding-inline: 4px var(--trees-item-padding-x);
    border-radius: 0 5px 5px 0;
    background-color: var(--background);
    background-image: linear-gradient(
      var(--truncate-marker-background-overlay-color),
      var(--truncate-marker-background-overlay-color)
    );
  }
`;

/** Host styles that keep a Pierre tree on the active color scheme and foreground. */
export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
  };
}

import { useEffect } from "react";

import { FILE_TREE_CONTENT_WIDTH_PROPERTY } from "~/pierre-tree-theme";

export interface FileTreeHostModel {
  getFileTreeContainer(): HTMLElement | undefined;
}

/** Holds the tree at its widest rendered row so virtualized rows leaving cannot yank the horizontal scroll. */
export function useFileTreeScrollWidth(model: FileTreeHostModel, resetKey: unknown) {
  useEffect(() => {
    const scroller = model
      .getFileTreeContainer()
      ?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll='true']");
    const list = scroller?.querySelector<HTMLElement>("[data-file-tree-virtualized-list='true']");
    if (!scroller || !list) return;
    let widest = 0;
    const measure = () => {
      // Rows share the list's width, and the decoration lane absorbs each row's spare space.
      let slack = Infinity;
      for (const lane of list.querySelectorAll<HTMLElement>(
        "[data-type='item'] > [data-item-section='decoration']",
      )) {
        slack = Math.min(slack, lane.offsetWidth);
      }
      if (slack === Infinity) return;
      const needed = list.offsetWidth - slack;
      if (needed <= widest) return;
      widest = needed;
      scroller.style.setProperty(FILE_TREE_CONTENT_WIDTH_PROPERTY, `${widest}px`);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(list, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      scroller.style.removeProperty(FILE_TREE_CONTENT_WIDTH_PROPERTY);
    };
  }, [model, resetKey]);
}

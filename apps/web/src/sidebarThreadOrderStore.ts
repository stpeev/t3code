import { create } from "zustand";

/** Scoped thread keys in the order the mounted sidebar lists them, top to bottom. */
export const useSidebarThreadOrderStore = create<{ threadKeys: readonly string[] }>(() => ({
  threadKeys: [],
}));

export function publishSidebarThreadOrder(threadKeys: readonly string[]): void {
  const current = useSidebarThreadOrderStore.getState().threadKeys;
  if (current.length === threadKeys.length && current.every((key, i) => key === threadKeys[i])) {
    return;
  }
  useSidebarThreadOrderStore.setState({ threadKeys });
}

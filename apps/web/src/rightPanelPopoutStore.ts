// App-wide placement of the right panel: inline, or in a popout window. Each thread's tabs stay in `rightPanelStore`.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type RightPanelLocation = "inline" | "popout";

export interface RightPanelPopoutBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RightPanelPopoutState {
  location: RightPanelLocation;
  /** Whether the popout window is showing. Only meaningful in popout mode. */
  open: boolean;
  bounds: RightPanelPopoutBounds | null;
  popOut: () => void;
  dock: () => void;
  setOpen: (open: boolean) => void;
  setBounds: (bounds: RightPanelPopoutBounds) => void;
}

const RIGHT_PANEL_POPOUT_STORAGE_KEY = "t3code:right-panel-popout:v1";

export interface RightPanelPopoutSyncSnapshot {
  threadKey: string;
  popoutOpen: boolean;
  /** The thread's own `isOpen` in `rightPanelStore`. */
  threadOpen: boolean;
  /** The thread's user-action revision; it moves only on user choices, never on automatic opens. */
  revision: number;
  surfaceCount: number;
}

export type RightPanelPopoutSyncAction =
  | "none"
  | "open-window"
  | "close-window"
  | "show-thread-panel"
  | "hide-thread-panel";

// Reconciles the app-wide popout window with the active thread's `isOpen`. A user action on the thread's panel
// moves the window; a thread switch, a closed window or an automatic open moves the thread.
export function resolveRightPanelPopoutSync(
  previous: RightPanelPopoutSyncSnapshot | null,
  next: RightPanelPopoutSyncSnapshot,
): RightPanelPopoutSyncAction {
  const userMovedThreadPanel =
    previous !== null &&
    previous.threadKey === next.threadKey &&
    previous.popoutOpen === next.popoutOpen &&
    previous.revision !== next.revision &&
    previous.threadOpen !== next.threadOpen;
  if (userMovedThreadPanel) {
    // Closing the last tab leaves the window showing an empty panel rather than closing it.
    if (!next.threadOpen && next.surfaceCount === 0) return "show-thread-panel";
    return next.threadOpen ? "open-window" : "close-window";
  }
  if (next.threadOpen === next.popoutOpen) return "none";
  return next.popoutOpen ? "show-thread-panel" : "hide-thread-panel";
}

export const useRightPanelPopoutStore = create<RightPanelPopoutState>()(
  persist(
    (set) => ({
      location: "inline",
      open: false,
      bounds: null,
      popOut: () => set({ location: "popout", open: true }),
      dock: () => set({ location: "inline", open: false }),
      setOpen: (open) => set((state) => (state.open === open ? state : { open })),
      setBounds: (bounds) => set({ bounds }),
    }),
    {
      name: RIGHT_PANEL_POPOUT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        location: state.location,
        open: state.open,
        bounds: state.bounds,
      }),
    },
  ),
);

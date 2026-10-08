import { SquareArrowDownLeftIcon } from "lucide-react";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { useRightPanelPopoutStore } from "../rightPanelPopoutStore";
import { PULL_REQUESTS_PANEL_REF, useRightPanelStore } from "../rightPanelStore";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import {
  closeRightPanelPopout,
  focusRightPanelPopout,
  getRightPanelPopout,
  openRightPanelPopout,
  setRightPanelPopoutTitle,
  subscribeRightPanelPopout,
} from "../rightPanelPopoutWindow";
import { PortalContainerProvider } from "./ui/portal-container";
import { toastManager } from "./ui/toast";

// Docking unmounts RightPanelPopout before its effects can react, so the store closes the window itself.
useRightPanelPopoutStore.subscribe((state) => {
  if (state.location !== "popout" || !state.open) closeRightPanelPopout();
});

const PULL_REQUESTS_PANEL_KEY = scopedThreadKey(PULL_REQUESTS_PANEL_REF);

// Opening a tab from the main window would otherwise update a popout hidden behind it. The pull-request
// page's panel never renders in the popout.
useRightPanelStore.subscribe((next, previous) => {
  if (next.revealRevisionByThreadKey === previous.revealRevisionByThreadKey) return;
  const popout = useRightPanelPopoutStore.getState();
  if (popout.location !== "popout" || !popout.open) return;
  const revealed = Object.entries(next.revealRevisionByThreadKey).some(
    ([threadKey, revision]) =>
      threadKey !== PULL_REQUESTS_PANEL_KEY &&
      revision !== previous.revealRevisionByThreadKey[threadKey] &&
      next.byThreadKey[threadKey]?.isOpen === true,
  );
  if (revealed) focusRightPanelPopout();
});

// Renders the right panel into the popout window. The window outlives this component, so a thread switch
// re-portals into the same window instead of reopening it.
export function RightPanelPopout(props: { title: string; children: ReactNode }) {
  const location = useRightPanelPopoutStore((state) => state.location);
  const open = useRightPanelPopoutStore((state) => state.open);
  const popout = useSyncExternalStore(subscribeRightPanelPopout, getRightPanelPopout);
  const showing = location === "popout" && open;

  useEffect(() => {
    if (!showing) return;
    const store = useRightPanelPopoutStore.getState();
    const opened = openRightPanelPopout(store.bounds, {
      onClosed: () => useRightPanelPopoutStore.getState().setOpen(false),
      onBoundsChange: (bounds) => useRightPanelPopoutStore.getState().setBounds(bounds),
    });
    if (opened) return;
    // Browsers only open windows from a click; a restore after reload just starts closed.
    if (navigator.userActivation?.isActive === false) {
      store.setOpen(false);
      return;
    }
    store.dock();
    toastManager.add({
      type: "warning",
      title: "The browser blocked the panel window",
      description: "Allow pop-ups for this site to move the panel into its own window.",
    });
  }, [showing]);

  useEffect(() => {
    setRightPanelPopoutTitle(props.title);
  }, [props.title]);

  if (!showing || !popout) return null;
  // React attaches its event listeners to a portal's container, so events in the popout's document still dispatch.
  return createPortal(
    <PortalContainerProvider value={popout.window.document.body}>
      {props.children}
    </PortalContainerProvider>,
    popout.root,
  );
}

/** Stands in for a tab that can't render in the popout window yet. */
export function RightPanelPopoutUnsupported(props: { label: string }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>{props.label} works in the main window</EmptyTitle>
        <EmptyDescription>Dock the panel to use this tab.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => useRightPanelPopoutStore.getState().dock()}>
          <SquareArrowDownLeftIcon />
          Dock in main window
        </Button>
      </EmptyContent>
    </Empty>
  );
}

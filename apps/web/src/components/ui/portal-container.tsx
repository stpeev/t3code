import { createContext, useContext } from "react";

// Base UI portals into the global `document.body`; content rendered in another window sets its own body here.
const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export const PortalContainerProvider = PortalContainerContext.Provider;

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext);
}

import { describe, expect, it } from "vite-plus/test";

import { render } from "../test/render";
import {
  closeRightPanelPopout,
  getFocusedRightPanelPopout,
  openRightPanelPopout,
  useFocusedRightPanelPopout,
} from "./rightPanelPopoutWindow";

function Probe() {
  const popout = useFocusedRightPanelPopout();
  return <output>{popout === null ? "none" : "focused"}</output>;
}

/** window.open is popup-blocked without a user gesture, so stand in an iframe's window. */
function openFakePopoutWindow() {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const fakeWindow = iframe.contentWindow as unknown as Window;
  const originalOpen = window.open;
  window.open = (() => fakeWindow) as typeof window.open;
  const opened = openRightPanelPopout(null, { onClosed: () => {}, onBoundsChange: () => {} });
  window.open = originalOpen;
  return { iframe, fakeWindow, opened };
}

function setPopoutHasFocus(fakeWindow: Window, focused: boolean) {
  Object.defineProperty(fakeWindow.document, "hasFocus", {
    configurable: true,
    value: () => focused,
  });
}

describe("useFocusedRightPanelPopout", () => {
  it("follows focus between the main window and the popout, including a blur that arrives before the popout's focus", async () => {
    await using screen = await render(<Probe />, { router: false });
    await expect.element(screen.getByRole("status")).toHaveTextContent("none");

    const { iframe, fakeWindow, opened } = openFakePopoutWindow();
    expect(opened).not.toBeNull();
    try {
      // The main window can report blur before the popout reports focus; the popout's own
      // focus event must still wake the hook.
      window.dispatchEvent(new Event("blur"));
      await expect.element(screen.getByRole("status")).toHaveTextContent("none");

      setPopoutHasFocus(fakeWindow, true);
      fakeWindow.dispatchEvent(new Event("focus"));
      await expect.element(screen.getByRole("status")).toHaveTextContent("focused");
      expect(getFocusedRightPanelPopout()?.window).toBe(fakeWindow);

      setPopoutHasFocus(fakeWindow, false);
      window.dispatchEvent(new Event("focus"));
      await expect.element(screen.getByRole("status")).toHaveTextContent("none");
    } finally {
      fakeWindow.dispatchEvent(new Event("pagehide"));
      closeRightPanelPopout();
      iframe.remove();
    }
    expect(getFocusedRightPanelPopout()).toBeNull();
  });
});

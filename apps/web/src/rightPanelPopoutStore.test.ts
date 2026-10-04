import { describe, expect, it } from "vite-plus/test";

import {
  resolveRightPanelPopoutSync,
  type RightPanelPopoutSyncSnapshot,
} from "./rightPanelPopoutStore";

const base: RightPanelPopoutSyncSnapshot = {
  threadKey: "env:thread-a",
  popoutOpen: true,
  threadOpen: true,
  revision: 1,
  surfaceCount: 2,
};

describe("resolveRightPanelPopoutSync", () => {
  it("opens the window when the user opens the thread's panel", () => {
    const previous = { ...base, popoutOpen: false, threadOpen: false };
    expect(
      resolveRightPanelPopoutSync(previous, { ...previous, threadOpen: true, revision: 2 }),
    ).toBe("open-window");
  });

  it("closes the window when the user closes the thread's panel", () => {
    expect(resolveRightPanelPopoutSync(base, { ...base, threadOpen: false, revision: 2 })).toBe(
      "close-window",
    );
  });

  it("keeps the window open with an empty panel when the last tab closes", () => {
    expect(
      resolveRightPanelPopoutSync(base, {
        ...base,
        threadOpen: false,
        revision: 2,
        surfaceCount: 0,
      }),
    ).toBe("show-thread-panel");
  });

  it("does not open the window for an automatic open", () => {
    const previous = { ...base, popoutOpen: false, threadOpen: false };
    expect(resolveRightPanelPopoutSync(previous, { ...previous, threadOpen: true })).toBe(
      "hide-thread-panel",
    );
  });

  it("shows the next thread's panel when switching threads with the window open", () => {
    expect(
      resolveRightPanelPopoutSync(base, {
        ...base,
        threadKey: "env:thread-b",
        threadOpen: false,
        revision: 0,
      }),
    ).toBe("show-thread-panel");
  });

  it("hides the thread's panel when the window closes", () => {
    expect(resolveRightPanelPopoutSync(base, { ...base, popoutOpen: false })).toBe(
      "hide-thread-panel",
    );
  });

  it("aligns the thread to the window on first sight", () => {
    expect(resolveRightPanelPopoutSync(null, { ...base, threadOpen: false })).toBe(
      "show-thread-panel",
    );
    expect(resolveRightPanelPopoutSync(null, base)).toBe("none");
  });
});

import { describe, expect, it } from "vite-plus/test";

import { orderToastsBySidebarThread } from "./toast.logic";

type TestToast = {
  id: string;
  limited?: boolean;
  transitionStatus?: "starting" | "ending";
  data?: { sidebarThreadKey?: string };
};

const threadToast = (id: string, sidebarThreadKey: string, extra: Partial<TestToast> = {}) => ({
  id,
  data: { sidebarThreadKey },
  ...extra,
});

const ids = (toasts: readonly TestToast[]) => toasts.map((toast) => toast.id);

describe("orderToastsBySidebarThread", () => {
  it("stacks thread alerts by sidebar position regardless of arrival", () => {
    // Base UI lists the newest toast first.
    const toasts = [
      threadToast("bottom", "t3"),
      threadToast("top", "t1"),
      threadToast("mid", "t2"),
    ];

    expect(ids(orderToastsBySidebarThread(toasts, ["t1", "t2", "t3"], 5))).toEqual([
      "top",
      "mid",
      "bottom",
    ]);
  });

  it("keeps other toasts in front, newest first", () => {
    const toasts: TestToast[] = [
      threadToast("alert", "t1"),
      { id: "error-new" },
      { id: "error-old", data: {} },
    ];

    expect(ids(orderToastsBySidebarThread(toasts, ["t1"], 5))).toEqual([
      "error-new",
      "error-old",
      "alert",
    ]);
  });

  it("puts alerts for unlisted threads last, in arrival order", () => {
    const toasts = [
      threadToast("unlisted-new", "gone-1"),
      threadToast("listed", "t1"),
      threadToast("unlisted-old", "gone-2"),
    ];

    expect(ids(orderToastsBySidebarThread(toasts, ["t1"], 5))).toEqual([
      "listed",
      "unlisted-new",
      "unlisted-old",
    ]);
  });

  it("hides the lowest threads past the limit, not the oldest arrivals", () => {
    // Base UI limited the oldest arrival, which is the top thread here.
    const toasts = [
      threadToast("bottom", "t3"),
      threadToast("mid", "t2"),
      threadToast("top", "t1", { limited: true }),
    ];

    const ordered = orderToastsBySidebarThread(toasts, ["t1", "t2", "t3"], 2);

    expect(ordered.map((toast) => [toast.id, toast.limited ?? false])).toEqual([
      ["top", false],
      ["mid", false],
      ["bottom", true],
    ]);
  });

  it("does not count closing toasts toward the limit", () => {
    const toasts = [
      threadToast("closing", "t1", { transitionStatus: "ending" }),
      threadToast("mid", "t2"),
      threadToast("bottom", "t3"),
    ];

    const ordered = orderToastsBySidebarThread(toasts, ["t1", "t2", "t3"], 2);

    expect(ordered.map((toast) => toast.limited ?? false)).toEqual([false, false, false]);
  });
});

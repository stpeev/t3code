import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";

/** Base UI updates omit undefined; clear actions with defined actionProps and empty children, treated as
 * invisible. */
export function hasVisibleToastAction(actionProps: unknown): boolean {
  if (actionProps == null || typeof actionProps !== "object") {
    return false;
  }
  if (!("children" in actionProps)) {
    return false;
  }
  const children = actionProps.children;
  return children != null && children !== false && children !== "";
}

export function shouldHideCollapsedToastContent(
  visibleToastIndex: number,
  visibleToastCount: number,
): boolean {
  if (visibleToastCount <= 1) return false;
  return visibleToastIndex > 0;
}

type ToastWithHeight = {
  height?: number | null | undefined;
};

type ToastWithTransitionStatus = {
  transitionStatus?: "starting" | "ending" | undefined;
};

type ToastWithLayoutProps = ToastWithHeight & ToastWithTransitionStatus;

type VisibleToastLayoutItem<TToast extends object> = {
  toast: TToast;
  visibleIndex: number;
  offsetY: number;
};

export function buildVisibleToastLayout<TToast extends object>(
  visibleToasts: readonly (TToast & ToastWithLayoutProps)[],
): {
  frontmostHeight: number;
  items: VisibleToastLayoutItem<TToast & ToastWithLayoutProps>[];
} {
  let fullIndex = 0;
  let fullOffsetY = 0;
  let liveIndex = 0;
  let liveOffsetY = 0;

  const items: VisibleToastLayoutItem<TToast & ToastWithLayoutProps>[] = visibleToasts.map(
    (toast) => {
      const height = normalizeToastHeight(toast.height);

      if (toast.transitionStatus === "ending") {
        const item = {
          toast,
          visibleIndex: fullIndex,
          offsetY: fullOffsetY,
        };
        fullOffsetY += height;
        fullIndex += 1;
        return item;
      }

      const item = {
        toast,
        visibleIndex: liveIndex,
        offsetY: liveOffsetY,
      };

      fullOffsetY += height;
      fullIndex += 1;
      liveOffsetY += height;
      liveIndex += 1;
      return item;
    },
  );

  const frontmostLiveToast = visibleToasts.find((toast) => toast.transitionStatus !== "ending");

  return {
    frontmostHeight: normalizeToastHeight(frontmostLiveToast?.height),
    items,
  };
}

type OrderableToast = ToastWithTransitionStatus & {
  limited?: boolean | undefined;
  data?: { sidebarThreadKey?: string | undefined } | undefined;
};

/** Thread alerts go behind other toasts in sidebar order; re-limits, as Base UI limits by arrival. */
export function orderToastsBySidebarThread<TToast extends OrderableToast>(
  toasts: readonly TToast[],
  sidebarThreadKeys: readonly string[],
  limit: number,
): TToast[] {
  const rankByKey = new Map(sidebarThreadKeys.map((key, index) => [key, index]));
  const rank = (toast: TToast) => {
    const key = toast.data?.sidebarThreadKey;
    if (key === undefined) return -1;
    return rankByKey.get(key) ?? sidebarThreadKeys.length;
  };
  let liveIndex = 0;
  return toasts
    .toSorted((left, right) => rank(left) - rank(right))
    .map((toast) => {
      if (toast.transitionStatus === "ending") return toast;
      const limited = liveIndex >= limit;
      liveIndex += 1;
      return (toast.limited ?? false) === limited ? toast : { ...toast, limited };
    });
}

function normalizeToastHeight(height: number | null | undefined): number {
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
}

export function shouldRenderThreadScopedToast(
  data:
    | {
        threadRef?: ScopedThreadRef | null;
        threadId?: ThreadId | null;
      }
    | undefined,
  activeThreadRef: ScopedThreadRef | null,
): boolean {
  if (data?.threadRef) {
    return (
      activeThreadRef !== null &&
      data.threadRef.environmentId === activeThreadRef.environmentId &&
      data.threadRef.threadId === activeThreadRef.threadId
    );
  }

  const toastThreadId = data?.threadId;
  if (!toastThreadId) {
    return true;
  }

  return activeThreadRef?.threadId === toastThreadId;
}

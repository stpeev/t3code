import {
  type ContextWindowSnapshot,
  summarizeContextUsage,
} from "@t3tools/client-runtime/context-window";
import type { ProviderDriverKind } from "@t3tools/contracts";
import { GaugeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { barColor } from "../usage/UsageLimits";
import { ComposerBanner } from "./ComposerBanner";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

const LABEL_CLASS_NAME =
  "col-start-1 flex h-6 items-center whitespace-nowrap text-muted-foreground";
const TRAILING_CLASS_NAME =
  "flex items-center justify-end whitespace-nowrap text-muted-foreground tabular-nums";

/** The /context-usage result as a composer notice; it re-reads the snapshot as the turn runs. */
export function contextUsageBannerItem(
  id: string,
  snapshot: ContextWindowSnapshot,
  driver: ProviderDriverKind,
  actions: ReactNode,
  onDismiss: () => void,
): ComposerBannerStackItem {
  const summary = summarizeContextUsage(snapshot);
  // Without a last-request row there is nowhere to trail the total, so it joins the heading.
  const processedNote =
    summary.lastRequest === null && summary.totalProcessed !== null
      ? [`${summary.totalProcessed} processed`]
      : [];
  const hasBar = summary.usedPercentage !== null && summary.percentage !== null;
  return {
    id,
    variant: "info",
    priority: "notice",
    icon: <GaugeIcon />,
    title: "Context usage",
    description: [summary.tokens, ...summary.notes, ...processedNote].join(" · "),
    actions,
    dismissLabel: "Dismiss context usage",
    onDismiss,
    children:
      hasBar || summary.lastRequest !== null ? (
        <ComposerBanner.Body className="pt-1 pb-1.5 pe-2">
          {/* Labels, then values sharing one left edge, then /usage-limits-style trailing text. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-xs">
            {hasBar ? (
              <>
                <span className={LABEL_CLASS_NAME}>Used</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-8 shrink-0 font-medium text-foreground tabular-nums">
                    {summary.percentage}
                  </span>
                  <div
                    className="relative h-6 min-w-12 flex-1"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(summary.usedPercentage ?? 0)}
                    aria-label="Context window usage"
                  >
                    <div className="absolute inset-x-0 inset-y-1.5 rounded-full bg-muted" />
                    <div
                      className="absolute inset-y-1.5 left-0 rounded-full"
                      style={{
                        width: `${summary.usedPercentage}%`,
                        backgroundColor: barColor(driver),
                      }}
                    />
                  </div>
                </span>
                <span className={TRAILING_CLASS_NAME}>
                  {summary.remaining ? `${summary.remaining} left` : ""}
                </span>
              </>
            ) : null}
            {summary.lastRequest !== null ? (
              <>
                <span className={LABEL_CLASS_NAME}>Last request</span>
                <span className="flex min-w-0 items-center">
                  <span className="truncate font-medium text-foreground tabular-nums">
                    {summary.lastRequest}
                  </span>
                </span>
                <span className={TRAILING_CLASS_NAME}>
                  {summary.totalProcessed ? `${summary.totalProcessed} processed` : ""}
                </span>
              </>
            ) : null}
          </div>
        </ComposerBanner.Body>
      ) : undefined,
  };
}

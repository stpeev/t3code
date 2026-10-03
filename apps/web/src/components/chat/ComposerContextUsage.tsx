import {
  type ContextUsageRow,
  type ContextWindowSnapshot,
  summarizeContextUsage,
} from "@t3tools/client-runtime/context-window";
import type { ProviderDriverKind } from "@t3tools/contracts";
import { GaugeIcon } from "lucide-react";
import type { ReactNode } from "react";

import { barColor } from "../usage/UsageLimits";
import { ComposerBanner } from "./ComposerBanner";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** The /context-usage result as a composer notice; it re-reads the snapshot as the turn runs. */
export function contextUsageBannerItem(
  id: string,
  snapshot: ContextWindowSnapshot,
  driver: ProviderDriverKind,
  actions: ReactNode,
  onDismiss: () => void,
): ComposerBannerStackItem {
  const summary = summarizeContextUsage(snapshot);
  return {
    id,
    variant: "info",
    priority: "notice",
    icon: <GaugeIcon />,
    title: "Context usage",
    description: summary.headline,
    actions,
    dismissLabel: "Dismiss context usage",
    onDismiss,
    children: (
      <ComposerBanner.Body className="flex flex-col gap-2 pt-1 pb-1.5 pe-2">
        {summary.usedPercentage !== null ? (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(summary.usedPercentage)}
            aria-label="Context window usage"
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${summary.usedPercentage}%`, backgroundColor: barColor(driver) }}
            />
          </div>
        ) : null}
        <UsageRows rows={summary.rows} />
        {summary.lastRequestRows.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-2xs font-medium text-muted-foreground">Last request</span>
            <UsageRows rows={summary.lastRequestRows} />
          </div>
        ) : null}
      </ComposerBanner.Body>
    ),
  };
}

function UsageRows({ rows }: { readonly rows: ReadonlyArray<ContextUsageRow> }) {
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-end tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

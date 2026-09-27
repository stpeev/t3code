import {
  type ContextWindowSnapshot,
  summarizeContextUsage,
} from "@t3tools/client-runtime/context-window";
import type { ProviderDriverKind } from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { useBarColor } from "../usage/UsageLimitsSection";

/** The /context-usage result, docked above the composer; it re-reads the snapshot as the turn runs. */
export function ComposerContextUsage({
  snapshot,
  driver,
  onClose,
}: {
  readonly snapshot: ContextWindowSnapshot;
  readonly driver: ProviderDriverKind | null;
  readonly onClose: () => void;
}) {
  const color = useBarColor(driver);
  const summary = summarizeContextUsage(snapshot);
  const used = summary.usedPercentage === null ? null : Math.round(summary.usedPercentage);
  // Without a bar there is nowhere under it for the total, so it joins the heading.
  const detail = [
    summary.tokens,
    ...summary.notes,
    ...(used === null && summary.totalProcessed ? [`${summary.totalProcessed} processed`] : []),
  ].join(" · ");
  return (
    <View className="gap-3 overflow-hidden rounded-[20px] border-continuous bg-card px-4 py-3">
      <View className="flex-row items-center gap-2">
        {driver ? <ProviderIcon provider={driver} size={16} /> : null}
        <View className="min-w-0 flex-1 flex-row items-baseline gap-2">
          <Text className="text-base font-t3-medium text-foreground">Context usage</Text>
          <Text className="shrink text-sm text-foreground-muted" numberOfLines={1}>
            · {detail}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Dismiss context usage"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onClose}
          className="-me-1 p-1 active:opacity-60"
        >
          <SymbolView
            name="xmark"
            size={14}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </Pressable>
      </View>
      {used !== null ? (
        <View className="gap-1">
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="text-sm text-foreground">Used</Text>
            <Text className="text-sm font-t3-medium tabular-nums text-foreground">
              {summary.percentage}
            </Text>
          </View>
          <View className="h-3 justify-center">
            <View className="h-1.5 flex-row overflow-hidden rounded-full bg-subtle">
              <View
                className={
                  used >= 90
                    ? "h-full rounded-full bg-red-500"
                    : "h-full rounded-full bg-foreground"
                }
                style={[{ flex: used }, used < 90 && color ? { backgroundColor: color } : null]}
              />
              <View style={{ flex: 100 - used }} />
            </View>
          </View>
          <View className="flex-row justify-between gap-3">
            <Text className="text-xs tabular-nums text-foreground-tertiary">
              {summary.totalProcessed ? `${summary.totalProcessed} processed` : ""}
            </Text>
            <Text className="text-xs tabular-nums text-foreground-tertiary">
              {summary.remaining ? `${summary.remaining} left` : ""}
            </Text>
          </View>
        </View>
      ) : null}
      {summary.lastRequest !== null ? (
        <View className="flex-row items-baseline justify-between gap-3">
          <Text className="text-sm text-foreground">Last request</Text>
          <Text
            className="shrink text-sm font-t3-medium tabular-nums text-foreground"
            numberOfLines={1}
          >
            {summary.lastRequest}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

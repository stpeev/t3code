import {
  type ContextUsageRow,
  type ContextWindowSnapshot,
  summarizeContextUsage,
} from "@t3tools/client-runtime/context-window";
import type { ProviderDriverKind } from "@t3tools/contracts";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
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
  const { height } = useWindowDimensions();
  const color = useBarColor(driver);
  const summary = summarizeContextUsage(snapshot);
  const used = summary.usedPercentage === null ? null : Math.round(summary.usedPercentage);
  return (
    <View className="overflow-hidden rounded-[20px] border-continuous bg-card">
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: Math.round(height * 0.4) }}
        contentContainerClassName="gap-3 px-4 py-3"
      >
        <View className="flex-row items-center gap-3">
          <Text className="min-w-0 flex-1 text-base text-foreground">Context usage</Text>
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
        <View className="gap-1">
          <Text className="text-sm font-t3-medium tabular-nums text-foreground">
            {summary.headline}
          </Text>
          {used !== null ? (
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
          ) : null}
        </View>
        <UsageRows rows={summary.rows} />
        {summary.lastRequestRows.length > 0 ? (
          <View className="gap-1">
            <Text className="text-xs text-foreground-tertiary">Last request</Text>
            <UsageRows rows={summary.lastRequestRows} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function UsageRows({ rows }: { readonly rows: ReadonlyArray<ContextUsageRow> }) {
  if (rows.length === 0) return null;
  return (
    <View className="gap-1">
      {rows.map((row) => (
        <View key={row.label} className="flex-row items-baseline justify-between gap-3">
          <Text className="text-sm text-foreground-muted">{row.label}</Text>
          <Text className="text-sm tabular-nums text-foreground">{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

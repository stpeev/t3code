import { GlobeIcon } from "lucide-react";
import type {
  EnvironmentId,
  EnvironmentMachineKind,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";

import { shortcutLabelForCommand, sidebarEnvironmentCommandForIndex } from "../../keybindings";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { resolveSidebarEnvironmentScopeToggle } from "../Sidebar.logic";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";
import { msg, T } from "gt-react";
import { m } from "~/i18n/messages";

interface EnvironmentIdentity {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/**
 * Filter icons on the sidebar header line: one "All" globe plus one icon per
 * environment. Exactly one is sunken (pressed): click an environment icon to show
 * only it, click All to show everything. Shift-click an environment icon to toggle
 * it for multi-select. mod+alt+1..9 solos an environment, mod+alt+0 shows all.
 */
export function SidebarEnvironmentToggleGroup(props: {
  readonly environments: readonly EnvironmentIdentity[];
  readonly machineByEnvironmentId: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  readonly connectedEnvironmentIds: readonly EnvironmentId[];
  readonly scopedEnvironmentIds: readonly EnvironmentId[];
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onScopeChange: (ids: readonly EnvironmentId[]) => void;
}) {
  const allIds = props.environments.map((environment) => environment.environmentId);
  const allSelected = props.scopedEnvironmentIds.length === 0;
  const allShortcutLabel = shortcutLabelForCommand(props.keybindings, "sidebar.environment.all");
  return (
    <div
      role="group"
      aria-label={msg("Filter threads by environment")}
      className="flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto"
    >
      <SidebarHeaderIconButton
        label={msg("All environments")}
        tooltip={
          <span className="flex flex-col gap-0.5">
            <span>
              <T>All environments</T>
            </span>
            <span className="text-muted-foreground">
              {allSelected ? m(msg("Shown")) : m(msg("Hidden"))}
              {allShortcutLabel
                ? m(
                    msg(" · show all with {allShortcutLabel}", {
                      allShortcutLabel: allShortcutLabel,
                    }),
                  )
                : ""}
            </span>
          </span>
        }
        aria-pressed={allSelected}
        isActive={allSelected}
        variant="pressed"
        onClick={() => {
          props.onScopeChange([]);
        }}
      >
        <GlobeIcon aria-hidden className="size-4" />
      </SidebarHeaderIconButton>
      {props.environments.map((environment, index) => {
        const pressed = props.scopedEnvironmentIds.includes(environment.environmentId);
        const offline = !props.connectedEnvironmentIds.includes(environment.environmentId);
        const shortcutCommand = sidebarEnvironmentCommandForIndex(index);
        const shortcutLabel = shortcutCommand
          ? shortcutLabelForCommand(props.keybindings, shortcutCommand)
          : null;
        const name = offline ? `${environment.label} (offline)` : environment.label;
        return (
          <SidebarHeaderIconButton
            key={environment.environmentId}
            label={name}
            tooltip={
              <span className="flex flex-col gap-0.5">
                <span>{name}</span>
                <span className="text-muted-foreground">
                  {pressed ? m(msg("Shown")) : m(msg("Hidden"))}
                  {shortcutLabel
                    ? m(
                        msg(" · show only this with {shortcutLabel}", {
                          shortcutLabel: shortcutLabel,
                        }),
                      )
                    : ""}
                  {m(msg(" · Shift+click to add or remove"))}
                </span>
              </span>
            }
            aria-pressed={pressed}
            isActive={pressed}
            variant="pressed"
            onClick={(event) => {
              props.onScopeChange(
                resolveSidebarEnvironmentScopeToggle({
                  scopedIds: props.scopedEnvironmentIds,
                  allIds,
                  target: environment.environmentId,
                  additive: event.shiftKey,
                }),
              );
            }}
          >
            <EnvironmentMachineIcon
              aria-hidden
              kind={props.machineByEnvironmentId.get(environment.environmentId) ?? "server"}
              className="size-4"
            />
          </SidebarHeaderIconButton>
        );
      })}
    </div>
  );
}

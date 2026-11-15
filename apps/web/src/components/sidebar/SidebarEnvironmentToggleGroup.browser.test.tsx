import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { compileResolvedKeybindingsConfig, DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { EnvironmentId, type EnvironmentMachineKind } from "@t3tools/contracts";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { SidebarEnvironmentToggleGroup } from "./SidebarEnvironmentToggleGroup";

const local = EnvironmentId.make("environment-local");
const vps = EnvironmentId.make("environment-vps");
const cloud = EnvironmentId.make("environment-cloud");

const environments = [
  { environmentId: local, label: "MacBook" },
  { environmentId: vps, label: "VPS" },
  { environmentId: cloud, label: "Cloud" },
];
const machines = new Map<EnvironmentId, EnvironmentMachineKind>([
  [local, "laptop"],
  [vps, "server"],
  [cloud, "cloud"],
]);
const keybindings = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);

// The real sidebar feeds the chosen scope back in as a prop, so the harness does too.
function StatefulGroup(props: {
  readonly initialScope: readonly EnvironmentId[];
  readonly onScopeChange: (ids: readonly EnvironmentId[]) => void;
}) {
  const [scope, setScope] = useState<readonly EnvironmentId[]>(props.initialScope);
  return (
    <SidebarProvider>
      <TooltipProvider>
        <SidebarEnvironmentToggleGroup
          environments={environments}
          machineByEnvironmentId={machines}
          connectedEnvironmentIds={[local, cloud]}
          scopedEnvironmentIds={scope}
          keybindings={keybindings}
          onScopeChange={(ids) => {
            props.onScopeChange(ids);
            setScope(ids);
          }}
        />
      </TooltipProvider>
    </SidebarProvider>
  );
}

function renderGroup(initialScope: readonly EnvironmentId[], onScopeChange = vi.fn()) {
  return render(<StatefulGroup initialScope={initialScope} onScopeChange={onScopeChange} />);
}

const button = (screen: Awaited<ReturnType<typeof renderGroup>>, name: string) =>
  screen.getByRole("button", { name });

describe("SidebarEnvironmentToggleGroup", () => {
  it("presses only the All button when the scope is all", async () => {
    await using screen = await renderGroup([]);
    await expect
      .element(button(screen, "All environments"))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(button(screen, "MacBook")).toHaveAttribute("aria-pressed", "false");
    await expect.element(button(screen, "VPS (offline)")).toHaveAttribute("aria-pressed", "false");
    await expect.element(button(screen, "Cloud")).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an environment solos it and turns the others off; clicking it again keeps it on", async () => {
    const onScopeChange = vi.fn();
    await using screen = await renderGroup([], onScopeChange);

    await userEvent.click(button(screen, "VPS (offline)"));
    expect(onScopeChange).toHaveBeenLastCalledWith([vps]);
    await expect.element(button(screen, "VPS (offline)")).toHaveAttribute("aria-pressed", "true");
    await expect.element(button(screen, "MacBook")).toHaveAttribute("aria-pressed", "false");
    await expect
      .element(button(screen, "All environments"))
      .toHaveAttribute("aria-pressed", "false");

    await userEvent.click(button(screen, "VPS (offline)"));
    expect(onScopeChange).toHaveBeenLastCalledWith([vps]);

    await userEvent.click(button(screen, "MacBook"));
    expect(onScopeChange).toHaveBeenLastCalledWith([local]);
    await expect.element(button(screen, "MacBook")).toHaveAttribute("aria-pressed", "true");
    await expect.element(button(screen, "VPS (offline)")).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking All returns to the all-scope", async () => {
    const onScopeChange = vi.fn();
    await using screen = await renderGroup([local], onScopeChange);

    await userEvent.click(button(screen, "All environments"));
    expect(onScopeChange).toHaveBeenLastCalledWith([]);
    await expect
      .element(button(screen, "All environments"))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(button(screen, "MacBook")).toHaveAttribute("aria-pressed", "false");
  });

  it("shift-click toggles membership for multi-select", async () => {
    const onScopeChange = vi.fn();
    await using screen = await renderGroup([local], onScopeChange);

    await userEvent.click(button(screen, "VPS (offline)"), { modifiers: ["Shift"] });
    expect(onScopeChange).toHaveBeenLastCalledWith([local, vps]);

    await userEvent.click(button(screen, "MacBook"), { modifiers: ["Shift"] });
    expect(onScopeChange).toHaveBeenLastCalledWith([vps]);
  });
});

import {
  type EnvironmentId,
  type ModelSelection,
  type OrchestratorMcpTaskRole,
  type ProviderInstanceId,
  type ServerProvider,
  SUBAGENT_MODEL_SELECTION_SETTING_KEY_BY_ROLE,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { getCustomModelOptionsByInstance, selectsPlanAgent } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { searchableSetting, type SettingsSearchItemId } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const ROLE_ROWS: ReadonlyArray<{
  readonly role: OrchestratorMcpTaskRole;
  readonly label: string;
  readonly description: string;
  readonly searchId: SettingsSearchItemId;
}> = [
  {
    role: "implementation",
    label: "Implementation",
    description: "Delegated tasks that write or change code.",
    searchId: "subagent-model-implementation",
  },
  {
    role: "research",
    label: "Research",
    description: "Delegated tasks that investigate code or docs to answer a question.",
    searchId: "subagent-model-research",
  },
  {
    role: "review",
    label: "Review",
    description: "Delegated tasks that review a change.",
    searchId: "subagent-model-review",
  },
  {
    role: "design",
    label: "Design",
    description: "Delegated tasks that plan an approach or an interface.",
    searchId: "subagent-model-design",
  },
  {
    role: "test",
    label: "Test",
    description: "Delegated tasks that write or run tests.",
    searchId: "subagent-model-test",
  },
  {
    role: "general",
    label: "General",
    description: "Delegated tasks the agent gives no role.",
    searchId: "subagent-model-general",
  },
];

/** The model each delegated task role runs on when the agent names none; off uses the thread's model. */
export function SubagentModelSettings() {
  const { target, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providers =
    (representative?.serverConfig
      ? providersByEnvironment.get(representative.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      target?.projectId ?? null,
    ),
  );
  const runnableInstanceIds = new Set(
    entries.filter((entry) => entry.enabled && entry.isAvailable).map((entry) => entry.instanceId),
  );
  // A role turned on starts from the new-thread model, limited to providers this project can run.
  const startSelection = resolveDefaultProviderModelSelection(
    providers.filter((provider) => runnableInstanceIds.has(provider.instanceId)),
    settings.defaultModelSelection,
  );
  const disabledReason = useScopedModelDisabledReason(settings, entries);
  const shared = {
    hasEnvironment: connectedEnvironments.length > 0,
    environmentId: representative?.environmentId ?? null,
    settings,
    updateSettings,
    providers,
    entries,
    startSelection,
    disabledReason,
  };
  return (
    <SettingsSection
      id="subagent-models"
      title="Subagent models"
      description="While any role has a model, agents' built-in subagent tools are turned off on Claude, Cursor, OpenCode, Codex and Pi, so delegation goes through T3 Code."
    >
      {ROLE_ROWS.map((row) => (
        <SubagentModelRow key={row.role} {...row} shared={shared} />
      ))}
    </SettingsSection>
  );
}

function SubagentModelRow({
  role,
  label,
  description,
  searchId,
  shared,
}: (typeof ROLE_ROWS)[number] & {
  readonly shared: {
    readonly hasEnvironment: boolean;
    readonly environmentId: EnvironmentId | null;
    readonly settings: UnifiedSettings;
    readonly updateSettings: ReturnType<typeof useUpdateScopedSettings>;
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly entries: ReadonlyArray<ProviderInstanceEntry>;
    readonly startSelection: ModelSelection | null;
    readonly disabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  };
}) {
  const { settings, updateSettings, entries, disabledReason } = shared;
  const settingKey = SUBAGENT_MODEL_SELECTION_SETTING_KEY_BY_ROLE[role];
  const mixed = useScopedSettingsMixed([settingKey]);
  const configured = settings[settingKey];
  const selection = configured ?? shared.startSelection;
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    shared.providers,
    selection?.instanceId,
    selection?.model,
  );

  const save = (value: ModelSelection) => {
    const reason = disabledReason(value.instanceId, value.model);
    if (reason) {
      toastManager.add({
        type: "error",
        title: `${label} subagent model not saved`,
        description: reason,
      });
      return;
    }
    updateSettings({ [settingKey]: value });
  };

  return (
    <SettingsRow
      serverScoped
      settingKeys={[settingKey]}
      mixed={mixed}
      {...searchableSetting(searchId)}
      title={label}
      resetLabel={`${label.toLowerCase()} subagent model`}
      description={description}
      status={configured === null && !mixed ? "Thread's model" : undefined}
      control={
        !shared.hasEnvironment || selection === null ? (
          <span className="text-sm text-muted-foreground">No providers available</span>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {configured !== null || mixed ? (
              <ProviderModelPicker
                environmentId={shared.environmentId}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={modelOptions}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel={`${label} subagent model`}
                {...(mixed ? { triggerLabel: "Mixed" } : {})}
                getModelDisabledReason={disabledReason}
                onInstanceModelChange={(instanceId: ProviderInstanceId, model: string) =>
                  save(createModelSelection(instanceId, model))
                }
              />
            ) : null}
            {configured !== null && !mixed && activeEntry ? (
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={configured.model}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={configured.options ?? []}
                allowPromptInjectedEffort={false}
                planModeEnabled={settings.planModeEnabled || selectsPlanAgent(configured.options)}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  save(createModelSelection(configured.instanceId, configured.model, options))
                }
              />
            ) : null}
            <Switch
              mixed={mixed}
              checked={mixed ? false : configured !== null}
              onCheckedChange={(checked) => {
                if (!checked) {
                  updateSettings({ [settingKey]: null });
                  return;
                }
                save(
                  createModelSelection(selection.instanceId, selection.model, selection.options),
                );
              }}
              aria-label={`Use a separate ${label.toLowerCase()} subagent model`}
            />
          </div>
        )
      }
    />
  );
}

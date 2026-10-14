import { useAtomValue } from "@effect/atom-react";
import { NotificationSettings } from "./NotificationSettings";
import { PRIVACY_POLICY_URL } from "../../legalLinks";
import { CheckIcon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  type DesktopUpdateChannel,
  IDLE_COMPACTION_MODES,
  globalIdleCompaction,
  managedUpdatesDenial,
  managedUpdatesMessage,
  ProviderDriverKind,
  type ProviderInstanceId,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  type DiffLayout,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type ResponseStreamingMode,
  type QuitConfirmationMode,
  SidebarProjectSortOrder,
  ScreenReaderAnnouncements,
  ToolCallVisibility,
  ToastPosition,
} from "@t3tools/contracts/settings";
import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import { createModelSelection, pickModelSelection } from "@t3tools/shared/model";
import { resolvePastedPath } from "@t3tools/shared/path";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import { AboutVersionTitle } from "./AboutVersionTitle";
import { CliCommandSettingsRow } from "./CliCommandSettingsRow";
import { MobileAppSettingsRow } from "./MobileAppSettingsRow";
import {
  canCheckForUpdate,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateInstallConfirmationMessage,
  installDesktopUpdate,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import { scopedIdleCompaction } from "./scopedSettings";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
import { SubagentModelSettings } from "./SubagentModelSettings";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { managedTelemetryOffMessage, usePrimaryManagedPolicy } from "../../state/managedPolicy";
import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import { useTextGenerationTargets } from "../../textGenerators";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  autoSettleDaysField,
  cancelAutoSettleDaysField,
  commitAutoSettleDaysField,
  editAutoSettleDaysField,
  failAutoSettleDaysField,
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  syncAutoSettleDaysField,
} from "./SettingsPanels.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting, type SettingsSearchItemId } from "./settingsSearch";
import { nativeLanguageName, SYSTEM_LANGUAGE } from "@t3tools/client-runtime/locales";
import { SUPPORTED_LOCALES } from "../../i18n/locales";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { PullRequestLinksOpenInAppSetting } from "./IntegrationsSettings";
import { StorageCleanupSections } from "./StorageSettings";
import { UpdateTrackSwitchDialog } from "./UpdateTrackSwitchDialog";
import { environmentIdsKey } from "~/state/environmentAtomList";
import { environmentSessionStatesAtom } from "~/state/session";
import { useCheckProviderUpdates } from "../ProviderUpdatesAction";
import { canUpdateServer } from "../ServerUpdateAction";
import { downloadLocalUpdate } from "../sidebar/SidebarUpdatePill";
import { useUpdateEverythingRun } from "../sidebar/updateEverythingRun";
import { awaitsTrackSwitch, channelSwitchLabel } from "../sidebar/updateEverything.logic";
import { isHostedByThisApp } from "../sidebar/useUpdateEverything";
import { m } from "~/i18n/messages";

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "Wait for the full response",
  paragraph: "Show finished paragraphs",
};

const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: "Text appears once the agent finishes its turn.",
  paragraph: "Each paragraph or code block appears as soon as it is complete.",
};

const SIDEBAR_PROJECT_SORT_ORDER_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: msg("Last user message"),
  created_at: msg("Created at"),
  manual: msg("Manual"),
};
const isSidebarProjectSortOrder = Schema.is(SidebarProjectSortOrder);

const TIMESTAMP_FORMAT_LABELS = {
  locale: msg("System default"),
  "12-hour": msg("12-hour"),
  "24-hour": msg("24-hour"),
};

const TOAST_POSITION_LABELS: Record<ToastPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};
const isToastPosition = Schema.is(ToastPosition);

const DIFF_LAYOUT_LABELS: Record<DiffLayout, string> = {
  stacked: "Stacked",
  split: "Split",
};

const QUIT_CONFIRMATION_MODE_LABELS: Record<QuitConfirmationMode, string> = {
  direct: msg("Direct"),
  hold: msg("Hold"),
  "double-click": msg("Double press"),
};

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
function AboutVersionSection() {
  const updateState = useDesktopUpdateState();
  const [switchChannel, setSwitchChannel] = useState<DesktopUpdateChannel | null>(null);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);
  const { environments } = useEnvironments();
  const sessionStates = useAtomValue(
    environmentSessionStatesAtom(
      environmentIdsKey(environments.map(({ environmentId }) => environmentId)),
    ),
  );
  // A second run would replace the first run's progress and local download.
  const updateRun = useUpdateEverythingRun();
  const checkProviderUpdates = useCheckProviderUpdates();

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  // The desktop updates this machine, whose policy the primary environment reports.
  const primaryPolicy = usePrimaryManagedPolicy();
  const updatesDenial = hasDesktopBridge ? managedUpdatesDenial(primaryPolicy) : undefined;
  const nightlyDeniedBy =
    hasDesktopBridge && primaryPolicy?.limits?.updates?.allowNightly === false
      ? primaryPolicy.organization
      : undefined;
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;
  // A switch that failed part way leaves this app or a server on the other track.
  // With its updater off, a switch cannot move this app, so it is not counted.
  const appOffTrack =
    updateState?.enabled !== false && desktopUpdateChannelOf(APP_VERSION) !== selectedUpdateChannel;
  const unswitchedMachines =
    (appOffTrack ? 1 : 0) +
    environments.filter(
      (environment, index) =>
        environment.connection.phase === "connected" &&
        canUpdateServer(sessionStates[index]!) &&
        awaitsTrackSwitch(
          {
            serverConfig: environment.serverConfig,
            hostedByThisApp: isHostedByThisApp(environment),
          },
          selectedUpdateChannel,
        ),
    ).length;

  const handleButtonClick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void downloadLocalUpdate(bridge, { notifyDownloaded: false });
      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
          ),
          { initialFocus: "confirm" },
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: m(msg("Could not confirm update")),
            description:
              error instanceof Error ? error.message : m(msg("Update confirmation failed.")),
          }),
        );
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void installDesktopUpdate(bridge)
        .then((result) => {
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: m(msg("Could not install update")),
              description: actionError,
            }),
          );
        })
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: m(msg("Could not install update")),
              description: error instanceof Error ? error.message : m(msg("Install failed.")),
            }),
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void checkProviderUpdates();
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: m(msg("Could not check for updates")),
              description:
                updatesDenial ??
                result.state.message ??
                m(msg("Automatic updates are not available in this build.")),
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: m(msg("Could not check for updates")),
            description: error instanceof Error ? error.message : m(msg("Update check failed.")),
          }),
        );
      });
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    // Off its track, "up to date" only means no switch is pending; Review moves it.
    ...(appOffTrack ? {} : { "up-to-date": "Up to Date" }),
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : (getDesktopUpdateDisabledReason(updateState, updatesDenial) ??
        "Current version of the application.");

  return (
    <>
      <SettingsRow
        id={searchableSetting("app-version").id}
        title={<AboutVersionTitle />}
        description={description}
        managed={updatesDenial}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={buttonDisabled || isUpdateActionPending}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description={
            nightlyDeniedBy !== undefined ? (
              m(
                msg("{arg0} Nightly builds are not available{arg1}", {
                  arg0: managedUpdatesMessage(nightlyDeniedBy),
                  arg1:
                    selectedUpdateChannel === "nightly"
                      ? "; switch to Stable to keep getting updates."
                      : ".",
                }),
              )
            ) : unswitchedMachines > 0 ? (
              <>
                {unswitchedMachines === 1
                  ? m(msg("1 machine still runs"))
                  : m(
                      msg("{unswitchedMachines} machines still run", {
                        unswitchedMachines: unswitchedMachines,
                      }),
                    )}{" "}
                {channelSwitchLabel(selectedUpdateChannel === "nightly" ? "latest" : "nightly")}.{" "}
                {/* The dialog moves what it can and says why it skips the rest. */}
                <Button
                  size="xs"
                  variant="link"
                  disabled={updateRun !== null}
                  onClick={() => setSwitchChannel(selectedUpdateChannel)}
                >
                  <T>Review</T>
                </Button>
              </>
            ) : (
              m(
                msg(
                  "Switches this app and every connected machine whose database the target release supports.",
                ),
              )
            )
          }
          managed={updatesDenial}
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                if (value !== selectedUpdateChannel) {
                  setSwitchChannel(value as DesktopUpdateChannel);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={m(msg("Update track"))}
                disabled={switchChannel !== null || updateRun !== null}
              >
                <SelectValue>{channelSwitchLabel(selectedUpdateChannel)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  <T>Stable</T>
                </SelectItem>
                <SelectItem
                  hideIndicator
                  value="nightly"
                  disabled={nightlyDeniedBy !== undefined && selectedUpdateChannel !== "nightly"}
                >
                  <T>Nightly</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description={msg("Switches the hosted app release channel.")}
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={m(msg("Update track"))}
              >
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  <T>Latest</T>
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  <T>Nightly</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
      {switchChannel === null ? null : (
        <UpdateTrackSwitchDialog channel={switchChannel} onClose={() => setSwitchChannel(null)} />
      )}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const gt = useGT();
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = [
    ...(theme !== "system" ? ["Theme"] : []),
    ...(!followSystem ? ["Follow system"] : []),
    ...(themeHalves !== null ? ["Theme mix"] : []),
    ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
      ? ["Contrast"]
      : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? ["Diff colors"]
      : []),
    ...(settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? [gt("Chat width")] : []),
    ...(settings.htmlPreviewWidth !== DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth
      ? [gt("HTML preview width")]
      : []),
    ...(settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay
      ? ["Effort display"]
      : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? ["Render math"]
      : []),
    ...(settings.attentionHighlight !== DEFAULT_UNIFIED_SETTINGS.attentionHighlight
      ? ["Attention highlight"]
      : []),
    ...(settings.panelAnimationDurationMs !== DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs
      ? ["Panel animations"]
      : []),
    ...(settings.environmentIdentificationMode !==
    DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
      ? ["Environment identification"]
      : []),
    ...(settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? ["Language"] : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? ["Time format"]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? ["Thread notifications"]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? ["In-app notifications"]
      : []),
    ...(settings.inAppNotificationsPersistent !==
    DEFAULT_UNIFIED_SETTINGS.inAppNotificationsPersistent
      ? ["Keep until dismissed"]
      : []),
    ...(settings.inAppNotificationsInBackground !==
    DEFAULT_UNIFIED_SETTINGS.inAppNotificationsInBackground
      ? ["Show while in background"]
      : []),
    ...(settings.inAppNotificationsForActiveThread !==
    DEFAULT_UNIFIED_SETTINGS.inAppNotificationsForActiveThread
      ? ["Include the open thread"]
      : []),
    ...(settings.toastPosition !== DEFAULT_UNIFIED_SETTINGS.toastPosition
      ? ["Notification position"]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? ["Project Grouping"]
      : []),
    ...(settings.sidebarProjectSortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder
      ? ["Project order"]
      : []),
    ...(settings.sidebarWorkingShelfEnabled !== DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled
      ? ["Working section"]
      : []),
    ...(settings.sidebarAutoSettleAfterDays !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays
      ? ["Auto-settle inactive threads"]
      : []),
    ...(settings.sidebarAutoSettleKeepPullRequests !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests
      ? ["Keep threads with a PR"]
      : []),
    ...(settings.sidebarAutoSettleOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge
      ? ["Auto-settle merged threads"]
      : []),
    ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
      ? ["Resume after usage limits"]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? ["Snooze until limits reset"]
      : []),
    ...(!Equal.equals(settings.snoozePresets, DEFAULT_UNIFIED_SETTINGS.snoozePresets)
      ? ["Snooze options"]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? ["Word wrap"] : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? ["Composer context"]
      : []),
    ...getChangedTypographySettingLabels(settings),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? ["Default diff file state"]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? ["Diff whitespace changes"]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? ["Diff layout"] : []),
    ...(settings.diffCollapseRemovedLines !== DEFAULT_UNIFIED_SETTINGS.diffCollapseRemovedLines
      ? ["Collapse removed lines"]
      : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? ["Open pull requests and changes panels proactively"]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? ["Show skills in slash menu"]
      : []),
    ...(settings.foldCompletedTurns !== DEFAULT_UNIFIED_SETTINGS.foldCompletedTurns
      ? ["Fold finished turns"]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? ["Rich text composer"]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? ["Send shortcut"] : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? ["Follow-up behavior"]
      : []),
    ...(settings.sideThreadOpenTarget !== DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget
      ? [gt("Open subagents and side chats in")]
      : []),
    ...(settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility
      ? ["Tool calls in chat"]
      : []),
    ...(settings.screenReaderAnnouncements !== DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements
      ? ["Screen reader announcements"]
      : []),
    ...(settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle
      ? ["Screen reader window title"]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? ["Response streaming"]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? ["Provider update checks"]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? ["Continue threads after restarts"]
      : []),
    ...(isBackgroundActivityDirty ? ["Background activity"] : []),
    ...(settings.keepAwakeWhileAgentsWork !== DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork
      ? ["Keep awake while agents work"]
      : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? ["New thread mode"]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? ["New worktrees start from remote"]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? ["Add project base directory"]
      : []),
    ...(settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout
      ? ["Clone into host folders"]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? ["Unpin confirmation"]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? ["Archive confirmation"]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? ["Delete confirmation"]
      : []),
    ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? ["Quit shortcut"] : []),
    ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
    ...(settings.threadTitleInstructions !== DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions
      ? ["Thread title instructions"]
      : []),
    ...getChangedBrowserSettingLabels(settings),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? ["Agent browser access"]
      : []),
  ];

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
      { variant: "destructive" },
    );
    if (!confirmed) return;

    // Reset only dirty theme keys so storage failures cannot block other settings; re-read after confirmation
    // for safe rollback.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {}
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Couldn’t restore theme settings")),
          description: m(msg("Try again.")),
        }),
      );
    };
    // Restore the base preference before the mix because restoring the base clears the mix.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
      htmlPreviewWidth: DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth,
      effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
      language: DEFAULT_UNIFIED_SETTINGS.language,
      attentionHighlight: DEFAULT_UNIFIED_SETTINGS.attentionHighlight,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
      inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
      inAppNotificationsPersistent: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsPersistent,
      inAppNotificationsInBackground: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsInBackground,
      inAppNotificationsForActiveThread: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsForActiveThread,
      toastPosition: DEFAULT_UNIFIED_SETTINGS.toastPosition,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
      diffCollapseRemovedLines: DEFAULT_UNIFIED_SETTINGS.diffCollapseRemovedLines,
      proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      foldCompletedTurns: DEFAULT_UNIFIED_SETTINGS.foldCompletedTurns,
      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
      sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
      sideThreadOpenTarget: DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget,
      toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility,
      screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
      screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
      sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
      sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
      sidebarAutoSettleKeepPullRequests: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleKeepPullRequests,
      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      snoozePresets: DEFAULT_UNIFIED_SETTINGS.snoozePresets,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
      browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
      browserSearchEngine: DEFAULT_UNIFIED_SETTINGS.browserSearchEngine,
      browserCustomSearchUrl: DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl,
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
      pullRequestLinksOpenInApp: DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 7;

function AutoSettleDaysInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (days: number, options: { onFailed: () => void }) => void;
}) {
  const [stored, setField] = useState(() => autoSettleDaysField(value));
  const field = syncAutoSettleDaysField(stored, value);
  if (field !== stored) setField(field);

  const commit = () => {
    const next = commitAutoSettleDaysField(field);
    setField(next.field);
    if (next.submit === null) return;
    const { revision } = next.field;
    onCommit(next.submit, {
      onFailed: () => setField((current) => failAutoSettleDaysField(current, revision)),
    });
  };

  return (
    <Input
      size="sm"
      type="number"
      min={MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS}
      className="w-full sm:w-24"
      value={field.draft}
      onChange={(event) => setField(editAutoSettleDaysField(field, event.target.value))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") commit();
        if (event.key === "Escape" && field.dirty) {
          // An unhandled Escape closes the settings page, and the blur that follows would save.
          event.preventDefault();
          event.stopPropagation();
          setField(cancelAutoSettleDaysField(field));
        }
      }}
      aria-label={m(msg("Days of inactivity before auto-settle"))}
    />
  );
}

/** Row anchor props with the registry title in the active language. */
function useTranslatedSearchableSetting() {
  const m = useMessages();
  return (id: SettingsSearchItemId) => {
    const setting = searchableSetting(id);
    return { ...setting, title: m(setting.title) };
  };
}

export function GeneralSettingsPanel() {
  const gt = useGT();
  const m = useMessages();
  const setting = useTranslatedSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const languageValue = SUPPORTED_LOCALES.includes(settings.language)
    ? settings.language
    : SYSTEM_LANGUAGE;

  return (
    <SettingsPageContainer>
      <SettingsSection id="notifications" title={gt("Notifications")}>
        <NotificationSettings />
        <SettingsRow
          {...setting("in-app-notifications")}
          description={
            <T>
              Show a toast when another thread finishes, fails, or needs input or approval while
              this app has focus.
            </T>
          }
          control={
            <Switch
              checked={settings.inAppNotificationsEnabled}
              onCheckedChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
              aria-label={gt("In-app notifications")}
            />
          }
        />
        {settings.inAppNotificationsEnabled ? (
          <SettingsRow
            title={searchableSetting("keep-in-app-notifications").title}
            description={msg("Thread toasts stay until you close them or open the thread.")}
            control={
              <Switch
                checked={settings.inAppNotificationsPersistent}
                onCheckedChange={(checked) =>
                  updateSettings({ inAppNotificationsPersistent: checked })
                }
                aria-label={m(msg("Keep in-app notifications until dismissed"))}
              />
            }
          />
        ) : null}
        {settings.inAppNotificationsEnabled ? (
          <SettingsRow
            title={searchableSetting("in-app-notifications-in-background").title}
            description={msg(
              "Also show toasts while this app is in the background, alongside any desktop notification.",
            )}
            control={
              <Switch
                checked={settings.inAppNotificationsInBackground}
                onCheckedChange={(checked) =>
                  updateSettings({ inAppNotificationsInBackground: checked })
                }
                aria-label={m(msg("Show in-app notifications while in background"))}
              />
            }
          />
        ) : null}
        {settings.inAppNotificationsEnabled ? (
          <SettingsRow
            title={searchableSetting("in-app-notifications-active-thread").title}
            description={msg("Also show toasts for the thread you currently have open.")}
            control={
              <Switch
                checked={settings.inAppNotificationsForActiveThread}
                onCheckedChange={(checked) =>
                  updateSettings({ inAppNotificationsForActiveThread: checked })
                }
                aria-label={m(msg("Include the open thread in in-app notifications"))}
              />
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id="sidebar" title={gt("Sidebar")}>
        <SettingsRow
          {...setting("project-grouping")}
          description={<T>Combine matching repositories across environments.</T>}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                ariaLabel={m(msg("project grouping"))}
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={gt("Project grouping")}
            />
          }
        />
        <SettingsRow
          {...setting("project-order")}
          description={<T>Order of projects in the sidebar project picker and command palette.</T>}
          resetAction={
            settings.sidebarProjectSortOrder !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
              <SettingResetButton
                ariaLabel={m(msg("project order"))}
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (isSidebarProjectSortOrder(value)) {
                  updateSettings({ sidebarProjectSortOrder: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={gt("Project order")}>
                <SelectValue>
                  {m(SIDEBAR_PROJECT_SORT_ORDER_LABELS[settings.sidebarProjectSortOrder])}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SidebarProjectSortOrder.literals.map((sortOrder) => (
                  <SelectItem hideIndicator key={sortOrder} value={sortOrder}>
                    {m(SIDEBAR_PROJECT_SORT_ORDER_LABELS[sortOrder])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...setting("working-shelf")}
          description={
            <T>
              Fold working and monitoring threads into a Working section. They return to the top of
              the inbox when they need you. The boring sidebar in Labs has no Working section.
            </T>
          }
          resetAction={
            settings.sidebarWorkingShelfEnabled !==
            DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled ? (
              <SettingResetButton
                ariaLabel={m(msg("working section"))}
                onClick={() =>
                  updateSettings({
                    sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.sidebarWorkingShelfEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ sidebarWorkingShelfEnabled: Boolean(checked) })
              }
              aria-label={gt("Working section")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="confirmations" title={gt("Confirmations")}>
        <SettingsRow
          {...setting("unpin-confirmation")}
          description={<T>Ask before unpinning a thread from the pinned section.</T>}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <SettingResetButton
                ariaLabel={m(msg("unpin confirmation"))}
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={gt("Confirm thread unpinning")}
            />
          }
        />
        <SettingsRow
          {...setting("archive-confirmation")}
          description={
            <T>Require a second click on the inline archive action before a thread is archived.</T>
          }
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                ariaLabel={m(msg("archive confirmation"))}
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={gt("Confirm thread archiving")}
            />
          }
        />
        <SettingsRow
          {...setting("delete-confirmation")}
          description={<T>Ask before deleting a thread and its chat history.</T>}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                ariaLabel={m(msg("delete confirmation"))}
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={gt("Confirm thread deletion")}
            />
          }
        />
        {isElectron ? (
          <SettingsRow
            {...setting("quit-confirmation")}
            description={<T>Hold mode also quits on two quick presses.</T>}
            resetAction={
              settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                <SettingResetButton
                  ariaLabel={m(msg("quit shortcut behavior"))}
                  onClick={() =>
                    updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.confirmQuit}
                onValueChange={(value) => {
                  if (value === "direct" || value === "hold" || value === "double-click") {
                    updateSettings({ confirmQuit: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={gt("Quit shortcut behavior")}
                >
                  <SelectValue>
                    {m(QUIT_CONFIRMATION_MODE_LABELS[settings.confirmQuit])}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(QUIT_CONFIRMATION_MODE_LABELS).map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {m(label)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id="display" title={gt("Display")}>
        <SettingsRow
          {...setting("language")}
          description={<T>System default follows your browser or OS language.</T>}
          resetAction={
            settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? (
              <SettingResetButton
                ariaLabel="language"
                onClick={() =>
                  updateSettings({
                    language: DEFAULT_UNIFIED_SETTINGS.language,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={languageValue}
              onValueChange={(value) => {
                if (value) {
                  updateSettings({ language: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Language")}>
                <SelectValue>
                  {languageValue === SYSTEM_LANGUAGE
                    ? m(TIMESTAMP_FORMAT_LABELS.locale)
                    : nativeLanguageName(languageValue)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={SYSTEM_LANGUAGE}>
                  {m(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                {SUPPORTED_LOCALES.map((locale) => (
                  <SelectItem hideIndicator key={locale} value={locale}>
                    {nativeLanguageName(locale)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("toast-position")}
          description={msg(
            "Choose the corner of the window where notifications and other toasts appear.",
          )}
          resetAction={
            settings.toastPosition !== DEFAULT_UNIFIED_SETTINGS.toastPosition ? (
              <SettingResetButton
                ariaLabel={m(msg("notification position"))}
                onClick={() =>
                  updateSettings({ toastPosition: DEFAULT_UNIFIED_SETTINGS.toastPosition })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.toastPosition}
                onValueChange={(value) => {
                  if (isToastPosition(value)) updateSettings({ toastPosition: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={m(msg("Notification position"))}
                >
                  <SelectValue>{TOAST_POSITION_LABELS[settings.toastPosition]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(TOAST_POSITION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {value === DEFAULT_UNIFIED_SETTINGS.toastPosition
                        ? m(msg("{label} (default)", { label: label }))
                        : label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("time-format")}
          description={msg("System default follows your browser or OS clock preference.")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                ariaLabel={m(msg("time format"))}
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={gt("Timestamp format")}
              >
                <SelectValue>{m(TIMESTAMP_FORMAT_LABELS[settings.timestampFormat])}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {m(TIMESTAMP_FORMAT_LABELS.locale)}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {m(TIMESTAMP_FORMAT_LABELS["12-hour"])}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {m(TIMESTAMP_FORMAT_LABELS["24-hour"])}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ChatSettingsPanel() {
  const gt = useGT();
  const setting = useTranslatedSearchableSetting();
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    {
      value: "mod-enter-multiline",
      label: m(
        msg("{modifierLabel} + Enter for multiline prompts", { modifierLabel: modifierLabel }),
      ),
    },
    {
      value: "mod-enter",
      label: m(msg("{modifierLabel} + Enter always", { modifierLabel: modifierLabel })),
    },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection id="composer" title={msg("Composer")}>
        <SettingsRow
          {...searchableSetting("composer-rich-text")}
          description={msg("Show formatted Markdown as you type.")}
          resetAction={
            settings.composerRichTextEnabled !==
            DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
              <SettingResetButton
                ariaLabel={m(msg("rich text composer"))}
                onClick={() =>
                  updateSettings({
                    composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerRichTextEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ composerRichTextEnabled: Boolean(checked) })
              }
              aria-label={m(msg("Rich text composer"))}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("send-shortcut")}
          description={msg("Choose when Enter sends a prompt or inserts a new line")}
          resetAction={
            settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
              <SettingResetButton
                ariaLabel={m(msg("send shortcut"))}
                onClick={() =>
                  updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sendShortcut}
              onValueChange={(value) => {
                const option = sendShortcutOptions.find((option) => option.value === value);
                if (option) updateSettings({ sendShortcut: option.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 max-w-full"
                aria-label={m(msg("Send shortcut"))}
              >
                <SelectValue>
                  {
                    sendShortcutOptions.find((option) => option.value === settings.sendShortcut)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {sendShortcutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center justify-between gap-4">
                      {option.label}
                      {settings.sendShortcut === option.value && <CheckIcon aria-hidden="true" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <AdvancedSettings targetIds={[searchableSetting("skills-in-slash-menu").id]}>
          <SettingsRow
            {...searchableSetting("skills-in-slash-menu")}
            description={msg(
              "Also include skills in the / command menu. Skills always appear when you type $.",
            )}
            resetAction={
              settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
                <SettingResetButton
                  ariaLabel={m(msg("skills in slash menu"))}
                  onClick={() =>
                    updateSettings({
                      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.showSkillsInSlashMenu}
                onCheckedChange={(checked) =>
                  updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
                }
                aria-label={m(msg("Show skills in slash menu"))}
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>

      <SettingsSection id="follow-ups" title={msg("Follow-ups")}>
        <SettingsRow
          {...searchableSetting("follow-up-behavior")}
          description={
            "Queue follow-ups while the agent runs or steer the current run. " +
            (settings.sendShortcut === "mod-enter-multiline"
              ? `Press ${modifierLabel} + Enter for single-line prompts or ${modifierLabel} + Shift + Enter for multiline prompts to do the opposite for one message.`
              : `Press ${modifierLabel}${settings.sendShortcut === "mod-enter" ? " + Shift" : ""} + Enter to do the opposite for one message.`)
          }
          resetAction={
            settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
              <SettingResetButton
                ariaLabel={m(msg("follow-up behavior"))}
                onClick={() =>
                  updateSettings({
                    followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.followUpBehavior}
              onValueChange={(value) => {
                if (value === "queue" || value === "steer") {
                  updateSettings({ followUpBehavior: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={m(msg("Follow-up behavior"))}
              >
                <SelectValue>
                  {settings.followUpBehavior === "queue" ? msg("Queue") : msg("Steer")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="queue">
                  <T>Queue</T>
                </SelectItem>
                <SelectItem value="steer">
                  <T>Steer</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="side-threads" title={gt("Subagents and side chats")}>
        <SettingsRow
          {...setting("side-thread-open-target")}
          description={
            settings.sideThreadOpenTarget === "panel"
              ? gt(
                  "Where a click opens a subagent, a side chat, or a thread on a linked environment. {modifier}-click or middle-click opens it in the main view instead.",
                  { modifier: modifierLabel },
                )
              : gt(
                  "Where a click opens a subagent, a side chat, or a thread on a linked environment. {modifier}-click or middle-click opens it in the side panel instead.",
                  { modifier: modifierLabel },
                )
          }
          resetAction={
            settings.sideThreadOpenTarget !== DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget ? (
              <SettingResetButton
                ariaLabel={gt("Reset where subagents and side chats open to default")}
                onClick={() =>
                  updateSettings({
                    sideThreadOpenTarget: DEFAULT_UNIFIED_SETTINGS.sideThreadOpenTarget,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sideThreadOpenTarget}
              onValueChange={(value) => {
                if (value === "panel" || value === "main") {
                  updateSettings({ sideThreadOpenTarget: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={gt("Open subagents and side chats in")}
              >
                <SelectValue>
                  {settings.sideThreadOpenTarget === "panel" ? gt("Side panel") : gt("Main view")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="panel">
                  <T>Side panel</T>
                </SelectItem>
                <SelectItem value="main">
                  <T>Main view</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="activity" title={gt("Activity")}>
        <ToolCallVisibilityRow />
      </SettingsSection>

      <SettingsSection id="screen-reader" title={msg("Screen reader")}>
        <ScreenReaderAnnouncementsRow />
        <ScreenReaderWindowTitleRow />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

const TOOL_CALL_VISIBILITY_LABELS: Record<ToolCallVisibility, string> = {
  showAll: "Show all",
  hideSuccessful: "Hide successful",
  hideAll: "Hide all",
  zen: "Zen",
};

const isToolCallVisibility = Schema.is(ToolCallVisibility);

function ToolCallVisibilityRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("tool-call-visibility")}
      description={msg(
        "Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.",
      )}
      resetAction={
        settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility ? (
          <SettingResetButton
            ariaLabel={m(msg("tool calls in chat"))}
            onClick={() =>
              updateSettings({ toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.toolCallVisibility}
          onValueChange={(value) => {
            if (isToolCallVisibility(value)) updateSettings({ toolCallVisibility: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-40"
            aria-label={m(msg("Tool calls in chat"))}
          >
            <SelectValue>{TOOL_CALL_VISIBILITY_LABELS[settings.toolCallVisibility]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ToolCallVisibility.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {TOOL_CALL_VISIBILITY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const SCREEN_READER_ANNOUNCEMENTS_LABELS: Record<ScreenReaderAnnouncements, string> = {
  status: "Status only",
  messages: "Status and messages",
  everything: "Everything",
};

const isScreenReaderAnnouncements = Schema.is(ScreenReaderAnnouncements);

function ScreenReaderAnnouncementsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("screen-reader-announcements")}
      description={msg(
        "What a screen reader hears from the open thread: a turn starting, needing you, and ending. Status and messages adds what the agent writes before its last message. Everything adds each step.",
      )}
      resetAction={
        settings.screenReaderAnnouncements !==
        DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements ? (
          <SettingResetButton
            ariaLabel={m(msg("screen reader announcements"))}
            onClick={() =>
              updateSettings({
                screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.screenReaderAnnouncements}
          onValueChange={(value) => {
            if (isScreenReaderAnnouncements(value)) {
              updateSettings({ screenReaderAnnouncements: value });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label={m(msg("Screen reader announcements"))}
          >
            <SelectValue>
              {SCREEN_READER_ANNOUNCEMENTS_LABELS[settings.screenReaderAnnouncements]}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ScreenReaderAnnouncements.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {SCREEN_READER_ANNOUNCEMENTS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ScreenReaderWindowTitleRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("screen-reader-window-title")}
      description={msg(
        "Start the window title with the thread's status, like Needs approval, and its name, so screen readers read them first when you switch apps. Taskbars, shared screens, and time trackers see it too.",
      )}
      resetAction={
        settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle ? (
          <SettingResetButton
            ariaLabel={m(msg("screen reader window title"))}
            onClick={() =>
              updateSettings({
                screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.screenReaderWindowTitle}
          onCheckedChange={(checked) => updateSettings({ screenReaderWindowTitle: checked })}
          aria-label={m(msg("Screen reader window title"))}
        />
      }
    />
  );
}

function DiffColorsSettingsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("diff-color-scheme")}
      description={msg("Choose colors for additions and deletions, including change counts.")}
      resetAction={
        settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme ? (
          <SettingResetButton
            ariaLabel={m(msg("diff colors"))}
            onClick={() =>
              updateSettings({ diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme })
            }
          />
        ) : null
      }
      control={
        <div className="w-full sm:w-40">
          <Select
            value={settings.diffColorScheme}
            onValueChange={(value) => {
              if (value === "red-green" || value === "blue-orange")
                updateSettings({ diffColorScheme: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label={m(msg("Diff colors"))}>
              <span
                aria-hidden="true"
                className={
                  settings.diffColorScheme === "blue-orange"
                    ? "flex shrink-0 flex-row-reverse gap-1"
                    : "flex shrink-0 gap-1"
                }
              >
                <span className="size-2 rounded-full bg-diff-deletion" />
                <span className="size-2 rounded-full bg-diff-addition" />
              </span>
              <SelectValue>
                {settings.diffColorScheme === "blue-orange"
                  ? m(msg("Blue & orange"))
                  : m(msg("Red & green"))}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="red-green">
                <T>Red & green (default)</T>
              </SelectItem>
              <SelectItem value="blue-orange">
                <T>Blue & orange</T>
              </SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}

export function DiffsSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection id="diffs" title={msg("Diffs")}>
        <SettingsRow
          {...searchableSetting("diff-layout")}
          description={msg(
            "Show diffs stacked or side by side. The toggle in the diff toolbar changes this too.",
          )}
          resetAction={
            settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? (
              <SettingResetButton
                ariaLabel={m(msg("diff layout"))}
                onClick={() => updateSettings({ diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffLayout}
              onValueChange={(value) => {
                if (value === "stacked" || value === "split") {
                  updateSettings({ diffLayout: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={m(msg("Diff layout"))}
              >
                <SelectValue>{DIFF_LAYOUT_LABELS[settings.diffLayout]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="stacked">
                  {DIFF_LAYOUT_LABELS.stacked}
                </SelectItem>
                <SelectItem hideIndicator value="split">
                  {DIFF_LAYOUT_LABELS.split}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("collapse-removed-lines")}
          description={msg(
            "In the stacked layout, fold each run of removed lines into a bar and show more surrounding code.",
          )}
          resetAction={
            settings.diffCollapseRemovedLines !==
            DEFAULT_UNIFIED_SETTINGS.diffCollapseRemovedLines ? (
              <SettingResetButton
                ariaLabel={m(msg("collapse removed lines"))}
                onClick={() =>
                  updateSettings({
                    diffCollapseRemovedLines: DEFAULT_UNIFIED_SETTINGS.diffCollapseRemovedLines,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffCollapseRemovedLines}
              onCheckedChange={(checked) =>
                updateSettings({ diffCollapseRemovedLines: Boolean(checked) })
              }
              aria-label={m(msg("Collapse removed lines"))}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("fold-completed-turns")}
          description={msg(
            'Hide the tool calls and commands of a finished turn behind a "Worked for" row above its reply.',
          )}
          resetAction={
            settings.foldCompletedTurns !== DEFAULT_UNIFIED_SETTINGS.foldCompletedTurns ? (
              <SettingResetButton
                ariaLabel={m(msg("fold finished turns"))}
                onClick={() =>
                  updateSettings({
                    foldCompletedTurns: DEFAULT_UNIFIED_SETTINGS.foldCompletedTurns,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.foldCompletedTurns}
              onCheckedChange={(checked) =>
                updateSettings({ foldCompletedTurns: Boolean(checked) })
              }
              aria-label={m(msg("Fold finished turns"))}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("hide-whitespace-changes")}
          description={msg("Set whether the diff panel ignores whitespace-only edits by default.")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                ariaLabel={m(msg("diff whitespace changes"))}
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={m(msg("Hide whitespace changes by default"))}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("default-diff-file-state")}
          description={msg(
            "Start with files expanded or collapsed when opening diffs or a pull request's Code tab.",
          )}
          resetAction={
            settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
              <SettingResetButton
                ariaLabel={m(msg("default diff file state"))}
                onClick={() =>
                  updateSettings({
                    diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.diffFilesCollapsed ? "collapsed" : "expanded"}
              onValueChange={(value) => {
                if (value === "expanded" || value === "collapsed") {
                  updateSettings({ diffFilesCollapsed: value === "collapsed" });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={m(msg("Default diff file state"))}
              >
                <SelectValue>
                  {settings.diffFilesCollapsed ? m(msg("Collapsed")) : m(msg("Expanded"))}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="expanded">
                  <T>Expanded</T>
                </SelectItem>
                <SelectItem hideIndicator value="collapsed">
                  <T>Collapsed</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <DiffColorsSettingsRow />
      </SettingsSection>

      <SettingsSection id="pull-requests" title={msg("Pull requests")}>
        <SettingsRow
          {...searchableSetting("proactive-panels")}
          description={msg(
            "Open linked pull requests first. Otherwise, open Changes for edits to at least 3 files or 50 lines.",
          )}
          resetAction={
            settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
              <SettingResetButton
                ariaLabel={m(msg("proactive panels"))}
                onClick={() =>
                  updateSettings({
                    proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.proactivePanelsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ proactivePanelsEnabled: Boolean(checked) })
              }
              aria-label={m(msg("Open pull requests and changes panels proactively"))}
            />
          }
        />
        <PullRequestLinksOpenInAppSetting />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

/** The Providers panel can render without a settings scope, as its tests do; this row needs one. */
export function CompactIdleThreadsRow() {
  return useOptionalSettingsScope() === null ? null : <ScopedCompactIdleThreadsRow />;
}

function ScopedCompactIdleThreadsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { targets } = useSettingsScope();
  const idleCompaction = scopedIdleCompaction(targets.length > 0 ? targets : [{ settings }]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["idleCompaction", "compactIdleThreads"]}
      mixed={idleCompaction.mixed}
      {...searchableSetting("compact-idle-threads")}
      description={msg(
        "When to compact an idle Claude thread over 200,000 tokens: after you return, just before its prompt cache expires, or never. Each Claude provider can override this.",
      )}
      resetAction={
        globalIdleCompaction(settings) !== globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) ? (
          <SettingResetButton
            ariaLabel={m(msg("compact idle threads"))}
            onClick={() =>
              updateSettings({ idleCompaction: globalIdleCompaction(DEFAULT_UNIFIED_SETTINGS) })
            }
          />
        ) : null
      }
      control={
        <Select
          value={idleCompaction.mixed ? null : globalIdleCompaction(settings)}
          onValueChange={(value) => {
            const mode = IDLE_COMPACTION_MODES.find((candidate) => candidate.value === value);
            if (mode) updateSettings({ idleCompaction: mode.value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={m(msg("Compact idle threads"))}
          >
            <SelectValue>
              {(value: string | null) =>
                value === null
                  ? "Mixed"
                  : IDLE_COMPACTION_MODES.find((mode) => mode.value === value)?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {IDLE_COMPACTION_MODES.map((mode) => (
              <SelectItem
                hideIndicator
                key={mode.value}
                value={mode.value}
                // A server from before modes has only the on/off switch, so it cannot store "Never".
                disabled={mode.value === "off" && !idleCompaction.neverAvailable}
              >
                {mode.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function ThreadsSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments, target, scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoSettlementScope = connectedEnvironments.every(
    (target) => target.serverConfig?.environment.capabilities.threadAutoSettlementScope === true,
  );

  const textGenerationTargets = useTextGenerationTargets({
    environmentId,
    settings,
    providers: serverProviders.filter((provider) => provider.supportsTextGeneration !== false),
    projectId: target?.projectId ?? null,
    selections: [settings.textGenerationModelSelection],
  });
  const textGenerationProviders = textGenerationTargets.providers;
  const textGenerationModelSelection = resolveAppModelSelectionState(
    settings,
    textGenerationProviders,
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = textGenerationTargets.entries;
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getTextGenerationModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGenerationModelInstanceEntries,
    true,
  );
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  return (
    <SettingsPageContainer>
      <SettingsSection id="new-projects" title={msg("New projects")}>
        <SettingsRow
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          {...searchableSetting("add-project-starts-in")}
          description={msg('Leave empty to use "~/" when the Add Project browser opens.')}
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                ariaLabel={m(msg("add project base directory"))}
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              normalizeDraft={resolvePastedPath}
              placeholder={mixedAddProjectBaseDirectory ? msg("Mixed") : "~/"}
              spellCheck={false}
              aria-label={m(msg("Add project base directory"))}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["ghqCloneLayout"]}
          {...searchableSetting("ghq-clone-layout")}
          description={msg("Clones go to github.com/owner/repo under the folder above, like ghq.")}
          resetAction={
            settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout ? (
              <SettingResetButton
                ariaLabel={m(msg("clone into host folders"))}
                onClick={() =>
                  updateSettings({ ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["ghqCloneLayout"]}
              checked={settings.ghqCloneLayout}
              onCheckedChange={(checked) => updateSettings({ ghqCloneLayout: Boolean(checked) })}
              aria-label={m(msg("Clone into host folders"))}
            />
          }
        />
      </SettingsSection>

      <ProjectDefaultsSettings category="general" />
      <SubagentModelSettings />

      {!isProjectScope ? (
        <SettingsSection id="snooze" title={msg("Snooze")}>
          <SnoozePresetsRow />
        </SettingsSection>
      ) : null}

      <SettingsSection id="usage-limits" title={msg("Usage limits")}>
        <SettingsRow
          serverScoped
          {...searchableSetting("auto-resume-limited-threads")}
          description={msg(
            "Automatically resume threads when their usage limits reset. You can cancel auto-resume in each thread.",
          )}
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label={m(msg("Resume after usage limits"))}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("snooze-limited-threads")}
          description={msg(
            "Snooze threads until their usage limits reset. Enable auto-resume to continue the agent after the reset.",
          )}
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label={m(msg("Snooze until limits reset"))}
            />
          }
        />
      </SettingsSection>

      {hasServerTargets ? (
        <SettingsSection id="auto-settle" title={msg("Auto-settle")}>
          <SettingsRow
            serverScoped
            settingKeys={["sidebarAutoSettleOnMerge"]}
            {...searchableSetting("auto-settle-merged-threads")}
            description={msg(
              "Settle a thread when its pull request merges. Closed pull requests still settle automatically.",
            )}
            resetAction={
              settings.sidebarAutoSettleOnMerge !==
              DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge ? (
                <SettingResetButton
                  ariaLabel={m(msg("auto-settle on merge"))}
                  onClick={() =>
                    updateSettings({
                      sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
                    })
                  }
                />
              ) : null
            }
            control={
              <ScopedSwitch
                settingKeys={["sidebarAutoSettleOnMerge"]}
                checked={settings.sidebarAutoSettleOnMerge}
                onCheckedChange={(checked) =>
                  updateSettings({ sidebarAutoSettleOnMerge: Boolean(checked) })
                }
                aria-label={m(msg("Auto-settle merged threads"))}
              />
            }
          />

          <SettingsRow
            serverScoped
            settingKeys={["sidebarAutoSettleAfterDays"]}
            {...searchableSetting("auto-settle-inactive-threads")}
            description={msg(
              "Sidebar threads with no activity for this long settle automatically.",
            )}
            resetAction={
              settings.sidebarAutoSettleAfterDays !==
              DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ? (
                <SettingResetButton
                  ariaLabel="auto-settle"
                  onClick={() =>
                    updateSettings({
                      sidebarAutoSettleAfterDays:
                        DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
                    })
                  }
                />
              ) : null
            }
            control={
              <ScopedSwitch
                settingKeys={["sidebarAutoSettleAfterDays"]}
                checked={settings.sidebarAutoSettleAfterDays !== null}
                onCheckedChange={(checked) =>
                  updateSettings({
                    sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null,
                  })
                }
                aria-label={m(msg("Auto-settle inactive threads"))}
              />
            }
          />
          {settings.sidebarAutoSettleAfterDays !== null ? (
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleAfterDays"]}
              title={searchableSetting("days-before-auto-settle").title}
              description={msg("Any new activity un-settles a thread automatically.")}
              control={
                <AutoSettleDaysInput
                  value={settings.sidebarAutoSettleAfterDays}
                  onCommit={(days, options) =>
                    updateSettings({ sidebarAutoSettleAfterDays: days }, options)
                  }
                />
              }
            />
          ) : null}
          {settings.sidebarAutoSettleAfterDays !== null && supportsAutoSettlementScope ? (
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoSettleKeepPullRequests"]}
              title={msg("Keep threads with a PR")}
              description={msg(
                "Inactivity does not settle threads with a pull request. Merge and close still do.",
              )}
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoSettleKeepPullRequests"]}
                  checked={settings.sidebarAutoSettleKeepPullRequests}
                  onCheckedChange={(checked) =>
                    updateSettings({ sidebarAutoSettleKeepPullRequests: checked })
                  }
                  aria-label={m(msg("Keep threads with a PR"))}
                />
              }
            />
          ) : null}
        </SettingsSection>
      ) : null}

      <SettingsSection id="text-generation" title={msg("Text generation")}>
        <SettingsRow
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          {...searchableSetting("text-generation-model")}
          description={msg(
            "For thread titles and other generated text. Source control has its own setting. Text generators from Providers also appear here.",
          )}
          resetAction={
            hasServerTargets && isTextGenerationModelDirty ? (
              <SettingResetButton
                ariaLabel={m(msg("text generation model"))}
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            !hasServerTargets ? (
              <span className="text-sm text-muted-foreground">
                <T>Connect an environment to choose its text generation model.</T>
              </span>
            ) : !hasTextGenerationProvider ? (
              <span className="text-sm text-muted-foreground">
                <T>No text generation providers available.</T>
              </span>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={textGenInstanceId}
                  model={textGenModel}
                  lockedProvider={null}
                  instanceEntries={textGenerationModelInstanceEntries}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(mixedTextGenerationModel ? { triggerLabel: msg("Mixed") } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = textGenerationModelDisabledReason(instanceId, model);
                    if (reason) {
                      toastManager.add({
                        type: "error",
                        title: m(msg("Text generation model not saved")),
                        description: reason,
                      });
                      return;
                    }
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        {
                          ...settings,
                          textGenerationModelSelection: pickModelSelection(
                            textGenerationModelSelection,
                            instanceId,
                            model,
                          ),
                        },
                        textGenerationProviders,
                      ),
                    });
                  }}
                />
                {textGenInstanceEntry ? (
                  <TraitsPicker
                    provider={textGenProvider}
                    models={textGenInstanceEntry?.models ?? []}
                    model={textGenModel}
                    modelOptions={textGenModelOptions}
                    allowPromptInjectedEffort={false}
                    includePlanAgent={selectsPlanAgent(textGenModelOptions)}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) => {
                      updateSettings({
                        textGenerationModelSelection: resolveAppModelSelectionState(
                          {
                            ...settings,
                            textGenerationModelSelection: createModelSelection(
                              textGenInstanceId,
                              textGenModel,
                              nextOptions,
                            ),
                          },
                          textGenerationProviders,
                        ),
                      });
                    }}
                  />
                ) : null}
              </div>
            )
          }
        />
        <AdvancedSettings
          targetIds={[
            searchableSetting("thread-title-instructions").id,
            searchableSetting("response-streaming").id,
          ]}
        >
          <ThreadTitleInstructionsSettings />
          <SettingsRow
            serverScoped
            settingKeys={["responseStreamingMode"]}
            {...searchableSetting("response-streaming")}
            description={
              mixedResponseStreamingMode
                ? m(msg("The selected targets use different streaming modes."))
                : RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode]
            }
            resetAction={
              settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
                <SettingResetButton
                  ariaLabel={m(msg("response streaming"))}
                  onClick={() =>
                    updateSettings({
                      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
                onValueChange={(value) => {
                  if (value === "turn" || value === "paragraph") {
                    updateSettings({ responseStreamingMode: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-56"
                  aria-label={m(msg("Response streaming"))}
                >
                  <SelectValue>
                    {(value: ResponseStreamingMode | null) =>
                      value === null ? "Mixed" : RESPONSE_STREAMING_MODE_LABELS[value]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="turn">
                    {RESPONSE_STREAMING_MODE_LABELS.turn}
                  </SelectItem>
                  <SelectItem hideIndicator value="paragraph">
                    {RESPONSE_STREAMING_MODE_LABELS.paragraph}
                  </SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        </AdvancedSettings>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function MaintenanceSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { scope, environment, connectedEnvironments } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const hasServerTargets = connectedEnvironments.length > 0;

  return (
    <SettingsPageContainer>
      <SettingsSection id="updates" title={msg("Updates")}>
        <SettingsRow
          serverScoped
          settingKeys={["enableProviderUpdateChecks"]}
          {...searchableSetting("provider-update-checks")}
          description={msg(
            "Check installed provider CLIs for newer available versions and fetch model catalog updates. When off, new models may not appear.",
          )}
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                ariaLabel={m(msg("provider update checks"))}
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["enableProviderUpdateChecks"]}
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label={m(msg("Check provider versions"))}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("continue-threads-after-server-update")}
          serverScoped
          settingKeys={["continueThreadsAfterServerUpdate"]}
          description={msg(
            "Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments.",
          )}
          status={
            !hasServerTargets
              ? "All selected connected environments must support restart continuation."
              : undefined
          }
          resetAction={
            hasServerTargets &&
            settings.continueThreadsAfterServerUpdate !==
              DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
              <SettingResetButton
                ariaLabel={m(msg("continue threads after restarts"))}
                onClick={() =>
                  updateSettings({
                    continueThreadsAfterServerUpdate:
                      DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["continueThreadsAfterServerUpdate"]}
              checked={settings.continueThreadsAfterServerUpdate}
              disabled={!hasServerTargets}
              onCheckedChange={(checked) =>
                updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
              }
              aria-label={m(msg("Continue threads after restarts"))}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="background" title={msg("Background activity")}>
        <BackgroundActivitySettingsRow />
        <SettingsRow
          serverScoped
          settingKeys={["keepAwakeWhileAgentsWork"]}
          {...searchableSetting("keep-awake-while-agents-work")}
          description={msg(
            "Stop the computer from going to sleep while agents are working, and let it sleep once they finish. Closing a laptop lid still puts it to sleep.",
          )}
          resetAction={
            settings.keepAwakeWhileAgentsWork !==
            DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork ? (
              <SettingResetButton
                ariaLabel={m(msg("keep awake while agents work"))}
                onClick={() =>
                  updateSettings({
                    keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["keepAwakeWhileAgentsWork"]}
              checked={settings.keepAwakeWhileAgentsWork}
              onCheckedChange={(checked) =>
                updateSettings({ keepAwakeWhileAgentsWork: Boolean(checked) })
              }
              aria-label={m(msg("Keep awake while agents work"))}
            />
          }
        />
      </SettingsSection>

      <StorageCleanupSections />

      <SettingsSection id="diagnostics-section" title={msg("Diagnostics")}>
        <SettingsRow
          {...searchableSetting("diagnostics")}
          description={
            isEnvironmentScope
              ? m(msg("Inspect processes, resource use, and logs on this environment."))
              : m(msg("Inspect processes, resource use, and logs on one environment at a time."))
          }
          control={
            <Button
              render={
                <Link to="/settings/diagnostics" search={{ machine: environmentId ?? undefined }} />
              }
              size="sm"
              variant="outline"
            >
              <T>View diagnostics</T>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function AboutSettingsPanel() {
  const primaryPolicy = usePrimaryManagedPolicy();
  // The Welcome page sets up this computer, so it needs one.
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const telemetryOff = managedTelemetryOffMessage(primaryPolicy);
  return (
    <SettingsPageContainer>
      <SettingsSection id="about" title={msg("App")}>
        {primaryPolicy ? (
          <SettingsRow
            title={msg("Organization")}
            description={m(
              msg(
                "This environment is managed by {arg0}. Some settings and features follow its policy.",
                { arg0: primaryPolicy.organization },
              ),
            )}
            control={
              primaryPolicy.supportUrl ? (
                <Button
                  render={
                    <a href={primaryPolicy.supportUrl} target="_blank" rel="noreferrer noopener" />
                  }
                  size="sm"
                  variant="outline"
                >
                  <T>Get help</T>
                </Button>
              ) : null
            }
          />
        ) : null}
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <>
            <SettingsRow
              id={searchableSetting("app-version").id}
              title={<AboutVersionTitle />}
              description={msg("Current version of the application.")}
            />
          </>
        )}
        <MobileAppSettingsRow />
        {primaryEnvironmentId === null ? null : (
          <SettingsRow
            {...searchableSetting("welcome-page")}
            description={msg("See your agents, import projects, and set up your phone.")}
            control={
              <Button size="sm" variant="outline" render={<Link to="/welcome" />}>
                <T>Open</T>
              </Button>
            }
          />
        )}
      </SettingsSection>

      <SettingsSection id="legal" title={msg("Legal")}>
        <SettingsRow
          {...searchableSetting("privacy-policy")}
          description={
            telemetryOff === undefined
              ? m(
                  msg(
                    "How we handle your data, including the anonymous usage data T3 Code collects.",
                  ),
                )
              : m(msg("How we handle your data. {telemetryOff}", { telemetryOff: telemetryOff }))
          }
          control={
            <Button
              render={<a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener" />}
              size="sm"
              variant="outline"
            >
              <T>View policy</T>
            </Button>
          }
        />
        <SettingsRow
          {...searchableSetting("open-source-licenses")}
          description={msg("Notices for dependencies, assets, and optional tools used by T3 Code.")}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              <T>View licenses</T>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

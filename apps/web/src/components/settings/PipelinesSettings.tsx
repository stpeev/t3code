import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  type EnvironmentId,
  type PipelinesConfigText,
} from "@t3tools/contracts";
import { useDeferredValue, useId, useState } from "react";

import { openInEditorMenuLabel } from "../../editorLabels";
import { useOpenInPreferredEditor, usePreferredEditor } from "../../editorPreferences";
import { ensureLocalApi } from "../../localApi";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  checkPipelinesDraft,
  describePipelinesPush,
  type PipelinesPushOutcome,
} from "./pipelinesSettings.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

function reportFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

function PipelinesEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly loaded: PipelinesConfigText;
  readonly configPath: string | null;
  readonly onRefresh: () => void;
}) {
  const { environmentId, loaded, configPath } = props;
  const textId = useId();
  const { environment } = useSettingsScope();
  const availableEditors = environment?.serverConfig?.availableEditors ?? [];
  const [preferredEditor] = usePreferredEditor(availableEditors);
  const openInEditor = useOpenInPreferredEditor(environmentId, availableEditors);
  const canOpenEditor = readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const openConfigInEditor = async () => {
    if (configPath === null) return;
    const result = await openInEditor(configPath);
    if (result._tag === "Success") return;
    reportFailure("Unable to open pipelines.json", squashAtomCommandFailure(result));
  };
  const canWrite = useAtomValue(
    serverEnvironment.savePipelinesConfigText.permissionAtom(environmentId),
  );
  const saveText = useAtomCommand(serverEnvironment.savePipelinesConfigText, {
    reportFailure: false,
  });
  const ensureExample = useAtomCommand(serverEnvironment.ensurePipelinesConfigFile, {
    reportFailure: false,
  });
  const readText = useAtomCommand(serverEnvironment.readPipelinesConfigText, {
    reportFailure: false,
  });
  const otherMachines = useEnvironments().environments.filter(
    (machine) =>
      machine.environmentId !== environmentId &&
      machine.connection.phase === "connected" &&
      machine.serverConfig !== null,
  );
  // `base` is the file as this editor last saw it; a save is refused if the file has moved on.
  const [base, setBase] = useState(loaded);
  const [draft, setDraft] = useState(loaded.text);
  const [seen, setSeen] = useState(loaded);
  const [conflict, setConflict] = useState<PipelinesConfigText | null>(null);
  const [saving, setSaving] = useState(false);
  // A fresh copy of the file replaces the text only while there are no unsaved edits.
  if (loaded !== seen) {
    setSeen(loaded);
    if (draft === base.text) {
      setBase(loaded);
      setDraft(loaded.text);
    }
  }

  const report = checkPipelinesDraft(useDeferredValue(draft));
  const dirty = draft !== base.text;

  /** True when this machine's file now holds the draft. */
  const save = async (expectedRevision: string | null, quiet = false) => {
    setSaving(true);
    const result = await saveText({
      environmentId,
      input: { text: draft, expectedRevision },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        reportFailure("Could not save pipelines.json", squashAtomCommandFailure(result));
      }
      return false;
    }
    if (result.value.saved) {
      setBase(result.value.current);
      setConflict(null);
      if (!quiet) toastManager.add({ type: "success", title: "pipelines.json saved" });
      return true;
    }
    setConflict(result.value.current);
    return false;
  };

  const copyFrom = async (machine: { environmentId: EnvironmentId; label: string }) => {
    if (
      dirty &&
      !(await ensureLocalApi().dialogs.confirm(
        `Replace your unsaved changes with the pipelines.json from ${machine.label}?`,
      ))
    ) {
      return;
    }
    setSaving(true);
    const result = await readText({ environmentId: machine.environmentId, input: {} });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        reportFailure(
          `Could not read pipelines.json from ${machine.label}`,
          squashAtomCommandFailure(result),
        );
      }
      return;
    }
    if (result.value.revision === null) {
      toastManager.add({ type: "info", title: `${machine.label} has no pipelines.json yet` });
      return;
    }
    setDraft(result.value.text);
    setConflict(null);
    toastManager.add({
      type: "info",
      title: `Copied from ${machine.label}`,
      description: "Read it over, then Save.",
    });
  };

  const saveEverywhere = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      [
        "Save this pipelines.json to every connected machine?",
        `Their current file is replaced on: ${otherMachines.map((machine) => machine.label).join(", ")}.`,
      ].join("\n"),
    );
    if (!confirmed) return;
    const wasDirty = dirty;
    // This machine first, so its own changed-file check still applies before anything spreads.
    if (wasDirty && !(await save(base.revision, true))) return;
    setSaving(true);
    const outcomes: PipelinesPushOutcome[] = [];
    for (const machine of otherMachines) {
      const outcome = (status: PipelinesPushOutcome["status"]) =>
        outcomes.push({ machine: machine.label, status });
      if (!readEnvironmentScope(machine.environmentId, AuthSettingsWriteScope)) {
        outcome("no-access");
        continue;
      }
      const found = await readText({ environmentId: machine.environmentId, input: {} });
      if (found._tag === "Failure") {
        outcome("failed");
        continue;
      }
      if (found.value.text === draft) {
        outcome("up-to-date");
        continue;
      }
      const saved = await saveText({
        environmentId: machine.environmentId,
        input: { text: draft, expectedRevision: found.value.revision },
      });
      outcome(saved._tag === "Failure" ? "failed" : saved.value.saved ? "saved" : "changed");
    }
    setSaving(false);
    toastManager.add(
      stackedThreadToast(
        describePipelinesPush([
          { machine: "This machine", status: wasDirty ? "saved" : "up-to-date" },
          ...outcomes,
        ]),
      ),
    );
  };

  const createExample = async () => {
    const result = await ensureExample({ environmentId, input: {} });
    if (result._tag === "Success") {
      props.onRefresh();
    } else if (!isAtomCommandInterrupted(result)) {
      reportFailure("Could not create pipelines.json", squashAtomCommandFailure(result));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <Textarea
        aria-label="pipelines.json"
        aria-describedby={textId}
        aria-invalid={report.issues.length > 0 || undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={!canWrite}
        spellCheck={false}
        autoCapitalize="none"
        placeholder={'{ "pipelines": [ … ] }'}
        className="flex min-h-64 flex-1 flex-col [&>textarea]:max-h-none [&>textarea]:min-h-0 [&>textarea]:flex-1"
      />
      <div id={textId} className="flex flex-col gap-1 text-sm" aria-live="polite">
        <p className="text-muted-foreground">{report.summary}</p>
        {report.issues.length === 0 ? null : (
          <ul className="flex list-disc flex-col gap-1 ps-4 text-warning-foreground">
            {report.issues.map((issue) => (
              <li key={issue} className="whitespace-pre-wrap">
                {issue}
              </li>
            ))}
          </ul>
        )}
      </div>
      {conflict === null ? null : (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-warning/40 p-3 text-sm"
        >
          <p>pipelines.json changed on the server since you opened it.</p>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setBase(conflict);
                setDraft(conflict.text);
                setConflict(null);
              }}
            >
              Load server version
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={saving || !canWrite}
              onClick={() => void save(conflict.revision)}
            >
              Save anyway
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || saving || !canWrite}
          onClick={() => void save(base.revision)}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(base.text);
            setConflict(null);
          }}
        >
          Revert
        </Button>
        {base.revision === null && draft === "" && canWrite ? (
          <Button size="sm" variant="ghost" onClick={() => void createExample()}>
            Start from an example
          </Button>
        ) : null}
        {configPath === null ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={!canOpenEditor || availableEditors.length === 0}
            onClick={() => void openConfigInEditor()}
          >
            {openInEditorMenuLabel(preferredEditor)}
          </Button>
        )}
        {otherMachines.length === 0 ? null : (
          <div className="ms-auto flex items-center gap-2">
            <Menu>
              <MenuTrigger
                disabled={saving || !canWrite}
                render={<Button size="sm" variant="outline" />}
              >
                Copy from…
              </MenuTrigger>
              <MenuPopup align="end">
                {otherMachines.map((machine) => (
                  <MenuItem key={machine.environmentId} onClick={() => void copyFrom(machine)}>
                    {machine.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !canWrite}
              onClick={() => void saveEverywhere()}
            >
              Save to all connected machines
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PipelinesSettingsBody() {
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const connected = environment?.connection.phase === "connected";
  const text = useEnvironmentQuery(
    environmentId !== null && connected
      ? serverEnvironment.pipelinesConfigText({ environmentId, input: {} })
      : null,
  );
  const snapshot = useEnvironmentQuery(
    environmentId !== null && connected
      ? serverEnvironment.pipelinesLive({ environmentId, input: {} })
      : null,
  ).data;
  const machine = environment?.label ?? "this machine";

  return (
    <SettingsPageContainer width="expanded" className="min-h-full">
      <SettingsSection
        title="Pipelines"
        description={`Stages sent one after another into a single thread. This is pipelines.json on ${machine}; saved changes apply right away.`}
        className="flex min-h-0 flex-1 flex-col gap-2.5 space-y-0"
      >
        {environmentId !== null && text.data !== null ? (
          <PipelinesEditor
            environmentId={environmentId}
            loaded={text.data}
            configPath={snapshot?.configPath ?? null}
            onRefresh={text.refresh}
          />
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {environmentId === null || !connected
              ? `Reconnect ${machine} to edit its pipelines.`
              : (text.error ?? "Loading pipelines.json…")}
          </p>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function PipelinesSettingsPanel() {
  const { environment } = useSettingsScope();
  // The draft belongs to one environment, so a scope switch starts fresh.
  return <PipelinesSettingsBody key={environment?.environmentId ?? ""} />;
}

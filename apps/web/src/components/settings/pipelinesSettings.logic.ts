import { decodePipelinesFile } from "@t3tools/shared/pipelines";

export interface PipelinesDraftReport {
  /** One line on what the text would do once saved. */
  readonly summary: string;
  readonly issues: ReadonlyArray<string>;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export type PipelinesPushStatus = "saved" | "up-to-date" | "changed" | "no-access" | "failed";

export interface PipelinesPushOutcome {
  readonly machine: string;
  readonly status: PipelinesPushStatus;
}

const NOT_SAVED_REASONS: Readonly<
  Record<Exclude<PipelinesPushStatus, "saved" | "up-to-date">, string>
> = {
  changed: "its file changed while saving",
  "no-access": "this connection can't change its settings",
  failed: "the request failed",
};

/** One toast for a save to several machines: what landed, and what didn't and why. */
export function describePipelinesPush(outcomes: ReadonlyArray<PipelinesPushOutcome>): {
  readonly type: "success" | "warning";
  readonly title: string;
  readonly description: string;
} {
  const landed = outcomes.filter(
    (outcome) => outcome.status === "saved" || outcome.status === "up-to-date",
  );
  const missed = outcomes.flatMap((outcome) =>
    outcome.status === "saved" || outcome.status === "up-to-date"
      ? []
      : [`${outcome.machine}: ${NOT_SAVED_REASONS[outcome.status]}`],
  );
  const matched = outcomes.filter((outcome) => outcome.status === "up-to-date").length;
  const landedLine =
    `${plural(landed.length, "machine")} now ${landed.length === 1 ? "has" : "have"} this file` +
    (matched > 0 ? ` (${matched} already did)` : "");
  return missed.length === 0
    ? { type: "success", title: "Saved to all connected machines", description: landedLine }
    : {
        type: "warning",
        title: "Not saved everywhere",
        description: `${landedLine}. Not saved: ${missed.join("; ")}.`,
      };
}

/** The same check the server runs on the saved file, so the text is judged before it is saved. */
export function checkPipelinesDraft(text: string): PipelinesDraftReport {
  if (text.trim() === "") return { summary: "No pipelines defined.", issues: [] };
  const { pipelines, issues } = decodePipelinesFile(text);
  const ready = `${plural(pipelines.length, "pipeline")} ready`;
  return {
    summary:
      issues.length === 0
        ? ready
        : `${ready}, ${plural(issues.length, "problem")} (a pipeline with a problem is skipped)`,
    issues,
  };
}

import { describe, expect, it } from "vite-plus/test";

import { PipelineStageId } from "./pipeline.ts";
import {
  pipelineVerdictOf,
  renderPipelineContinuationPrompt,
  renderPipelineStagePrompt,
  renderPipelineVerifyPrompt,
} from "./pipeline.ts";

describe("renderPipelineStagePrompt", () => {
  it("replaces {input} and appends the verdict and reports rule", () => {
    const rendered = renderPipelineStagePrompt(
      "Plan {input}.",
      "Fix the login bug",
      PipelineStageId.make("plan"),
    );
    expect(rendered.startsWith("Plan Fix the login bug.\n")).toBe(true);
    expect(rendered).toContain("pipeline-reports/plan.md");
    expect(rendered).toContain("PIPELINE: DONE");
    expect(rendered).toContain("PIPELINE: FAILED: <why>");
    expect(rendered).toContain("PIPELINE: WAITING");
  });

  it("replaces every {input} occurrence", () => {
    expect(renderPipelineStagePrompt("{input} then {input}", "X")).toContain("X then X");
  });
});

describe("renderPipelineVerifyPrompt", () => {
  it("names the stage, the criteria and the verdict lines", () => {
    const rendered = renderPipelineVerifyPrompt(
      "Review",
      PipelineStageId.make("review"),
      "check {input} is covered by tests",
      "the login bug",
    );
    expect(rendered).toContain('"Review"');
    expect(rendered).toContain("check the login bug is covered by tests");
    expect(rendered).toContain("pipeline-reports/review.verify.md");
    expect(rendered).toContain("PIPELINE: VERIFIED");
    expect(rendered).toContain("PIPELINE: REJECTED: <what is missing or wrong>");
  });
});

describe("renderPipelineContinuationPrompt", () => {
  it("names the unfinished stage and restates the verdict lines", () => {
    const rendered = renderPipelineContinuationPrompt("Work");
    expect(rendered).toContain('"Work" stage is not finished');
    expect(rendered).toContain("Continue where you left off");
    expect(rendered).toContain("PIPELINE: DONE");
    expect(rendered).toContain("PIPELINE: WAITING");
  });
});

describe("pipelineVerdictOf", () => {
  it("reads the last PIPELINE: line, not an earlier mention", () => {
    expect(
      pipelineVerdictOf("I considered `PIPELINE: WAITING` but finished.\n\nPIPELINE: DONE"),
    ).toEqual({ verdict: "done", detail: "" });
  });

  it("captures the FAILED / REJECTED detail", () => {
    expect(pipelineVerdictOf("work\nPIPELINE: FAILED: tests red")).toEqual({
      verdict: "failed",
      detail: "tests red",
    });
    expect(pipelineVerdictOf("PIPELINE: REJECTED: no tests added")).toEqual({
      verdict: "rejected",
      detail: "no tests added",
    });
  });

  it("accepts VERIFIED and WAITING, and tolerates markdown around the keyword", () => {
    expect(pipelineVerdictOf("`PIPELINE: **VERIFIED**`")).toEqual({
      verdict: "verified",
      detail: "",
    });
    expect(pipelineVerdictOf("PIPELINE: WAITING")).toEqual({ verdict: "waiting", detail: "" });
  });

  it("returns null when the reply has no verdict line", () => {
    expect(pipelineVerdictOf("all done, trust me")).toBe(null);
    expect(pipelineVerdictOf("")).toBe(null);
  });
});

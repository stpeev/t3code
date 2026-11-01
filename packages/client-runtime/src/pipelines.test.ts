import { PipelineId, PipelineStageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  labelThreadPipelineStage,
  planPipelineCommand,
  resolveThreadPipelineProgress,
} from "./pipelines.ts";

const threadId = ThreadId.make("thread-1");
const stage = (id: string, name: string, color?: string) => ({
  id: PipelineStageId.make(id),
  name,
  prompt: `${name} {input}.`,
  ...(color === undefined ? {} : { color }),
});
const ticket = {
  id: PipelineId.make("ticket"),
  name: "Ticket",
  stages: [
    stage("plan", "Plan"),
    stage("develop", "Develop", "#0ea5e9"),
    stage("review", "Review"),
  ],
};
const savedAt = (pipelineId: string, stageId: string) => ({
  pipelines: [ticket],
  threads: [
    {
      threadId,
      pipelineId: PipelineId.make(pipelineId),
      stageId: PipelineStageId.make(stageId),
      input: "Fix the login bug",
      updatedAt: "2026-10-29T00:00:00.000Z",
    },
  ],
});

describe("resolveThreadPipelineProgress", () => {
  it("places the thread's stage in its pipeline and names the stage after it", () => {
    const develop = resolveThreadPipelineProgress(savedAt("ticket", "develop"), threadId);
    const review = resolveThreadPipelineProgress(savedAt("ticket", "review"), threadId);

    expect([develop?.position, develop?.next?.id]).toEqual([2, "review"]);
    expect([review?.position, review?.next]).toEqual([3, null]);
    expect(develop && labelThreadPipelineStage(develop)).toEqual({
      short: "Develop 2/3",
      spoken: "pipeline Ticket, stage Develop, 2 of 3",
      pipelineId: "ticket",
      stageName: "Develop",
      color: "#0ea5e9",
      position: 2,
      stageCount: 3,
    });
    // No explicit color: orange first, green halfway, blue last.
    expect(
      labelThreadPipelineStage(resolveThreadPipelineProgress(savedAt("ticket", "plan"), threadId)!)
        .color,
    ).toBe("hsl(30 70% 45%)");
    expect(labelThreadPipelineStage(review!).color).toBe("hsl(240 70% 45%)");
    expect(resolveThreadPipelineProgress(savedAt("ticket", "plan"), ThreadId.make("other"))).toBe(
      null,
    );
  });

  it("keeps a thread whose stage or pipeline left pipelines.json, with no place or next stage", () => {
    for (const [pipelineId, stageId] of [
      ["ticket", "deploy"],
      ["bugfix", "plan"],
    ] as const) {
      const progress = resolveThreadPipelineProgress(savedAt(pipelineId, stageId), threadId);

      expect([progress?.stage, progress?.next]).toEqual([null, null]);
      expect(progress && labelThreadPipelineStage(progress).short).toBe(stageId);
    }
  });
});

describe("planPipelineCommand", () => {
  const plan = (prompt: string, newThread = false) =>
    planPipelineCommand({ prompt, pipelines: [ticket], newThread });

  it("reads the pipeline and the task, keeping the task's own lines", () => {
    expect(plan("/pipeline ticket Fix the login bug")).toMatchObject({
      ok: true,
      stage: { id: "plan" },
      task: "Fix the login bug",
    });
    expect(plan("  /pipeline ticket\nFix it\n\nwith details  ")).toMatchObject({
      task: "Fix it\n\nwith details",
    });
    expect(plan("/pipeline ticket")).toMatchObject({ ok: true, task: "" });
  });

  it("leaves other prompts alone and says why it can't start a pipeline", () => {
    expect(plan("/pipelines ticket")).toBe(null);
    expect(plan("Run /pipeline ticket")).toBe(null);
    expect(plan("/pipeline")).toEqual({
      ok: false,
      message: "Name a pipeline: /pipeline <id> <task>",
    });
    expect(plan("/pipeline bugfix Fix it")).toEqual({
      ok: false,
      message: 'There is no pipeline "bugfix" in pipelines.json.',
    });
    expect(plan("/pipeline ticket", true)).toEqual({
      ok: false,
      message: "Add the task after the pipeline: /pipeline ticket <task>",
    });
  });
});

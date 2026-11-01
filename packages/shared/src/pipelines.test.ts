import { describe, expect, it } from "vite-plus/test";

import { decodePipelinesFile } from "./pipelines.ts";

const pipeline = (id: string, stageIds: ReadonlyArray<string> = ["plan"]) => ({
  id,
  name: `Pipeline ${id}`,
  stages: stageIds.map((stageId) => ({ id: stageId, name: stageId, prompt: `Do ${stageId}.` })),
});

const ids = (raw: string) => decodePipelinesFile(raw).pipelines.map((entry) => entry.id);

describe("decodePipelinesFile", () => {
  it("reads pipelines and accepts comments and trailing commas", () => {
    const state = decodePipelinesFile(`// mine
      { "pipelines": [ { "id": "ticket", "name": "Ticket", "stages": [
        { "id": "plan", "name": "Plan", "prompt": "Plan {input}." }, /* more later */
      ] }, ] }`);

    expect(state.pipelines.map((entry) => entry.id)).toEqual(["ticket"]);
    expect(state.issues).toEqual([]);
  });

  it("reports a file that isn't a pipelines object as one problem", () => {
    for (const raw of ["{ not json", "[]", `{ "pipelines": {} }`]) {
      const state = decodePipelinesFile(raw);
      expect(state.pipelines).toEqual([]);
      expect(state.issues).toHaveLength(1);
    }
  });

  it("skips only the pipelines with a problem and names each one", () => {
    const raw = JSON.stringify({
      pipelines: [
        pipeline("ticket"),
        pipeline("Bad Id"),
        pipeline("ticket"),
        pipeline("bugfix", ["fix", "fix"]),
        { ...pipeline("empty"), stages: [] },
        pipeline("review"),
      ],
    });
    const { issues } = decodePipelinesFile(raw);

    expect(ids(raw)).toEqual(["ticket", "review"]);
    expect(issues).toHaveLength(4);
    expect(issues[0]).toMatch(/^Pipeline 2: /);
    expect(issues[1]).toBe('Pipeline 3: id "ticket" is already used by another pipeline.');
    expect(issues[2]).toBe('Pipeline 4 ("bugfix"): stage id "fix" is used twice.');
    expect(issues[3]).toMatch(/^Pipeline 5: /);
  });

  it("accepts any CSS color for a stage and only rejects over-length values", () => {
    for (const color of ["#0EA5E9", "blue", "hsl(210 90% 45%)", "color(srgb 0.1 0.6 0.9)"]) {
      const state = decodePipelinesFile(
        JSON.stringify({
          pipelines: [
            {
              ...pipeline("ticket"),
              stages: [{ id: "plan", name: "Plan", prompt: "Plan.", color }],
            },
          ],
        }),
      );
      expect(state.issues).toEqual([]);
      expect(state.pipelines[0]?.stages[0]?.color).toBe(color);
    }

    const tooLong = decodePipelinesFile(
      JSON.stringify({
        pipelines: [
          {
            ...pipeline("ticket"),
            stages: [{ id: "plan", name: "Plan", prompt: "Plan.", color: `red ${"x".repeat(60)}` }],
          },
        ],
      }),
    );
    expect(tooLong.pipelines).toEqual([]);
    expect(tooLong.issues[0]).toMatch(/^Pipeline 1: /);
  });

  it("stops at the pipeline limit", () => {
    const names = Array.from({ length: 52 }, (_, index) => `p${index}`);
    const state = decodePipelinesFile(
      JSON.stringify({ pipelines: names.map((id) => pipeline(id)) }),
    );

    expect(state.pipelines).toHaveLength(50);
    expect(state.issues).toEqual([
      "Pipeline 51 and the ones after it are skipped: the limit is 50.",
    ]);
  });
});

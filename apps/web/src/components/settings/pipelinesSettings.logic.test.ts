import { describe, expect, it } from "vite-plus/test";

import { checkPipelinesDraft, describePipelinesPush } from "./pipelinesSettings.logic";

const stage = { id: "plan", name: "Plan", prompt: "Plan {input}." };
const pipeline = (id: string) => ({ id, name: id, stages: [stage] });

describe("checkPipelinesDraft", () => {
  it("judges the draft as the server will judge the saved file", () => {
    expect(checkPipelinesDraft("   ")).toEqual({ summary: "No pipelines defined.", issues: [] });
    expect(checkPipelinesDraft(JSON.stringify({ pipelines: [pipeline("a")] }))).toEqual({
      summary: "1 pipeline ready",
      issues: [],
    });

    const mixed = checkPipelinesDraft(
      JSON.stringify({ pipelines: [pipeline("a"), pipeline("Bad Id"), pipeline("b")] }),
    );
    expect(mixed.summary).toBe(
      "2 pipelines ready, 1 problem (a pipeline with a problem is skipped)",
    );
    expect(mixed.issues).toHaveLength(1);
    expect(mixed.issues[0]).toMatch(/^Pipeline 2: /);

    expect(checkPipelinesDraft("{ not json").issues).toHaveLength(1);
  });
});

describe("describePipelinesPush", () => {
  it("reports what landed, and names each machine that didn't and why", () => {
    expect(
      describePipelinesPush([
        { machine: "Laptop", status: "saved" },
        { machine: "Desktop", status: "up-to-date" },
      ]),
    ).toEqual({
      type: "success",
      title: "Saved to all connected machines",
      description: "2 machines now have this file (1 already did)",
    });

    expect(
      describePipelinesPush([
        { machine: "Laptop", status: "saved" },
        { machine: "Server", status: "changed" },
        { machine: "VM", status: "no-access" },
        { machine: "Old", status: "failed" },
      ]),
    ).toEqual({
      type: "warning",
      title: "Not saved everywhere",
      description:
        "1 machine now has this file. Not saved: Server: its file changed while saving; " +
        "VM: this connection can't change its settings; Old: the request failed.",
    });
  });
});

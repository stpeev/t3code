import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import { sessionRules } from "./adapter.ts";

// The last matching rule decides, as OpenCode 2 evaluates them.
const effectFor = (rules: ReturnType<typeof sessionRules>, action: string) =>
  rules.findLast((rule) => rule.action === "*" || rule.action === action)?.effect;

describe("OpenCode 2 session rules", () => {
  it("denies the native subagent tool in every mode while native subagents are blocked", () => {
    for (const runtimeMode of ["approval-required", "auto-accept-edits", "full-access"] as const) {
      const rulesFor = (nativeSubagents: "allowed" | "blocked") =>
        sessionRules({ runtimeMode, interactionMode: "default", nativeSubagents }, [], [], null);
      assert.equal(effectFor(rulesFor("blocked"), "subagent"), "deny", runtimeMode);
      assert.notEqual(effectFor(rulesFor("allowed"), "subagent"), "deny", runtimeMode);
    }
  });
});

import { assert, describe, it } from "vite-plus/test";

import {
  DIFF_SEARCH_HISTORY_LIMIT,
  rememberDiffSearchTerm,
  stepDiffSearchRecall,
} from "./diffSearchHistory";

describe("rememberDiffSearchTerm", () => {
  it("moves a repeated term to the front instead of duplicating it", () => {
    assert.deepEqual(rememberDiffSearchTerm(["b", "a", "c"], "a"), ["a", "b", "c"]);
  });

  it("ignores blank terms and keeps the history identity when nothing changes", () => {
    const history = ["a", "b"];
    assert.strictEqual(rememberDiffSearchTerm(history, "  "), history);
    assert.strictEqual(rememberDiffSearchTerm(history, "a"), history);
  });

  it("drops the oldest term past the limit", () => {
    const history = Array.from({ length: DIFF_SEARCH_HISTORY_LIMIT }, (_, index) => `t${index}`);
    const next = rememberDiffSearchTerm(history, "new");
    assert.lengthOf(next, DIFF_SEARCH_HISTORY_LIMIT);
    assert.strictEqual(next[0], "new");
    assert.notInclude(next, `t${DIFF_SEARCH_HISTORY_LIMIT - 1}`);
  });
});

describe("stepDiffSearchRecall", () => {
  const history = ["newest", "older", "oldest"];

  it("walks back through history and returns to the typed draft", () => {
    let state = stepDiffSearchRecall(history, null, "draft", "older");
    assert.deepEqual(state, { recall: { index: 0, draft: "draft" }, query: "newest" });
    state = stepDiffSearchRecall(history, state!.recall, state!.query, "older");
    assert.strictEqual(state?.query, "older");
    state = stepDiffSearchRecall(history, state!.recall, state!.query, "newer");
    assert.strictEqual(state?.query, "newest");
    state = stepDiffSearchRecall(history, state!.recall, state!.query, "newer");
    assert.deepEqual(state, { recall: null, query: "draft" });
  });

  it("stops at either end", () => {
    assert.isNull(stepDiffSearchRecall(history, null, "draft", "newer"));
    assert.isNull(stepDiffSearchRecall(history, { index: 2, draft: "" }, "oldest", "older"));
    assert.isNull(stepDiffSearchRecall([], null, "", "older"));
  });
});

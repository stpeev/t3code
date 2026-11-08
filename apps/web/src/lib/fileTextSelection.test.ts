import { describe, expect, it } from "vite-plus/test";

import { findTextLineRange, formatTextLineRange } from "./fileTextSelection";

const CONTENTS = ["# Plan", "", "Some text here.", "", "- item one", "- item two"].join("\n");

describe("findTextLineRange", () => {
  it("maps a single-line selection to its source line", () => {
    expect(findTextLineRange(CONTENTS, "Some text here.")).toEqual({ startLine: 3, endLine: 3 });
  });

  it("maps a multi-line selection across lines", () => {
    expect(findTextLineRange(CONTENTS, "item one - item two")).toEqual({
      startLine: 5,
      endLine: 6,
    });
  });

  it("tolerates whitespace differences between rendered and source text", () => {
    expect(findTextLineRange(CONTENTS, "Some   text\nhere.")).toEqual({ startLine: 3, endLine: 3 });
  });

  it("returns null when the selection is not in the file", () => {
    expect(findTextLineRange(CONTENTS, "not present anywhere")).toBeNull();
    expect(findTextLineRange(CONTENTS, "   ")).toBeNull();
  });
});

describe("formatTextLineRange", () => {
  it("formats single and multi line ranges", () => {
    expect(formatTextLineRange({ startLine: 3, endLine: 3 })).toBe("L3");
    expect(formatTextLineRange({ startLine: 5, endLine: 6 })).toBe("L5 to L6");
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  extractMermaidCodeBlocks,
  findDiagramSectionLines,
  mermaidSourcesMatch,
} from "./mermaidBlocks.ts";

describe("extractMermaidCodeBlocks", () => {
  it("returns no blocks for plain source", () => {
    expect(extractMermaidCodeBlocks("const a = 1;\n// nothing here\n")).toEqual([]);
  });

  it("extracts a fenced block from a JS doc comment with line numbers", () => {
    const source = [
      "/**",
      " * ```mermaid",
      " * graph TD",
      " *   A --> B",
      " * ```",
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(extractMermaidCodeBlocks(source)).toEqual([
      { source: "graph TD\nA --> B", startLine: 3, endLine: 4 },
    ]);
  });

  it("strips line-comment prefixes from the block source so renderers can parse it", () => {
    const source = ["// ```mermaid", "// flowchart LR", "//   A-->B", "// ```"].join("\n");
    const blocks = extractMermaidCodeBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe("flowchart LR\nA-->B");
    expect(blocks[0]).toMatchObject({ startLine: 2, endLine: 3 });
  });

  it("supports tilde fences, longer closing fences and fence titles", () => {
    const source = [
      "~~~mermaid title=Flow",
      "graph TD; A-->B",
      "~~~~",
      "```mermaid",
      "graph LR; C-->D",
      "``````",
    ].join("\n");
    expect(extractMermaidCodeBlocks(source)).toEqual([
      { source: "graph TD; A-->B", startLine: 2, endLine: 2 },
      { source: "graph LR; C-->D", startLine: 5, endLine: 5 },
    ]);
  });

  it("ignores unclosed blocks", () => {
    const source = ["```mermaid", "graph TD; A-->B", "const a = 1;"].join("\n");
    expect(extractMermaidCodeBlocks(source)).toEqual([]);
  });

  it("does not close on a fence that carries an info string", () => {
    const source = ["```mermaid", "graph TD; A-->B", "```js", "const a = 1;", "```"].join("\n");
    expect(extractMermaidCodeBlocks(source)).toEqual([
      { source: "graph TD; A-->B\n```js\nconst a = 1;", startLine: 2, endLine: 4 },
    ]);
  });

  it("does not close a fence on a shorter fence of the same character", () => {
    const source = ["````mermaid", "graph TD; A-->B", "```", "still inside", "````"].join("\n");
    expect(extractMermaidCodeBlocks(source)).toEqual([
      { source: "graph TD; A-->B\n```\nstill inside", startLine: 2, endLine: 4 },
    ]);
  });

  it("extracts multiple blocks", () => {
    const source = [
      "```mermaid",
      "graph TD; A-->B",
      "```",
      "text",
      "```mermaid",
      "sequenceDiagram",
      "```",
    ].join("\n");
    expect(extractMermaidCodeBlocks(source)).toEqual([
      { source: "graph TD; A-->B", startLine: 2, endLine: 2 },
      { source: "sequenceDiagram", startLine: 6, endLine: 6 },
    ]);
  });
});

describe("mermaidSourcesMatch", () => {
  it("ignores per-line indentation and comment prefixes", () => {
    expect(
      mermaidSourcesMatch("graph TD\n  A[Login] --> B[Home]", "graph TD\nA[Login] --> B[Home]"),
    ).toBe(true);
    expect(mermaidSourcesMatch(" * graph TD\n * A-->B", "graph TD\nA-->B")).toBe(true);
    expect(mermaidSourcesMatch("graph TD\nA-->B", "graph TD\nA-->C")).toBe(false);
  });
});

describe("findDiagramSectionLines", () => {
  const contents = [
    "graph TD", // 1
    "  A[Login] --> B[Home]", // 2
    "  B --> C[Logout]", // 3
    "  subgraph S[Auth]", // 4
    "    A", // 5
    "  end", // 6
  ].join("\n");

  it("finds the line where a node id is defined", () => {
    expect(
      findDiagramSectionLines({ contents, sectionId: "B", blockStartLine: 1, blockEndLine: 6 }),
    ).toEqual({ startLine: 2, endLine: 2 });
  });

  it("matches subgraph ids", () => {
    expect(
      findDiagramSectionLines({ contents, sectionId: "S", blockStartLine: 1, blockEndLine: 6 }),
    ).toEqual({ startLine: 4, endLine: 4 });
  });

  it("does not match a longer id that merely starts with the section id", () => {
    expect(
      findDiagramSectionLines({ contents, sectionId: "A", blockStartLine: 1, blockEndLine: 6 }),
    ).toEqual({ startLine: 2, endLine: 2 });
  });

  it("falls back to the block range for ids absent from the source", () => {
    expect(
      findDiagramSectionLines({
        contents,
        sectionId: "L_A_B_0",
        blockStartLine: 2,
        blockEndLine: 3,
      }),
    ).toEqual({ startLine: 2, endLine: 3 });
  });

  it("prefers a line inside the block over one outside it", () => {
    const withDuplicate = `A --> B\n${contents}`;
    expect(
      findDiagramSectionLines({
        contents: withDuplicate,
        sectionId: "C",
        blockStartLine: 3,
        blockEndLine: 7,
      }),
    ).toEqual({ startLine: 4, endLine: 4 });
  });
});

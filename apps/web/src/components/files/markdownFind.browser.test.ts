import { describe, expect, it } from "vite-plus/test";

import {
  collectMarkdownFindRanges,
  firstMarkdownFindIndexAfterScroll,
  stepMarkdownFindIndex,
} from "./markdownFind";

function container(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

describe("collectMarkdownFindRanges", () => {
  it("finds matches in document order, case-insensitively", () => {
    const element = container("<p>Alpha needle beta</p><p>NEEDLE again</p>");
    const ranges = collectMarkdownFindRanges(element, "needle");
    expect(ranges.map((range) => range.toString())).toEqual(["needle", "NEEDLE"]);
  });

  it("joins matches split across inline elements but not across blocks", () => {
    const element = container(
      "<p>some <strong>nee</strong><code>dle</code> here</p><p>needle</p><div>nee<span>dle</span></div>",
    );
    const ranges = collectMarkdownFindRanges(element, "needle");
    expect(ranges.map((range) => range.toString())).toEqual(["needle", "needle", "needle"]);
  });

  it("skips ignored subtrees such as the find bar itself", () => {
    const element = container(
      '<p>needle</p><div data-markdown-find-ignore="true"><span>needle needle</span></div><svg><text>needle</text></svg>',
    );
    const ranges = collectMarkdownFindRanges(element, "needle");
    expect(ranges.map((range) => range.toString())).toEqual(["needle"]);
  });

  it("maps a match to the correct text nodes when split across spans", () => {
    const element = container("<pre><code><span>con</span><span>st</span> a = 1</code></pre>");
    const ranges = collectMarkdownFindRanges(element, "const");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.toString()).toBe("const");
    expect(ranges[0]!.startContainer.nodeValue).toBe("con");
    expect(ranges[0]!.startOffset).toBe(0);
    expect(ranges[0]!.endContainer.nodeValue).toBe("st");
    expect(ranges[0]!.endOffset).toBe(2);
  });

  it("returns no ranges for an empty query and matches across soft line breaks", () => {
    const element = container("<p>needle</p>");
    expect(collectMarkdownFindRanges(element, "")).toEqual([]);
    // The newline is normalized to a space for matching; the range still covers the raw text.
    const wrapped = container("<p>nee\ndle</p>");
    const ranges = collectMarkdownFindRanges(wrapped, "nee dle");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.toString()).toBe("nee\ndle");
  });
});

describe("stepMarkdownFindIndex", () => {
  it("wraps in both directions and starts from either end", () => {
    expect(stepMarkdownFindIndex(-1, 3, 1)).toBe(0);
    expect(stepMarkdownFindIndex(-1, 3, -1)).toBe(2);
    expect(stepMarkdownFindIndex(2, 3, 1)).toBe(0);
    expect(stepMarkdownFindIndex(0, 3, -1)).toBe(2);
    expect(stepMarkdownFindIndex(1, 0, 1)).toBe(-1);
  });
});

describe("firstMarkdownFindIndexAfterScroll", () => {
  it("picks the first match at or below the scroll container's top edge", () => {
    const paragraph = 'style="margin:0;height:20px"';
    const element = container(
      `<p ${paragraph}>one needle</p><p ${paragraph}>two needle</p><p ${paragraph}>three needle</p><div style="height:600px"></div>`,
    );
    const scroll = document.createElement("div");
    scroll.style.cssText = "position:fixed;top:0;left:0;width:100px;height:100px;overflow:auto";
    scroll.appendChild(element);
    document.body.appendChild(scroll);
    const ranges = collectMarkdownFindRanges(element, "needle");
    expect(ranges).toHaveLength(3);
    // Scrolled to the top: the first match is the active one.
    expect(firstMarkdownFindIndexAfterScroll(ranges, scroll)).toBe(0);
    // Scrolled so the second paragraph reaches the top edge: the first match is above it.
    scroll.scrollTop = (element.children[1] as HTMLElement).offsetTop;
    expect(firstMarkdownFindIndexAfterScroll(ranges, scroll)).toBe(1);
    // Scrolled past every match (the spacer fills the rest): wraps back to the first match.
    scroll.scrollTop = scroll.scrollHeight;
    expect(firstMarkdownFindIndexAfterScroll(ranges, scroll)).toBe(0);
    expect(firstMarkdownFindIndexAfterScroll([], scroll)).toBe(-1);
    scroll.remove();
  });
});

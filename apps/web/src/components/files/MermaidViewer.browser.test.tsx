import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

import MermaidViewer from "./MermaidViewer";

const SOURCE = "graph TD\n  A[Login] --> B[Home]";

async function waitForNode(container: HTMLElement, id: string): Promise<Element> {
  let node: Element | null = null;
  await vi.waitFor(() => {
    node = container.querySelector(`g.pele-node[data-id='${id}']`);
    expect(node).not.toBeNull();
  });
  return node!;
}

function markedNode(container: HTMLElement, id: string): Element | null {
  return container.querySelector(`g.pele-node[data-id='${id}'].t3-mermaid-marked`);
}

// SVG elements have no .click(); dispatch a bubbling click like a user would.
async function clickElement(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

it("marks a diagram node, comments on it and sends the comment to chat", async () => {
  const onCommentSection = vi.fn();
  const screen = await render(<MermaidViewer text={SOURCE} onCommentSection={onCommentSection} />, {
    router: false,
  });
  await using _screen = screen;

  await clickElement(await waitForNode(screen.container, "A"));

  // The section is marked and the comment bar names it.
  await vi.waitFor(() => expect(markedNode(screen.container, "A")).not.toBeNull());
  const commentBox = page.getByRole("textbox", { name: /Comment on lines/ });
  await userEvent.type(commentBox, "Should this handle SSO?");
  await userEvent.click(page.getByRole("button", { name: "Send to chat" }));

  expect(onCommentSection).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "node", id: "A", label: expect.stringContaining("Login") }),
    "Should this handle SSO?",
  );
  // The comment bar closes after sending.
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-diff-comment-annotation]")).toBeNull(),
  );
});

it("clears the mark when the selected node is clicked again", async () => {
  const screen = await render(<MermaidViewer text={SOURCE} onCommentSection={vi.fn()} />, {
    router: false,
  });
  await using _screen = screen;

  const node = await waitForNode(screen.container, "B");
  await clickElement(node);
  await vi.waitFor(() => expect(markedNode(screen.container, "B")).not.toBeNull());
  await clickElement(await waitForNode(screen.container, "B"));
  await vi.waitFor(() => expect(markedNode(screen.container, "B")).toBeNull());
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-diff-comment-annotation]")).toBeNull(),
  );
});

it("stays non-interactive without an onCommentSection callback", async () => {
  const screen = await render(<MermaidViewer text={SOURCE} />, { router: false });
  await using _screen = screen;

  await clickElement(await waitForNode(screen.container, "A"));
  // Give a selection handler a chance to (not) run.
  await act(() => Promise.resolve());
  expect(markedNode(screen.container, "A")).toBeNull();
  expect(screen.container.querySelector("[data-diff-comment-annotation]")).toBeNull();
});

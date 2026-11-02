import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { revealClickedRow, type SidebarRouteReveal, useActiveRowReveal } from "./routeReveal";

const ROW_HEIGHT_PX = 24;

function RevealList(props: {
  readonly reveal: SidebarRouteReveal;
  readonly rowKeys: ReadonlyArray<string>;
  readonly activeKey: string | null;
}) {
  const revealActiveRow = useActiveRowReveal(props.reveal, props.activeKey);
  return (
    <ul aria-label="Threads" style={{ height: ROW_HEIGHT_PX * 4, overflowY: "auto", margin: 0 }}>
      {props.rowKeys.map((key) => (
        <li
          key={key}
          ref={key === props.activeKey ? (row) => revealActiveRow(row, key) : undefined}
          tabIndex={-1}
          style={{ height: ROW_HEIGHT_PX }}
        >
          {key}
        </li>
      ))}
    </ul>
  );
}

const rowKeys = (count: number) => Array.from({ length: count }, (_, index) => `thread-${index}`);
const newReveal = (): SidebarRouteReveal => ({ observedKey: null, pendingKey: null });

describe("useActiveRowReveal", () => {
  it("scrolls an off-screen row into view when the route opens its thread", async () => {
    const reveal = newReveal();
    const keys = rowKeys(50);
    await using screen = await render(
      <RevealList reveal={reveal} rowKeys={keys} activeKey="thread-0" />,
      // No router: the route arrives as the activeKey prop.
      { router: false },
    );
    const target = screen.getByText("thread-40", { exact: true });
    await expect.element(target).not.toBeInViewport();

    await screen.rerender(<RevealList reveal={reveal} rowKeys={keys} activeKey="thread-40" />);

    await expect.element(target).toBeInViewport();
  });

  it("leaves the list where it is when the user clicked the row that opened the thread", async () => {
    const reveal = newReveal();
    const keys = rowKeys(50);
    await using screen = await render(
      <RevealList reveal={reveal} rowKeys={keys} activeKey="thread-0" />,
      // No router: the route arrives as the activeKey prop.
      { router: false },
    );
    await userEvent.hover(screen.getByText("thread-2", { exact: true }));
    // Even a no-op scroll forces a layout of the thread being opened.
    using scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    await screen.rerender(<RevealList reveal={reveal} rowKeys={keys} activeKey="thread-2" />);

    await vi.waitFor(() => expect(reveal.pendingKey).toBeNull());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("reveals a focused row scrolled out of view when the keyboard opens its thread", async () => {
    const reveal = newReveal();
    const keys = rowKeys(50);
    await using screen = await render(
      <RevealList reveal={reveal} rowKeys={keys} activeKey="thread-0" />,
      // No router: the route arrives as the activeKey prop.
      { router: false },
    );
    const target = screen.getByText("thread-40", { exact: true });
    target.element().focus({ preventScroll: true });
    await expect.element(target).not.toBeInViewport();

    await screen.rerender(<RevealList reveal={reveal} rowKeys={keys} activeKey="thread-40" />);

    await expect.element(target).toBeInViewport();
  });

  it("reveals the active row when it mounts after the shells arrive", async () => {
    const reveal = newReveal();
    // The route already names the thread, but its environment's shells have not
    // listed it yet.
    await using screen = await render(
      <RevealList reveal={reveal} rowKeys={rowKeys(5)} activeKey="thread-40" />,
      // No router: the route arrives as the activeKey prop.
      { router: false },
    );
    await expect.element(screen.getByText("thread-4", { exact: true })).toBeInTheDocument();

    await screen.rerender(
      <RevealList reveal={reveal} rowKeys={rowKeys(50)} activeKey="thread-40" />,
    );

    await expect.element(screen.getByText("thread-40", { exact: true })).toBeInViewport();
  });

  it("reveals a thread reopened after a thread whose row never mounted", async () => {
    const reveal = newReveal();
    const keys = rowKeys(50);
    await using screen = await render(
      <RevealList reveal={reveal} rowKeys={keys} activeKey="thread-40" />,
      // No router: the route arrives as the activeKey prop.
      { router: false },
    );
    const target = screen.getByText("thread-40", { exact: true });
    await expect.element(target).toBeInViewport();
    screen.getByRole("list", { name: "Threads" }).element().scrollTop = 0;
    await expect.element(target).not.toBeInViewport();

    // The route moves to a thread the list does not hold yet, then back.
    await screen.rerender(<RevealList reveal={reveal} rowKeys={keys} activeKey="thread-99" />);
    await screen.rerender(<RevealList reveal={reveal} rowKeys={keys} activeKey="thread-40" />);

    await expect.element(target).toBeInViewport();
  });

  it("reveals the open thread again when the sidebar remounts on the same route", async () => {
    const reveal = newReveal();
    const keys = rowKeys(50);
    {
      await using screen = await render(
        <RevealList reveal={reveal} rowKeys={keys} activeKey="thread-40" />,
        // No router: the route arrives as the activeKey prop.
        { router: false },
      );
      await expect.element(screen.getByText("thread-40", { exact: true })).toBeInViewport();
    }

    // A remount starts the list at the top; the record outlives it with no reveal pending.
    await using screen = await render(
      <RevealList reveal={reveal} rowKeys={keys} activeKey="thread-40" />,
      // No router: the route arrives as the activeKey prop.
      { router: false },
    );
    await expect.element(screen.getByText("thread-40", { exact: true })).toBeInViewport();
  });
});

function ClickRevealList(props: { readonly rowKeys: ReadonlyArray<string> }) {
  return (
    <ul
      aria-label="Clickable threads"
      style={{ height: ROW_HEIGHT_PX * 4, overflowY: "auto", margin: 0 }}
    >
      {props.rowKeys.map((key) => (
        <li
          key={key}
          style={{ height: ROW_HEIGHT_PX }}
          onClick={(event) => revealClickedRow(event)}
        >
          {key}
        </li>
      ))}
    </ul>
  );
}

describe("revealClickedRow", () => {
  it("scrolls a row clicked while cut off at the scroll edge fully into view", async () => {
    await using screen = await render(<ClickRevealList rowKeys={rowKeys(50)} />, {
      router: false,
    });
    const list = screen.getByRole("list", { name: "Clickable threads" }).element();
    // Cut the top 10px of the third row off above the viewport.
    list.scrollTop = ROW_HEIGHT_PX * 2 + 10;
    const target = screen.getByText("thread-2", { exact: true });
    expect(list.scrollTop).toBe(ROW_HEIGHT_PX * 2 + 10);

    // A raw click: userEvent.click would scroll the row into view itself.
    await act(() => {
      target.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(list.scrollTop).toBe(ROW_HEIGHT_PX * 2);
    await expect.element(target).toBeInViewport();
  });

  it("leaves the scroll alone when the clicked row is already fully visible", async () => {
    await using screen = await render(<ClickRevealList rowKeys={rowKeys(50)} />, {
      router: false,
    });
    const list = screen.getByRole("list", { name: "Clickable threads" }).element();
    list.scrollTop = ROW_HEIGHT_PX * 2;
    const target = screen.getByText("thread-3", { exact: true });

    await act(() => {
      target.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(list.scrollTop).toBe(ROW_HEIGHT_PX * 2);
  });
});

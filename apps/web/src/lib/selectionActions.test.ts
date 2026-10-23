import { expect, it, vi } from "vite-plus/test";

import { observeSelectionActions } from "./selectionActions";

function createSurface() {
  const pending = new Map<number, () => void>();
  let nextId = 0;
  const enqueue = (callback: () => void) => {
    pending.set(++nextId, callback);
    return nextId;
  };
  const view = Object.assign(new EventTarget(), {
    setTimeout: enqueue,
    clearTimeout: (id: number) => pending.delete(id),
    requestAnimationFrame: enqueue,
    cancelAnimationFrame: (id: number) => pending.delete(id),
  });
  const document = Object.assign(new EventTarget(), { defaultView: view, activeElement: null });
  const element = Object.assign(new EventTarget(), {
    ownerDocument: document,
    contains: (target: unknown) => target === element,
    closest: () => null,
  });
  const onSelection = vi.fn();
  const actions = observeSelectionActions({
    element: element as unknown as HTMLElement,
    restoreAfterScroll: true,
    onSelection,
    onDismiss: vi.fn(),
  });
  const touchDown = () => {
    const press = Object.assign(new Event("pointerdown"), {
      isPrimary: true,
      button: 0,
      pointerType: "touch",
    });
    Object.defineProperty(press, "target", { value: element });
    document.dispatchEvent(press);
    element.dispatchEvent(press);
  };
  const flush = () => {
    while (pending.size > 0) {
      const [id, callback] = pending.entries().next().value!;
      pending.delete(id);
      callback();
    }
  };
  return { view, actions, onSelection, touchDown, flush };
}

it("shows the actions once a touch long-press selection settles", () => {
  const surface = createSurface();

  surface.touchDown();
  surface.view.dispatchEvent(new Event("pointercancel"));
  surface.actions.selectionChanged();
  surface.actions.selectionChanged();
  expect(surface.onSelection).not.toHaveBeenCalled();

  surface.flush();
  expect(surface.onSelection).toHaveBeenCalledExactlyOnceWith(null);
});

interface FileEditorDismissalOptions {
  root: HTMLElement;
  editor: {
    setSelections: (selections: []) => void;
  };
  isBlocked: () => boolean;
  onDismiss: () => void;
}

function dismissFileEditorInteraction({
  root,
  editor,
  onDismiss,
}: Pick<FileEditorDismissalOptions, "root" | "editor" | "onDismiss">): void {
  onDismiss();
  editor.setSelections([]);

  const file = root.querySelector<HTMLElement>("diffs-container");
  const activeElement = file?.shadowRoot?.activeElement as HTMLElement | null | undefined;
  activeElement?.blur?.();
}

function isFileEditorFocused(root: HTMLElement): boolean {
  const file = root.querySelector<HTMLElement>("diffs-container");
  return file?.shadowRoot?.activeElement?.hasAttribute("data-content") === true;
}

export function installFileEditorDismissal({
  root,
  editor,
  isBlocked,
  onDismiss,
}: FileEditorDismissalOptions): () => void {
  const handlePointerDown = (event: PointerEvent) => {
    if (isBlocked() || event.composedPath().includes(root)) return;
    dismissFileEditorInteraction({ root, editor, onDismiss });
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || isBlocked() || !isFileEditorFocused(root)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dismissFileEditorInteraction({ root, editor, onDismiss });
  };

  // The root's own document: the panel may render in the popout window.
  const ownerDocument = root.ownerDocument;
  ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
  ownerDocument.addEventListener("keydown", handleKeyDown, true);
  return () => {
    ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
    ownerDocument.removeEventListener("keydown", handleKeyDown, true);
  };
}

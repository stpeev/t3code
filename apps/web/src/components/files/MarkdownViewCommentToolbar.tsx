import { MessageCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { findTextLineRange, formatTextLineRange } from "~/lib/fileTextSelection";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";

import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { Button } from "../ui/button";

/**
 * Floating "Comment" action over text selected in a rendered file preview. Submitting
 * maps the selection back to source lines and hands a file review comment to the chat.
 */
export function MarkdownViewCommentToolbar(props: {
  readonly viewport: HTMLElement;
  readonly contents: string;
  readonly onComment: (input: { startLine: number; endLine: number; text: string }) => void;
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [capture, setCapture] = useState<{ text: string; position: SelectionActionPoint } | null>(
    null,
  );
  const [draftOpen, setDraftOpen] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the viewport document's selectionchange to track text selections; the panel can live in a popout window with its own document
  useEffect(() => {
    // The right panel may be portaled into a popout window, so scope all selection
    // access to the viewport's own document/window, not the main one.
    const doc = props.viewport.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    const update = (pointer: SelectionActionPoint | null) => {
      const selection = view.getSelection();
      const text = selection?.toString() ?? "";
      if (!selection || selection.rangeCount === 0 || text.trim().length === 0) {
        setCapture(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!props.viewport.contains(range.commonAncestorContainer)) {
        setCapture(null);
        return;
      }
      const rects = range.getClientRects();
      setCapture({
        text,
        position: resolveSelectionActionPosition({
          bounds: props.viewport.getBoundingClientRect(),
          selectionRect: rects.item(rects.length - 1) ?? null,
          pointer,
          viewport: { width: view.innerWidth, height: view.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: props.viewport,
      getActionElement: () => toolbarRef.current,
      onSelection: update,
      onDismiss: () => {
        setCapture(null);
        setDraftOpen(false);
      },
    });
    doc.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      doc.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
    };
  }, [props.viewport]);

  if (!capture) return null;
  const clearSelection = () =>
    props.viewport.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
  const range = findTextLineRange(props.contents, capture.text);
  const rangeLabel = range ? formatTextLineRange(range) : "selection";

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50"
      style={{ left: capture.position.x, top: capture.position.y }}
    >
      {draftOpen ? (
        <div className="w-72 rounded-lg border border-border bg-background p-2 shadow-lg">
          <DiffCommentAnnotation
            kind="draft"
            rangeLabel={rangeLabel}
            text=""
            placeholder={`Comment on ${rangeLabel} and send it to the chat…`}
            submitLabel="Send to chat"
            onCancel={() => {
              setDraftOpen(false);
              setCapture(null);
              clearSelection();
            }}
            onComment={(text) => {
              if (!text.trim() || !range) return;
              props.onComment({ ...range, text });
              setDraftOpen(false);
              setCapture(null);
              clearSelection();
            }}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => setDraftOpen(true)}
          disabled={range === null}
        >
          <MessageCircleIcon className="size-3" />
          Comment
        </Button>
      )}
    </div>
  );
}

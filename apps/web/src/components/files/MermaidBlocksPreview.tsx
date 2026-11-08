import type { MermaidCodeBlock } from "@t3tools/shared/mermaidBlocks";

import type { DiagramSection } from "../chat/MermaidDiagram";
import { ScrollArea } from "../ui/scroll-area";
import { MermaidFilePreview } from "./MermaidFilePreview";

function blockRangeLabel(block: MermaidCodeBlock): string {
  return block.startLine === block.endLine
    ? `L${block.startLine}`
    : `L${block.startLine} to L${block.endLine}`;
}

/**
 * Renders every mermaid block found in a source file (e.g. fenced blocks inside
 * JS/TS doc comments) as an interactive diagram.
 */
export function MermaidBlocksPreview(props: {
  readonly filePath: string;
  readonly blocks: ReadonlyArray<MermaidCodeBlock>;
  readonly onCommentSection?:
    | ((block: MermaidCodeBlock, section: DiagramSection | null, text: string) => void)
    | undefined;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
        {props.blocks.map((block, index) => (
          <section
            key={`${block.startLine}:${block.endLine}`}
            className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border"
          >
            <header className="shrink-0 border-b border-border bg-muted/40 px-3 py-1.5 text-2xs text-muted-foreground">
              Diagram {index + 1} of {props.blocks.length} · {blockRangeLabel(block)} in{" "}
              <span className="break-all font-mono">{props.filePath}</span>
            </header>
            <MermaidFilePreview
              text={block.source}
              onCommentSection={
                props.onCommentSection
                  ? (section, text) => props.onCommentSection?.(block, section, text)
                  : undefined
              }
            />
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}

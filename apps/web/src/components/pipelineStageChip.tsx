import type { PipelineStageLabels } from "@t3tools/client-runtime/pipelines";
import { WorkflowIcon } from "lucide-react";
import type { CSSProperties } from "react";

/** Stable hue per pipeline id, so one pipeline's rows share a color. */
function pipelineHue(pipelineId: string): number {
  let hash = 0;
  for (let index = 0; index < pipelineId.length; index++) {
    hash = (hash * 31 + pipelineId.charCodeAt(index)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

// Canvas normalizes any valid CSS color (names, hsl(), color(…)) to rgb, so no
// color tables live in our code. Invalid assignments leave the sentinel, so
// unresolvable values are detected instead of silently painted.
let canvasContext: CanvasRenderingContext2D | null | undefined;
function resolveCssColor(value: string): [number, number, number] | null {
  if (canvasContext === undefined) {
    canvasContext = document.createElement("canvas").getContext("2d");
  }
  const ctx = canvasContext;
  if (ctx === null) return null;
  ctx.fillStyle = "#000001";
  ctx.fillStyle = value;
  const resolved = ctx.fillStyle;
  if (resolved === "#000001") return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(resolved);
  if (hex !== null) {
    const digits = hex[1]!;
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(resolved);
  if (rgb === null) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** Dark text on light stage colors, white on dark ones. */
function foregroundFor([r, g, b]: [number, number, number]): string {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#18181b" : "#ffffff";
}

// The dots wrap to a second line inside the chip once they exceed this width,
// so wide pipelines show every stage instead of a "+n" (stages cap at 20).
const DOTS_WRAP_WIDTH = "max-w-24";

/**
 * A thread's pipeline stage as a sidebar chip: pipeline hue, stage name, and
 * one dot per stage (filled up to the current one). The solid background keeps
 * it readable on the selected row, where a border-only chip disappears.
 */
export function PipelineStageChip(props: {
  readonly labels: PipelineStageLabels;
  /** Red tint when the thread's latest run failed in this stage. */
  readonly tone?: "default" | "error";
  readonly testId?: string;
}) {
  const { labels, tone = "default", testId } = props;
  const failed = tone === "error";
  const hue = pipelineHue(labels.pipelineId);
  // A stage's own CSS color becomes the chip background, passed through as-is;
  // otherwise the pipeline hue only tints border and text over the sidebar
  // background. An unresolvable color falls back to that hue styling.
  const stageColor = failed ? null : labels.color;
  const resolved = stageColor === null ? null : resolveCssColor(stageColor);
  const style: CSSProperties = failed
    ? {
        borderColor: "color-mix(in oklab, var(--color-error-foreground) 45%, transparent)",
        color: "var(--color-error-foreground)",
      }
    : stageColor !== null && resolved !== null
      ? {
          backgroundColor: stageColor,
          borderColor: `color-mix(in oklab, ${stageColor} 72%, black)`,
          color: foregroundFor(resolved),
        }
      : {
          borderColor: `hsl(${hue} 60% 55% / 0.55)`,
          color: `hsl(${hue} 65% 40%)`,
        };
  const count = labels.stageCount;
  return (
    <span
      aria-hidden
      data-testid={testId}
      className="inline-flex max-w-48 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 rounded-sm border bg-sidebar px-1 font-medium text-2xs"
      style={style}
    >
      <WorkflowIcon className="size-3 shrink-0 opacity-70" />
      <span className="truncate">{labels.stageName}</span>
      {count > 0 ? (
        <span className="shrink-0 tabular-nums opacity-70">
          {labels.position}/{count}
        </span>
      ) : null}
      {count > 0 ? (
        <span className={`flex ${DOTS_WRAP_WIDTH} flex-wrap items-center gap-0.5`}>
          {Array.from({ length: count }, (_, index) => (
            <span
              key={index}
              className={`size-[5px] shrink-0 rounded-full ${
                index < labels.position ? "bg-current" : "border border-current opacity-40"
              }`}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

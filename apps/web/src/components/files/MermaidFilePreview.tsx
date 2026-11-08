import { lazy, Suspense } from "react";

import type { DiagramSection } from "../chat/MermaidDiagram";
import { FileSurfaceLoading } from "./fileSurfaceChrome";

const MermaidViewer = lazy(() => import("./MermaidViewer"));

export function MermaidFilePreview(props: {
  readonly text: string;
  readonly onCommentSection?: ((section: DiagramSection, text: string) => void) | undefined;
}) {
  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      <MermaidViewer key={props.text} {...props} />
    </Suspense>
  );
}

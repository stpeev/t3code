import DOMPurify from "dompurify";
import type { DiagramType, MathResolver } from "pele/lazy";
import { use, useEffect, useRef, useState } from "react";

import { serializeCodeBlockToMarkdown } from "../../markdown-clipboard";
import { Button } from "../ui/button";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";

/** A markable section of a rendered diagram: a node, edge or subgraph. */
export interface DiagramSection {
  readonly kind: "node" | "edge" | "cluster";
  readonly id: string;
  readonly label: string;
}

export function diagramSectionKey(section: DiagramSection): string {
  return `${section.kind}:${section.id}`;
}

/** Human-readable name for a marked diagram section, used in comment labels. */
export function diagramSectionLabel(section: DiagramSection | null): string {
  if (!section) return "diagram";
  const name = section.label && section.label !== section.id ? ` "${section.label}"` : "";
  if (section.kind === "node") return `node${name || ` "${section.id}"`}`;
  if (section.kind === "cluster") return `section${name || ` "${section.id}"`}`;
  return `edge${name || ` "${section.id}"`}`;
}

const MARKABLE_SELECTOR = "g.pele-node, g.pele-edge, g.pele-cluster";
const MARKABLE_CLASS = "t3-mermaid-markable";
const MARKED_CLASS = "t3-mermaid-marked";

// Injected once per document head; the diagram SVG itself is sanitized without
// <style>, so the highlight rules must live outside it. The panel can be portaled
// into a popout window, so key the style on the container's own document.
const markStylesInstalled = new WeakSet<Document>();

function ensureDiagramMarkStyles(doc: Document): void {
  if (markStylesInstalled.has(doc)) return;
  markStylesInstalled.add(doc);
  const style = doc.createElement("style");
  style.setAttribute("data-t3-mermaid-mark", "");
  style.textContent = [
    `.${MARKABLE_CLASS} { cursor: pointer; }`,
    `.${MARKABLE_CLASS}:hover { filter: drop-shadow(0 0 2px var(--ring)); }`,
    `.${MARKED_CLASS}, .${MARKED_CLASS}:hover { filter: drop-shadow(0 0 4px var(--ring)); }`,
  ].join("\n");
  doc.head.append(style);
}

function decorateSections(container: HTMLElement): void {
  for (const element of container.querySelectorAll(MARKABLE_SELECTOR)) {
    element.classList.add(MARKABLE_CLASS);
  }
}

function sectionFromElement(element: Element): DiagramSection | null {
  const kind = element.classList.contains("pele-node")
    ? ("node" as const)
    : element.classList.contains("pele-edge")
      ? ("edge" as const)
      : element.classList.contains("pele-cluster")
        ? ("cluster" as const)
        : null;
  if (!kind) return null;
  const id = element.getAttribute("data-id") ?? "";
  const label = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  return { kind, id, label: label || id };
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function applyMarked(container: HTMLElement, selectedSection: string | null): void {
  for (const element of container.querySelectorAll(`.${MARKED_CLASS}`)) {
    element.classList.remove(MARKED_CLASS);
  }
  if (!selectedSection) return;
  const separator = selectedSection.indexOf(":");
  const kind = selectedSection.slice(0, separator);
  const id = selectedSection.slice(separator + 1);
  container
    .querySelector(`g.pele-${kind}[data-id="${escapeAttributeValue(id)}"]`)
    ?.classList.add(MARKED_CLASS);
}

type Pele = typeof import("pele/lazy");
type PeleLoad = { readonly status: "loaded"; readonly pele: Pele } | { readonly status: "failed" };

let coreLoad: Promise<PeleLoad> | null = null;
// Each diagram type is its own chunk, so a chat with one flowchart loads only
// the flowchart parser and layout.
const diagramLoads = new Map<DiagramType, Promise<PeleLoad>>();

function loadCore(): Promise<PeleLoad> {
  coreLoad ??= import("pele/lazy").then(
    (pele): PeleLoad => ({ status: "loaded", pele }),
    (): PeleLoad => ({ status: "failed" }),
  );
  return coreLoad;
}

function loadDiagramType(pele: Pele, type: DiagramType): Promise<PeleLoad> {
  let load = diagramLoads.get(type);
  if (!load) {
    load = pele.load(type).then(
      (): PeleLoad => ({ status: "loaded", pele }),
      (): PeleLoad => ({ status: "failed" }),
    );
    diagramLoads.set(type, load);
  }
  return load;
}

function detectDiagramType(pele: Pele, source: string): DiagramType | null {
  try {
    return pele.detectType(source);
  } catch {
    return null;
  }
}

let mathLoad: Promise<MathResolver | null> | null = null;

// Pele has no typesetter, so $$...$$ labels go through the KaTeX the chat
// already uses for math. It only loads for diagrams that contain math.
function loadMath(): Promise<MathResolver | null> {
  mathLoad ??= import("katex").then(
    ({ default: katex }) => {
      const typeset = new Map<string, ReturnType<MathResolver>>();
      let probe: HTMLDivElement | null = null;
      // Pele calls this on every layout, including resizes.
      return (tex, size) => {
        const key = `${size}:${tex}`;
        if (typeset.has(key)) return typeset.get(key);
        let markup: ReturnType<MathResolver> = null;
        try {
          if (!probe) {
            probe = document.createElement("div");
            probe.style.cssText =
              "position:absolute;left:-9999px;visibility:hidden;display:inline-block;white-space:nowrap";
            document.body.append(probe);
          }
          probe.style.fontSize = `${size}px`;
          probe.innerHTML = katex.renderToString(tex, {
            displayMode: true,
            output: "mathml",
            throwOnError: true,
            // No \href, \url, \htmlClass, or other commands that emit active HTML.
            trust: false,
            strict: "ignore",
            maxSize: 20,
            maxExpand: 1000,
          });
          const expression = probe.querySelector("math");
          // The annotation repeats the TeX source; the sanitizer would keep its text.
          expression?.querySelector("annotation")?.remove();
          if (expression) {
            const { width, height } = expression.getBoundingClientRect();
            markup = { html: expression.outerHTML, width, height };
          }
        } catch {
          // Unsupported TeX stays readable as its source.
        }
        typeset.set(key, markup);
        return markup;
      };
    },
    () => null,
  );
  return mathLoad;
}

// MathML element types KaTeX emits, without annotation (the resolver removes it),
// semantics (only a wrapper, so its content is kept), and mglyph (an image).
const KATEX_MATHML_TAGS = new Set([
  "math",
  "menclose",
  "mfrac",
  "mi",
  "mlabeledtr",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
]);
// Presentation attributes KaTeX sets on those elements. The profiles already
// cover class, style, width, height, display, and xmlns.
const KATEX_MATHML_ATTRIBUTES = new Set([
  "accent",
  "accentunder",
  "columnalign",
  "columnlines",
  "columnspacing",
  "depth",
  "displaystyle",
  "fence",
  "largeop",
  "linebreak",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "notation",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "voffset",
]);

let purifier: ReturnType<typeof DOMPurify> | null = null;

// Diagrams can come from untrusted PR descriptions. Pele escapes labels and
// links and images are off, so this is defense in depth against anything that
// could navigate, run script, or fetch remote content.
function sanitizeDiagramSvg(svg: string): Node {
  purifier ??= DOMPurify(window);
  return purifier.sanitize(svg, {
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "image", "foreignObject", "style"],
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
  });
}

// Pele puts MathML labels in a <foreignObject> with an HTML <div> around them.
function sanitizeMathDiagramSvg(svg: string): Node {
  purifier ??= DOMPurify(window);
  return purifier.sanitize(svg, {
    // DOMPurify still only accepts <math> under an HTML parent and checks every
    // MathML child's namespace.
    ADD_TAGS: ["foreignObject", ...KATEX_MATHML_TAGS],
    ADD_ATTR: (attribute, tagName) =>
      KATEX_MATHML_TAGS.has(tagName) && KATEX_MATHML_ATTRIBUTES.has(attribute),
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "img", "image", "script", "style"],
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    RETURN_DOM_FRAGMENT: true,
  });
}

// Pele colors diagrams through these, which a standalone image cannot inherit.
const PELE_COLOR_VARIABLES = [
  "--pele-bg",
  "--pele-fg",
  "--pele-muted",
  "--pele-line",
  "--pele-surface",
  "--pele-surface-alt",
  "--pele-border",
  "--pele-accent",
  "--pele-critical",
  ...Array.from({ length: 8 }, (_, index) => `--pele-series-${index + 1}`),
];

let expandedImageUrl: string | null = null;

/**
 * A blob URL, unlike a data URL, passes the desktop connect-src policy that media
 * save and copy actions fetch through.
 */
function diagramImageUrl(svg: SVGSVGElement): string {
  const element = svg.cloneNode(true) as SVGSVGElement;
  const computed = getComputedStyle(svg);
  for (const name of PELE_COLOR_VARIABLES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) element.style.setProperty(name, value);
  }
  element.style.maxWidth = "none";
  element.style.backgroundColor = getComputedStyle(document.body).backgroundColor;
  if (expandedImageUrl) URL.revokeObjectURL(expandedImageUrl);
  expandedImageUrl = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" }),
  );
  return expandedImageUrl;
}

export function MermaidDiagram({
  source,
  onExpand,
  markable = false,
  onSelectSection,
  onCommentSection,
}: {
  source: string;
  onExpand: (imageUrl: string) => void;
  /** Lets the user mark diagram sections (nodes, edges, subgraphs) for commenting. */
  markable?: boolean;
  onSelectSection?: (section: DiagramSection | null) => void;
  /** Enables marking plus a comment bar whose submission is sent via this callback. */
  onCommentSection?: ((section: DiagramSection, text: string) => void) | undefined;
}) {
  const [, setAttempt] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DiagramSection | null>(null);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const markingEnabled = markable || onCommentSection !== undefined;
  const selectedKey = selected === null ? null : diagramSectionKey(selected);
  // Read by the imperative mount's onRender; updated in the effect below so a
  // selection change does not remount the diagram.
  const selectedKeyRef = useRef<string | null>(selectedKey);
  const trimmedSource = source.trim();
  const core = use(loadCore());
  const type = core.status === "loaded" ? detectDiagramType(core.pele, trimmedSource) : null;
  const load = core.status === "loaded" && type ? use(loadDiagramType(core.pele, type)) : core;
  const math = trimmedSource.includes("$$") ? use(loadMath()) : null;

  // Re-created, and so remounted, whenever the renderer, math support or source changes.
  const mountDiagram = (container: HTMLSpanElement) => {
    containerRef.current = container;
    if (load.status !== "loaded") return;
    const mounted = load.pele.mount(container, trimmedSource, {
      links: false,
      images: false,
      zoom: false,
      // Keep the author's direction; a wide diagram scales down to fit instead of turning vertical.
      autoDirection: false,
      ...(math ? { math, sanitize: sanitizeMathDiagramSvg } : { sanitize: sanitizeDiagramSvg }),
      onRender: () => {
        setRenderError(null);
        if (markingEnabled) {
          decorateSections(container);
          applyMarked(container, selectedKeyRef.current);
        }
      },
      onError: (error) =>
        setRenderError(
          error instanceof Error ? error.message : "The diagram could not be rendered.",
        ),
    });
    return () => {
      containerRef.current = null;
      mounted.destroy();
    };
  };

  // Re-apply the marked highlight on selection change; onRender re-applies both
  // after every (re)mount because pele renders asynchronously.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the imperative pele mount in step with the selected section: updates the ref its onRender reads and toggles the marked class on the rendered SVG
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
    const container = containerRef.current;
    if (!container || !markingEnabled) return;
    ensureDiagramMarkStyles(container.ownerDocument);
    decorateSections(container);
    applyMarked(container, selectedKey);
  }, [markingEnabled, selectedKey]);

  if (load.status === "failed") {
    return (
      <DiagramError
        message="The diagram renderer failed to load."
        source={source}
        onRetry={() => {
          if (core.status === "failed") coreLoad = null;
          if (type) diagramLoads.delete(type);
          setAttempt((attempt) => attempt + 1);
        }}
      />
    );
  }

  const selectedLabel = diagramSectionLabel(selected);
  return (
    <div
      className="chat-markdown-mermaid overflow-x-auto"
      data-markdown-mermaid=""
      data-markdown-copy={serializeCodeBlockToMarkdown(source, "mermaid")}
    >
      {onCommentSection && selected ? (
        <div className="mb-2 border-b border-border pb-2">
          <DiffCommentAnnotation
            kind="draft"
            rangeLabel={selectedLabel}
            text=""
            placeholder={`Comment on ${selectedLabel} and send it to the chat…`}
            submitLabel="Send to chat"
            onCancel={() => setSelected(null)}
            onComment={(text) => {
              if (!text.trim()) return;
              onCommentSection(selected, text);
              setSelected(null);
            }}
          />
        </div>
      ) : null}
      {renderError ? <DiagramError message={renderError} source={source} /> : null}
      <button
        type="button"
        aria-label={
          markingEnabled
            ? "Diagram; click a node, edge or subgraph to comment on it"
            : "Expand diagram"
        }
        hidden={renderError !== null}
        className="block w-full cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        onClick={(event) => {
          if (markingEnabled) {
            const marked = (event.target as Element).closest?.(MARKABLE_SELECTOR);
            if (marked) {
              const section = sectionFromElement(marked);
              if (section) {
                const next = selectedKey === diagramSectionKey(section) ? null : section;
                setSelected(next);
                onSelectSection?.(next);
                return;
              }
            }
          }
          const svg = event.currentTarget.querySelector("svg");
          if (svg) onExpand(diagramImageUrl(svg));
        }}
      >
        <span ref={mountDiagram} className="flex w-full justify-center" />
      </button>
    </div>
  );
}

function DiagramError({
  message,
  source,
  onRetry,
}: {
  message: string;
  source: string;
  onRetry?: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-xs text-destructive">Unable to render diagram: {message}</p>
        {onRetry ? (
          <Button type="button" variant="ghost" size="xs" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
      <pre
        data-thread-find-ignore
        className="mt-2 mb-0 overflow-auto font-mono text-xs whitespace-pre-wrap"
      >
        {source}
      </pre>
    </div>
  );
}

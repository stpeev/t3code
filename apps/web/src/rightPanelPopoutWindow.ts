import { isEditableFocused } from "./lib/editableFocus";
import type { RightPanelPopoutBounds } from "./rightPanelPopoutStore";

/** Window name the desktop shell matches to allow this one popup. */
export const RIGHT_PANEL_POPOUT_WINDOW_NAME = "t3code-right-panel";

const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 900;

export interface RightPanelPopout {
  readonly window: Window;
  /** Portal target inside the popout's body. */
  readonly root: HTMLElement;
}

interface PopoutCallbacks {
  /** The user closed the popout; not called when the main window unloads. */
  onClosed: () => void;
  onBoundsChange: (bounds: RightPanelPopoutBounds) => void;
}

let current: (RightPanelPopout & { dispose: () => void }) | null = null;
let mainWindowUnloading = false;
let popoutTitle = "";
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeRightPanelPopout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRightPanelPopout(): RightPanelPopout | null {
  return current;
}

export function focusRightPanelPopout(): void {
  current?.window.focus();
}

export function closeRightPanelPopout(): void {
  current?.window.close();
}

/** Also kept for the next window opened. */
export function setRightPanelPopoutTitle(title: string): void {
  popoutTitle = title;
  if (current) current.window.document.title = title;
}

function popoutFeatures(bounds: RightPanelPopoutBounds | null): string {
  const size = bounds ?? {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    left: window.screenX + Math.max(0, window.outerWidth - DEFAULT_WIDTH),
    top: window.screenY,
  };
  return `popup,left=${size.left},top=${size.top},width=${size.width},height=${size.height}`;
}

/** Returns the open popout, opening it if needed; `null` when the browser blocked it. */
export function openRightPanelPopout(
  bounds: RightPanelPopoutBounds | null,
  callbacks: PopoutCallbacks,
): RightPanelPopout | null {
  if (current && !current.window.closed) return current;
  // An empty URL keeps the initial about:blank document; navigating to "about:blank" can replace it.
  const popup = window.open("", RIGHT_PANEL_POPOUT_WINDOW_NAME, popoutFeatures(bounds));
  if (!popup) return null;

  const doc = popup.document;
  doc.head.replaceChildren();
  doc.body.replaceChildren();
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  doc.head.append(charset);
  doc.title = popoutTitle || document.title;

  const root = doc.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden";
  doc.body.append(root);

  const disposers = [
    mirrorAttributes(document.documentElement, doc.documentElement),
    mirrorAttributes(document.body, doc.body),
    mirrorStylesheets(doc),
    forwardKeyboardEvents(popup),
    mirrorShadowStyles(popup as Window & typeof globalThis, root),
    shareDomClasses(popup as Window & typeof globalThis),
  ];

  const readBounds = (): RightPanelPopoutBounds => ({
    left: popup.screenX,
    top: popup.screenY,
    width: popup.outerWidth,
    height: popup.outerHeight,
  });
  let resizeFrame = 0;
  const onResize = () => {
    if (resizeFrame !== 0) return;
    resizeFrame = popup.requestAnimationFrame(() => {
      resizeFrame = 0;
      callbacks.onBoundsChange(readBounds());
    });
  };
  popup.addEventListener("resize", onResize);

  const onPopupPageHide = () => {
    callbacks.onBoundsChange(readBounds());
    dispose();
    if (!mainWindowUnloading) callbacks.onClosed();
  };
  popup.addEventListener("pagehide", onPopupPageHide);

  // A reload or quit of the main window must not leave an orphaned blank popup behind.
  const onMainPageHide = () => {
    mainWindowUnloading = true;
    popup.close();
  };
  window.addEventListener("pagehide", onMainPageHide);

  const dispose = () => {
    if (current?.window !== popup) return;
    for (const disposer of disposers) disposer();
    popup.removeEventListener("resize", onResize);
    popup.removeEventListener("pagehide", onPopupPageHide);
    window.removeEventListener("pagehide", onMainPageHide);
    current = null;
    notify();
  };

  current = { window: popup, root, dispose };
  notify();
  return current;
}

function mirrorAttributes(source: Element, target: Element): () => void {
  const sync = () => {
    for (const { name } of Array.from(target.attributes)) {
      if (!source.hasAttribute(name)) target.removeAttribute(name);
    }
    for (const { name, value } of Array.from(source.attributes)) {
      if (target.getAttribute(name) !== value) target.setAttribute(name, value);
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { attributes: true });
  return () => observer.disconnect();
}

function isStylesheetNode(node: Node): node is HTMLStyleElement | HTMLLinkElement {
  return (
    node instanceof HTMLStyleElement ||
    (node instanceof HTMLLinkElement && node.rel === "stylesheet")
  );
}

// Lazy chunks and dev HMR add and rewrite <style>/<link> tags in the main head after the popout opens.
function mirrorStylesheets(doc: Document): () => void {
  const clones = new Map<Node, Node>();
  const add = (node: Node) => {
    if (!isStylesheetNode(node) || clones.has(node)) return;
    const clone = doc.importNode(node, true);
    clones.set(node, clone);
    doc.head.append(clone);
  };
  const remove = (node: Node) => {
    const clone = clones.get(node);
    if (!clone) return;
    clone.parentNode?.removeChild(clone);
    clones.delete(node);
  };
  for (const node of Array.from(document.head.childNodes)) add(node);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target === document.head && record.type === "childList") {
        for (const node of Array.from(record.removedNodes)) remove(node);
        for (const node of Array.from(record.addedNodes)) add(node);
        continue;
      }
      const style =
        record.target instanceof HTMLStyleElement ? record.target : record.target.parentElement;
      const clone = style ? clones.get(style) : undefined;
      if (style && clone) clone.textContent = style.textContent;
    }
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    for (const clone of clones.values()) clone.parentNode?.removeChild(clone);
    clones.clear();
  };
}

// Custom elements the panel renders whose styles live in an adopted sheet, not in the head.
const SHADOW_STYLED_ELEMENTS = ["diffs-container"];

// Constructed sheets only apply in the document that built them, and moving a shadow root to the popout drops
// them; elements arrive both ways (React in the popout, @pierre/diffs CodeView via the main `document`).
function mirrorShadowStyles(popup: Window & typeof globalThis, root: HTMLElement): () => void {
  const sheetsByTag = new Map<string, CSSStyleSheet[]>();
  const apply = (element: Element) => {
    const sheets = sheetsByTag.get(element.localName);
    if (!sheets) return;
    const shadowRoot = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    if (shadowRoot.adoptedStyleSheets[0] !== sheets[0]) shadowRoot.adoptedStyleSheets = sheets;
  };
  const applyWithin = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    apply(element);
    for (const tag of sheetsByTag.keys()) {
      for (const match of Array.from(element.getElementsByTagName(tag))) apply(match);
    }
  };

  for (const tag of SHADOW_STYLED_ELEMENTS) {
    void customElements.whenDefined(tag).then(() => {
      if (popup.closed) return;
      const sources = document.createElement(tag).shadowRoot?.adoptedStyleSheets ?? [];
      sheetsByTag.set(
        tag,
        sources.map((source) => {
          const sheet = new popup.CSSStyleSheet();
          sheet.replaceSync(Array.from(source.cssRules, (rule) => rule.cssText).join("\n"));
          return sheet;
        }),
      );
      applyWithin(root);
    });
  }

  const observer = new popup.MutationObserver((records) => {
    if (sheetsByTag.size === 0) return;
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) applyWithin(node);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// Libraries test nodes with `instanceof HTMLElement`, which fails for popout nodes built from the popout's own classes.
// Defined on Node, so every DOM subclass inherits it and checks against its same-named popout class.
function shareDomClasses(popup: Window & typeof globalThis): () => void {
  const defaultHasInstance = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Node, Symbol.hasInstance, {
    configurable: true,
    value(this: Function, value: unknown): boolean {
      if (defaultHasInstance.call(this, value)) return true;
      if (popup.closed || typeof value !== "object" || value === null) return false;
      if (Reflect.get(window, this.name) !== this) return false;
      const popupClass: unknown = Reflect.get(popup, this.name);
      return typeof popupClass === "function" && defaultHasInstance.call(popupClass, value);
    },
  });
  return () => {
    Reflect.deleteProperty(Node, Symbol.hasInstance);
  };
}

// App shortcuts listen on the main window; replay unhandled popout keys there so they work in both.
function forwardKeyboardEvents(popup: Window): () => void {
  const forward = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const chorded = event.metaKey || event.ctrlKey || event.altKey;
    if (!chorded && isEditableFocused(event.target)) return;
    const replay = new KeyboardEvent(event.type, event);
    // Handlers inspect `target` to skip editable fields; keep the popout's element.
    Object.defineProperty(replay, "target", { value: event.target });
    window.dispatchEvent(replay);
    if (replay.defaultPrevented) event.preventDefault();
  };
  popup.addEventListener("keydown", forward);
  popup.addEventListener("keyup", forward);
  return () => {
    popup.removeEventListener("keydown", forward);
    popup.removeEventListener("keyup", forward);
  };
}

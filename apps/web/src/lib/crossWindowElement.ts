// `target` as an Element from any window: popout nodes belong to that window's realm, where `instanceof Element` fails.
export function asElement(target: EventTarget | null | undefined): Element | null {
  return target != null && (target as Partial<Node>).nodeType === 1 ? (target as Element) : null;
}

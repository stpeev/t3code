import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";

import { randomUUID } from "../lib/utils";

/** `service.instance.id` for this page load, shared by every resource the UI exports. */
export const serviceInstanceId = randomUUID();

let delegate: Tracer.Tracer | null = null;

export function setDelegate(next: Tracer.Tracer | null): void {
  delegate = next;
}

export function hasDelegate(): boolean {
  return delegate !== null;
}

// Install before exporters exist so spans reach whichever exporter is configured later.
export const layer = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({
    span(options) {
      return delegate?.span(options) ?? new Tracer.NativeSpan(options);
    },
  }),
);

/** Records a decision made outside Effect (React effects, DOM callbacks) as a zero-length root span. */
export function recordEvent(name: string, attributes: Record<string, unknown>): void {
  Effect.runFork(
    Effect.void.pipe(Effect.withSpan(name, { root: true, attributes }), Effect.provide(layer)),
  );
}

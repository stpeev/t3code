import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import type * as Persistence from "../platform/persistence.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

type PipelinesAtomRuntime<R, E> = Atom.AtomRuntime<
  EnvironmentRegistry.EnvironmentRegistry | Persistence.EnvironmentCacheStore | R,
  E
>;

// The pipeline atoms, kept here so state/server.ts spreads them in with one seam
// line instead of carrying the entries inside its big factory return.
export function createPipelinesAtoms<R, E>(
  runtime: PipelinesAtomRuntime<R, E>,
  deps: {
    readonly configScheduler: ReturnType<typeof createAtomCommandScheduler>;
    readonly configConcurrency: {
      readonly mode: "serial";
      readonly key: (target: { readonly environmentId: string }) => string;
    };
  },
) {
  const { configScheduler, configConcurrency } = deps;
  return {
    pipelinesLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:server:pipelines:live",
      tag: WS_METHODS.pipelinesSubscribe,
    }),
    // An editor starts from the file as it is now, so nothing is kept between visits.
    pipelinesConfigText: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:pipelines:config-text",
      tag: WS_METHODS.pipelinesGetConfigText,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    // Off the config lane: a start waits until the stage's message is sent. A double click
    // joins the start in flight instead of being refused as stale.
    startPipelineStage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:pipelines:start-stage",
      tag: WS_METHODS.pipelinesStartStage,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => `${environmentId}:${input.threadId}`,
      },
    }),
    recordPipelineStage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:pipelines:record-stage",
      tag: WS_METHODS.pipelinesRecordStage,
    }),
    leavePipeline: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:pipelines:leave",
      tag: WS_METHODS.pipelinesLeave,
    }),
    // A command, not the cached query, so copying and pushing to other machines read them live.
    readPipelinesConfigText: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:pipelines:read-config-text",
      tag: WS_METHODS.pipelinesGetConfigText,
    }),
    savePipelinesConfigText: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:pipelines:save-config-text",
      tag: WS_METHODS.pipelinesSaveConfigText,
      scheduler: configScheduler,
      concurrency: configConcurrency,
    }),
    ensurePipelinesConfigFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:server:pipelines:ensure-config-file",
      tag: WS_METHODS.pipelinesEnsureConfigFile,
      scheduler: configScheduler,
      concurrency: configConcurrency,
    }),
  };
}

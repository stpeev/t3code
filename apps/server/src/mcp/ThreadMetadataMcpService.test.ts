import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  EnvironmentId,
  type OrchestrationV2Command,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestratorDispatchError } from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import * as ThreadMetadataMcpService from "./ThreadMetadataMcpService.ts";

const callerThreadId = ThreadId.make("thread-metadata-caller");
const otherThreadId = ThreadId.make("thread-metadata-other");
const targetProjectId = ProjectId.make("project-metadata-target");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-metadata-test"),
  requestNamespace: "provider-session-metadata-test",
  thread: {
    threadId: callerThreadId,
    providerSessionId: "provider-session-metadata-test",
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const makeHarness = (options: { readonly dispatchRefusal?: string } = {}) => {
  const dispatch = vi.fn((command: OrchestrationV2Command) =>
    options.dispatchRefusal === undefined
      ? Effect.succeed({ sequence: 1, storedEvents: [] })
      : (Effect.fail(
          new OrchestratorDispatchError({
            commandId: command.commandId,
            commandType: "thread.metadata.update",
            cause: options.dispatchRefusal,
          }),
        ) as never),
  );
  const getThreadShell = vi.fn((id: ThreadId) =>
    Effect.succeed({
      id,
      projectId: targetProjectId,
      title: "Moved thread",
      titleRegeneration: null,
      linkedPullRequest: null,
      updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
      deletedAt: null,
    }),
  );
  const layer = ThreadMetadataMcpService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          dispatch,
          getThreadShell,
        } as unknown as Partial<ThreadManagementService.ThreadManagementService["Service"]>),
        NodeCrypto.layer,
      ),
    ),
  );
  const move = (threadId?: ThreadId) =>
    ThreadMetadataMcpService.ThreadMetadataMcpService.pipe(
      Effect.flatMap((service) =>
        service.update(scope, {
          action: "move",
          projectId: targetProjectId,
          ...(threadId === undefined ? {} : { threadId }),
        }),
      ),
      Effect.provide(layer),
    );
  return { dispatch, move };
};

describe("ThreadMetadataMcpService move", () => {
  it.effect("ends the caller's own turn but leaves another thread's turn guarded", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      yield* harness.move();
      yield* harness.move(otherThreadId);
      const [own, other] = harness.dispatch.mock.calls.map(([command]) => command);
      assert.include(own, { threadId: callerThreadId, interruptActiveTurn: true });
      assert.notProperty(other, "interruptActiveTurn");
    }),
  );

  it.effect("reports the orchestrator's refusal reason instead of the generic dispatch error", () =>
    Effect.gen(function* () {
      const reason = `Thread ${otherThreadId} has a turn in progress. Stop it before moving the thread.`;
      const error = yield* makeHarness({ dispatchRefusal: reason })
        .move(otherThreadId)
        .pipe(Effect.flip);
      assert.include(error.message, reason);
    }),
  );
});

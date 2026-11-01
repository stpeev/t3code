import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";

// Pipeline RPC scopes, kept out of RpcAuthorization.test.ts so that upstream
// test file stays untouched by the fork.
describe("pipeline RPC authorization scopes", () => {
  it("lets readers see pipelines but keeps writing pipelines.json behind settings write", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.pipelinesSubscribe)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.pipelinesGetConfigText)).toBe(
      AuthOrchestrationReadScope,
    );
    for (const method of [
      WS_METHODS.pipelinesEnsureConfigFile,
      WS_METHODS.pipelinesSaveConfigText,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthSettingsWriteScope);
    }
    for (const method of [
      WS_METHODS.pipelinesStartStage,
      WS_METHODS.pipelinesRecordStage,
      WS_METHODS.pipelinesLeave,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationOperateScope);
    }
  });
});

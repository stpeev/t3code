import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { isWithinRoot, resolveWorktreesDirectory } from "./worktreesDirectory.ts";

const home = "/home/tester";
const defaultDir = "/home/tester/.t3/worktrees";

const withPath = <A, E>(effect: Effect.Effect<A, E, Path.Path>) =>
  effect.pipe(Effect.provide(Path.layer));

// Posix fixtures only; the win32 Path impl would classify them differently.
describe.skipIf(process.platform === "win32")("resolveWorktreesDirectory", () => {
  it.effect("returns the default for an empty setting", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.equal(resolveWorktreesDirectory("", defaultDir, path, home), defaultDir);
      }),
    ),
  );

  it.effect("keeps absolute settings absolute, expanding ~", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.equal(
          resolveWorktreesDirectory("/data/worktrees", defaultDir, path, home),
          "/data/worktrees",
        );
        assert.equal(
          resolveWorktreesDirectory("~/worktrees", defaultDir, path, home),
          "/home/tester/worktrees",
        );
      }),
    ),
  );

  it.effect("rejects filesystem roots", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.equal(resolveWorktreesDirectory("/", defaultDir, path, home), null);
      }),
    ),
  );

  it.effect("rejects relative settings without a project root", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.equal(resolveWorktreesDirectory(".claude/worktrees", defaultDir, path, home), null);
        assert.equal(
          resolveWorktreesDirectory(".claude/worktrees", defaultDir, path, home, null),
          null,
        );
      }),
    ),
  );

  it.effect("resolves relative settings under the project root", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.equal(
          resolveWorktreesDirectory(".claude/worktrees", defaultDir, path, home, "/repo/project"),
          "/repo/project/.claude/worktrees",
        );
      }),
    ),
  );

  it.effect("rejects a relative setting that escapes to a filesystem root", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.equal(resolveWorktreesDirectory("../../..", defaultDir, path, home, "/repo"), null);
      }),
    ),
  );
});

describe.skipIf(process.platform === "win32")("isWithinRoot", () => {
  it.effect("accepts the root itself and paths below it", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.isTrue(isWithinRoot(path, "/repo", "/repo"));
        assert.isTrue(isWithinRoot(path, "/repo/.claude/worktrees/feat+a", "/repo"));
      }),
    ),
  );

  it.effect("rejects parents, siblings and absolute outsiders", () =>
    withPath(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        assert.isFalse(isWithinRoot(path, "/repo/..", "/repo"));
        assert.isFalse(isWithinRoot(path, "/other", "/repo"));
        assert.isFalse(isWithinRoot(path, "/repo2/x", "/repo"));
      }),
    ),
  );
});

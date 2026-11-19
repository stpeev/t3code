import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  PIPELINE_REPORTS_EXCLUDE,
  defaultExcludesPath,
  ensureExcludeLine,
  ensureWith,
  expandHome,
} from "./pipelineReportsExclude.ts";

it("ensureExcludeLine appends the exclude to empty and unterminated contents", () => {
  assert.strictEqual(
    ensureExcludeLine(""),
    `# t3code: pipeline stage reports\n${PIPELINE_REPORTS_EXCLUDE}\n`,
  );
  assert.strictEqual(
    ensureExcludeLine("*.log"),
    `*.log\n# t3code: pipeline stage reports\n${PIPELINE_REPORTS_EXCLUDE}\n`,
  );
  assert.strictEqual(
    ensureExcludeLine("*.log\n"),
    `*.log\n# t3code: pipeline stage reports\n${PIPELINE_REPORTS_EXCLUDE}\n`,
  );
});

it("ensureExcludeLine leaves contents alone when the exclude is already there", () => {
  const once = ensureExcludeLine("");
  assert.strictEqual(ensureExcludeLine(once), once);
  assert.strictEqual(
    ensureExcludeLine(`${PIPELINE_REPORTS_EXCLUDE}\n`),
    `${PIPELINE_REPORTS_EXCLUDE}\n`,
  );
  assert.strictEqual(
    ensureExcludeLine(`${PIPELINE_REPORTS_EXCLUDE}  \n`),
    `${PIPELINE_REPORTS_EXCLUDE}  \n`,
  );
  // An anchored pattern is a different rule and must not count as present.
  assert.notStrictEqual(ensureExcludeLine("foo/pipeline-reports/\n"), "foo/pipeline-reports/\n");
});

it("defaultExcludesPath follows XDG_CONFIG_HOME, then HOME", () => {
  assert.strictEqual(
    defaultExcludesPath({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }),
    "/xdg/git/ignore",
  );
  assert.strictEqual(defaultExcludesPath({ HOME: "/home/u" }), "/home/u/.config/git/ignore");
  assert.strictEqual(
    defaultExcludesPath({ XDG_CONFIG_HOME: "", HOME: "/home/u" }),
    "/home/u/.config/git/ignore",
  );
});

it("expandHome expands ~ and ~/ against HOME", () => {
  assert.strictEqual(expandHome("~/ignores", "/home/u"), "/home/u/ignores");
  assert.strictEqual(expandHome("~", "/home/u"), "/home/u");
  assert.strictEqual(expandHome("/abs/path", "/home/u"), "/abs/path");
  assert.strictEqual(expandHome("~/ignores", undefined), "~/ignores");
});

it.layer(NodeServices.layer)("PipelineReportsExclude.ensure", (it) => {
  it.effect("writes to the XDG default when core.excludesFile is unset, and is idempotent", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        const deps = {
          fs,
          path,
          env: { XDG_CONFIG_HOME: dir, HOME: dir },
          readGlobalExcludesFile: Effect.succeed(null as string | null),
        };
        yield* ensureWith(deps);
        const file = path.join(dir, "git", "ignore");
        const first = yield* fs.readFileString(file);
        assert.include(first, PIPELINE_REPORTS_EXCLUDE);
        yield* ensureWith(deps);
        assert.strictEqual(yield* fs.readFileString(file), first);
      }),
    ),
  );

  it.effect("honors a configured core.excludesFile with ~ expansion and keeps existing lines", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        const custom = path.join(dir, "my-ignore");
        yield* fs.writeFileString(custom, "*.log\n");
        const deps = {
          fs,
          path,
          env: { HOME: dir },
          readGlobalExcludesFile: Effect.succeed("~/my-ignore" as string | null),
        };
        yield* ensureWith(deps);
        const first = yield* fs.readFileString(custom);
        assert.strictEqual(
          first,
          `*.log\n# t3code: pipeline stage reports\n${PIPELINE_REPORTS_EXCLUDE}\n`,
        );
        yield* ensureWith(deps);
        assert.strictEqual(yield* fs.readFileString(custom), first);
      }),
    ),
  );

  it.effect("never fails when the excludes path is not writable", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        // A regular file where the excludes directory would go makes the write fail.
        const blocker = path.join(dir, "blocker");
        yield* fs.writeFileString(blocker, "not a directory");
        const deps = {
          fs,
          path,
          env: { XDG_CONFIG_HOME: blocker, HOME: dir },
          readGlobalExcludesFile: Effect.succeed(null as string | null),
        };
        yield* ensureWith(deps);
      }),
    ),
  );
});

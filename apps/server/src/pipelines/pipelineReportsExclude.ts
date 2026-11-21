import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** Matches a .pipeline-reports/ directory at any depth in any repo (no inner slash). */
export const PIPELINE_REPORTS_EXCLUDE = ".pipeline-reports/";

/** Pure: the exclude line is present (exact line, trailing whitespace tolerated), else appended. */
export const ensureExcludeLine = (contents: string): string => {
  const present = contents.split("\n").some((line) => line.trimEnd() === PIPELINE_REPORTS_EXCLUDE);
  if (present) return contents;
  const prefix = contents.length > 0 && !contents.endsWith("\n") ? `${contents}\n` : contents;
  return `${prefix}# t3code: pipeline stage reports\n${PIPELINE_REPORTS_EXCLUDE}\n`;
};

/** git's built-in default when core.excludesFile is unset. */
export const defaultExcludesPath = (env: {
  readonly XDG_CONFIG_HOME?: string | undefined;
  readonly HOME?: string | undefined;
}): string => {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== "") return `${xdg}/git/ignore`;
  return `${env.HOME ?? "~"}/.config/git/ignore`;
};

export const expandHome = (value: string, home: string | undefined): string =>
  value === "~"
    ? (home ?? value)
    : value.startsWith("~/")
      ? `${home ?? "~"}${value.slice(1)}`
      : value;

const ensure = Effect.fn("PipelineReportsExclude.ensure")(function* (deps: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly env: Record<string, string | undefined>;
  readonly readGlobalExcludesFile: Effect.Effect<string | null>;
}) {
  const { fs, path, env } = deps;
  const configured = yield* deps.readGlobalExcludesFile;
  const expanded = expandHome(configured ?? defaultExcludesPath(env), env.HOME);
  const filePath = path.isAbsolute(expanded) ? expanded : path.join(env.HOME ?? ".", expanded);
  const existing = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
  const next = ensureExcludeLine(existing);
  if (next === existing) return;
  yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* writeFileStringAtomically({ filePath, contents: next }).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
  );
  yield* Effect.logInfo("added .pipeline-reports/ to the global git excludes file", { filePath });
});

/** Never fails: a best-effort housekeeping step, so pipelines work even when it cannot run. */
export const ensureWith = (deps: {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly env: Record<string, string | undefined>;
  readonly readGlobalExcludesFile: Effect.Effect<string | null>;
}): Effect.Effect<void> =>
  ensure(deps).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("could not update the global git excludes file for pipeline reports", {
        cause,
      }),
    ),
  );

export class PipelineReportsExclude extends Context.Service<
  PipelineReportsExclude,
  {
    readonly ensure: Effect.Effect<void>;
  }
>()("t3/pipelines/pipelineReportsExclude") {}

export const layer = Layer.effect(
  PipelineReportsExclude,
  Effect.gen(function* () {
    const git = yield* GitVcsDriver.GitVcsDriver;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Exit 1 just means core.excludesFile is unset, which is the common case.
    const readGlobalExcludesFile = git
      .execute({
        operation: "PipelineReportsExclude.readGlobalExcludesFile",
        cwd: process.cwd(),
        args: ["config", "--global", "--get", "core.excludesfile"],
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((result) => {
          const value = result.stdout.trim();
          return value === "" ? null : value;
        }),
        Effect.orElseSucceed(() => null as string | null),
      );
    return PipelineReportsExclude.of({
      ensure: ensureWith({ fs, path, env: process.env, readGlobalExcludesFile }),
    });
  }),
);

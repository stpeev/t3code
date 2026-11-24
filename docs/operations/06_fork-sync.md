# Fork sync (main-fork onto upstream main)

Runbook for syncing the fork branch with `upstream` (`pingdotgg/t3code`; `origin` is the fork). The rule: **resolve every conflict inside the commit being replayed — never as a follow-up repair commit.**

## Environment

- Use the pinned newer node: `export PATH="$HOME/.local/share/vite-plus/fallback-bin:$PATH"` (default node 24 lacks `node:sqlite` `statement.stat` and OOMs on the server typecheck).
- `NODE_OPTIONS=--max-old-space-size=8192` for `vp run typecheck` / builds; call `vp` as `command vp ...`.
- Prefer `vp run check:changed` and focused `vp test run <files>` over repo-wide checks.
- Always ignore `.claude/worktrees/*` ghost test/react-compiler failures; verify other failures against `backup/main-fork-pre-clean-rebase` before believing they are yours.

## Steps

1. Fetch and rebase:
   ```sh
   git fetch upstream main && git branch -f main upstream/main
   git rebase main          # on main-fork; GIT_EDITOR=true for non-interactive
   ```
2. Conflict rules (resolve in the replayed commit, then `git add` + `git rebase --continue`):
   - Both sides added different things (imports, exports, RPC scope maps, tests, CSS keyframes) → keep both.
   - Upstream renamed/moved an API the fork uses → adopt upstream's API, adapt fork call sites in the same commit.
   - Keep the fork's deliberate pins/patches (e.g. `@pierre/diffs@1.7.0-beta.3` in `pnpm-workspace.yaml` + `patches/`); do not adopt upstream's newer pierre API.
   - Upstream deleted a file the fork touched (e.g. docs pruning) → accept with `git rm`.
   - `pnpm-lock.yaml` → `git checkout --ours pnpm-lock.yaml`, `pnpm install --lockfile-only`, `git add`, continue. Full `pnpm install` after the rebase.
3. Verify: `command vp run typecheck` (all packages), `command vp run check:changed`, `command vp run build`.
4. Fold any fallout into the introducing commits — not as new commits:
   ```sh
   # per changed file: git log -1 --format=%H main..HEAD -- <file>, then
   git add <file> && git commit --fixup=<sha>        # grouped per target commit
   GIT_EDITOR=true git rebase -i --autosquash main
   git log --format=%s main..HEAD | grep -ci 'repair\|re-port\|fixup!'   # must be 0
   ```
5. Push: `git push --force-with-lease=main-fork:<old-origin-sha> origin main-fork`

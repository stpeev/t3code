---
name: sync-upstream
description: Sync the main-fork branch with upstream main via a clean rebase, resolving every conflict inside the replayed commit (no repair commits). Full runbook: docs/operations/06_fork-sync.md
---

# /sync-upstream

Sync `main-fork` with `upstream/main` the clean way. The rule: **resolve every
conflict inside the commit being replayed — never as a follow-up repair
commit.** Full runbook: `docs/operations/06_fork-sync.md`.

## Environment

- `export PATH="$HOME/.local/share/vite-plus/fallback-bin:$PATH"` (pinned newer node; default node 24 lacks `node:sqlite` `statement.stat` and OOMs on server typecheck).
- `NODE_OPTIONS=--max-old-space-size=8192` for typecheck/builds; call `command vp ...`.
- Prefer `vp run check:changed` and focused `vp test run <files>` over repo-wide checks.
- Ignore `.claude/worktrees/*` ghost test failures; verify other failures against `backup/main-fork-pre-clean-rebase` before believing they are yours.

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
   - Upstream deleted a file the fork touched → accept with `git rm`.
   - `pnpm-lock.yaml` → `git checkout --ours pnpm-lock.yaml`, `pnpm install --lockfile-only`, `git add`, continue. Full `pnpm install` after the rebase.
3. Verify: `command vp run typecheck`, `command vp run check:changed`, `command vp run build`.
4. Fold any fallout into the introducing commits — not as new commits:
   ```sh
   git add <file> && git commit --fixup=<sha>        # sha = git log -1 --format=%H main..HEAD -- <file>
   GIT_EDITOR=true git rebase -i --autosquash main
   git log --format=%s main..HEAD | grep -ci 'repair\|re-port\|fixup!'   # must be 0
   ```
5. Push: `git push --force-with-lease=main-fork:<old-origin-sha> origin main-fork`

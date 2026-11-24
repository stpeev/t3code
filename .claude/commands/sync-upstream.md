---
description: Sync main-fork with upstream main via a clean rebase — resolve every conflict inside the replayed commit, never as a repair commit
---

Mirror of the Vibe project skill `/sync-upstream`
(`.vibe/skills/sync-upstream/SKILL.md`). Full runbook:
`docs/operations/06_fork-sync.md`.

Rule: resolve every conflict inside the commit being replayed — never as a
follow-up repair commit.

1. `git fetch upstream main && git branch -f main upstream/main`, then
   `git rebase main` on `main-fork` (GIT_EDITOR=true).
2. Conflicts (resolve in the replayed commit, then `git add` +
   `git rebase --continue`): keep both sides on additive conflicts; adopt
   upstream renames and adapt fork call sites in the same commit; keep the
   fork's `@pierre/diffs@1.7.0-beta.3` pin; accept upstream deletions with
   `git rm`; for `pnpm-lock.yaml` use `git checkout --ours`,
   `pnpm install --lockfile-only`, `git add`, continue.
3. Verify: `command vp run typecheck`, `command vp run check:changed`,
   `command vp run build` (node from
   `$HOME/.local/share/vite-plus/fallback-bin`,
   `NODE_OPTIONS=--max-old-space-size=8192`).
4. Fold fallout into introducing commits via `--fixup` +
   `rebase -i --autosquash main`; `git log --format=%s main..HEAD | grep -ci
   'repair\|re-port\|fixup!'` must be 0.
5. `git push --force-with-lease=main-fork:<old-origin-sha> origin main-fork`.

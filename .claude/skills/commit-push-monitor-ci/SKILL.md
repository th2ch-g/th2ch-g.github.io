---
name: commit-push-monitor-ci
description: Deliver a finished change all the way to green CI on main — validate it, commit only the intended files with the running agent's Co-authored-by trailer, push to main, watch every CI run for that exact SHA, and when a run fails, diagnose it, fix it, push again, and re-monitor until CI passes or a bounded retry limit stops you. Use whenever the user says "終わったらcommit(co-author),push,ci監視", "commitしてpush", "pushしてCI監視", "mainにpushしてCIが通るまで見て", "CIが落ちたら直して", "commit and push", "watch CI until it's green", or otherwise asks for the complete commit → push → green-CI delivery workflow. Also use when the user just says the work is done and asks you to ship it.
---

# Commit, push, and drive CI to green

Deliver completed repository work without widening its scope, and do not report success until every CI run for the pushed commit is terminal and green.

Pushing to `main` in this repository **is** the release: `.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`. Treat each push as a production deploy, and let that shape how carefully you stage, how you bound retries, and what you verify at the end.

## Preconditions

Confirm all of these before touching git. Each one, skipped, produces a bad commit on a branch that deploys immediately.

- The user explicitly asked for commit / push (this skill's trigger phrases count as that authorization). Never commit or push on your own initiative.
- The implementation is finished and locally validated in proportion to the change — for this repo that usually means `npm run check` plus a `npm run build` when the change touches build-time code, and nothing at all when the change is a lone Markdown edit. Spending five minutes on a full build to validate a typo fix is its own kind of failure.
- You are on `main`: check with `git rev-parse --abbrev-ref HEAD`. If you are on another branch, stop and ask whether to switch, rebase, or push that branch instead. A wrong-branch commit costs far more to unwind than one question costs to ask.

## Workflow

### 1. Inspect before staging

```bash
git status --short --branch
git diff --check
```

Review the full diff. The worktree may hold changes the user made and did not mention — preserve them. Stage only what belongs to the task.

### 2. Stage and re-review

- Prefer explicit paths: `git add -- <paths...>`.
- Use `git add -A` only when the worktree was clean at task start and every change since is yours and intentional.
- Then confirm what you actually staged:

  ```bash
  git diff --cached --check
  git diff --cached --stat
  git status --short
  ```

- Never create an empty commit, and never stage secrets, `.env` files, build artifacts, or regenerable output. Note that `src/data/citations.json` and `src/data/bibtex.json` **are** committed on purpose (see `CLAUDE.md`) — if `prebuild` refreshed them, decide whether that refresh belongs in this commit or should be reverted, rather than sweeping it in silently.

### 3. Commit

Follow the repository's commit-message conventions (comments and commit messages in English here). Write an accurate, concise subject that describes the change, not the process.

Add the Co-authored-by trailer for **the agent actually running this skill** — the trailer is a record of authorship, so a stale hardcoded value makes the log lie:

| Running agent | Trailer |
|---|---|
| Claude Code | the exact `Co-Authored-By:` line your system prompt prescribes (it names the running model, e.g. `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`) |
| Codex CLI | `Co-authored-by: OpenAI Codex <codex@openai.com>` |
| Any other harness | that harness's prescribed trailer; if it prescribes none, omit the trailer rather than inventing one |

Verify it landed with `git log -1 --pretty=fuller` — a malformed trailer is invisible until someone reads the log, and by then the commit is public.

### 4. Push

```bash
git push origin main
```

Never force-push as part of this workflow. If the push is rejected because the remote moved ahead, stop and report — a rebase or merge on `main` is a decision for the user, not a step to improvise.

Record the full commit SHA (`git rev-parse HEAD`); everything downstream keys off it.

### 5. Discover the CI runs for that exact SHA

```bash
gh run list --commit <sha> --json databaseId,workflowName,status,conclusion,url,headSha --limit 20
```

GitHub often registers runs a few seconds after `git push` returns, so an empty list is not an answer. Retry, or fall back to `gh run list --branch main` and keep only rows whose `headSha` equals your SHA.

Discover workflows dynamically. Do not assume the set is Deploy / Lighthouse / a11y / links — workflows get added, and monitoring a hardcoded subset is how a red run gets reported as green.

### 6. Monitor every run to a terminal conclusion

```bash
gh run watch <run-id> --exit-status --interval 10
```

Watch each run, then re-query the full list for the SHA. "Done" means every relevant run has `status: completed`, and you have read its `conclusion`. Never infer success from partial job output or from one workflow finishing first.

Send the user a short progress line at least once a minute during long runs — silence during a multi-minute deploy reads as a hang.

### 7. On failure, fix and go around again

```bash
gh run view <run-id> --log-failed
```

Read the actual error before theorizing. Then:

- **Caused by this change, fix stays in scope** → fix it, re-validate locally, commit (new co-authored commit — do not amend a pushed commit), push, and return to step 5 with the new SHA.
- **Flaky or infrastructure failure** → say so with the evidence that makes you think so, and ask before rerunning. Do not rerun or cancel workflows unprompted.
- **Unrelated to this change, or the fix needs authority you weren't given** (new dependency, unrelated file, config the user hasn't seen) → stop and report the blocker with the run URL. Widening scope to make CI green is worse than a red CI, because the user can see red.

**Bound the loop.** Every retry is another production deploy, so an unbounded fix-push cycle against `main` is genuinely costly:

- Stop after 3 fix attempts for one delivery.
- Stop immediately if the same failure recurs after a fix aimed at it. Recurrence means the diagnosis was wrong, and another attempt without new information just adds commits to `main`.
- When you stop, report the failing run URL, the log excerpt showing the cause, what you tried, and what you'd try next.

### 8. Verify the delivery

- When the deploy workflow ran, fetch the affected production URL read-only and confirm the change is actually live. A green deploy job with stale content is a real failure mode, and this is the only step that catches it.
- `git status --short --branch` — confirm the local branch is in sync with `origin/main` and the worktree is in the state you expect.

### 9. Report

State plainly:

- Commit SHA and subject (all of them, if the fix loop ran).
- Branch pushed.
- Every relevant CI run with its conclusion and URL.
- The deployed URL, when a deploy ran.
- Any residual issue, skipped check, or known-flaky run — including it is what makes the rest of the report trustworthy.

## Safety rules

- Commit, push, workflow rerun, and deploy are authorized only when the user asked for them.
- No destructive git commands, no force push, no amending or rebasing already-pushed commits, no cancelling runs you did not start.
- Never commit secrets, credentials, temporary files, or unrelated worktree changes.
- Never claim CI success from partial output. Terminal conclusions only.

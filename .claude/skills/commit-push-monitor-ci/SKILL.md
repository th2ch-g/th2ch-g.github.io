---
name: commit-push-monitor-ci
description: Finish an authorized repository change by validating it, committing only the intended files with a Co-authored-by trailer, pushing the current branch, and monitoring every CI run for the pushed commit to a terminal result. Use when the user says "終わったらcommit(co-author),push,ci監視", "commitしてpush", "pushしてCI監視", "commit and push", "watch CI", or otherwise explicitly requests this complete delivery workflow.
---

# Commit, push, and monitor CI

Deliver completed repository work without widening its scope. Keep the user updated while CI runs and do not report success before every relevant workflow is terminal.

## Workflow

1. Finish the requested implementation and run proportionate local validation.
2. Inspect the repository before staging:
   - Run `git status --short --branch`, `git diff --check`, and review the diff.
   - Preserve unrelated user changes. Stage only files belonging to the task.
   - Do not create an empty commit.
3. Stage and review:
   - Prefer `git add -- <paths...>`.
   - Use `git add -A` only when the worktree was clean at task start and every change is intentional.
   - Run `git diff --cached --check`, `git diff --cached --stat`, and `git status --short`.
4. Commit:
   - Follow repository instructions for commit language and message style.
   - Use an accurate, concise subject.
   - In this repository, add:

     ```text
     Co-authored-by: OpenAI Codex <codex@openai.com>
     ```

   - Verify the trailer with `git log -1 --pretty=fuller`.
5. Push:
   - Push the current branch to its configured remote without force:

     ```bash
     git push origin <branch>
     ```

   - Never force-push unless the user explicitly authorizes it.
6. Discover CI for the exact pushed commit:
   - Record the full commit SHA.
   - Start with:

     ```bash
     gh run list --commit <sha> --json databaseId,workflowName,status,conclusion,url,headSha --limit 20
     ```

   - GitHub may register runs after the push returns. If the list is initially empty, retry with the current branch and keep only runs whose `headSha` equals the pushed SHA.
   - Discover workflows dynamically; do not assume only Deploy, Lighthouse, or a11y exists.
7. Monitor every matching run:
   - Use `gh run watch <run-id> --exit-status --interval 10` for live progress.
   - Re-query all runs for the commit afterward. Completion requires every relevant run to have `status: completed`.
   - Send a concise user update at least once per minute during long runs.
8. Handle failures:
   - Fetch evidence with `gh run view <run-id> --log-failed`.
   - If the failure is caused by the current change and the correction stays within the original task, fix it, validate, create a new co-authored commit, push, and monitor the new SHA.
   - If it is unrelated, flaky, or requires new authority, report the exact blocker and link the failed run. Do not mutate unrelated systems or rerun unrelated workflows.
9. Verify delivery:
   - When a deployment workflow ran, verify the requested production URL with a safe read-only request.
   - Run `git status --short --branch` and confirm the local branch is synchronized with its remote.
10. Report:
    - Include the commit SHA and subject.
    - State the pushed branch.
    - Link every relevant CI run and its conclusion.
    - Include the deployed URL when applicable.
    - Mention any known residual issue or skipped check.

## Safety rules

- Treat commit, push, workflow rerun, and deployment as authorized only when the user explicitly requests them.
- Never include secrets, temporary files, build artifacts, or unrelated worktree changes.
- Never use destructive Git commands or force push as part of this workflow.
- Do not cancel another run unless the user explicitly requests cancellation.
- Do not claim CI success from partial job output; require terminal workflow conclusions.

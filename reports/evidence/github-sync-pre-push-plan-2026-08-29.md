# Kairema → GitHub pre-push sync plan

**Статус:** подготовка завершена; GitHub push не выполнялся. Этот документ описывает только безопасный план и условия для отдельного подтверждённого push.

## 1. Source of truth

Текущий Manus checkout `/home/ubuntu/kairema` остаётся source of truth. Проверенный локальный branch — `main`; HEAD — `3b3db65790bffd964af047e0cf56814876cb81fd`, соответствующий последнему support-platform snapshot. В checkout 431 tracked files. Major areas: `client` (102), `server` (100), `reports` (102), `drizzle` (82), `scripts` (22), `shared` (5). Application areas requested by the brief — frontend, backend/routes, auth/session, four roles, provider/search, memory, attachments, exports, drafts, owner/multi-user controls and tests — are represented in the current tree.

The current working delta is task documentation only: `todo.md` is modified and `reports/evidence/data/github-sync-readonly-findings-2026-08-29.md` is a new sanitized evidence file. No application/runtime source was changed during this sync analysis.

The configured local `origin` is the Manus/WebDev artifact remote. It is not the supplied GitHub URL and must not be repointed automatically.

## 2. GitHub state

The supplied target `https://github.com/2gg4gg2-ship-it/Kairema-.git` was checked through the GitHub UI and API. The UI showed GitHub’s not-found page; the API returned HTTP 404 `Not Found`. A read-only git transport check could not authenticate because no GitHub credential is available to the terminal, and no credential was requested, printed, stored or guessed.

Consequently, the target repository’s existence/visibility, current files, commit history, default branch and empty/non-empty status are **UNVERIFIED**. The 404 must not be interpreted as proof that the repository is empty; it may also indicate private, renamed, inaccessible or mistyped repository identity.

## 3. Proposed safe sync plan

No push is proposed in the current state. After the repository URL/access is corrected or an approved GitHub integration becomes available, the safe sequence is:

| Stage | Proposed action | Guard |
|---|---|---|
| Target confirmation | Read target metadata and default branch; fetch without mutation | Stop if repository identity or access is ambiguous |
| Baseline comparison | Compare target tree/history with local `main`; do not overwrite silently | Preserve existing target history |
| Working branch | If target is non-empty, use a new `manus-sync-2026-08-29` branch; if target is confirmed empty, use its confirmed default branch, preferably `main` only when verified | No direct default-branch overwrite by assumption |
| Content review | Include the current application source, tests, configuration, migrations and documentation needed to reproduce the current Kairema tree | Exclude secrets, `.env*`, generated/runtime artifacts and unsafe historical payloads |
| Commit | Create one descriptive sync commit after the user approves the exact file list and exclusions | No commit before explicit confirmation |
| Push | Push only the reviewed branch to the confirmed existing repository | No force push, delete, reset, or destructive rewrite |
| Post-push | Verify remote commit/tree and report the exact branch and commit | Stop on any mismatch |

The local branch name `main` is a proposal derived from the Manus checkout, not a claim about the GitHub default branch. The target default branch must be read from GitHub after access is resolved.

## 4. Secret and sensitive-content policy

The existing `.gitignore` excludes environment files and common generated/runtime artifacts. Filename-only and likely-literal scans were performed without printing values. No likely API-key/private-key literal pattern was found in the scanned tracked application files. This is a screening result, not a substitute for final human review.

Before any push, the following groups require explicit review and are not automatically included in the proposed commit: provider-specific `*.secret.test.ts` files, live-test/diagnostic scripts, historical provider or auth reports, generated build/runtime artifacts, and any file containing raw provider output, URLs tied to private sessions, request identifiers, user data, tokens or credentials. Tests that reference environment-variable names may be retained only after confirming that they contain no literal values. No secret values will be copied into GitHub.

## 5. Bolt import readiness

The source tree is structurally suitable for a future Bolt import as a React/Vite frontend plus Node/Express/tRPC server project, with `package.json`, `pnpm-lock.yaml`, TypeScript/Vite configuration, client/server/shared code and Drizzle schema present. Import readiness is **conditional**, not certified: the GitHub target is inaccessible, and the current repository has platform-specific Manus/WebDev integration files and server environment assumptions that Bolt may not reproduce automatically. A later import should preserve source files first and treat deployment/secrets/database wiring as separate configuration work.

## 6. Required confirmation before push

The next action must not be a push. First resolve GitHub access and confirm the exact repository identity/default branch. Then provide the user with the final reviewed file list, excluded-file list and branch/commit plan. Only after the user explicitly confirms that exact plan may a single non-destructive push be considered. Until then, current production/runtime behavior, Manus origin, application code, database, user data, auth, provider routing and infrastructure remain unchanged.

## References

[1]: https://github.com/2gg4gg2-ship-it/Kairema- "Supplied Kairema GitHub repository URL"
[2]: https://api.github.com/repos/2gg4gg2-ship-it/Kairema- "GitHub repository metadata endpoint"

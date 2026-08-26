# Kairema: provider-managed Stytch Consumer Authentication

**Дата:** 2026-08-26 UTC  
**Статус:** **CODE-LEVEL PASS**; real email delivery и end-to-end browser acceptance — **NOT VERIFIED**.

## Scope и сохранённые границы

В Kairema добавлен provider-managed email/password путь через **Stytch Consumer Authentication**. Существующий вход Manus/Google OAuth, canonical таблица `users`, server-derived `ctx.user`, multi-user scope и owner mapping сохранены. Реализация не содержит локальных password hashes, самодельных JWT, Kairema reset tokens, фиктивной email delivery либо автоматического объединения аккаунтов по совпавшему email.

| Требование | Реализация | Статус |
|---|---|---|
| Проверка provider configuration | Server-only test вызывает Stytch Password Strength Check с синтетической строкой; endpoint не создаёт пользователя, не запускает сессию и не отправляет email.[1] | **PASS** |
| Canonical identity | Additive `provider_identities`: unique `(provider, providerSubject)` → `users.id`; существующая `users` таблица не изменена. | **PASS** |
| Email/password | Server-side Stytch SDK обрабатывает registration, password authentication, verification magic link, password reset и provider session. | **PASS** |
| Session | В HttpOnly/Secure/SameSite cookie хранится только opaque provider-issued Stytch session token; на каждом request сервер проверяет его через SDK. Kairema session token не выпускается. | **PASS** |
| Manus/Google OAuth | Existing cookie/callback/nonce contract сохранён. При успешном Stytch sign-in активная Manus cookie очищается как явное переключение principal, а не как identity merge. | **PASS** |
| Account linking | Protected `beginLink` выдаёт short-lived opaque reference, привязанный server-side к initiating canonical user; callback atomically consumes его только для того же `ctx.user.id`. Same-email lookup отсутствует. | **PASS** |
| Реальная доставка email / переход по ссылке | 2026-08-26 выполнены согласованные public registration и same-browser login attempts на отдельном разрешённом test mailbox с ephemeral password. Оба завершились generic safe UI error; inbox не открывался, delivery не подтверждена, дальнейшие attempts остановлены. | **FAIL / BLOCKED BY PROVIDER ACCEPTANCE** |

## Server trust model

> **Canonical user identity никогда не принимается от клиента.** Для Stytch она выводится только после успешной server-side session/magic-link verification и unique provider-subject mapping.

Stytch Consumer API использует server credentials для server-side calls и изолирует test/live environments.[2] Конфигурация берётся только на сервере. `STYTCH_CALLBACK_BASE_URL` валидируется как trusted HTTPS origin и используется для фиксированного `/api/stytch/callback`; redirect не строится из `Host` header или client input.

| Контроль | Проверенное поведение |
|---|---|
| Registration | Stytch `passwords.create`, затем Stytch-managed magic link для подтверждения. В локальную БД не пишутся password или verification token. |
| Login | Stytch `passwords.authenticate`; если provider email не verified, provider session отзывается и отправляется verification flow. |
| Verification | Callback принимает provider token server-side, проверяет magic link SDK и создаёт/находит mapping только по `user_id` provider после verified email. |
| Recovery | Stytch reset token помещается только в отдельную short-lived HttpOnly cookie и передаётся обратно в SDK `passwords.email.reset`; token не попадает в client JavaScript или database. |
| Logout | Отзывается Stytch provider session по opaque token и очищаются Manus/Stytch/session-reset/link-intent cookies. |
| Ошибки | В API/UI возвращаются generic Russian statuses; raw Stytch response, password, token, email or credentials не логируются и не отображаются. |

## Additive persistence и no-auto-linking

Migration `0033_military_stranger.sql` добавляет только `provider_identities` с provider-subject unique constraint, FK на existing `users.id` и index для owned identity lookup. Additive migration `0034_aberrant_nemesis.sql` добавляет только `stytch_link_intents`: hash одноразовой opaque reference, исходный `users.id` и expiry. 2026-08-26 schema-level verification подтвердила обе таблицы и keys. Migrations не содержат изменения либо удаления existing user/content data.

Совпадение email не используется для поиска canonical user. Для нового verified Stytch subject создаётся отдельный canonical user. Для уже вошедшего Manus/Google user доступна только явная protected linking action. Browser получает только short-lived opaque reference; её hash и initiating canonical `users.id` хранятся server-side. Callback получает current verified requester и atomically consumes reference только при совпадении user ID и неистекшем сроке. Поэтому link intent пользователя A не может быть завершён после session-switch на user B. Интеграция не полагается на automatic same-email identity linking — именно это было причиной отказа от Supabase route.[3]

## UI и regression coverage

Data-free Welcome сохраняет Google/Manus CTA и добавляет доступные provider-backed формы регистрации, login, verification resend, recovery и reset. Authenticated Settings содержит явный Stytch linking entry. Mobile public visual check выполнен на `/?welcome=1` без открытия private chat, memory, profile или attachment data.

| Проверка | Результат |
|---|---|
| Stytch configuration + trusted callback origin | **PASS** — 3 tests, включая non-mutating provider configuration validation и environment normalization. |
| SDK environment normalization | **PASS** — project-scoped `test-*`/`live-*` values переводятся только в official Stytch base URLs; focused suite (`stytch.secret`, `stytch.security`, `auth.logout`) 3 files / 8 tests passed. |
| Provider cookies, forged-client boundary, explicit linking | **PASS** — `server/stytch.security.test.ts`, 4 tests, включая user-A/user-B session-switch denial. |
| Logout Stytch/Manus cookie cleanup | **PASS** — existing/logout regression extended. |
| Welcome и authenticated linking UI | **PASS** — component/integration regressions, без credentials/provider calls. |
| Полный `pnpm test` | **PASS** — 58 files passed, 1 skipped; 279 tests passed, 4 skipped. |
| `pnpm check` и `git diff --check` | **PASS**. |
| Production build | **NOT RUN** — сохранён ранее согласованный sandbox SIGTERM/resource blocker. |
| Live register → inbox → magic link → session → reset → logout | **FAIL / BLOCKED BY PROVIDER ACCEPTANCE** — registration и same-browser login завершились generic safe error; inbox не открывался, link/reset/logout не выполнялись. |

## Ограничения и следующий безопасный шаг

Provider password configuration и code-level contract готовы. Ограниченная live acceptance выявила provider acceptance blocker: public registration и same-browser login вернули generic safe error уже до подтверждения delivery. A separate documented non-delivery Stytch sandbox diagnostic confirmed Password Create and Authenticate, then returned the safe category `no_match_for_provided_magic_link_url` for the Magic Link request. Это означает, что server-derived callback URL отсутствует в Stytch project allowlist. No raw provider error message, request ID, credentials, password, token, mailbox content или user records не извлекались. До добавления exact callback URL в Stytch Dashboard нельзя утверждать delivery, callback, session, reset или logout live PASS.

Официальная документация Stytch предоставляет sandbox values только в Test environment и только для прямых API calls. Email `sandbox@stytch.com` вызывает predetermined `200` в Password Create/Authenticate независимо от пароля, а также в Password Reset Start без фактической email delivery.[4] Такой путь позволяет проверить provider request semantics через текущий server adapter без повторной доставки на реальный mailbox, но не заменяет реальную email delivery acceptance. Для реальной delivery Stytch документирует отдельный E2E mailbox flow.[5]

## References

[1]: https://stytch.com/docs/api-reference/consumer/api/passwords/strength-check "Stytch Consumer Password Strength Check"
[2]: https://stytch.com/docs/api-reference/consumer/api/overview "Stytch Consumer API overview"
[3]: https://supabase.com/docs/guides/auth/auth-identity-linking "Supabase Auth identity linking"
[4]: https://stytch.com/docs/api-reference/consumer/api/magic-links-email/login-or-create "Stytch Consumer Magic Link Login or Create"
[4]: https://stytch.com/docs/api-reference/consumer/api/resources/sandbox-values "Stytch Consumer Sandbox Values"
[5]: https://stytch.com/docs/api-reference/consumer/api/resources/e2e-testing "Stytch Consumer E2E Testing"

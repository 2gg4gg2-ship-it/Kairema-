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
| Реальная доставка email / переход по ссылке | 2026-08-26 выполнены согласованные public registration и same-browser login attempts на отдельном разрешённом test mailbox с ephemeral password. Inbox не открывался. Один delivery-only resend был принят безопасным public API response, но письмо не наблюдалось; Stytch Dashboard показал `EmailDelivery` HTTP 400 без доступного `message_status` или error category. Новые отправки остановлены. | **BLOCKED BY PROVIDER DELIVERY DIAGNOSTICS** |

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
| Future resend failure observability | **PASS** — allowlisted local categories only (`ADDRESS_INVALID`, `ADDRESS_INACTIVE`, `CALLBACK_URL_REJECTED`, `REQUEST_REJECTED`, `PROVIDER_UNAVAILABLE`, `UNKNOWN`); one bounded technical event has no actor identifier, email, request ID, token, callback URL, raw Stytch type/message/details or provider payload. SDK RequestError/client/transport failure preserves the existing `SERVICE_UNAVAILABLE` path. Focused Stytch suite: 4 files / 10 tests passed. |
| Welcome и authenticated linking UI | **PASS** — component/integration regressions, без credentials/provider calls. |
| Полный `pnpm test` | **PASS** — 59 files passed, 1 skipped; 281 tests passed, 4 skipped. |
| `pnpm check` и `git diff --check` | **PASS**. |
| Production build | **NOT RUN** — сохранён ранее согласованный sandbox SIGTERM/resource blocker. |
| Live register → inbox → magic link → session → reset → logout | **BLOCKED BY PROVIDER DELIVERY DIAGNOSTICS** — API acceptance не доказывает delivery; Dashboard `EmailDelivery` HTTP 400 не содержит доступной safe category. Inbox, link/reset/logout не открывались и не выполнялись. |

## Ограничения и следующий безопасный шаг

Provider password configuration и code-level contract готовы. Первоначальный non-delivery sandbox diagnostic вернул safe category `no_match_for_provided_magic_link_url` для Magic Link request. После добавления exact production callback в Test Redirect URLs process-local recheck с тем же trusted URL прошёл. Следовательно, callback allowlist **не является подтверждённым текущим blocker**. Отдельный delivery-only resend затем получил generic anti-enumeration response от Kairema, но в Stytch Dashboard появился `EmailDelivery` HTTP 400; доступная пользователю Event Log view не содержит `message_status` или error category. No raw provider error message, request ID, credentials, password, token, mailbox content или user records не извлекались. Новые provider requests остановлены; delivery, callback, session, reset и logout live PASS не заявляются.

Официальная документация Stytch предоставляет sandbox values только в Test environment и только для прямых API calls. Email `sandbox@stytch.com` вызывает predetermined `200` в Password Create/Authenticate независимо от пароля, а также в Password Reset Start без фактической email delivery.[4] Такой путь позволяет проверить provider request semantics через текущий server adapter без повторной доставки на реальный mailbox, но не заменяет реальную email delivery acceptance. Для реальной delivery Stytch документирует отдельный E2E mailbox flow.[5]

### Read-only delivery status path

Stytch документирует delivery events с action `EmailDelivery` в Dashboard Event Logs; события появляются в течение минуты после request completion и хранятся 30 дней.[6] Consumer API не предоставляет отдельного safe application endpoint для чтения delivery status в данном integration scope. Поэтому без новой отправки единственный доступный путь — просмотреть Event Logs в том же Stytch Test project и записать только технический delivery outcome, не экспортируя email address, link, token или raw event payload.

Официальная deliverability-документация указывает, что одно email request может создавать несколько `EmailDelivery` events, а диагностически значимым полем является `message_status` в dropdown view, а не HTTP status code сам по себе.[6] Для 4XX Stytch называет среди возможных категорий `invalid_email` и `inactive_email`, но доступный `400` без category не различает их и не доказывает ни одну из причин. Поэтому исправление адреса, reactivation либо inbox/spam remediation **не выполнялись и не рекомендуются как установленный диагноз**.

2026-08-26 Stytch Support подтвердил только тот же ограниченный уровень: observed `EmailDelivery` HTTP 400 относится к 4XX client-error bucket, а `invalid_email` и `inactive_email` являются возможными coarse categories. Точную category для данного события provider не предоставил. Поэтому этот ответ **не подтверждает** ни ошибку формата, ни prior hard bounce, ни spam complaint. Stytch документирует проверку формата только при установленном `invalid_email`; reactivation через User Management применима только после установленного `inactive_email` и устранения причины hard bounce. Для case of spam complaint Stytch направляет к Support.[6] Ни проверка mailbox, ни изменение адреса, ни reactivation, ни новая отправка не выполнялись.

После отдельного разрешения пользователя на поиск exact category Kairema включила встроенный Stytch connector только для безопасного capability discovery. Он предоставляет project/configuration tools, но не содержит операций чтения Event Logs, delivery-status lookup или создания/ведения Support request. Поэтому connector не может получить точную category текущего `EmailDelivery` HTTP 400 в рамках запрета на передачу идентификаторов; никаких его mutation-tools не вызывалось.

### Final operational status for Magic Link delivery

По явному указанию пользователя дальнейшая Support escalation прекращена. **Password Create** и **Password Authenticate** остаются **PASS** по non-delivery server diagnostic. **Magic Link delivery** остаётся отдельным внешним **BLOCKED**: Stytch `EmailDelivery` вернул HTTP 400, а точная coarse category недоступна. Это не изменяет и не отменяет рабочий provider-managed auth flow. Не выполнялись и не будут выполняться без нового отдельного задания: provider-side проверка или mutation, reactivation, изменение адреса, inbox access, повторная verification delivery либо password-reset delivery.

Независимая от delivery регрессия Kairema после этой фиксации завершилась **PASS**: полный suite — 59 файлов / 281 тест, 1 файл / 4 теста skipped; `pnpm check` и `git diff --check` — PASS. В suite присутствуют существующие health tests для других провайдеров, но не выполнялись Stytch delivery, mailbox access, provider mutation или resend. Production build по сохранённому sandbox SIGTERM blocker не запускался.

Для будущей **отдельно разрешённой** verification resend Kairema теперь сохраняет best-effort техническое событие только при provider failure. Маппинг допускает исключительно фиксированные Kairema-owned labels: `ADDRESS_INVALID`, `ADDRESS_INACTIVE`, `CALLBACK_URL_REJECTED`, `REQUEST_REJECTED`, `PROVIDER_UNAVAILABLE` или `UNKNOWN`. Он не выводит историческую причину уже завершившегося HTTP 400 и не изменяет anti-enumeration response `DELIVERY_REQUESTED`. В событие намеренно не попадают email, `request_id`, callback URL, token, raw Stytch error type/message/details, payload или actor identifier.

### Test-environment acceptance boundary

`sandbox@stytch.com` — специальное значение для прямых Consumer API calls в Test environment: корректный Magic Link request возвращает predefined `200`, но email не отправляется. Это безопасная проверка server request contract, не замена inbox delivery.[4] Stytch рекомендует sandbox values для backend endpoint tests в Test environment, а для flows, требующих реального inbox или Live environment behavior, — программно доступный test mailbox.[4] [5] Следовательно, следующий live email resend допускается только после получения provider-side category/remediation и отдельного разрешения пользователя.

## References

[1]: https://stytch.com/docs/api-reference/consumer/api/passwords/strength-check "Stytch Consumer Password Strength Check"
[2]: https://stytch.com/docs/api-reference/consumer/api/overview "Stytch Consumer API overview"
[3]: https://supabase.com/docs/guides/auth/auth-identity-linking "Supabase Auth identity linking"
[4]: https://stytch.com/docs/api-reference/consumer/api/resources/sandbox-values "Stytch Consumer Sandbox Values"
[5]: https://stytch.com/docs/api-reference/consumer/api/resources/e2e-testing "Stytch Consumer E2E Testing"
[6]: https://stytch.com/docs/resources/policies/messaging/deliverability/email-deliverability "Stytch Email deliverability"; https://stytch.com/docs/resources/workspace-management/event-logs "Stytch Event Logs"

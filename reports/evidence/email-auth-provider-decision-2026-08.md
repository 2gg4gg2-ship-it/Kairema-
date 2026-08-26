# Kairema — provider decision для Google + email/password auth

**Дата:** 2026-08-25 UTC  
**Статус:** **рекомендован Stytch Consumer Authentication, но не интегрирован.** Решение ожидает явного подтверждения и provider configuration values. Existing Manus OAuth/Google, users, owner mapping, server-derived authorization, multi-user data, drafts, memory, attachments и exports не менялись.

## Рекомендация

Для Kairema рекомендуется **Stytch Consumer Authentication** как отдельный managed provider для email/password, verification, recovery и provider-managed sessions. Рекомендация основана на совместимости с обязательным правилом: у Kairema не должно быть автоматического связывания Google и email identities только потому, что совпал email. Stytch предоставляет consumer password/session/fraud capabilities и managed email delivery, тогда как выбранный путь может оставлять существующий Manus OAuth/Google без переноса приложения на новую database/auth platform.[1] [2]

> **Ключевая архитектурная оговорка:** Stytch используется только для новых email identities. Существующий Google/Manus OAuth не заменяется и не «переводится» в Stytch. Canonical Kairema user остаётся server-owned; связывание дополнительного email с уже существующим Google user должно требовать явного verified action в действующей сессии, а не совпадения email.

| Критерий | Stytch Consumer Auth | Supabase Auth | Вывод для Kairema |
|---|---|---|---|
| Password, verification, recovery | Managed consumer password/session product; email delivery является частью provider capability.[1] [2] | Hosted email/password с confirmation и reset, но требует отдельной redirect/template/SMTP policy.[3] | **Преимущество Stytch:** меньше локальной auth/email инфраструктуры. |
| Linking и anti-takeover | Provider описывает verified identity handling и managed deduplication; Kairema всё равно должен оставить linking explicit между Manus и Stytch identities.[2] | Automatic same-email linking включён в documented strategy; manual linking beta.[4] | **Stytch подходит лучше:** Supabase default противоречит запрету auto-link по email. |
| Google continuity | Можно оставить existing Manus OAuth без миграции Kairema data; email добавляется как второй verified factor через explicit link. | Требовал бы новый OAuth/PKCE and identity-linking policy, что создаёт дополнительный risk surface. | **Stytch:** меньший scope изменения canonical Google path. |
| Session и abuse controls | Managed sessions, revocation, fraud/rate capabilities доступны в Consumer Auth.[1] | Hosted auth service, но integration должен самостоятельно строить PKCE callback/server session policy.[3] | **Stytch:** лучше соответствует запрету на homemade session/reset flow. |
| Free-tier reality | Pricing page сообщает $0/mo allowance до 10,000 MAU, затем usage-based billing.[5] | Free tier сообщает 50,000 MAU, но free project pauses after one week of inactivity; Pro starts at $25/mo.[6] | **Ни один provider не даёт гарантию «всегда бесплатно».** Цена/limits могут меняться; Kairema не должен обещать отсутствие future paid transition. |
| Migration pressure | Не требует переноса Kairema database/chats/memory/attachments. | Может использоваться без data migration, но добавляет hosted-project and default-linking constraints. | **No-migration guard:** выбран Stytch. |

## Безопасная целевая модель

Текущая таблица `users` остаётся единственным canonical owner для Kairema data. При реализации будет добавлен **provider identity mapping**, где provider subject связывается с existing internal user только после verified server-side proof. Это не новая users/auth database и не client-authoritative mapping.

| Identity source | Допустимый путь | Недопустимый путь |
|---|---|---|
| Existing Manus OAuth / Google | Сохраняет current callback, nonce, verified `openId` and root session behavior. | Не заменяется Stytch OAuth и не получает новый client-only user ID. |
| Stytch email/password | Provider verifies password, email verification/recovery and provider session; backend verifies provider-issued session/subject before mapping. | Нет local password hash, reset token table, homemade JWT, fake email or client-supplied subject. |
| Account linking | Только explicit authenticated user action plus verified provider proof; conflict returns generic safe response and does not expose existing account. | Нет merge/ownership transfer по equal email alone; нет automatic reassignment of chats/memory/attachments/exports. |

## Что необходимо до implementation

Решение не создаёт Stytch account, не активирует connector и не записывает secret. Для начала implementation пользователь должен подтвердить выбор **Stytch Consumer Auth** и предоставить provider configuration через защищённый secret flow.

| Значение | Назначение | Где используется |
|---|---|---|
| `STYTCH_PROJECT_ID` | Идентифицирует Consumer project. | Server-only provider client configuration. |
| `STYTCH_SECRET` | Authenticates server-to-provider calls. | Server-only; никогда не попадёт в frontend/logs. |
| `STYTCH_ENVIRONMENT` | `test` для pre-production или `live` для actual users. | Server-only endpoint selection. |
| `VITE_STYTCH_PUBLIC_TOKEN` | Publishable token, если выбран provider-hosted/prebuilt frontend flow. | Только если требуется official browser SDK; не является server secret. |

В Stytch Consumer project также должны быть включены password authentication, email verification, password reset/recovery, approved redirect URLs для Kairema и rate/abuse policy. Provider configuration и its logs остаются outside Kairema; application не будет симулировать delivery при их отсутствии.

## Текущий blocker

**BLOCKED BY PROVIDER CONFIGURATION:** current project does not have an enabled, configured Stytch Consumer connector or approved credentials. Therefore no login/register/reset form, email delivery, account linking or provider session code has been added. Это преднамеренно предотвращает небезопасную вторую local auth system.

## References

[1]: https://stytch.com/docs/consumer-auth/overview "Stytch Consumer Authentication overview"
[2]: https://stytch.com/blog/user-linking-and-provider-failover-with-stytch/ "Stytch user linking and provider failover"
[3]: https://supabase.com/docs/guides/auth/passwords "Supabase password-based Auth"
[4]: https://supabase.com/docs/guides/auth/auth-identity-linking "Supabase Auth identity linking"
[5]: https://stytch.com/pricing "Stytch pricing"
[6]: https://supabase.com/pricing "Supabase pricing"

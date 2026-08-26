# Stytch configuration validation — source record

**Дата:** 2026-08-25 UTC  
**Назначение:** зафиксировать официальный lightweight validation contract для переданных Stytch Consumer configuration values. Этот документ не содержит configuration values, project identifiers, public tokens, credentials, users или email addresses.

Stytch Consumer API требует Basic Authentication с project ID и secret для server-side calls. Test environments используют `https://test.stytch.com`, live environments — `https://api.stytch.com`; credentials и data isolates per environment.[1] [2]

Для health validation выбран `POST /v1/passwords/strength_check`. Официальный API reference определяет endpoint как Basic-Auth protected и подтверждает, что request body содержит только password string; endpoint проверяет password policy, не создаёт user, не запускает session и не отправляет email.[3] Kairema передаёт синтетическую non-user test string, не реальный пароль и не user data.

| Проверка | Допустимый результат | Недопустимое действие |
|---|---|---|
| Stytch configuration | HTTP 200 от password strength check | Создание user, login, session, verification/reset email, чтение users list или раскрытие credentials. |
| Environment mapping | `test`/`test-*` → test API; `live`/`live-*` → live API | Использование test secret с live endpoint или наоборот. |

## Sources

[1]: https://stytch.com/docs/api-reference/consumer/api/overview
[2]: https://stytch.com/docs/resources/workspace-management/api-keys
[3]: https://stytch.com/docs/api-reference/consumer/api/passwords/strength-check

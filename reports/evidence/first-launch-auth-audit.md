# Kairema — first-launch auth flow: итоговый audit

**Дата:** 2026-08-25 UTC  
**Статус:** code-level first-launch auth flow реализован и готов к публикации. Действующий Manus OAuth сохранён как единственный источник session identity. Email/password registration, verification, recovery и account linking **не реализованы и заблокированы инфраструктурно**: в проекте нет подключённого и согласованного auth/email provider с безопасной password/session архитектурой и transactional delivery.

## Результат реализации

Гостевой root теперь не рендерит обычный интерфейс Kairema, историю, память, настройки или экспорты. Пока проверенная сессия не доступна, root показывает только отдельный auth screen. После появления verified user normal root рендерит существующий private Home. Отдельно тем же gate защищён прямой маршрут `/owner-analytics`; его server-side owner authorization не ослаблялась.[1]

| Область | Статус | Реализованная граница |
|---|---|---|
| Root `/` | **PASS (code-level)** | `RootRoute` возвращает Welcome при loading/guest и private Home только при verified user. Параметр `?welcome=1` остаётся явным data-free entry. |
| Direct private route | **PASS (code-level)** | `/owner-analytics` обёрнут в общий `VerifiedSessionRoute`; guest не получает даже restricted owner UI. |
| Google / provider login | **PRESERVED** | Обе CTA запускают только существующий click-time `startLogin()`. Новая сессия, callback, cookie или client token не добавлялись.[2] [3] |
| Server authorization | **PRESERVED** | Данные продолжают требовать `protectedProcedure` и trusted `ctx.user`; frontend user ID не становится источником полномочий.[4] |
| User identity mapping | **PRESERVED** | Существующий OAuth callback, nonce validation и локальная users mapping не менялись. |
| Password/email login | **BLOCKED / NOT IMPLEMENTED** | Нет локального password form, hash, reset/verification token, второй `auth_users` store, самодельной JWT/session или фиктивной email delivery. |

> **Принцип безопасности:** Kairema не заявляет о работающем email/password flow, пока отсутствует явно подключённый provider, который одновременно покрывает password storage, verified email, recovery delivery, session management и account linking. Это исключает создание небезопасной параллельной auth-системы.

## Поведение экрана входа

First-launch экран содержит две provider-managed точки входа: «Продолжить с Google» и «Войти через защищённый аккаунт». Обе сознательно используют один существующий OAuth flow, а не создают второй local-email path. Экран объясняет отсутствие локального пароля и выводит встроенные, доступные с клавиатуры disclosures для условий и конфиденциальности; ссылки на несуществующие routes не добавлялись.[2]

Существующий OAuth flow не переписывался: callback URI продолжает формироваться от `window.location.origin`, одноразовый nonce создаётся только в момент начала входа, а callback проверяет state до обмена code.[3] [5]

## Email/password feasibility и блокировка

Read-only audit конфигурации email-интеграций подтвердил, что доступные email-capable connectors отключены, а готового transactional email/auth provider с одобренными credentials в этой задаче нет. Поэтому следующие требования остаются **не реализованы**, а не замаскированы под работающую функцию.

| Запрошенная возможность | Статус | Причина / безопасное условие разблокировки |
|---|---|---|
| Регистрация по email и паролю | **BLOCKED** | Нужен отдельно согласованный provider, server-side password hashing policy и managed session lifecycle. |
| Verification email | **BLOCKED** | Нужны transactional provider, verified sender/domain и подтверждённая delivery configuration. |
| Password reset | **BLOCKED** | Нужны provider-managed single-use reset lifecycle, TTL, abuse controls и delivery. |
| Account linking | **BLOCKED** | Нужен provider-supported verified identity linking с явной conflict/recovery policy. |

Следующее допустимое действие — пользователь выбирает и предоставляет/подтверждает конкретную безопасную инфраструктуру (например, auth provider с email/password и transactional email service). После этого требуется отдельный согласованный change-set с проверкой provider contract и credentials; до этого нельзя добавлять локальные password fields или имитировать отправку писем.

## Проверки

| Проверка | Результат |
|---|---|
| Focused auth regressions | **PASS:** 4 files, 11 tests: root guest/verified/reset, direct private route, canonical `?welcome=1`, provider CTA/disclosures, server guest boundary. |
| Full `pnpm test` | **NOT PASS:** 53 files passed, 1 failed, 1 skipped; 256 tests passed, 1 failed, 4 skipped. Единственный fail — внешний Tavily `POST /search` вернул HTTP 403 в `optional-providers.secret.test.ts`; это credential/provider-health assertion, не auth regression. |
| Deterministic suite | **PASS:** `pnpm vitest run --exclude=server/optional-providers.secret.test.ts` — 53 files passed, 1 skipped; 256 tests passed, 4 skipped. |
| `pnpm check` | **PASS:** TypeScript без ошибок. |
| `git diff --check` | **PASS:** whitespace errors отсутствуют. |
| Dev root availability | **PASS:** `GET http://127.0.0.1:3000/` вернул HTTP 200. |
| Desktop guest visual check | **PASS:** root показал только data-free Welcome с provider CTA; OAuth не запускался. |
| Mobile guest visual check | **NOT VERIFIED:** mobile browser context уже имел verified session и показал generic private empty-chat shell. Никаких действий, данных, истории, памяти, профиля, вложений или exports не открывали. Это не является guest acceptance. |

## Ограничения приёмки

Реальный OAuth login/callback acceptance не запускался, cookies не очищались, и пользовательский контент не открывался. Production build также намеренно не запускался: ранее зафиксированный sandbox SIGTERM blocker остаётся открытым по явному требованию пользователя. Ни OAuth identity mapping, ни owner mapping, ни четыре public roles, ни provider chains, ни storage lifecycle, ни schema, ни секреты в этом auth-этапе не менялись.

## References

[1]: ../../client/src/App.tsx "Root и direct private route guard"
[2]: ../../client/src/pages/Welcome.tsx "First-launch auth screen и disclosures"
[3]: ../../client/src/const.ts "Event-time OAuth login entry"
[4]: ../../server/_core/trpc.ts "Protected procedure и server-derived context"
[5]: ../../server/_core/oauth.ts "OAuth callback и nonce validation"
[6]: ../../client/src/App.auth-gate.test.tsx "Root/direct-route auth regressions"
[7]: ../../server/auth.first-launch-boundary.test.ts "Guest protected-boundary regression"

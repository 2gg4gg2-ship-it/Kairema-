# Kairema — безопасный phone-only путь входа

**Дата:** 2026-08-25 UTC  
**Статус:** code-level и data-free guest-screen проверка завершены; полный OAuth browser acceptance остаётся **NOT VERIFIED BY PLATFORM SESSION**.

## Что проверено

| Проверка | Статус | Основание |
|---|---|---|
| Гостевой entry point | **PASS** | На data-free mobile welcome-экране `/?welcome=1` есть одна кнопка **«Войти для истории»**. |
| Старт OAuth | **PASS (code-level)** | Обработчик кнопки вызывается только по нажатию, создаёт одноразовый nonce, сохраняет host-only state cookie и формирует callback как `${window.location.origin}/api/oauth/callback`. |
| Защита callback | **PASS (code-level)** | Callback сверяет nonce с cookie до обмена кода, очищает nonce-cookie и после успешного входа возвращает на проверенный корень приложения. |
| Focused OAuth/UI regressions | **PASS:** 3 test files, 38 tests. | Проверены callback guard, guest-route и login triggers; реальный OAuth redirect не запускался. |
| Реальный вход в managed browser | **NOT VERIFIED BY PLATFORM SESSION** | Его не запускали: ранее управляемая сессия страдала от PWA handoff/blank page/guest-shell состояния. |

## Один воспроизводимый путь на телефоне

Откройте **актуальный публичный адрес Kairema** в обычной вкладке браузера телефона, а не в приватном режиме и не во встроенном PWA/WebView. На гостевом welcome-экране нажмите **«Войти для истории» ровно один раз**. Не копируйте callback URL вручную и не открывайте вход в новой вкладке: кнопка сама создаёт одноразовую проверку состояния для текущего origin.

Завершите вход в том же окне. Успешный callback должен вернуть браузер на корень Kairema в этой же вкладке. Не очищайте cookies, не включайте «блокировать все cookies» и не используйте Safari Private Browsing, Firefox Strict или агрессивный Brave Shields: эти режимы могут блокировать обязательную cookie-проверку OAuth.

> Если после подтверждения входа появляется белый экран, PWA handoff или снова гостевой экран, **остановитесь**. Не повторяйте вход и не очищайте cookies. Это следует зафиксировать как platform/session blocker, а не компенсировать изменением callback или ослаблением nonce guard.

## Границы

Этот сценарий не просит пароль, код, cookie или OAuth URL в чате. Он не открывает историю, память, профиль, вложения, owner-разделы и не меняет OAuth, owner mapping, provider chains или пользовательские данные.

## Внутренние основания

| № | Проверенный компонент |
|---|---|
| 1 | `client/src/const.ts`: click-time nonce, `window.location.origin` и `/api/oauth/callback`. |
| 2 | `server/_core/oauth.ts`: nonce comparison, fail-closed callback и redirect на trusted app root. |
| 3 | `client/src/pages/Welcome.tsx` и data-free mobile welcome screenshot: guest login entry. |

import { ArrowRight, Check, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { startLogin } from "@/const";

export default function Welcome() {
  const [securityNoteOpen, setSecurityNoteOpen] = useState(false);
  const [legalNote, setLegalNote] = useState<"terms" | "privacy" | null>(null);

  return (
    <main className="kairema-auth-gate" aria-labelledby="auth-gate-title">
      <div className="kairema-auth-gate__background" aria-hidden="true" />
      <section className="kairema-auth-gate__shell">
        <div className="kairema-auth-gate__panel">
          <div className="kairema-auth-gate__brand" aria-label="Kairema">
            <span className="kairema-auth-gate__brand-mark"><Sparkles className="size-[18px]" aria-hidden="true" /></span>
            <span>Kairema</span>
          </div>

          <div className="kairema-auth-gate__copy">
            <p className="kairema-auth-gate__eyebrow">ПРИВАТНОЕ РАБОЧЕЕ ПРОСТРАНСТВО</p>
            <h1 id="auth-gate-title">Добро пожаловать</h1>
            <p>Ваши чаты, память и настройки защищены. Войдите, чтобы продолжить.</p>
          </div>

          <div className="kairema-auth-gate__trust" aria-label="Преимущества защищённого входа">
            <span><Check className="size-4" aria-hidden="true" /> Только ваша история</span>
            <span><Check className="size-4" aria-hidden="true" /> Защищённый вход</span>
          </div>

          <div className="kairema-auth-gate__actions">
            <button type="button" className="kairema-auth-gate__google" onClick={startLogin}>
              <span className="kairema-auth-gate__google-g" aria-hidden="true">G</span>
              <span>Продолжить с Google</span>
              <ArrowRight className="ml-auto size-4" aria-hidden="true" />
            </button>

            <div className="kairema-auth-gate__divider" aria-hidden="true"><span />или<span /></div>

            <button type="button" className="kairema-auth-gate__secure" onClick={startLogin}>
              <Mail className="size-4" aria-hidden="true" />
              <span>Войти через защищённый аккаунт</span>
            </button>
          </div>

          <button
            type="button"
            className="kairema-auth-gate__security-link"
            aria-expanded={securityNoteOpen}
            onClick={() => setSecurityNoteOpen((open) => !open)}
          >
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            <span>Почему здесь нет пароля?</span>
          </button>

          {securityNoteOpen && (
            <div className="kairema-auth-gate__security-note" role="status">
              Kairema не хранит локальные пароли. Вход и восстановление учётной записи выполняются защищённым провайдером аккаунта.
            </div>
          )}

          <div className="kairema-auth-gate__legal">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            <span>
              Продолжая, вы принимаете{" "}
              <button type="button" onClick={() => setLegalNote("terms")}>Условия использования</button>
              {" "}и{" "}
              <button type="button" onClick={() => setLegalNote("privacy")}>Политику конфиденциальности</button>.
            </span>
          </div>

          {legalNote && (
            <section className="kairema-auth-gate__legal-note" aria-live="polite" aria-label={legalNote === "terms" ? "Условия использования" : "Политика конфиденциальности"}>
              <div>
                <strong>{legalNote === "terms" ? "Условия использования" : "Политика конфиденциальности"}</strong>
                <p>
                  {legalNote === "terms"
                    ? "Вход открывает личное рабочее пространство Kairema. Доступ к данным предоставляется только после проверки сессии, а действия выполняются от имени текущего пользователя."
                    : "Kairema разделяет чаты, память, настройки, вложения и экспорты по server-derived identity. Локальные пароли приложением не собираются и не хранятся."}
                </p>
              </div>
              <button type="button" className="kairema-auth-gate__legal-close" onClick={() => setLegalNote(null)}>Закрыть</button>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

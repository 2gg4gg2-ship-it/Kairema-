import { ArrowLeft, ArrowRight, Check, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";

type EmailAuthView = "start" | "login" | "register" | "verify" | "recovery" | "reset";

function initialAuthView(): EmailAuthView {
  if (typeof window === "undefined") return "start";
  return new URLSearchParams(window.location.search).get("reset") === "1" ? "reset" : "start";
}

export default function Welcome() {
  const [securityNoteOpen, setSecurityNoteOpen] = useState(false);
  const [legalNote, setLegalNote] = useState<"terms" | "privacy" | null>(null);
  const [emailView, setEmailView] = useState<EmailAuthView>(initialAuthView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [notice, setNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    const auth = new URLSearchParams(window.location.search).get("auth");
    return auth === "failed" ? "Не удалось завершить ссылку входа. Запросите новую и попробуйте снова." : "";
  });

  const registerMutation = trpc.auth.stytch.register.useMutation();
  const loginMutation = trpc.auth.stytch.login.useMutation();
  const resendMutation = trpc.auth.stytch.resendVerification.useMutation();
  const resetStartMutation = trpc.auth.stytch.requestPasswordReset.useMutation();
  const resetCompleteMutation = trpc.auth.stytch.completePasswordReset.useMutation();
  const pending = registerMutation.isPending || loginMutation.isPending || resendMutation.isPending || resetStartMutation.isPending || resetCompleteMutation.isPending;

  const showStart = () => {
    setEmailView("start");
    setPassword("");
    setPasswordConfirm("");
    setNotice("");
  };

  const submitRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== passwordConfirm) {
      setNotice("Пароли не совпадают. Повторите ввод.");
      return;
    }
    try {
      await registerMutation.mutateAsync({ email, password });
      setPassword("");
      setPasswordConfirm("");
      setEmailView("verify");
      setNotice("Мы отправили ссылку для подтверждения email. Откройте её в этом же браузере.");
    } catch (error) {
      const trpcError = error as { data?: { code?: string }; message?: string };
      if (trpcError?.data?.code === "CONFLICT") {
        setNotice("Этот email уже зарегистрирован. Войдите в аккаунт или воспользуйтесь восстановлением пароля.");
      } else {
        setNotice("Не удалось создать защищённый аккаунт. Проверьте данные или повторите позже.");
      }
    }
  };

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await loginMutation.mutateAsync({ email, password });
      setPassword("");
      if (result.state === "SIGNED_IN") {
        window.location.assign("/");
        return;
      }
      setEmailView("verify");
      setNotice("Сначала подтвердите email по ссылке из письма. При необходимости запросите новую ссылку.");
    } catch {
      setNotice("Не удалось подтвердить email или пароль. Попробуйте снова либо восстановите пароль.");
    }
  };

  const resendVerification = async () => {
    try {
      await resendMutation.mutateAsync({ email });
      setNotice("Если этот адрес доступен для подтверждения, новая ссылка отправлена.");
    } catch {
      setNotice("Отправка ссылки временно недоступна. Повторите попытку позже.");
    }
  };

  const submitRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await resetStartMutation.mutateAsync({ email });
      setNotice("Если этот адрес доступен для восстановления, ссылка отправлена. Откройте её в этом же браузере.");
    } catch {
      setNotice("Восстановление пароля временно недоступно. Повторите попытку позже.");
    }
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== passwordConfirm) {
      setNotice("Пароли не совпадают. Повторите ввод.");
      return;
    }
    try {
      await resetCompleteMutation.mutateAsync({ password });
      setPassword("");
      setPasswordConfirm("");
      window.location.assign("/");
    } catch {
      setNotice("Ссылка для восстановления истекла или пароль не принят. Запросите новую ссылку.");
    }
  };

  const emailForm = (() => {
    if (emailView === "start") return null;
    if (emailView === "verify") {
      return <section className="kairema-auth-gate__email" aria-labelledby="email-verify-title">
        <div className="kairema-auth-gate__email-heading"><Mail className="size-4" aria-hidden="true" /><h2 id="email-verify-title">Подтвердите email</h2></div>
        <p>Ссылка подтверждается защищённым провайдером. Kairema не создаёт и не хранит токены подтверждения.</p>
        <button type="button" className="kairema-auth-gate__google" disabled={pending || !email} onClick={() => void resendVerification()}>Отправить ссылку повторно</button>
        <button type="button" className="kairema-auth-gate__text-button" onClick={showStart}>Вернуться к выбору входа</button>
      </section>;
    }
    if (emailView === "recovery") {
      return <form className="kairema-auth-gate__email" onSubmit={submitRecovery} aria-labelledby="email-recovery-title">
        <div className="kairema-auth-gate__email-heading"><KeyRound className="size-4" aria-hidden="true" /><h2 id="email-recovery-title">Восстановление пароля</h2></div>
        <p>Введите email. Если адрес доступен для восстановления, провайдер отправит защищённую ссылку.</p>
        <label>Email<input aria-label="Email для восстановления" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
        <button type="submit" className="kairema-auth-gate__google" disabled={pending}>Отправить ссылку</button>
        <button type="button" className="kairema-auth-gate__text-button" onClick={() => setEmailView("login")}>Вернуться ко входу</button>
      </form>;
    }
    if (emailView === "reset") {
      return <form className="kairema-auth-gate__email" onSubmit={submitReset} aria-labelledby="email-reset-title">
        <div className="kairema-auth-gate__email-heading"><KeyRound className="size-4" aria-hidden="true" /><h2 id="email-reset-title">Новый пароль</h2></div>
        <p>Новая комбинация отправляется только защищённому провайдеру. Ссылка действует ограниченное время.</p>
        <label>Новый пароль<input aria-label="Новый пароль" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>
        <label>Повторите пароль<input aria-label="Повторите новый пароль" type="password" autoComplete="new-password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} minLength={8} required /></label>
        <button type="submit" className="kairema-auth-gate__google" disabled={pending}>Сохранить пароль</button>
      </form>;
    }
    const isRegister = emailView === "register";
    return <form className="kairema-auth-gate__email" onSubmit={isRegister ? submitRegister : submitLogin} aria-labelledby="email-auth-title">
      <div className="kairema-auth-gate__email-heading"><Mail className="size-4" aria-hidden="true" /><h2 id="email-auth-title">{isRegister ? "Создать аккаунт" : "Войти по email"}</h2></div>
      <label>Email<input aria-label="Email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
      <label>Пароль<input aria-label="Пароль" type="password" autoComplete={isRegister ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>
      {isRegister && <label>Повторите пароль<input aria-label="Повторите пароль" type="password" autoComplete="new-password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} minLength={8} required /></label>}
      <button type="submit" className="kairema-auth-gate__google" disabled={pending}>{isRegister ? "Создать и подтвердить email" : "Войти"}</button>
      {isRegister ? <button type="button" className="kairema-auth-gate__text-button" onClick={() => setEmailView("login")}>Уже есть аккаунт? Войти</button> : <><button type="button" className="kairema-auth-gate__text-button" onClick={() => setEmailView("recovery")}>Забыли пароль?</button><button type="button" className="kairema-auth-gate__text-button" onClick={() => setEmailView("register")}>Создать аккаунт</button></>}
      <button type="button" className="kairema-auth-gate__text-button" onClick={showStart}><ArrowLeft className="size-3" aria-hidden="true" /> Другой способ входа</button>
    </form>;
  })();

  return (
    <main className="kairema-auth-gate" aria-labelledby="auth-gate-title">
      <div className="kairema-auth-gate__background" aria-hidden="true" />
      <section className="kairema-auth-gate__shell"><div className="kairema-auth-gate__panel">
        <div className="kairema-auth-gate__brand" aria-label="Kairema"><span className="kairema-auth-gate__brand-mark"><Sparkles className="size-[18px]" aria-hidden="true" /></span><span>Kairema</span></div>
        <div className="kairema-auth-gate__copy"><p className="kairema-auth-gate__eyebrow">ПРИВАТНОЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><h1 id="auth-gate-title">Добро пожаловать</h1><p>Ваши чаты, память и настройки защищены. Войдите, чтобы продолжить.</p></div>
        <div className="kairema-auth-gate__trust" aria-label="Преимущества защищённого входа"><span><Check className="size-4" aria-hidden="true" /> Только ваша история</span><span><Check className="size-4" aria-hidden="true" /> Защищённый вход</span></div>
        {emailView === "start" ? <div className="kairema-auth-gate__actions">
          <button type="button" className="kairema-auth-gate__google" onClick={startLogin}><span className="kairema-auth-gate__google-g" aria-hidden="true">G</span><span>Продолжить с Google</span><ArrowRight className="ml-auto size-4" aria-hidden="true" /></button>
          <div className="kairema-auth-gate__divider" aria-hidden="true"><span />или<span /></div>
          <button type="button" className="kairema-auth-gate__secure" onClick={() => { setEmailView("login"); setNotice(""); }}><Mail className="size-4" aria-hidden="true" /><span>Войти по email и паролю</span></button>
        </div> : emailForm}
        {notice && <p className="kairema-auth-gate__notice" role="status">{notice}</p>}
        <button type="button" className="kairema-auth-gate__security-link" aria-expanded={securityNoteOpen} onClick={() => setSecurityNoteOpen(open => !open)}><LockKeyhole className="size-3.5" aria-hidden="true" /><span>Как защищён email-вход?</span></button>
        {securityNoteOpen && <div className="kairema-auth-gate__security-note" role="status">Пароли, сессии, подтверждения и восстановление управляются Stytch. Kairema не хранит локальные password hashes, JWT или reset-токены.</div>}
        <div className="kairema-auth-gate__legal"><ShieldCheck className="size-3.5" aria-hidden="true" /><span>Продолжая, вы принимаете <button type="button" onClick={() => setLegalNote("terms")}>Условия использования</button> и <button type="button" onClick={() => setLegalNote("privacy")}>Политику конфиденциальности</button>.</span></div>
        {legalNote && <section className="kairema-auth-gate__legal-note" aria-live="polite" aria-label={legalNote === "terms" ? "Условия использования" : "Политика конфиденциальности"}><div><strong>{legalNote === "terms" ? "Условия использования" : "Политика конфиденциальности"}</strong><p>{legalNote === "terms" ? "Вход открывает личное рабочее пространство Kairema. Доступ к данным предоставляется только после проверки сессии, а действия выполняются от имени текущего пользователя." : "Kairema разделяет чаты, память, настройки, вложения и экспорты по server-derived identity. Email account не связывается с Google/Manus автоматически."}</p></div><button type="button" className="kairema-auth-gate__legal-close" onClick={() => setLegalNote(null)}>Закрыть</button></section>}
      </div></section>
    </main>
  );
}

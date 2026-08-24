import { startLogin } from "@/const";
import { ArrowRight, LogIn, ShieldCheck, Sparkles } from "lucide-react";

export default function Welcome() {
  return <main className="kairema-welcome" aria-labelledby="welcome-title">
    <div className="kairema-welcome-grid" aria-hidden="true" />
    <section className="kairema-welcome-card">
      <div className="kairema-welcome-brand"><Sparkles className="size-5" aria-hidden="true" /><span>Kairema</span></div>
      <div className="kairema-welcome-mark" aria-hidden="true"><LogIn className="size-7" /></div>
      <p className="kairema-welcome-eyebrow">Личный AI-ассистент</p>
      <h1 id="welcome-title">Войдите, чтобы начать</h1>
      <p className="kairema-welcome-copy">История, память и вложения доступны только после безопасного входа в этом же окне.</p>
      <button type="button" className="kairema-welcome-login" onClick={() => startLogin()}>
        <LogIn className="size-5" aria-hidden="true" />
        <span>Войти для истории</span>
        <ArrowRight className="ml-auto size-5" aria-hidden="true" />
      </button>
      <p className="kairema-welcome-note"><ShieldCheck className="size-4" aria-hidden="true" /> После входа вы вернётесь в Kairema автоматически.</p>
    </section>
  </main>;
}

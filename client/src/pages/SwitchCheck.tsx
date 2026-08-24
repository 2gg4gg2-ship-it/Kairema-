import { Switch } from "@/components/ui/switch";
import { useState } from "react";

export default function SwitchCheck() {
  const [checked, setChecked] = useState(false);

  return (
    <main className="min-h-screen bg-[#0a0a0c] px-4 py-12 text-white">
      <section className="mx-auto max-w-md rounded-2xl border border-white/10 bg-[#121217] p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Локальная проверка</p>
        <h1 className="mt-2 text-2xl font-semibold">Switch без пользовательских данных</h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          Этот изолированный dev-only экран не загружает историю, память, профиль, вложения или настройки аккаунта.
        </p>

        <div className="mt-8 space-y-5" aria-label="Проверочные переключатели">
          <label className="flex min-h-11 items-center justify-between gap-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span>
              <b className="block text-sm">Проверочное состояние</b>
              <small className="mt-1 block text-xs text-white/55">Нажмите для проверки движения thumb и возврата состояния.</small>
            </span>
            <Switch className="kairema-switch-control" aria-label="Проверочное состояние" checked={checked} onCheckedChange={setChecked} />
          </label>

          <label className="flex min-h-11 items-center justify-between gap-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span>
              <b className="block text-sm">Исходное включённое состояние</b>
              <small className="mt-1 block text-xs text-white/55">Отдельный контроль для визуального сравнения двух положений.</small>
            </span>
            <Switch className="kairema-switch-control" aria-label="Исходное включённое состояние" defaultChecked />
          </label>
        </div>

        <p aria-live="polite" className="mt-6 text-sm text-violet-200">
          {checked ? "Проверочное состояние включено." : "Проверочное состояние выключено."}
        </p>
        <p className="mt-4 text-xs leading-5 text-white/45">
          Reduced-motion fallback проверяется отдельной CSS regression; здесь не изменяется системная настройка motion.
        </p>
      </section>
    </main>
  );
}

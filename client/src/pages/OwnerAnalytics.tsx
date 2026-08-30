import { useMemo, useState } from "react";
import { Activity, ArrowLeft, Download, Gauge, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useLocation } from "wouter";
import { downloadPreparedChatExport } from "@/lib/chat-export";
import { trpc } from "@/lib/trpc";

type DailyPoint = { date: string; requests: number; success: number; failures_by_layer: { layer_1: number; layer_2: number; layer_3: number }; p50: number; p95: number };
type HourlyPoint = { hour: string; layer1: number; layer2: number; layer3: number };
type ControlInput = { targetKey: string; targetType: "provider" | "model"; disabled: boolean; preference: "normal" | "prefer" | "avoid" };

function escapeCsv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function localExport(fileName: string, contentType: string, content: string) {
  downloadPreparedChatExport({ fileName, contentType, blob: new Blob([content], { type: contentType }) });
}

function formatWhen(value: Date | string | null | undefined) {
  if (!value) return "нет данных";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "нет данных" : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export default function OwnerAnalytics() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [targetType, setTargetType] = useState<ControlInput["targetType"]>("provider");
  const [targetKey, setTargetKey] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [preference, setPreference] = useState<ControlInput["preference"]>("normal");
  const [stagingEmailTo, setStagingEmailTo] = useState("");
  const [stagingEmailSubject, setStagingEmailSubject] = useState("Kairema Staging — Resend email delivery test");
  const [stagingEmailHtml, setStagingEmailHtml] = useState("<p>Kairema Staging — Resend email delivery test</p>");
  const [stagingEmailResult, setStagingEmailResult] = useState<{ success: boolean; id?: string } | null>(null);
  const [stagingEmailError, setStagingEmailError] = useState<string | null>(null);
  const sendTestEmailMutation = trpc.owner.sendTestEmail.useMutation();
  const ownerQuery = trpc.owner.isOwner.useQuery(undefined, { staleTime: 300_000 });
  const enabled = ownerQuery.data === true;
  const claimDiagnostic = trpc.owner.claimDiagnostic.useQuery(undefined, { enabled: ownerQuery.isSuccess && !enabled, staleTime: 300_000 });
  const chartQuery = trpc.search.qualityChart.useQuery(undefined, { enabled, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const observabilityQuery = trpc.owner.observability.useQuery(undefined, { enabled, refetchInterval: 30_000, refetchOnWindowFocus: true });
  const controlsQuery = trpc.owner.providerControls.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const targetsQuery = trpc.owner.providerControlTargets.useQuery(undefined, { enabled, staleTime: 300_000 });
  const updateControl = trpc.owner.updateProviderControl.useMutation();
  const capacitySnapshotQuery = trpc.owner.capacitySnapshot.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const capacityPolicyQuery = trpc.owner.capacityPolicy.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const updateCapacity = trpc.owner.updateCapacityPolicy.useMutation();
  const capacityProviderBudgetsQuery = trpc.owner.capacityProviderBudgets.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const updateCapacityProviderBudgetMutation = trpc.owner.updateCapacityProviderBudget.useMutation();
  const daily: DailyPoint[] = chartQuery.data?.daily ?? [];
  const hourly: HourlyPoint[] = chartQuery.data?.hourlyLayers ?? [];
  const maxSuccess = Math.max(1, ...daily.map((point) => point.success));
  const maxLayer = Math.max(1, ...hourly.map((point) => point.layer1 + point.layer2 + point.layer3));
  const selectedTargets = targetType === "provider" ? targetsQuery.data?.providers ?? [] : targetsQuery.data?.models ?? [];
  const readiness = useMemo(() => ({
    total: observabilityQuery.data?.providers.length ?? 0,
    ready: observabilityQuery.data?.providers.filter((provider) => provider.state === "ready").length ?? 0,
  }), [observabilityQuery.data]);
  const runtime = observabilityQuery.data?.runtime;

  const exportAggregate = (kind: "json" | "csv") => {
    const aggregate = { generatedAt: new Date().toISOString(), scope: "anonymous-search-quality-aggregates-only", daily, hourly_failures_by_layer: hourly };
    if (kind === "json") { localExport("kairema-search-quality-aggregate.json", "application/json;charset=utf-8", JSON.stringify(aggregate, null, 2)); return; }
    const dailyCsv = ["date,requests,success,failures_by_layer,p50,p95", ...daily.map((point) => [point.date, point.requests, point.success, JSON.stringify(point.failures_by_layer), point.p50, point.p95].map(escapeCsv).join(","))];
    localExport("kairema-search-quality-aggregate.csv", "text/csv;charset=utf-8", `${dailyCsv.join("\n")}\n`);
  };

  const applyControl = async (input: ControlInput) => {
    const action = input.disabled ? "отключить" : input.preference === "normal" ? "сбросить настройку для" : "изменить порядок для";
    if (!window.confirm(`Подтвердите: ${action} ${input.targetType} «${input.targetKey}». Это только fail-safe routing control и не меняет ключи или базовую allowlist.`)) return;
    await updateControl.mutateAsync(input);
    await Promise.all([utils.owner.providerControls.invalidate(), utils.owner.observability.invalidate()]);
    setTargetKey("");
    setDisabled(false);
    setPreference("normal");
  };
  const applyCapacityPolicy = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const positive = (name: string, fallback: number) => {
      const parsed = Number(fields.get(name));
      return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    };
    const nullablePositive = (name: string) => {
      const raw = String(fields.get(name) ?? "").trim();
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    await updateCapacity.mutateAsync({
      enabled: fields.get("capacityEnabled") === "on",
      globalGenerationWcuLimit: nullablePositive("globalGenerationWcuLimit"),
      globalSearchWcuLimit: nullablePositive("globalSearchWcuLimit"),
      perUserGenerationWcuLimit: positive("perUserGenerationWcuLimit", 12),
      perUserSearchWcuLimit: positive("perUserSearchWcuLimit", 6),
      perUserGenerationConcurrency: positive("perUserGenerationConcurrency", 2),
      perUserSearchConcurrency: positive("perUserSearchConcurrency", 1),
      queueMaxWaitMs: Math.max(0, Math.min(1_500, Number(fields.get("queueMaxWaitMs")) || 0)),
      queueMaxDepth: Math.max(0, Math.min(64, Number(fields.get("queueMaxDepth")) || 0)),
    });
    await Promise.all([utils.owner.capacitySnapshot.invalidate(), utils.owner.capacityPolicy.invalidate(), utils.owner.observability.invalidate()]);
  };
  const applyCapacityProviderBudget = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const target = JSON.parse(String(fields.get("budgetTarget") ?? "{}")) as { provider?: string; modelId?: string | null };
    if (!target.provider) return;
    const nullablePositive = (name: string) => {
      const raw = String(fields.get(name) ?? "").trim();
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    };
    const selectedRoles = (["fast", "smart", "context", "flagship"] as const).filter((role) => fields.get(`role-${role}`) === "on");
    await updateCapacityProviderBudgetMutation.mutateAsync({
      provider: target.provider as "openrouter" | "orcarouter" | "google" | "groq",
      modelId: target.modelId ?? null,
      enabled: fields.get("budgetEnabled") === "on",
      generationWcuLimit: nullablePositive("budgetGenerationWcuLimit"),
      maxConcurrent: nullablePositive("budgetMaxConcurrent"),
      rpmLimit: nullablePositive("budgetRpmLimit"),
      tpmLimit: nullablePositive("budgetTpmLimit"),
      dailyUnitsLimit: nullablePositive("budgetDailyUnitsLimit"),
      dailyRequestLimit: nullablePositive("budgetDailyRequestLimit"),
      dailyTokenLimit: nullablePositive("budgetDailyTokenLimit"),
      resetWindow: String(fields.get("budgetResetWindow") ?? "").trim() || null,
      cooldownState: String(fields.get("budgetCooldownState") ?? "inherit_provider_health") as "unknown" | "inherit_provider_health" | "cooldown",
      roleEligibility: selectedRoles.length ? selectedRoles : null,
      searchEligibility: String(fields.get("budgetSearchEligibility") ?? "unknown") as "unknown" | "eligible" | "not_eligible",
      eligibilityState: String(fields.get("budgetEligibilityState") ?? "unknown") as "unknown" | "eligible" | "not_eligible" | "paid_required",
      billingState: String(fields.get("budgetBillingState") ?? "unknown") as "unknown" | "free" | "paid" | "not_configured",
      billingSafe: fields.get("budgetBillingSafe") === "on",
      quotaState: String(fields.get("budgetQuotaState") ?? "unknown") as "unknown" | "operator_configured",
    });
    await Promise.all([utils.owner.capacityProviderBudgets.invalidate(), utils.owner.capacitySnapshot.invalidate(), utils.owner.observability.invalidate()]);
  };

  if (ownerQuery.isLoading) return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><p className="mx-auto max-w-5xl text-sm text-slate-400">Загрузка аналитики владельца…</p></main>;
  if (!enabled) return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><section className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6"><ShieldAlert className="mb-3 size-6 text-amber-300" /><h1 className="text-xl font-semibold">Аналитика недоступна</h1><p className="mt-2 text-sm text-slate-400">Эта страница доступна только владельцу проекта.</p>{claimDiagnostic.data && <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300" aria-label="Безопасная диагностика owner claim"><p>Сравниваемый claim: <b>{claimDiagnostic.data.comparedClaim}</b></p><p>Owner mapping: <b>{claimDiagnostic.data.configured ? "настроен" : "не настроен"}</b></p><p className="mt-2 break-all text-slate-400">Ожидаемый fingerprint: {claimDiagnostic.data.expectedFingerprint}</p><p className="break-all text-slate-400">Fingerprint текущей сессии: {claimDiagnostic.data.sessionFingerprint}</p><p className="mt-2 text-amber-200">Совпадение: {claimDiagnostic.data.matches ? "да" : "нет"}. Реальные идентификаторы не отображаются.</p></div>}<button className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => navigate("/")}><ArrowLeft className="size-4" />К чату</button></section></main>;

  return <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:px-6"><div className="mx-auto max-w-6xl">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><button className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800" onClick={() => navigate("/")}><ArrowLeft className="size-4" />К чату</button><p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-300">Владелец · техническая панель</p><h1 className="mt-1 text-2xl font-semibold">Наблюдаемость Kairema</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Только bounded технические метаданные и агрегаты. Тексты, URL, вложения, идентификаторы пользователей, ключи и содержимое памяти не выводятся.</p></div><div className="flex gap-2"><button className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800" onClick={() => exportAggregate("csv")}><Download className="size-4" />CSV</button><button className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400" onClick={() => exportAggregate("json")}><Download className="size-4" />JSON</button></div></header>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Сводка состояния"><Metric icon={<Activity />} title="Provider health" value={`${readiness.ready}/${readiness.total}`} detail="готовы сейчас" /><Metric icon={<Gauge />} title="Живой поиск" value={String(observabilityQuery.data?.search.samples24h ?? 0)} detail={`samples / 24ч · outages: ${observabilityQuery.data?.search.outages24h ?? 0}`} /><Metric icon={<Activity />} title="Память" value={String((observabilityQuery.data?.memory.facts ?? 0) + (observabilityQuery.data?.memory.topics ?? 0))} detail={`facts: ${observabilityQuery.data?.memory.facts ?? 0} · topics: ${observabilityQuery.data?.memory.topics ?? 0}`} /><Metric icon={<SlidersHorizontal />} title="Controls" value={String(controlsQuery.data?.filter((control) => Boolean(control.disabled)).length ?? 0)} detail="manual disabled" /></section>

    <section className="mt-4 rounded-2xl border border-cyan-950 bg-slate-900/80 p-4" aria-label="AI Capacity & Fairness Controller"><div className="flex items-start gap-3"><Gauge className="mt-0.5 size-5 text-cyan-300" /><div><h2 className="font-medium">AI Capacity & Fairness Controller</h2><p className="mt-1 text-xs text-slate-400">Owner-only policy. Только WCU, concurrency и aggregate state; фактические provider quotas остаются <b>UNKNOWN</b>, пока не подтверждены отдельно.</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs"><Metric icon={<Activity />} title="Global generation" value={capacitySnapshotQuery.data?.policy.globalCapacity ?? "—"} detail="не является claim production capacity" /><Metric icon={<Activity />} title="Global search" value={capacitySnapshotQuery.data?.policy.searchCapacity ?? "—"} detail="отдельный budget domain" /><Metric icon={<Gauge />} title="Local controller" value={`${capacitySnapshotQuery.data?.local.generation.active ?? 0}/${capacitySnapshotQuery.data?.local.generation.instanceLimit ?? 12}`} detail={capacitySnapshotQuery.data?.local.scope ?? "single process only"} /><Metric icon={<ShieldAlert />} title="Queue" value={capacitySnapshotQuery.data?.policy.queueScope ?? "—"} detail="default: immediate admission/rejection" /></div><form key={JSON.stringify(capacityPolicyQuery.data ?? {})} onSubmit={(event) => void applyCapacityPolicy(event)} className="mt-4 grid gap-3 rounded-xl bg-slate-950/70 p-3 sm:grid-cols-2 lg:grid-cols-4"><label className="flex items-center gap-2 self-end text-xs text-slate-300"><input name="capacityEnabled" type="checkbox" defaultChecked={capacityPolicyQuery.data?.enabled ?? true} />Включить controller</label><label className="text-xs text-slate-400">Global generation WCU<input name="globalGenerationWcuLimit" type="number" min="1" max="100000" defaultValue={capacityPolicyQuery.data?.globalGenerationWcuLimit ?? ""} placeholder="UNKNOWN / unset" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Per-user generation WCU<input name="perUserGenerationWcuLimit" type="number" min="1" max="100000" defaultValue={capacityPolicyQuery.data?.perUserGenerationWcuLimit ?? 12} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Per-user concurrent generation<input name="perUserGenerationConcurrency" type="number" min="1" max="12" defaultValue={capacityPolicyQuery.data?.perUserGenerationConcurrency ?? 2} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Global search WCU<input name="globalSearchWcuLimit" type="number" min="1" max="100000" defaultValue={capacityPolicyQuery.data?.globalSearchWcuLimit ?? ""} placeholder="UNKNOWN / unset" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Per-user search WCU<input name="perUserSearchWcuLimit" type="number" min="1" max="100000" defaultValue={capacityPolicyQuery.data?.perUserSearchWcuLimit ?? 6} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Queue max wait (ms)<input name="queueMaxWaitMs" type="number" min="0" max="1500" defaultValue={capacityPolicyQuery.data?.queueMaxWaitMs ?? 0} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Queue max depth<input name="queueMaxDepth" type="number" min="0" max="64" defaultValue={capacityPolicyQuery.data?.queueMaxDepth ?? 0} className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-3"><button type="submit" disabled={updateCapacity.isPending} className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{updateCapacity.isPending ? "Сохранение…" : "Сохранить policy"}</button><p className="text-xs text-slate-400">Context/Apex reserve: {capacityPolicyQuery.data?.apexPressureReservePercent ?? 20}% · role/modifier weights are server-side validated.</p>{updateCapacity.error && <p role="alert" className="text-sm text-rose-300">Не удалось сохранить policy. Значения не применены.</p>}</div></form><p className="mt-3 text-xs text-slate-500">Adapters: {capacitySnapshotQuery.data?.adapters.map((adapter) => `${adapter.id} (${adapter.status})`).join(" · ") ?? "нет данных"}. Cloudflare Workers AI — feasibility-only; routing и billing не меняются.</p>

      <details className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-200">Provider / model budget metadata</summary><p className="mt-2 text-xs text-slate-400">Заполняйте только independently documented значения. Пустое поле означает <b>UNKNOWN / не configured</b>; RPM, TPM, daily units и WCU не пересчитываются друг в друга.</p><form onSubmit={(event) => void applyCapacityProviderBudget(event)} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs text-slate-400">Allowlisted target<select name="budgetTarget" required className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"><option value="">Выберите provider/model</option>{(targetsQuery.data?.providers ?? []).map((provider) => <option key={provider} value={JSON.stringify({ provider })}>{provider} · provider pool</option>)}{(targetsQuery.data?.models ?? []).map((entry) => { const separator = entry.indexOf(":"); const provider = entry.slice(0, separator); const modelId = entry.slice(separator + 1); return <option key={entry} value={JSON.stringify({ provider, modelId })}>{entry} · model pool</option>; })}</select></label><label className="flex items-center gap-2 self-end text-xs text-slate-300"><input name="budgetEnabled" type="checkbox" defaultChecked />Разрешить для controller</label><label className="flex items-center gap-2 self-end text-xs text-slate-300"><input name="budgetBillingSafe" type="checkbox" />Billing safety independently confirmed</label><label className="text-xs text-slate-400">Generation WCU cap<input name="budgetGenerationWcuLimit" type="number" min="1" max="100000" placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Max concurrent<input name="budgetMaxConcurrent" type="number" min="1" max="128" placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Documented RPM<input name="budgetRpmLimit" type="number" min="1" max="100000" placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Documented TPM<input name="budgetTpmLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Daily units<input name="budgetDailyUnitsLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Daily requests<input name="budgetDailyRequestLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Daily tokens<input name="budgetDailyTokenLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Reset window<input name="budgetResetWindow" type="text" maxLength={80} placeholder="UNKNOWN" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label><label className="text-xs text-slate-400">Eligibility<select name="budgetEligibilityState" defaultValue="unknown" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"><option value="unknown">UNKNOWN</option><option value="eligible">eligible</option><option value="not_eligible">not eligible</option><option value="paid_required">paid required</option></select></label><label className="text-xs text-slate-400">Billing state<select name="budgetBillingState" defaultValue="unknown" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"><option value="unknown">UNKNOWN</option><option value="free">free</option><option value="paid">paid</option><option value="not_configured">not configured</option></select></label><label className="text-xs text-slate-400">Search eligibility<select name="budgetSearchEligibility" defaultValue="unknown" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"><option value="unknown">UNKNOWN</option><option value="eligible">eligible</option><option value="not_eligible">not eligible</option></select></label><label className="text-xs text-slate-400">Cooldown<select name="budgetCooldownState" defaultValue="inherit_provider_health" className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100"><option value="inherit_provider_health">inherit Provider Health</option><option value="unknown">UNKNOWN</option><option value="cooldown">cooldown</option></select></label><fieldset className="sm:col-span-2 lg:col-span-4"><legend className="text-xs text-slate-400">Eligible public roles</legend><div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-300">{(["fast", "smart", "context", "flagship"] as const).map((role) => <label key={role} className="flex items-center gap-1.5"><input name={`role-${role}`} type="checkbox" />{role}</label>)}</div></fieldset><div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-3"><button type="submit" disabled={updateCapacityProviderBudgetMutation.isPending} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{updateCapacityProviderBudgetMutation.isPending ? "Сохранение…" : "Сохранить metadata"}</button>{updateCapacityProviderBudgetMutation.error && <p role="alert" className="text-sm text-rose-300">Не удалось сохранить provider/model metadata.</p>}</div></form><div className="mt-3 space-y-1 text-xs text-slate-500" aria-label="Configured provider budgets">{(capacityProviderBudgetsQuery.data ?? []).length === 0 ? <p>Configured provider/model budgets пока отсутствуют; это не означает нулевую доступную квоту.</p> : (capacityProviderBudgetsQuery.data ?? []).map((budget) => <p key={budget.scopeKey}>{budget.scopeKey}: WCU {budget.generationWcuLimit ?? "UNKNOWN"} · RPM {budget.rpmLimit ?? "UNKNOWN"} · daily units {budget.dailyUnitsLimit ?? "UNKNOWN"} · billing {budget.billingState}</p>)}</div></details></section>

    <section className="mt-4 grid gap-4 lg:grid-cols-2" aria-label="Локальные метрики SSE"><article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">SSE admission · local process</h2><p className="mt-1 text-xs text-slate-400">Снимок текущего process: не multi-pod метрика и не содержит идентификаторов или содержимого.</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><Metric icon={<Activity />} title="Active streams" value={`${runtime?.active.streams ?? 0}/${runtime?.limits.activePerInstance ?? 12}`} detail={`${runtime?.active.userBuckets ?? 0} active user buckets`} /><Metric icon={<ShieldAlert />} title="Controlled 503" value={String(runtime?.outcomes.capacityRejected ?? 0)} detail={`per-user: ${runtime?.outcomes.perUserCapacityRejected ?? 0}`} /><Metric icon={<Gauge />} title="Accepted" value={String(runtime?.outcomes.accepted ?? 0)} detail={`rate-limited: ${runtime?.outcomes.rateLimited ?? 0}`} /><Metric icon={<Activity />} title="Replay" value={String((runtime?.outcomes.replayCompleted ?? 0) + (runtime?.outcomes.replayPending ?? 0) + (runtime?.outcomes.replayStored ?? 0))} detail={`stored: ${runtime?.outcomes.replayStored ?? 0}`} /></div></article><article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Stream timing · bounded sample</h2><p className="mt-1 text-xs text-slate-400">Только local-process duration/start latency samples; тексты, токены и payload не собираются.</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><Metric icon={<Gauge />} title="Start p95" value={`${runtime?.samples.startLatencyMs.p95 ?? "—"} ms`} detail={`p99: ${runtime?.samples.startLatencyMs.p99 ?? "—"} ms`} /><Metric icon={<Gauge />} title="Active p95" value={`${runtime?.samples.activeDurationMs.p95 ?? "—"} ms`} detail={`p99: ${runtime?.samples.activeDurationMs.p99 ?? "—"} ms`} /><Metric icon={<Activity />} title="Completed" value={String(runtime?.outcomes.completed ?? 0)} detail={`cancelled: ${runtime?.outcomes.cancelled ?? 0}`} /><Metric icon={<ShieldAlert />} title="Queue" value="not used" detail={`entered: ${runtime?.queue.entered ?? 0} · timeout: ${runtime?.queue.timedOut ?? 0}`} /></div></article></section>

    <section className="mt-4 grid gap-4 lg:grid-cols-2"><article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Успешные результаты за 7 дней</h2><p className="mt-1 text-xs text-slate-400">Анонимные дневные агрегаты поиска.</p><svg viewBox="0 0 320 150" className="mt-4 h-40 w-full overflow-visible" role="img" aria-label="Успешные результаты за семь дней"><line x1="16" y1="120" x2="304" y2="120" stroke="currentColor" opacity=".25" /><polyline points={daily.map((point, index) => `${16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)},${120 - (point.success / maxSuccess) * 96}`).join(" ")} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />{daily.map((point, index) => <g key={point.date}><circle cx={16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)} cy={120 - (point.success / maxSuccess) * 96} r="3" fill="#6ee7b7" /><text x={16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)} y="142" textAnchor="middle" fill="currentColor" opacity=".65" fontSize="9">{point.date.slice(5)}</text></g>)}</svg></article>
      <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Отказы каскада за 24 часа</h2><p className="mt-1 text-xs text-slate-400">Анонимные порядковые слои; названия providers не раскрываются в этом графике.</p><div className="mt-7 flex h-32 items-end gap-px" role="img" aria-label="Отказы анонимных слоёв поиска за двадцать четыре часа">{hourly.map((point, index) => { const total = point.layer1 + point.layer2 + point.layer3; const height = Math.max(3, (total / maxLayer) * 124); return <span key={`${point.hour}-${index}`} className="flex min-w-0 flex-1 flex-col-reverse overflow-hidden rounded-sm bg-slate-800" style={{ height: `${height}px` }} title={`${point.hour}: ${total}`}><i className="bg-cyan-400" style={{ height: `${total ? (point.layer1 / total) * 100 : 0}%` }} /><i className="bg-violet-400" style={{ height: `${total ? (point.layer2 / total) * 100 : 0}%` }} /><i className="bg-amber-400" style={{ height: `${total ? (point.layer3 / total) * 100 : 0}%` }} /></span>; })}</div></article></section>

    <section className="mt-4 grid gap-4 lg:grid-cols-2"><article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Технические события</h2><p className="mt-1 text-xs text-slate-400">Последние 30 событий, retention 30 дней. Без prompt, response, URL, headers и secrets.</p><div className="mt-3 space-y-2">{observabilityQuery.data?.events.slice(0, 8).map((event) => <div key={event.id} className="rounded-xl bg-slate-950/70 px-3 py-2 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-200">{event.title}</span><span className="shrink-0 text-slate-500">{formatWhen(event.createdAt)}</span></div><p className="mt-1 text-slate-400">{event.kind}{event.roleId ? ` · ${event.roleId}` : ""}{event.code ? ` · ${event.code}` : ""}</p></div>)}{!observabilityQuery.data?.events.length && <p className="rounded-xl bg-slate-950/70 p-3 text-sm text-slate-400">Технических событий пока нет.</p>}</div></article>
      <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Health providers</h2><p className="mt-1 text-xs text-slate-400">Read-only status snapshots без ключей, endpoint details и raw errors.</p><div className="mt-3 space-y-2">{observabilityQuery.data?.providers.map((provider) => <div key={provider.provider} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/70 px-3 py-2 text-xs"><span className="min-w-0 truncate font-medium text-slate-200">{provider.provider}</span><span className="text-right text-slate-400">{provider.state} · {provider.category ?? "—"}<br />{formatWhen(provider.checkedAt)}</span></div>)}{!observabilityQuery.data?.providers.length && <p className="rounded-xl bg-slate-950/70 p-3 text-sm text-slate-400">Нет сохранённых health snapshots.</p>}</div></article></section>

    <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><div className="flex items-start gap-3"><SlidersHorizontal className="mt-0.5 size-5 text-amber-300" /><div><h2 className="font-medium">Fail-safe routing controls</h2><p className="mt-1 text-xs text-slate-400">Owner-only. Controls могут пропустить известный candidate до network call или изменить его порядок. Они не меняют ключи, allowlist, rate limits и maximum-attempt contract.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs text-slate-400">Тип<select className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" value={targetType} onChange={(event) => { setTargetType(event.target.value as ControlInput["targetType"]); setTargetKey(""); }}><option value="provider">Provider</option><option value="model">Model candidate</option></select></label><label className="text-xs text-slate-400">Разрешённая цель<select className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" value={targetKey} onChange={(event) => setTargetKey(event.target.value)}><option value="">Выберите…</option>{selectedTargets.map((target) => <option key={target} value={target}>{target}</option>)}</select></label><label className="text-xs text-slate-400">Порядок<select className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" value={preference} onChange={(event) => setPreference(event.target.value as ControlInput["preference"])}><option value="normal">Обычный</option><option value="prefer">Предпочесть</option><option value="avoid">Избегать</option></select></label><label className="flex items-end gap-3 pb-1 text-sm text-slate-300"><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />Отключить candidate</label></div><button disabled={!targetKey || updateControl.isPending} className="mt-4 rounded-lg bg-amber-300 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void applyControl({ targetKey, targetType, disabled, preference })}>{updateControl.isPending ? "Сохранение…" : "Подтвердить control"}</button>{updateControl.error && <p role="alert" className="mt-2 text-sm text-rose-300">Не удалось сохранить control. Повторите позже.</p>}<div className="mt-4 grid gap-2 sm:grid-cols-2">{controlsQuery.data?.map((control) => <div key={`${control.targetType}:${control.targetKey}`} className="rounded-xl bg-slate-950/70 p-3 text-xs"><p className="break-all font-medium text-slate-200">{control.targetType}: {control.targetKey}</p><p className="mt-1 text-slate-400">{control.disabled ? "disabled" : "enabled"} · {control.preference} · {formatWhen(control.updatedAt)}</p><button className="mt-2 rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800" onClick={() => void applyControl({ targetKey: control.targetKey, targetType: control.targetType, disabled: false, preference: "normal" })}>Сбросить</button></div>)}{!controlsQuery.data?.length && <p className="text-sm text-slate-400">Manual controls пока не заданы.</p>}</div></section>
    <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4" aria-label="Staging Resend email diagnostic">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 text-amber-300" />
        <div>
          <h2 className="font-medium">Resend email diagnostic (staging only)</h2>
          <p className="mt-1 text-xs text-slate-400">
            Temporary owner-only test control for staging Resend integration. Uses existing owner.sendTestEmail endpoint with 60s cooldown per recipient. Do not expose this in production documentation.
          </p>
        </div>
      </div>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={async (event) => {
        event.preventDefault();
        setStagingEmailResult(null);
        setStagingEmailError(null);
        try {
          const result = await sendTestEmailMutation.mutateAsync({ to: stagingEmailTo, subject: stagingEmailSubject, html: stagingEmailHtml });
          setStagingEmailResult(result);
        } catch (error) {
          setStagingEmailError(error instanceof Error ? error.message : "Unknown error");
        }
      }}>
        <label className="text-xs text-slate-400">Recipient email<input value={stagingEmailTo} onChange={(event) => setStagingEmailTo(event.target.value)} type="email" required className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label>
        <label className="text-xs text-slate-400">Subject<input value={stagingEmailSubject} onChange={(event) => setStagingEmailSubject(event.target.value)} required className="mt-1 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" /></label>
        <label className="text-xs text-slate-400">HTML body<textarea value={stagingEmailHtml} onChange={(event) => setStagingEmailHtml(event.target.value)} required rows={3} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100" /></label>
        <div className="sm:col-span-2 lg:col-span-3">
          <button disabled={sendTestEmailMutation.isPending} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">{sendTestEmailMutation.isPending ? "Sending…" : "Send test email"}</button>
        </div>
      </form>
      {stagingEmailResult && <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">Resend response: success = <b>{String(stagingEmailResult.success)}</b>{stagingEmailResult.id ? `, id = ${stagingEmailResult.id}` : ""}</div>}
      {stagingEmailError && <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-red-300">Error: {stagingEmailError}</div>}
      <p className="mt-2 text-xs text-slate-500">Endpoint: owner.sendTestEmail · Protected by requireOwner · 60s cooldown per recipient · No secrets exposed</p>
    </section>

  </div></main>;
}

function Metric({ icon, title, value, detail }: { icon: React.ReactNode; title: string; value: string; detail: string }) {
  return <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><div className="flex items-center gap-2 text-cyan-300">{icon}<span className="text-xs font-medium uppercase tracking-wide">{title}</span></div><p className="mt-3 text-2xl font-semibold text-slate-100">{value}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></article>;
}

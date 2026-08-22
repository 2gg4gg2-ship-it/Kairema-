import { ArrowLeft, Download, ShieldAlert } from "lucide-react";
import { useLocation } from "wouter";
import { downloadPreparedChatExport } from "@/lib/chat-export";
import { trpc } from "@/lib/trpc";

type DailyPoint = { date: string; requests: number; success: number; failures_by_layer: { layer_1: number; layer_2: number; layer_3: number }; p50: number; p95: number };
type HourlyPoint = { hour: string; layer1: number; layer2: number; layer3: number };

function escapeCsv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function localExport(fileName: string, contentType: string, content: string) {
  downloadPreparedChatExport({ fileName, contentType, blob: new Blob([content], { type: contentType }) });
}

export default function OwnerAnalytics() {
  const [, navigate] = useLocation();
  const ownerQuery = trpc.owner.isOwner.useQuery(undefined, { staleTime: 300_000 });
  const enabled = ownerQuery.data === true;
  const chartQuery = trpc.search.qualityChart.useQuery(undefined, { enabled, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const daily: DailyPoint[] = chartQuery.data?.daily ?? [];
  const hourly: HourlyPoint[] = chartQuery.data?.hourlyLayers ?? [];
  const maxSuccess = Math.max(1, ...daily.map((point) => point.success));
  const maxLayer = Math.max(1, ...hourly.map((point) => point.layer1 + point.layer2 + point.layer3));

  const exportAggregate = (kind: "json" | "csv") => {
    const aggregate = {
      generatedAt: new Date().toISOString(),
      scope: "anonymous-search-quality-aggregates-only",
      daily,
      hourly_failures_by_layer: hourly,
    };
    if (kind === "json") {
      localExport("kairema-search-quality-aggregate.json", "application/json;charset=utf-8", JSON.stringify(aggregate, null, 2));
      return;
    }
    const dailyCsv = ["date,requests,success,failures_by_layer,p50,p95", ...daily.map((point) => [point.date, point.requests, point.success, JSON.stringify(point.failures_by_layer), point.p50, point.p95].map(escapeCsv).join(","))];
    localExport("kairema-search-quality-aggregate.csv", "text/csv;charset=utf-8", `${dailyCsv.join("\n")}\n`);
  };

  if (ownerQuery.isLoading) return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><p className="mx-auto max-w-5xl text-sm text-slate-400">Загрузка аналитики владельца…</p></main>;
  if (!enabled) return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><section className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6"><ShieldAlert className="mb-3 size-6 text-amber-300" /><h1 className="text-xl font-semibold">Аналитика недоступна</h1><p className="mt-2 text-sm text-slate-400">Эта страница доступна только владельцу проекта.</p><button className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm" onClick={() => navigate("/")}><ArrowLeft className="size-4" />К чату</button></section></main>;

  return <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:px-6"><div className="mx-auto max-w-6xl"><header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><button className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800" onClick={() => navigate("/")}><ArrowLeft className="size-4" />К чату</button><p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-300">Владелец</p><h1 className="mt-1 text-2xl font-semibold">Качество поиска</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Только обезличенные агрегаты. Данные обновляются не чаще одного раза в минуту; запросы, URL, пользователи, модели и провайдеры не отображаются.</p></div><div className="flex flex-wrap gap-2"><button className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800" onClick={() => exportAggregate("csv")}><Download className="size-4" />CSV</button><button className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400" onClick={() => exportAggregate("json")}><Download className="size-4" />JSON</button></div></header>

    <section className="grid gap-4 lg:grid-cols-2"><article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Успешные результаты за 7 дней</h2><p className="mt-1 text-xs text-slate-400">Линия отражает число исходов «найдено» в обезличенных дневных агрегатах.</p><svg viewBox="0 0 320 150" className="mt-4 h-44 w-full overflow-visible" role="img" aria-label="Успешные результаты за семь дней"><line x1="16" y1="120" x2="304" y2="120" stroke="currentColor" opacity=".25" /><polyline points={daily.map((point, index) => `${16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)},${120 - (point.success / maxSuccess) * 96}`).join(" ")} fill="none" stroke="#34d399" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />{daily.map((point, index) => <g key={point.date}><circle cx={16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)} cy={120 - (point.success / maxSuccess) * 96} r="3" fill="#6ee7b7" /><text x={16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)} y="142" textAnchor="middle" fill="currentColor" opacity=".65" fontSize="9">{point.date.slice(5)}</text></g>)}</svg></article>
      <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Отказы каскада за 24 часа</h2><p className="mt-1 text-xs text-slate-400">Составные столбцы показывают анонимные порядковые слои отказа, а не поставщиков.</p><div className="mt-7 flex h-36 items-end gap-px" role="img" aria-label="Отказы анонимных слоёв поиска за двадцать четыре часа">{hourly.map((point, index) => { const total = point.layer1 + point.layer2 + point.layer3; const height = Math.max(3, (total / maxLayer) * 132); return <span key={`${point.hour}-${index}`} className="flex min-w-0 flex-1 flex-col-reverse overflow-hidden rounded-sm bg-slate-800" style={{ height: `${height}px` }} title={`${point.hour}: ${total}`}><i className="bg-cyan-400" style={{ height: `${total ? (point.layer1 / total) * 100 : 0}%` }} /><i className="bg-violet-400" style={{ height: `${total ? (point.layer2 / total) * 100 : 0}%` }} /><i className="bg-amber-400" style={{ height: `${total ? (point.layer3 / total) * 100 : 0}%` }} /></span>; })}</div><div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-400" />Слой 1</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-violet-400" />Слой 2</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />Слой 3</span></div></article></section>
    <section className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><h2 className="font-medium">Дневные агрегаты</h2><table className="mt-3 w-full min-w-[720px] text-left text-sm"><thead className="text-slate-400"><tr><th className="pb-2 pr-4">Дата</th><th className="pb-2 pr-4">Запросы</th><th className="pb-2 pr-4">Успех</th><th className="pb-2 pr-4">Отказы по слоям</th><th className="pb-2 pr-4">p50, мс</th><th className="pb-2">p95, мс</th></tr></thead><tbody>{daily.map((point) => <tr key={point.date} className="border-t border-slate-800"><td className="py-2 pr-4">{point.date}</td><td className="py-2 pr-4">{point.requests}</td><td className="py-2 pr-4 text-emerald-300">{point.success}</td><td className="py-2 pr-4">{point.failures_by_layer.layer_1} / {point.failures_by_layer.layer_2} / {point.failures_by_layer.layer_3}</td><td className="py-2 pr-4">{point.p50}</td><td className="py-2">{point.p95}</td></tr>)}</tbody></table></section>
  </div></main>;
}

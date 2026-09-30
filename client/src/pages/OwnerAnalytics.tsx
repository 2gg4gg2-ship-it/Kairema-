import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, Download, Gauge, ShieldAlert, SlidersHorizontal, Sun, Moon } from "lucide-react";
import { useLocation } from "wouter";
import { PRESENCE_HEARTBEAT_SECONDS } from "@shared/const";
import { downloadPreparedChatExport } from "@/lib/chat-export";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";

type Language = "ru" | "en";
type DailyPoint = { date: string; requests: number; success: number; failures_by_layer: { layer_1: number; layer_2: number; layer_3: number }; p50: number; p95: number };
type HourlyPoint = { hour: string; layer1: number; layer2: number; layer3: number };
type ControlInput = { targetKey: string; targetType: "provider" | "model"; disabled: boolean; preference: "normal" | "prefer" | "avoid" };

/**
 * Every visible string on this page lives here, RU and EN, so the panel follows the same language
 * setting as the chat rather than drifting into a mixed Russian/English surface. Technical
 * identifiers — role slugs, provider ids, WCU, p95/p99, control states — are deliberately absent:
 * they are real values, not prose, and stay verbatim in both languages.
 */
const copy = {
  ru: {
    backToChat: "К чату",
    panelTitle: "Kairema — панель владельца",
    panelSubtitle: "Техническая панель для контроля состояния приложения, AI-провайдеров и производительности.",
    loading: "Загрузка панели владельца…",
    themeToLight: "Светлая тема",
    themeToDark: "Тёмная тема",
    exportCsv: "Экспорт CSV",
    exportJson: "Экспорт JSON",
    exportCsvHint: "Скачать технические агрегаты в CSV.",
    exportJsonHint: "Скачать текущие технические агрегаты в JSON.",
    deniedTitle: "Панель недоступна",
    deniedBody: "Эта страница доступна только владельцу проекта.",
    claimCompared: "Сравниваемый признак",
    claimMapping: "Сопоставление владельца",
    claimConfigured: "настроено",
    claimNotConfigured: "не настроено",
    claimExpected: "Ожидаемый fingerprint",
    claimSession: "Fingerprint текущей сессии",
    claimMatchesYes: "Совпадение",
    claimMatchesNo: "нет",
    claimMatchesNote: "Реальные идентификаторы не отображаются.",

    sectionOverview: "Обзор",
    sectionCapacity: "Пропускная способность AI",
    sectionStreams: "Потоки AI",
    sectionSearch: "Поиск и события",
    sectionProviders: "Провайдеры",

    onlineTitle: "Сейчас в приложении",
    peopleOne: "человек сейчас активен",
    peopleFew: "человека сейчас активны",
    peopleMany: "человек сейчас активны",
    onlineHint: "Сессии, которые отправили сигнал совсем недавно. Человек с несколькими вкладками считается один раз.",
    onlineUpdated: "Обновлено несколько секунд назад",
    onlineUnavailable: "Нет данных",
    onlineNoOne: "Сейчас в приложении пока никого нет.",

    totalUsers: "Всего пользователей",
    totalUsersHint: "Зарегистрированные аккаунты без гостевых сессий.",
    active30d: "Активны за 30 дней",
    active30dHint: "Заходили в приложение за последний месяц.",
    quotaPerRole: "Квота на роль",
    quotaPerRoleHint: "Запросов в минуту на каждую роль Kairema.",
    requestsByRole: "Запросы по ролям",
    requestsByRoleHint: "Всего ответов ассистента по каждой роли.",

    providerHealth: "Состояние провайдеров",
    providerHealthHint: "Сколько провайдеров сейчас готовы к работе.",
    liveSearch: "Живой поиск",
    liveSearchHint: "Проверок поиска за последние сутки и сбои.",
    memory: "Память",
    memoryHint: "Сохранённые факты и темы.",
    controls: "Правила маршрутизации",
    controlsHint: "Сколько кандидатов отключено вручную.",

    capacityTitle: "Контроллер пропускной способности и справедливости AI",
    capacitySubtitle: "Только владелец. Реальные лимиты провайдеров остаются неподтверждёнными, пока не заданы отдельно.",
    globalGeneration: "Глобальная генерация",
    globalGenerationHint: "Общий лимит мощности генерации.",
    globalSearch: "Глобальный поиск",
    globalSearchHint: "Отдельный лимит мощности поиска.",
    localController: "Локальный контроллер",
    localControllerHint: "Занято и доступно в этом процессе.",
    queue: "Очередь",
    queueHint: "Что происходит с запросом при нехватке мощности.",
    enableController: "Включить контроллер",
    enableControllerHint: "Разрешить локальному контроллеру управлять допуском AI-запросов.",
    fieldGlobalGenerationWcu: "Глобальная генерация, WCU",
    fieldPerUserGenerationWcu: "Генерация на пользователя, WCU",
    fieldPerUserGenerationConcurrency: "Генерация на пользователя, одновременных",
    fieldGlobalSearchWcu: "Глобальный поиск, WCU",
    fieldPerUserSearchWcu: "Поиск на пользователя, WCU",
    fieldQueueMaxWait: "Максимальное ожидание в очереди, мс",
    fieldQueueMaxDepth: "Максимальная глубина очереди",
    savePolicy: "Сохранить policy",
    savePolicyHint: "Сохранить текущие ограничения контроллера.",
    saving: "Сохранение…",
    savePolicyFailed: "Не удалось сохранить policy. Значения не применены.",
    apexReserve: "Резерв для Context и Apex",
    serverValidated: "веса ролей проверяются на сервере.",
    adapters: "Адаптеры",
    adaptersNote: "Cloudflare Workers AI — только оценка возможностей; маршрутизация и тарификация не меняются.",
    budgetSummary: "Лимиты провайдеров и моделей",
    budgetIntro: "Заполняйте только независимо подтверждённые значения. Пустое поле означает «не настроено».",
    fieldTarget: "Цель лимитов",
    budgetAllowController: "Разрешить для контроллера",
    budgetBillingSafe: "Безопасность тарификации подтверждена",
    fieldBudgetGenerationWcu: "Лимит генерации, WCU",
    fieldBudgetMaxConcurrent: "Максимум одновременных",
    fieldBudgetRpm: "Документированный RPM",
    fieldBudgetTpm: "Документированный TPM",
    fieldBudgetDailyUnits: "Дневные единицы",
    fieldBudgetDailyRequests: "Дневные запросы",
    fieldBudgetDailyTokens: "Дневные токены",
    fieldBudgetResetWindow: "Окно сброса",
    fieldBudgetEligibility: "Допуск",
    fieldBudgetBillingState: "Состояние тарификации",
    fieldBudgetSearchEligibility: "Допуск к поиску",
    fieldBudgetCooldown: "Охлаждение",
    fieldBudgetRoles: "Доступные роли",
    saveMetadata: "Сохранить лимиты",
    saveMetadataHint: "Сохранить подтверждённые лимиты для выбранной цели.",
    saveMetadataFailed: "Не удалось сохранить лимиты провайдера или модели.",
    budgetEmpty: "Настроенных лимитов пока нет; это не означает нулевую доступную квоту.",

    streamsTitle: "Допуск потоков",
    streamsSubtitle: "Снимок текущего процесса: не метрика нескольких инстансов и без идентификаторов.",
    activeStreams: "Активные потоки",
    activeStreamsHint: "Одновременные потоки и лимит инстанса.",
    controlled503: "Отклонено по мощности",
    controlled503Hint: "В том числе по лимиту пользователя.",
    accepted: "Принято",
    acceptedHint: "В том числе отклонено по частоте запросов.",
    replay: "Воспроизведение",
    replayHint: "Сохранённые ответы для повторной отправки.",
    timingTitle: "Тайминги потоков",
    timingSubtitle: "Только длительность и задержка старта; тексты, токены и содержимое не собираются.",
    startP95: "Старт p95",
    activeP95: "Активные p95",
    completed: "Завершено",
    completedHint: "Отменено пользователем.",
    notUsed: "не используется",
    entered: "вошло",
    timedOut: "истекло ожидание",

    success7d: "Успешные результаты за 7 дней",
    success7dHint: "Анонимные дневные агрегаты поиска.",
    success7dAria: "Успешные результаты за семь дней",
    cascade24h: "Отказы каскада за 24 часа",
    cascade24hHint: "Анонимные порядковые слои; названия провайдеров не раскрываются.",
    cascade24hAria: "Отказы анонимных слоёв поиска за двадцать четыре часа",
    legendLayer1: "Слой 1",
    legendLayer2: "Слой 2",
    legendLayer3: "Слой 3",
    eventsTitle: "Технические события",
    eventsSubtitle: "Последние 30 событий, хранение 30 дней. Без запросов, ответов, адресов и секретов.",
    eventsEmpty: "Технических событий пока нет.",
    eventRole: "Роль",
    eventProvider: "Провайдер",

    healthTitle: "Состояние провайдеров",
    healthSubtitle: "Только для чтения: без ключей, адресов и текстов ошибок.",
    healthColumnProvider: "Провайдер",
    healthColumnStatus: "Статус",
    healthColumnChanged: "Последнее изменение",
    healthEmpty: "Нет сохранённых проверок.",
    stateReady: "готов",
    stateCooldown: "охлаждение",
    stateAuthFailed: "ошибка авторизации",
    stateUnavailable: "временно недоступен",
    stateNotConfigured: "не настроен",

    controlsTitle: "Аварийные правила маршрутизации",
    controlsSubtitle: "Только владелец. Правила могут пропустить известного кандидата или изменить его порядок. Ключи, белый список и лимиты запросов не меняются.",
    controlType: "Тип",
    controlTarget: "Разрешённая цель",
    controlPreference: "Порядок",
    controlDisabled: "Отключить кандидата",
    controlConfirm: "Подтвердить правило",
    controlConfirmHint: "Применить выбранное ручное правило маршрутизации.",
    controlFailed: "Не удалось сохранить правило. Повторите позже.",
    controlReset: "Сбросить",
    controlResetHint: "Вернуть кандидата к обычным настройкам.",
    controlEmpty: "Ручные правила пока не заданы.",
    typeProvider: "Провайдер",
    typeModel: "Модель",
    preferenceNormal: "Обычный",
    preferencePrefer: "Предпочесть",
    preferenceAvoid: "Избегать",
    stateEnabled: "включён",
    stateOff: "отключён",
    selectPlaceholder: "Выберите…",
    selectTargetPlaceholder: "Выберите провайдера или модель",
    providerPool: "пул провайдера",
    modelPool: "пул модели",
    confirmQuestionDisable: "отключить",
    confirmQuestionReset: "сбросить настройку для",
    confirmQuestionReorder: "изменить порядок для",
    confirmQuestionNote: "Это только аварийное правило маршрутизации: ключи и базовый бел список не меняются.",
    noData: "нет данных",
  },
  en: {
    backToChat: "Back to chat",
    panelTitle: "Kairema — owner dashboard",
    panelSubtitle: "Technical dashboard for monitoring the application, AI providers, and performance.",
    loading: "Loading the owner dashboard…",
    themeToLight: "Light theme",
    themeToDark: "Dark theme",
    exportCsv: "Export CSV",
    exportJson: "Export JSON",
    exportCsvHint: "Download the technical aggregates as CSV.",
    exportJsonHint: "Download the current technical aggregates as JSON.",
    deniedTitle: "Dashboard unavailable",
    deniedBody: "This page is available to the project owner only.",
    claimCompared: "Compared claim",
    claimMapping: "Owner mapping",
    claimConfigured: "configured",
    claimNotConfigured: "not configured",
    claimExpected: "Expected fingerprint",
    claimSession: "Current session fingerprint",
    claimMatchesYes: "Match",
    claimMatchesNo: "no",
    claimMatchesNote: "Real identifiers are never displayed.",

    sectionOverview: "Overview",
    sectionCapacity: "AI capacity",
    sectionStreams: "AI streams",
    sectionSearch: "Search and events",
    sectionProviders: "Providers",

    onlineTitle: "Currently active",
    peopleOne: "person is currently active",
    peopleFew: "people are currently active",
    peopleMany: "people are currently active",
    onlineHint: "Sessions that signalled very recently. One person with several tabs is counted once.",
    onlineUpdated: "Updated a few seconds ago",
    onlineUnavailable: "Unavailable",
    onlineNoOne: "Nobody is in the app right now.",

    totalUsers: "Total users",
    totalUsersHint: "Registered accounts, excluding guest sessions.",
    active30d: "Active last 30 days",
    active30dHint: "Opened the app during the last month.",
    quotaPerRole: "Quota per role",
    quotaPerRoleHint: "Requests per minute for each Kairema role.",
    requestsByRole: "Requests by role",
    requestsByRoleHint: "Total assistant replies for each role.",

    providerHealth: "Provider health",
    providerHealthHint: "How many providers are ready to serve requests.",
    liveSearch: "Live search",
    liveSearchHint: "Search checks over the last day, and outages.",
    memory: "Memory",
    memoryHint: "Stored facts and topics.",
    controls: "Routing rules",
    controlsHint: "How many candidates are disabled manually.",

    capacityTitle: "AI Capacity & Fairness Controller",
    capacitySubtitle: "Owner only. Real provider quotas stay unconfirmed until they are configured separately.",
    globalGeneration: "Global generation",
    globalGenerationHint: "Total generation capacity limit.",
    globalSearch: "Global search",
    globalSearchHint: "A separate search capacity limit.",
    localController: "Local controller",
    localControllerHint: "In use and available in this process.",
    queue: "Queue",
    queueHint: "What happens to a request when capacity is short.",
    enableController: "Enable controller",
    enableControllerHint: "Let the local controller govern AI request admission.",
    fieldGlobalGenerationWcu: "Global generation WCU",
    fieldPerUserGenerationWcu: "Per-user generation WCU",
    fieldPerUserGenerationConcurrency: "Per-user concurrent generation",
    fieldGlobalSearchWcu: "Global search WCU",
    fieldPerUserSearchWcu: "Per-user search WCU",
    fieldQueueMaxWait: "Queue max wait (ms)",
    fieldQueueMaxDepth: "Queue max depth",
    savePolicy: "Save policy",
    savePolicyHint: "Save the current controller limits.",
    saving: "Saving…",
    savePolicyFailed: "The policy could not be saved. No values were applied.",
    apexReserve: "Context/Apex reserve",
    serverValidated: "role weights are validated on the server.",
    adapters: "Adapters",
    adaptersNote: "Cloudflare Workers AI — feasibility only; routing and billing are unchanged.",
    budgetSummary: "Provider and model limits",
    budgetIntro: "Only enter independently documented values. An empty field means “not configured”.",
    fieldTarget: "Limit target",
    budgetAllowController: "Allow for the controller",
    budgetBillingSafe: "Billing safety independently confirmed",
    fieldBudgetGenerationWcu: "Generation WCU cap",
    fieldBudgetMaxConcurrent: "Max concurrent",
    fieldBudgetRpm: "Documented RPM",
    fieldBudgetTpm: "Documented TPM",
    fieldBudgetDailyUnits: "Daily units",
    fieldBudgetDailyRequests: "Daily requests",
    fieldBudgetDailyTokens: "Daily tokens",
    fieldBudgetResetWindow: "Reset window",
    fieldBudgetEligibility: "Eligibility",
    fieldBudgetBillingState: "Billing state",
    fieldBudgetSearchEligibility: "Search eligibility",
    fieldBudgetCooldown: "Cooldown",
    fieldBudgetRoles: "Eligible public roles",
    saveMetadata: "Save limits",
    saveMetadataHint: "Save the confirmed limits for the selected target.",
    saveMetadataFailed: "The provider or model limits could not be saved.",
    budgetEmpty: "No provider or model limits are configured yet; that does not mean a zero allowance.",

    streamsTitle: "Stream admission",
    streamsSubtitle: "A snapshot of the current process: not a multi-instance metric, and free of identifiers.",
    activeStreams: "Active streams",
    activeStreamsHint: "Concurrent streams and the instance limit.",
    controlled503: "Controlled 503",
    controlled503Hint: "Including per-user capacity rejections.",
    accepted: "Accepted",
    acceptedHint: "Including rate-limited rejections.",
    replay: "Replay",
    replayHint: "Stored answers kept for resending.",
    timingTitle: "Stream timing",
    timingSubtitle: "Only duration and start latency; texts, tokens and payloads are not collected.",
    startP95: "Start p95",
    activeP95: "Active p95",
    completed: "Completed",
    completedHint: "Cancelled by the user.",
    notUsed: "not used",
    entered: "entered",
    timedOut: "timed out",

    success7d: "Successful results over 7 days",
    success7dHint: "Anonymous daily search aggregates.",
    success7dAria: "Successful results over seven days",
    cascade24h: "Cascade failures over 24 hours",
    cascade24hHint: "Anonymous ordered layers; provider names are not disclosed here.",
    cascade24hAria: "Anonymous search layer failures over twenty four hours",
    legendLayer1: "Layer 1",
    legendLayer2: "Layer 2",
    legendLayer3: "Layer 3",
    eventsTitle: "Technical events",
    eventsSubtitle: "The last 30 events, kept for 30 days. No prompts, responses, URLs or secrets.",
    eventsEmpty: "No technical events yet.",
    eventRole: "Role",
    eventProvider: "Provider",

    healthTitle: "Provider health",
    healthSubtitle: "Read-only status snapshots, without keys, endpoint details or raw errors.",
    healthColumnProvider: "Provider",
    healthColumnStatus: "Status",
    healthColumnChanged: "Last change",
    healthEmpty: "No health snapshots saved.",
    stateReady: "ready",
    stateCooldown: "cooldown",
    stateAuthFailed: "authentication error",
    stateUnavailable: "temporarily unavailable",
    stateNotConfigured: "not configured",

    controlsTitle: "Fail-safe routing controls",
    controlsSubtitle: "Owner only. Controls may skip a known candidate or change its order. They do not change keys, the allowlist, or the request limits.",
    controlType: "Type",
    controlTarget: "Allowlisted target",
    controlPreference: "Order",
    controlDisabled: "Disable candidate",
    controlConfirm: "Confirm control",
    controlConfirmHint: "Apply the selected manual routing rule.",
    controlFailed: "The control could not be saved. Try again later.",
    controlReset: "Reset",
    controlResetHint: "Return the candidate to its default settings.",
    controlEmpty: "No manual controls yet.",
    typeProvider: "Provider",
    typeModel: "Model candidate",
    preferenceNormal: "Normal",
    preferencePrefer: "Prefer",
    preferenceAvoid: "Avoid",
    stateEnabled: "enabled",
    stateOff: "disabled",
    selectPlaceholder: "Select…",
    selectTargetPlaceholder: "Select a provider or model",
    providerPool: "provider pool",
    modelPool: "model pool",
    confirmQuestionDisable: "disable",
    confirmQuestionReset: "reset the setting for",
    confirmQuestionReorder: "change the order for",
    confirmQuestionNote: "This is a fail-safe routing control only: keys and the base allowlist are unchanged.",
    noData: "no data",
  },
} as const;

type Copy = (typeof copy)[Language];

const PROVIDER_STATE_TONE = { ready: "ok", cooldown: "warn", auth_failed: "danger", unavailable: "danger", not_configured: "muted" } as const;
const EVENT_KIND_TONE = { provider: "ok", fallback: "warn", search: "ok", owner_flag: "danger", attachment: "muted" } as const;

/**
 * Russian counts a person, two people and five people differently; English does not. Falls back to
 * the English string for any state the server adds later, so a new enum value degrades to text
 * rather than to an empty label.
 */
function providerStateLabel(state: string, t: Copy) {
  const known: Record<string, string> = {
    ready: t.stateReady,
    cooldown: t.stateCooldown,
    auth_failed: t.stateAuthFailed,
    unavailable: t.stateUnavailable,
    not_configured: t.stateNotConfigured,
  };
  return known[state] ?? state;
}

function eventKindLabel(kind: string, t: Copy, language: Language) {
  const known: Record<string, string> = {
    provider: t.eventProvider,
    fallback: language === "ru" ? "Резервный кандидат" : "Fallback",
    search: t.sectionSearch,
    owner_flag: language === "ru" ? "Действие владельца" : "Owner action",
    attachment: language === "ru" ? "Вложение" : "Attachment",
  };
  return known[kind] ?? kind;
}

function peopleCountLabel(count: number, language: Language, t: Copy) {
  if (language !== "ru") return `${count} ${count === 1 ? t.peopleOne : t.peopleMany}`;
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${t.peopleMany}`;
  if (mod10 === 1) return `${count} ${t.peopleOne}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${t.peopleFew}`;
  return `${count} ${t.peopleMany}`;
}

function escapeCsv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function localExport(fileName: string, contentType: string, content: string) {
  downloadPreparedChatExport({ fileName, contentType, blob: new Blob([content], { type: contentType }) });
}

export default function OwnerAnalytics() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { theme, toggleTheme } = useTheme();
  const [targetType, setTargetType] = useState<ControlInput["targetType"]>("provider");
  const [targetKey, setTargetKey] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [preference, setPreference] = useState<ControlInput["preference"]>("normal");
  const ownerQuery = trpc.owner.isOwner.useQuery(undefined, { staleTime: 300_000 });
  const enabled = ownerQuery.data === true;
  // Language comes from the same per-user setting the chat uses, so the panel always matches it.
  // It is a `protectedProcedure`, so it is only asked once the owner check has already passed.
  const settingsQuery = trpc.settings.get.useQuery(undefined, { enabled, staleTime: 300_000 });
  const language = (settingsQuery.data?.language as Language | undefined) ?? "ru";
  const t = copy[language];
  const hint = (ru: string, en: string) => (language === "ru" ? ru : en);

  const claimDiagnostic = trpc.owner.claimDiagnostic.useQuery(undefined, { enabled: ownerQuery.isSuccess && !enabled, staleTime: 300_000 });
  const chartQuery = trpc.search.qualityChart.useQuery(undefined, { enabled, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const observabilityQuery = trpc.owner.observability.useQuery(undefined, { enabled, refetchInterval: 30_000, refetchOnWindowFocus: true });
  const dashboardQuery = trpc.owner.dashboard.useQuery(undefined, { enabled, refetchInterval: 30_000, refetchOnWindowFocus: true });
  const onlineQuery = trpc.owner.getOnlineUsersCount.useQuery(undefined, { enabled, refetchInterval: 30_000, refetchOnWindowFocus: true });
  const controlsQuery = trpc.owner.providerControls.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const targetsQuery = trpc.owner.providerControlTargets.useQuery(undefined, { enabled, staleTime: 300_000 });
  const updateControl = trpc.owner.updateProviderControl.useMutation();
  const capacitySnapshotQuery = trpc.owner.capacitySnapshot.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const capacityPolicyQuery = trpc.owner.capacityPolicy.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const updateCapacity = trpc.owner.updateCapacityPolicy.useMutation();
  const capacityProviderBudgetsQuery = trpc.owner.capacityProviderBudgets.useQuery(undefined, { enabled, refetchInterval: 30_000 });
  const updateCapacityProviderBudgetMutation = trpc.owner.updateCapacityProviderBudget.useMutation();
  const heartbeat = trpc.presence.heartbeat.useMutation();

  /**
   * Presence is driven from the client that is actually in the app, not from the dashboard: the
   * owner looking at this page is a person in the app too, and every other open tab keeps its own
   * signal. The interval is well inside the server-side TTL, the timer is cleared on unmount, and a
   * hidden tab stays silent because a backgrounded window is not "in the app".
   */
  const beatRef = useRef(heartbeat.mutate);
  beatRef.current = heartbeat.mutate;
  useEffect(() => {
    if (!enabled) return;
    const beat = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void beatRef.current();
    };
    beat();
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_SECONDS * 1_000);
    return () => window.clearInterval(timer);
  }, [enabled]);

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
  const onlineUsers = onlineQuery.data?.onlineUsers ?? null;

  const formatWhen = (value: Date | string | null | undefined) => {
    if (!value) return t.noData;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t.noData : date.toLocaleString(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" });
  };

  const exportAggregate = (kind: "json" | "csv") => {
    const aggregate = { generatedAt: new Date().toISOString(), scope: "anonymous-search-quality-aggregates-only", daily, hourly_failures_by_layer: hourly };
    if (kind === "json") { localExport("kairema-search-quality-aggregate.json", "application/json;charset=utf-8", JSON.stringify(aggregate, null, 2)); return; }
    const dailyCsv = ["date,requests,success,failures_by_layer,p50,p95", ...daily.map((point) => [point.date, point.requests, point.success, JSON.stringify(point.failures_by_layer), point.p50, point.p95].map(escapeCsv).join(","))];
    localExport("kairema-search-quality-aggregate.csv", "text/csv;charset=utf-8", `${dailyCsv.join("\n")}\n`);
  };

  const applyControl = async (input: ControlInput) => {
    const action = input.disabled ? t.confirmQuestionDisable : input.preference === "normal" ? t.confirmQuestionReset : t.confirmQuestionReorder;
    if (!window.confirm(hint(
      `Подтвердите: ${action} ${input.targetType} «${input.targetKey}». ${t.confirmQuestionNote}`,
      `Confirm: ${action} ${input.targetType} “${input.targetKey}”. ${t.confirmQuestionNote}`,
    ))) return;
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

  if (ownerQuery.isLoading) {
    return <main className="kairema-owner-page"><p className="mx-auto max-w-5xl text-sm" style={{ color: "var(--k-muted)" }}>{copy.ru.loading}</p></main>;
  }

  if (!enabled) {
    return <main className="kairema-owner-page"><div className="mx-auto max-w-lg">
      <section className="kairema-owner-card p-4">
        <ShieldAlert className="mb-3 size-6" style={{ color: "var(--k-warn-text)" }} aria-hidden="true" />
        <h1 className="text-xl font-semibold">{copy.ru.deniedTitle}</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--k-muted)" }}>{copy.ru.deniedBody}</p>
        {claimDiagnostic.data && <div className="kairema-owner-empty mt-4 text-xs" aria-label="Safe owner claim diagnostics">
          <p>{copy.ru.claimCompared}: <b>{claimDiagnostic.data.comparedClaim}</b></p>
          <p>{copy.ru.claimMapping}: <b>{claimDiagnostic.data.configured ? copy.ru.claimConfigured : copy.ru.claimNotConfigured}</b></p>
          <p className="mt-2 break-all">{copy.ru.claimExpected}: {claimDiagnostic.data.expectedFingerprint}</p>
          <p className="break-all">{copy.ru.claimSession}: {claimDiagnostic.data.sessionFingerprint}</p>
          <p className="mt-2" style={{ color: "var(--k-warn-text)" }}>{copy.ru.claimMatchesYes}: {claimDiagnostic.data.matches ? copy.ru.claimMatchesYes : copy.ru.claimMatchesNo}. {copy.ru.claimMatchesNote}</p>
        </div>}
        <button className="kairema-owner-btn mt-4 px-3 py-2" onClick={() => navigate("/")}><ArrowLeft className="size-4" />{copy.ru.backToChat}</button>
      </section>
    </div></main>;
  }

  const quota = dashboardQuery.data?.quota;
  const requestsByRole = dashboardQuery.data?.requestsByRole ?? [];
  const roleCounts = useMemo(() => new Map(requestsByRole.map((row) => [row.roleId, row.count])), [requestsByRole]);
  const policies = capacityPolicyQuery.data;

  return (
    <main className="kairema-owner-page">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button className="kairema-owner-btn px-3 py-2" onClick={() => navigate("/")}><ArrowLeft className="size-4" />{t.backToChat}</button>
              {toggleTheme && <button className="kairema-owner-btn px-3 py-2" title={theme === "dark" ? t.themeToLight : t.themeToDark} aria-label={theme === "dark" ? t.themeToLight : t.themeToDark} onClick={toggleTheme}>{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>}
            </div>
            <h1 className="mt-3 text-2xl font-semibold">{t.panelTitle}</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--k-muted)" }}>{t.panelSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex flex-col items-start gap-1">
              <button className="kairema-owner-btn px-3 py-2" onClick={() => exportAggregate("csv")}><Download className="size-4" />{t.exportCsv}</button>
              <span className="max-w-[15rem] text-xs" style={{ color: "var(--k-muted)" }}>{t.exportCsvHint}</span>
            </span>
            <span className="flex flex-col items-start gap-1">
              <button className="kairema-owner-btn-primary px-3 py-2" onClick={() => exportAggregate("json")}><Download className="size-4" />{t.exportJson}</button>
              <span className="max-w-[15rem] text-xs" style={{ color: "var(--k-muted)" }}>{t.exportJsonHint}</span>
            </span>
          </div>
        </header>

        <Section title={t.sectionOverview}>
          <div className="kairema-owner-online">
            <span className="kairema-owner-online-value">{onlineUsers === null ? "—" : onlineUsers}</span>
            <div className="kairema-owner-online-side">
              <p className="text-sm font-medium">{t.onlineTitle}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--k-muted)" }}>
                {onlineUsers === null ? t.onlineUnavailable : peopleCountLabel(onlineUsers, language, t)}
              </p>
              {onlineUsers === 0 && <p className="mt-1 text-xs" style={{ color: "var(--k-muted)" }}>{t.onlineNoOne}</p>}
              <p className="mt-1 text-xs" style={{ color: "var(--k-muted)" }}>{t.onlineHint}</p>
            </div>
            {onlineQuery.isSuccess && (
              <span className="kairema-owner-pill kairema-owner-pill-muted self-center">{t.onlineUpdated}</span>
            )}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={<Activity />} title={t.providerHealth} value={`${readiness.ready}/${readiness.total}`} detail={t.providerHealthHint} />
            <Metric icon={<Gauge />} title={t.liveSearch} value={String(observabilityQuery.data?.search.samples24h ?? 0)} detail={`${t.liveSearchHint} · ${observabilityQuery.data?.search.outages24h ?? 0}`} />
            <Metric icon={<Activity />} title={t.memory} value={String((observabilityQuery.data?.memory.facts ?? 0) + (observabilityQuery.data?.memory.topics ?? 0))} detail={t.memoryHint} />
            <Metric icon={<SlidersHorizontal />} title={t.controls} value={String(controlsQuery.data?.filter((control) => Boolean(control.disabled)).length ?? 0)} detail={t.controlsHint} />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Metric icon={<Activity />} title={t.totalUsers} value={String(dashboardQuery.data?.users.total ?? 0)} detail={t.totalUsersHint} />
            <Metric icon={<Activity />} title={t.active30d} value={String(dashboardQuery.data?.users.activeLast30d ?? 0)} detail={t.active30dHint} />
            <Metric icon={<Gauge />} title={t.quotaPerRole} value={quota ? `${quota.limitPerRole} / ${quota.windowSeconds} s` : "—"} detail={t.quotaPerRoleHint} />
          </div>

          <Card className="mt-3" title={t.requestsByRole} subtitle={t.requestsByRoleHint}>
            {quota?.roles.length ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {quota.roles.map((role) => (
                  <div key={role.roleId} className="kairema-owner-row">
                    <span className="kairema-owner-row-text">{role.label}</span>
                    <span className="kairema-owner-row-meta">{roleCounts.get(role.roleId) ?? 0}</span>
                  </div>
                ))}
              </div>
            ) : <p className="kairema-owner-empty">{t.noData}</p>}
          </Card>
        </Section>

        <Section title={t.sectionCapacity}>
          <Card title={t.capacityTitle} subtitle={t.capacitySubtitle}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={<Activity />} title={t.globalGeneration} value={capacitySnapshotQuery.data?.policy.globalCapacity ?? "—"} detail={t.globalGenerationHint} />
              <Metric icon={<Activity />} title={t.globalSearch} value={capacitySnapshotQuery.data?.policy.searchCapacity ?? "—"} detail={t.globalSearchHint} />
              <Metric icon={<Gauge />} title={t.localController} value={`${capacitySnapshotQuery.data?.local.generation.active ?? 0}/${capacitySnapshotQuery.data?.local.generation.instanceLimit ?? 12}`} detail={capacitySnapshotQuery.data?.local.scope ?? t.localControllerHint} />
              <Metric icon={<ShieldAlert />} title={t.queue} value={capacitySnapshotQuery.data?.policy.queueScope ?? "—"} detail={t.queueHint} />
            </div>

            <form key={JSON.stringify(policies ?? {})} onSubmit={(event) => void applyCapacityPolicy(event)} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="kairema-owner-check self-end"><input name="capacityEnabled" type="checkbox" defaultChecked={policies?.enabled ?? true} />{t.enableController}</label>
              <Field label={t.fieldGlobalGenerationWcu}><input name="globalGenerationWcuLimit" type="number" min="1" max="100000" defaultValue={policies?.globalGenerationWcuLimit ?? ""} placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
              <Field label={t.fieldPerUserGenerationWcu}><input name="perUserGenerationWcuLimit" type="number" min="1" max="100000" defaultValue={policies?.perUserGenerationWcuLimit ?? 12} className="kairema-owner-field" /></Field>
              <Field label={t.fieldPerUserGenerationConcurrency}><input name="perUserGenerationConcurrency" type="number" min="1" max="12" defaultValue={policies?.perUserGenerationConcurrency ?? 2} className="kairema-owner-field" /></Field>
              <Field label={t.fieldGlobalSearchWcu}><input name="globalSearchWcuLimit" type="number" min="1" max="100000" defaultValue={policies?.globalSearchWcuLimit ?? ""} placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
              <Field label={t.fieldPerUserSearchWcu}><input name="perUserSearchWcuLimit" type="number" min="1" max="100000" defaultValue={policies?.perUserSearchWcuLimit ?? 6} className="kairema-owner-field" /></Field>
              <Field label={t.fieldQueueMaxWait}><input name="queueMaxWaitMs" type="number" min="0" max="1500" defaultValue={policies?.queueMaxWaitMs ?? 0} className="kairema-owner-field" /></Field>
              <Field label={t.fieldQueueMaxDepth}><input name="queueMaxDepth" type="number" min="0" max="64" defaultValue={policies?.queueMaxDepth ?? 0} className="kairema-owner-field" /></Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
                <span className="flex flex-col items-start">
                  <button type="submit" disabled={updateCapacity.isPending} className="kairema-owner-btn-primary px-3 py-2" title={t.savePolicyHint}>
                    {updateCapacity.isPending ? t.saving : t.savePolicy}
                  </button>
                </span>
                <span className="text-xs" style={{ color: "var(--k-muted)" }}>{t.apexReserve}: {policies?.apexPressureReservePercent ?? 20}% · {t.serverValidated}</span>
                {updateCapacity.error && <p role="alert" className="kairema-owner-alert kairema-owner-alert-error">{t.savePolicyFailed}</p>}
              </div>
            </form>
            <p className="mt-3 text-xs" style={{ color: "var(--k-muted)" }}>
              {t.adapters}: {capacitySnapshotQuery.data?.adapters.map((adapter) => `${adapter.id} (${adapter.status})`).join(" · ") ?? t.noData}. {t.adaptersNote}
            </p>

            <details className="kairema-owner-details">
              <summary className="kairema-owner-summary">{t.budgetSummary}</summary>
              <p className="mt-2 text-xs" style={{ color: "var(--k-muted)" }}>{t.budgetIntro}</p>
              <form onSubmit={(event) => void applyCapacityProviderBudget(event)} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t.fieldTarget}>
                  <select name="budgetTarget" required className="kairema-owner-field">
                    <option value="">{t.selectTargetPlaceholder}</option>
                    {(targetsQuery.data?.providers ?? []).map((provider) => <option key={provider} value={JSON.stringify({ provider })}>{provider} · {t.providerPool}</option>)}
                    {(targetsQuery.data?.models ?? []).map((entry) => {
                      const separator = entry.indexOf(":");
                      const provider = entry.slice(0, separator);
                      const modelId = entry.slice(separator + 1);
                      return <option key={entry} value={JSON.stringify({ provider, modelId })}>{entry} · {t.modelPool}</option>;
                    })}
                  </select>
                </Field>
                <label className="kairema-owner-check self-end"><input name="budgetEnabled" type="checkbox" defaultChecked />{t.budgetAllowController}</label>
                <label className="kairema-owner-check self-end"><input name="budgetBillingSafe" type="checkbox" />{t.budgetBillingSafe}</label>
                <Field label={t.fieldBudgetGenerationWcu}><input name="budgetGenerationWcuLimit" type="number" min="1" max="100000" placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetMaxConcurrent}><input name="budgetMaxConcurrent" type="number" min="1" max="128" placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetRpm}><input name="budgetRpmLimit" type="number" min="1" max="100000" placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetTpm}><input name="budgetTpmLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetDailyUnits}><input name="budgetDailyUnitsLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetDailyRequests}><input name="budgetDailyRequestLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetDailyTokens}><input name="budgetDailyTokenLimit" type="number" min="1" max="100000000" placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetResetWindow}><input name="budgetResetWindow" type="text" maxLength={80} placeholder="UNKNOWN" className="kairema-owner-field" /></Field>
                <Field label={t.fieldBudgetEligibility}>
                  <select name="budgetEligibilityState" defaultValue="unknown" className="kairema-owner-field">
                    <option value="unknown">UNKNOWN</option><option value="eligible">eligible</option><option value="not_eligible">not eligible</option><option value="paid_required">paid required</option>
                  </select>
                </Field>
                <Field label={t.fieldBudgetBillingState}>
                  <select name="budgetBillingState" defaultValue="unknown" className="kairema-owner-field">
                    <option value="unknown">UNKNOWN</option><option value="free">free</option><option value="paid">paid</option><option value="not_configured">not configured</option>
                  </select>
                </Field>
                <Field label={t.fieldBudgetSearchEligibility}>
                  <select name="budgetSearchEligibility" defaultValue="unknown" className="kairema-owner-field">
                    <option value="unknown">UNKNOWN</option><option value="eligible">eligible</option><option value="not_eligible">not eligible</option>
                  </select>
                </Field>
                <Field label={t.fieldBudgetCooldown}>
                  <select name="budgetCooldownState" defaultValue="inherit_provider_health" className="kairema-owner-field">
                    <option value="inherit_provider_health">inherit Provider Health</option><option value="unknown">UNKNOWN</option><option value="cooldown">cooldown</option>
                  </select>
                </Field>
                <fieldset className="sm:col-span-2 lg:col-span-4">
                  <legend className="kairema-owner-label">{t.fieldBudgetRoles}</legend>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                    {(["fast", "smart", "context", "flagship"] as const).map((role) => (
                      <label key={role} className="kairema-owner-check"><input name={`role-${role}`} type="checkbox" />{role}</label>
                    ))}
                  </div>
                </fieldset>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
                  <span className="flex flex-col items-start">
                    <button type="submit" disabled={updateCapacityProviderBudgetMutation.isPending} className="kairema-owner-btn-primary px-3 py-2" title={t.saveMetadataHint}>
                      {updateCapacityProviderBudgetMutation.isPending ? t.saving : t.saveMetadata}
                    </button>
                  </span>
                  {updateCapacityProviderBudgetMutation.error && <p role="alert" className="kairema-owner-alert kairema-owner-alert-error">{t.saveMetadataFailed}</p>}
                </div>
              </form>
              <div className="mt-3 space-y-1 text-xs" style={{ color: "var(--k-muted)" }} aria-label={t.budgetSummary}>
                {(capacityProviderBudgetsQuery.data ?? []).length === 0
                  ? <p>{t.budgetEmpty}</p>
                  : (capacityProviderBudgetsQuery.data ?? []).map((budget) => <p key={budget.scopeKey}>{budget.scopeKey}: WCU {budget.generationWcuLimit ?? "UNKNOWN"} · RPM {budget.rpmLimit ?? "UNKNOWN"} · {budget.dailyUnitsLimit ?? "UNKNOWN"} · {budget.billingState}</p>)}
              </div>
            </details>
          </Card>
        </Section>

        <Section title={t.sectionStreams}>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title={t.streamsTitle} subtitle={t.streamsSubtitle}>
              <div className="grid grid-cols-2 gap-2">
                <Metric icon={<Activity />} title={t.activeStreams} value={`${runtime?.active.streams ?? 0}/${runtime?.limits.activePerInstance ?? 12}`} detail={t.activeStreamsHint} />
                <Metric icon={<ShieldAlert />} title={t.controlled503} value={String(runtime?.outcomes.capacityRejected ?? 0)} detail={t.controlled503Hint} />
                <Metric icon={<Gauge />} title={t.accepted} value={String(runtime?.outcomes.accepted ?? 0)} detail={t.acceptedHint} />
                <Metric icon={<Activity />} title={t.replay} value={String((runtime?.outcomes.replayCompleted ?? 0) + (runtime?.outcomes.replayPending ?? 0) + (runtime?.outcomes.replayStored ?? 0))} detail={t.replayHint} />
              </div>
            </Card>
            <Card title={t.timingTitle} subtitle={t.timingSubtitle}>
              <div className="grid grid-cols-2 gap-2">
                <Metric icon={<Gauge />} title={t.startP95} value={`${runtime?.samples.startLatencyMs.p95 ?? "—"} ms`} detail={`p99: ${runtime?.samples.startLatencyMs.p99 ?? "—"} ms`} />
                <Metric icon={<Gauge />} title={t.activeP95} value={`${runtime?.samples.activeDurationMs.p95 ?? "—"} ms`} detail={`p99: ${runtime?.samples.activeDurationMs.p99 ?? "—"} ms`} />
                <Metric icon={<Activity />} title={t.completed} value={String(runtime?.outcomes.completed ?? 0)} detail={t.completedHint} />
                <Metric icon={<ShieldAlert />} title={t.queue} value={t.notUsed} detail={`${t.entered}: ${runtime?.queue.entered ?? 0} · ${t.timedOut}: ${runtime?.queue.timedOut ?? 0}`} />
              </div>
            </Card>
          </div>
        </Section>

        <Section title={t.sectionSearch}>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title={t.success7d} subtitle={t.success7dHint}>
              <svg viewBox="0 0 320 150" className="kairema-owner-chart" role="img" aria-label={t.success7dAria}>
                <line x1="16" y1="120" x2="304" y2="120" stroke="currentColor" opacity=".35" />
                <polyline
                  points={daily.map((point, index) => `${16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)},${120 - (point.success / maxSuccess) * 96}`).join(" ")}
                  fill="none" stroke="var(--k-ok)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                />
                {daily.map((point, index) => (
                  <g key={point.date}>
                    <circle cx={16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)} cy={120 - (point.success / maxSuccess) * 96} r="3" fill="var(--k-ok)" />
                    <text x={16 + (daily.length > 1 ? (index / (daily.length - 1)) * 288 : 144)} y="142" textAnchor="middle" fill="currentColor" opacity=".75" fontSize="9">{point.date.slice(5)}</text>
                  </g>
                ))}
              </svg>
            </Card>
            <Card title={t.cascade24h} subtitle={t.cascade24hHint}>
              <div className="kairema-owner-bars" role="img" aria-label={t.cascade24hAria}>
                {hourly.map((point, index) => {
                  const total = point.layer1 + point.layer2 + point.layer3;
                  const height = Math.max(3, (total / maxLayer) * 94);
                  return (
                    <span key={`${point.hour}-${index}`} className="kairema-owner-bar" style={{ height: `${height}px` }} title={`${point.hour}: ${total}`}>
                      <i style={{ height: `${total ? (point.layer1 / total) * 100 : 0}%`, background: "var(--k-ok)" }} />
                      <i style={{ height: `${total ? (point.layer2 / total) * 100 : 0}%`, background: "var(--k-warn)" }} />
                      <i style={{ height: `${total ? (point.layer3 / total) * 100 : 0}%`, background: "var(--k-danger)" }} />
                    </span>
                  );
                })}
              </div>
              <div className="kairema-owner-legend">
                <span><i className="kairema-owner-legend-swatch" style={{ background: "var(--k-ok)" }} />{t.legendLayer1}</span>
                <span><i className="kairema-owner-legend-swatch" style={{ background: "var(--k-warn)" }} />{t.legendLayer2}</span>
                <span><i className="kairema-owner-legend-swatch" style={{ background: "var(--k-danger)" }} />{t.legendLayer3}</span>
              </div>
            </Card>
          </div>

          <Card className="mt-3" title={t.eventsTitle} subtitle={t.eventsSubtitle}>
            {observabilityQuery.data?.events.slice(0, 8).map((event) => (
              <div key={event.id} className="kairema-owner-row mb-1">
                <div className="min-w-0">
                  <p className="kairema-owner-row-text">{event.title}</p>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--k-muted)" }}>
                    {t.eventRole}: {event.roleId ?? "—"} · {t.eventProvider}: {event.code ?? "—"}
                  </p>
                </div>
                <span className={`kairema-owner-pill kairema-owner-pill-${EVENT_KIND_TONE[event.kind as keyof typeof EVENT_KIND_TONE] ?? "muted"}`}>{eventKindLabel(event.kind, t, language)}</span>
                <span className="kairema-owner-row-meta">{formatWhen(event.createdAt)}</span>
              </div>
            ))}
            {!observabilityQuery.data?.events.length && <p className="kairema-owner-empty">{t.eventsEmpty}</p>}
          </Card>
        </Section>

        <Section title={t.sectionProviders}>
          <Card title={t.healthTitle} subtitle={t.healthSubtitle}>
            <div className="kairema-owner-legend mb-2">
              <span>{t.healthColumnProvider}</span><span>{t.healthColumnStatus}</span><span>{t.healthColumnChanged}</span>
            </div>
            {observabilityQuery.data?.providers.map((provider) => (
              <div key={provider.provider} className="kairema-owner-row mb-1">
                <span className="kairema-owner-row-text">{provider.provider}</span>
                <span className={`kairema-owner-pill kairema-owner-pill-${PROVIDER_STATE_TONE[provider.state as keyof typeof PROVIDER_STATE_TONE] ?? "muted"}`}>
                  {providerStateLabel(provider.state, t)}
                </span>
                <span className="kairema-owner-row-meta">{formatWhen(provider.checkedAt)}</span>
              </div>
            ))}
            {!observabilityQuery.data?.providers.length && <p className="kairema-owner-empty">{t.healthEmpty}</p>}
          </Card>

          <Card className="mt-3" title={t.controlsTitle} subtitle={t.controlsSubtitle}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t.controlType}>
                <select className="kairema-owner-field" value={targetType} onChange={(event) => { setTargetType(event.target.value as ControlInput["targetType"]); setTargetKey(""); }}>
                  <option value="provider">{t.typeProvider}</option><option value="model">{t.typeModel}</option>
                </select>
              </Field>
              <Field label={t.controlTarget}>
                <select className="kairema-owner-field" value={targetKey} onChange={(event) => setTargetKey(event.target.value)}>
                  <option value="">{t.selectPlaceholder}</option>
                  {selectedTargets.map((target) => <option key={target} value={target}>{target}</option>)}
                </select>
              </Field>
              <Field label={t.controlPreference}>
                <select className="kairema-owner-field" value={preference} onChange={(event) => setPreference(event.target.value as ControlInput["preference"])}>
                  <option value="normal">{t.preferenceNormal}</option><option value="prefer">{t.preferencePrefer}</option><option value="avoid">{t.preferenceAvoid}</option>
                </select>
              </Field>
              <label className="kairema-owner-check self-end"><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />{t.controlDisabled}</label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="flex flex-col items-start">
                <button disabled={!targetKey || updateControl.isPending} className="kairema-owner-btn-primary px-3 py-2" title={t.controlConfirmHint} onClick={() => void applyControl({ targetKey, targetType, disabled, preference })}>
                  {updateControl.isPending ? t.saving : t.controlConfirm}
                </button>
              </span>
              {updateControl.error && <p role="alert" className="kairema-owner-alert kairema-owner-alert-error">{t.controlFailed}</p>}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {controlsQuery.data?.map((control) => (
                <div key={`${control.targetType}:${control.targetKey}`} className="kairema-owner-row">
                  <div className="min-w-0">
                    <p className="kairema-owner-row-text break-all">{control.targetType}: {control.targetKey}</p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--k-muted)" }}>{control.disabled ? t.stateOff : t.stateEnabled} · {control.preference} · {formatWhen(control.updatedAt)}</p>
                  </div>
                  <button className="kairema-owner-btn px-2 py-1 text-xs" title={t.controlResetHint} onClick={() => void applyControl({ targetKey: control.targetKey, targetType: control.targetType, disabled: false, preference: "normal" })}>{t.controlReset}</button>
                </div>
              ))}
              {!controlsQuery.data?.length && <p className="kairema-owner-empty">{t.controlEmpty}</p>}
            </div>
          </Card>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="kairema-owner-section" aria-label={title}>
    <h2 className="kairema-owner-section-title">{title}</h2>
    <div className="mt-2">{children}</div>
  </section>;
}

function Card({ title, subtitle, className, children }: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return <article className={`kairema-owner-card ${className ?? ""}`}>
    <div className="kairema-owner-card-head">
      <div className="min-w-0 flex-1">
        <h3 className="kairema-owner-title">{title}</h3>
        {subtitle && <p className="kairema-owner-sub">{subtitle}</p>}
      </div>
    </div>
    <div className="kairema-owner-card-body">{children}</div>
  </article>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="kairema-owner-label">{label}</span>{children}</label>;
}

function Metric({ icon, title, value, detail }: { icon: React.ReactNode; title: string; value: string; detail: string }) {
  return <div className="kairema-owner-metric">
    <div className="kairema-owner-metric-head">{icon}<span className="kairema-owner-metric-label">{title}</span></div>
    <p className="kairema-owner-metric-value">{value}</p>
    <p className="kairema-owner-metric-detail">{detail}</p>
  </div>;
}

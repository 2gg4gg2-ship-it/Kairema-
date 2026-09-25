// @ts-nocheck — экран содержит динамические tRPC-данные, уточняемые интеграционными тестами.
import { AIChatBox, type ChatAttachment, type Message } from "@/components/AIChatBox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { startLogin } from "@/const";
import { memorySearchMatches } from "@/lib/memory-search";
import { runtimeAuthHeaders } from "@/lib/runtime-auth";
import { consumeChatStream } from "@/lib/chat-stream";
import { trpc } from "@/lib/trpc";
import { Archive, Bot, CircleCheck, CircleDot, Clock3, Copy, FileImage, Gauge, Globe2, Languages, Lightbulb, LoaderCircle, LogIn, Menu, MessageSquare, MessageSquarePlus, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings2, SlidersHorizontal, Sparkles, Sun, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

type ModelId = "fast" | "smart" | "context" | "flagship";
type Language = "ru" | "en";
type ResponseStyle = "default" | "professional" | "friendly" | "concise" | "steps";
type StaticModel = { key: string; modelId: ModelId; label: Record<Language, string>; role: Record<Language, string> };
type PublicStatus = { state: string; badge: string; category: string | null; http: number | null; checkedAt: string; confirmed: string };
type PublicRuntime = { state: "ready" | "backup" | "unavailable"; provider: string | null; modelUsed: string | null; checkedAt: string };
type PublicRoleLimits = { candidate: "primary" | "backup" | "unavailable"; provider: string | null; quota: "ready" | "limited" | "unavailable"; nextFallback: string | null; lastFallback: boolean };
type PublicModel = StaticModel & { status?: PublicStatus; runtime?: PublicRuntime | null; limits?: PublicRoleLimits };
type SearchItem = { type: "chat" | "message"; id: string; sessionId?: string; title: string; snippet: string; createdAt: Date | string };
type SearchStatus = { state: "found" | "empty" | "degraded" | "error"; verificationStatus?: "verified" | "no_results" | "degraded" | "unavailable"; sourcesCount: number; freshnessBlocked?: boolean; staleRagOnly?: boolean; sourceDateMin?: string; sourceDateMax?: string };
type SourceEvidence = { title: string; url: string; publishedAt?: string };
type WebGrounding = { intent: "PREFERRED" | "REQUIRED"; state: "verified" | "disabled" | "empty" | "degraded" | "unavailable" | "admission_denied"; sourcesCount: number; citations: SourceEvidence[]; freshnessBlocked?: boolean };

function safeSearchStatus(value: unknown): SearchStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = value as { state?: unknown; verificationStatus?: unknown; sourcesCount?: unknown; freshnessBlocked?: unknown; staleRagOnly?: unknown; sourceDateMin?: unknown; sourceDateMax?: unknown };
  if (!(status.state === "found" || status.state === "empty" || status.state === "degraded" || status.state === "error") || typeof status.sourcesCount !== "number") return undefined;
  const iso = (date: unknown) => typeof date === "string" && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : undefined;
  return { state: status.state, ...(status.verificationStatus === "verified" || status.verificationStatus === "no_results" || status.verificationStatus === "degraded" || status.verificationStatus === "unavailable" ? { verificationStatus: status.verificationStatus } : {}), ...(status.freshnessBlocked === true ? { freshnessBlocked: true } : {}), ...(status.staleRagOnly === true ? { staleRagOnly: true } : {}), ...(iso(status.sourceDateMin) ? { sourceDateMin: iso(status.sourceDateMin) } : {}), ...(iso(status.sourceDateMax) ? { sourceDateMax: iso(status.sourceDateMax) } : {}), sourcesCount: status.sourcesCount };
}

function safeSourceEvidence(value: unknown): SourceEvidence[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as { title?: unknown; url?: unknown; publishedAt?: unknown };
    if (typeof source.title !== "string" || typeof source.url !== "string") return [];
    try {
      const url = new URL(source.url);
      const title = source.title.replace(/\s+/g, " ").trim().slice(0, 180);
      if (!title || !(url.protocol === "https:" || url.protocol === "http:") || seen.has(url.href)) return [];
      seen.add(url.href);
      const date = typeof source.publishedAt === "string" && !Number.isNaN(new Date(source.publishedAt).getTime()) ? new Date(source.publishedAt).toISOString() : undefined;
      return [{ title, url: url.href, ...(date ? { publishedAt: date } : {}) }];
    } catch { return []; }
  }).slice(0, 5);
}

function safeWebGrounding(value: unknown): WebGrounding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const grounding = value as { intent?: unknown; state?: unknown; sourcesCount?: unknown; citations?: unknown; freshnessBlocked?: unknown };
  if (!(grounding.intent === "PREFERRED" || grounding.intent === "REQUIRED") || !(grounding.state === "verified" || grounding.state === "disabled" || grounding.state === "empty" || grounding.state === "degraded" || grounding.state === "unavailable" || grounding.state === "admission_denied") || typeof grounding.sourcesCount !== "number") return undefined;
  return { intent: grounding.intent, state: grounding.state, sourcesCount: Math.max(0, Math.min(5, Math.floor(grounding.sourcesCount))), citations: grounding.state === "verified" ? safeSourceEvidence(grounding.citations) : [], ...(grounding.freshnessBlocked === true ? { freshnessBlocked: true } : {}) };
}

function metadataAttachmentIds(metadata: unknown): string[] {
  if (!metadata) return [];
  let parsed = metadata;
  if (typeof metadata === "string") {
    try { parsed = JSON.parse(metadata); } catch { return []; }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { attachmentIds?: unknown }).attachmentIds)) return [];
  return (parsed as { attachmentIds: unknown[] }).attachmentIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)).slice(0, 4);
}

function metadataSourceEvidence(metadata: unknown): SourceEvidence[] {
  if (!metadata) return [];
  let parsed = metadata;
  if (typeof metadata === "string") {
    try { parsed = JSON.parse(metadata); } catch { return []; }
  }
  if (!parsed || typeof parsed !== "object") return [];
  return safeSourceEvidence((parsed as { sources?: unknown }).sources);
}

function AppDropdown({ value, onValueChange, options, ariaLabel }: { value: string; onValueChange: (value: string) => void; options: readonly { value: string; label: string; description?: string }[]; ariaLabel: string }) {
  const current = options.find((option) => option.value === value);
  return <Select value={value} onValueChange={onValueChange}><SelectTrigger role="combobox" aria-label={ariaLabel} className="w-full"><SelectValue>{current?.label ?? value}</SelectValue></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value} className="py-2"><span className="flex min-w-0 flex-col gap-0.5 text-left"><span className="break-words font-medium leading-5">{option.label}</span>{option.description && <span className="whitespace-normal break-words text-xs leading-5 text-muted-foreground">{option.description}</span>}</span></SelectItem>)}</SelectContent></Select>;
}
const AppSelect = AppDropdown;

const MODELS: readonly StaticModel[] = [
  { key: "fast", modelId: "fast", label: { ru: "Kairema Flash", en: "Kairema Flash" }, role: { ru: "Короткие повседневные ответы без ожидания.", en: "Fast answers for everyday questions." } },
  { key: "smart", modelId: "smart", label: { ru: "Kairema Think", en: "Kairema Think" }, role: { ru: "Логика, рассуждения и сложные задачи среднего объёма.", en: "Reasoning and medium-complexity tasks." } },
  { key: "context", modelId: "context", label: { ru: "Kairema Context", en: "Kairema Context" }, role: { ru: "Длинные документы, большие фрагменты текста и связный контекст.", en: "Long documents and connected context." } },
  { key: "flagship", modelId: "flagship", label: { ru: "Kairema Apex", en: "Kairema Apex" }, role: { ru: "Требовательные задачи, глубокий анализ и комплексные ответы.", en: "Deep analysis and complex responses." } },
];

const copy = {
  ru: { newChat: "Новый чат", models: "Роли", modelLimits: "Модели и лимиты", healthRefresh: "Обновление здоровья", history: "История", search: "Поиск", memory: "Память", settings: "Настройки", noHistory: "История пока пуста.", loginHistory: "Войти для истории", newConversation: "Новый разговор", loginChat: "Войдите, чтобы начать чат с Kairema", start: "Начните разговор с", secure: "Модели и ключи — только на сервере", light: "Светлая тема", dark: "Тёмная тема", language: "Язык", theme: "Тема", profile: "Профиль памяти", facts: "Факты памяти", addFact: "Добавить факт", clear: "Очистить память", autoMemory: "Автоматически извлекать новые факты", memoryEnabled: "Использовать память в ответах", response: "Ответ", style: "Стиль", length: "Длина", effort: "Усилия", thinking: "Дополнительное рассуждение", defaultRole: "Роль по умолчанию", web: "Web-поиск", webStatus: "Статус web-поиска", searchResults: "Результаты поиска", chats: "Чаты", messages: "Сообщения", save: "Изменения сохраняются автоматически", openSettings: "Открыть настройки", delete: "Удалить", unsupportedSearch: "Поиск недоступен", uploadFailed: "Не удалось загрузить вложение.", noSearch: "Ничего не найдено." },
  en: { newChat: "New chat", models: "Roles", modelLimits: "Models & limits", healthRefresh: "Health refresh", history: "History", search: "Search", memory: "Memory", settings: "Settings", noHistory: "No chat history yet.", loginHistory: "Sign in for history", newConversation: "New conversation", loginChat: "Sign in to start chatting with Kairema", start: "Start a conversation with", secure: "Models and keys stay on the server", light: "Light theme", dark: "Dark theme", language: "Language", theme: "Theme", profile: "Memory profile", facts: "Memory facts", addFact: "Add a fact", clear: "Clear memory", autoMemory: "Automatically extract new facts", memoryEnabled: "Use memory in replies", response: "Response", style: "Style", length: "Length", effort: "Effort", thinking: "Extra reasoning", defaultRole: "Default role", web: "Web search", webStatus: "Web search status", searchResults: "Search results", chats: "Chats", messages: "Messages", save: "Changes save automatically", openSettings: "Open settings", delete: "Delete", unsupportedSearch: "Search unavailable", uploadFailed: "Could not upload the attachment.", noSearch: "No results found." },
} as const;

const styles: Record<ResponseStyle, Record<Language, string>> = { default: { ru: "По умолчанию", en: "Default" }, professional: { ru: "Профессиональный", en: "Professional" }, friendly: { ru: "Дружелюбный", en: "Friendly" }, concise: { ru: "Кратко", en: "Concise" }, steps: { ru: "По шагам", en: "Step by step" } };
const lengths = { brief: { ru: "Кратко", en: "Brief" }, balanced: { ru: "Сбалансированно", en: "Balanced" }, detailed: { ru: "Подробно", en: "Detailed" } } as const;
const efforts = { low: { ru: "Низкие", en: "Low" }, standard: { ru: "Обычные", en: "Standard" }, high: { ru: "Высокие", en: "High" } } as const;

type PromptTemplate = { id: string; category: string; title: string; description: string; text: string; accent: string };
const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  { id: "youtube-analytics", category: "Аналитика", title: "YouTube-аналитика", description: "Разобрать результаты ролика и определить следующие действия.", text: "Проанализируй показатели YouTube-ролика [ССЫЛКА ИЛИ ДАННЫЕ]. Оцени CTR, удержание, источники трафика, вовлечённость и подписки. Отдели сильные сигналы от гипотез, найди 3 узких места и предложи конкретные изменения для следующего ролика: тема, заголовок, обложка, первые 30 секунд и призыв к действию.", accent: "red" },
  { id: "weekly-content-plan", category: "Планирование", title: "Контент-план на неделю", description: "Собрать публикации с целью, форматом и измеримым действием.", text: "Составь контент-план на 7 дней для [ПРОДУКТ ИЛИ ТЕМА] и аудитории [АУДИТОРИЯ]. Для каждого дня укажи: площадку, формат, тему, главный тезис, структуру, призыв к действию и метрику успеха. Распредели форматы так, чтобы неделя работала на [ЦЕЛЬ], а не повторяла один и тот же тип публикаций.", accent: "violet" },
  { id: "brand-content-strategy", category: "Стратегия", title: "Контент-стратегия бренда", description: "Сформировать устойчивую систему тем, рубрик и метрик.", text: "Разработай контент-стратегию для бренда [БРЕНД] в категории [КАТЕГОРИЯ]. Опиши целевую аудиторию, позиционирование, ключевое сообщение, 4–5 контент-рубрик, роли каналов, тон коммуникации, путь пользователя и KPI. Добавь примеры тем, контент-ритм на месяц и правила, по которым команда будет выбирать новые идеи.", accent: "amber" },
  { id: "explain", category: "Объяснение", title: "Объяснить просто", description: "Короткое понятное объяснение с примером.", text: "Объясни [ТЕМУ] простыми словами. Дай короткое определение, один пример и укажи, что важно не перепутать.", accent: "sky" },
  { id: "verify", category: "Проверка", title: "Проверить информацию", description: "Отделить подтверждённое от предположений.", text: "Проверь утверждение: [УТВЕРЖДЕНИЕ]. Отдели подтверждённые факты от неопределённости, приведи проверяемые источники и не выдумывай детали.", accent: "emerald" },
  { id: "edit", category: "Текст", title: "Отредактировать текст", description: "Сохранить смысл и улучшить ясность.", text: "Отредактируй текст ниже: [[ТЕКСТ]]. Сохрани смысл, исправь ошибки и верни: 1) улучшенную версию, 2) список ключевых изменений.", accent: "amber" },
  { id: "document", category: "Анализ", title: "Разобрать документ", description: "Выделить тезисы, риски и вопросы.", text: "Проанализируй документ: [[ДОКУМЕНТ ИЛИ ВЛОЖЕНИЕ]]. Выдели главные тезисы, важные факты, риски, неясные места и вопросы для уточнения.", accent: "rose" },
  { id: "compare", category: "Выбор", title: "Сравнить варианты", description: "Таблица плюсов, минусов и условий выбора.", text: "Сравни варианты [[ВАРИАНТ А]] и [[ВАРИАНТ Б]] по критериям: стоимость, риски, сроки, удобство и ограничения. Покажи вывод с условиями, при которых стоит выбрать каждый вариант.", accent: "cyan" },
  { id: "study", category: "Обучение", title: "Разобрать тему", description: "Объяснение от базы к практике.", text: "Помоги изучить [[ТЕМУ]]. Объясни основу, составь мини-урок на 20 минут, дай 3 контрольных вопроса и короткое практическое задание.", accent: "indigo" },
  { id: "review", category: "Код", title: "Проверить код", description: "Найти ошибки, риски и улучшения.", text: "Проведи code review этого фрагмента: [[КОД]]. Сначала назови критические проблемы, затем риски и улучшения. Для каждого замечания предложи конкретное исправление.", accent: "orange" },
];

function TemplateTokenText({ text }: { text: string }) {
  return <>{text.split(/(\[[^\]]+\])/g).map((part, index) => part.startsWith("[") && part.endsWith("]") ? <span key={`${part}-${index}`} className="kairema-template-token">{part}</span> : <span key={`text-${index}`}>{part}</span>)}</>;
}

function PromptTemplatesDialog({ open, onOpenChange, onInsert, onCopy }: { open: boolean; onOpenChange: (open: boolean) => void; onInsert: (template: PromptTemplate) => void; onCopy: (template: PromptTemplate) => void }) {
  const [category, setCategory] = useState("Все");
  const categories = ["Все", ...Array.from(new Set(PROMPT_TEMPLATES.map((template) => template.category)))];
  const templates = category === "Все" ? PROMPT_TEMPLATES : PROMPT_TEMPLATES.filter((template) => template.category === category);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="kairema-dialog kairema-dialog-wide"><DialogHeader><DialogTitle>Шаблоны промптов</DialogTitle></DialogHeader><p className="kairema-dialog-note">Выберите основу для запроса. Замените токены в квадратных скобках своими деталями.</p><div className="kairema-template-filters" aria-label="Категории шаблонов">{categories.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="kairema-template-grid">{templates.map((template) => <article className={`kairema-template-card kairema-template-${template.accent}`} key={template.id}><div className="kairema-template-card-head"><span className="kairema-template-category">{template.category}</span><h3>{template.title}</h3><p>{template.description}</p></div><pre className="kairema-template-text"><TemplateTokenText text={template.text} /></pre><div className="kairema-template-actions"><button type="button" onClick={() => onCopy(template)}><Copy className="size-3.5" />Копировать</button><button type="button" className="kairema-template-insert" onClick={() => onInsert(template)}><Sparkles className="size-3.5" />Вставить в запрос</button></div></article>)}</div></DialogContent></Dialog>;
}

function statusClass(status?: PublicStatus) { return status?.state === "ready" || status?.state === "fallback" ? "status-ready" : status?.category === "RATE_LIMIT" || status?.category === "QUOTA" ? "status-quota" : status?.state === "not_configured" ? "status-muted" : status?.state === "unavailable" ? "status-unavailable" : status?.state === "loading" ? "status-loading" : "status-auth"; }
function StatusIndicator({ status }: { status?: PublicStatus }) { const label = status?.badge ?? "…"; const Icon = status?.state === "ready" ? CircleCheck : status?.category === "RATE_LIMIT" || status?.category === "QUOTA" ? Gauge : status?.state === "loading" || !status ? LoaderCircle : TriangleAlert; return <span className={`kairema-status ${statusClass(status)}`} title={status?.confirmed ?? label}><Icon className={`size-3 ${status?.state === "loading" || !status ? "animate-spin" : ""}`} /><span>{label}</span></span>; }
function bytes(value: number) { return value < 1_000_000 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1_000_000).toFixed(1)} MB`; }
function metadataSearchStatus(metadata: unknown): SearchStatus | undefined { try { const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata; return safeSearchStatus(parsed?.searchStatus); } catch { return undefined; } }
function metadataWebGrounding(metadata: unknown): WebGrounding | undefined { try { const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata; return safeWebGrounding(parsed?.webGrounding); } catch { return undefined; } }
function contentType(file: File) { if (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp" || file.type === "application/pdf" || file.type === "text/plain" || file.type === "text/markdown") return file.type; return file.name.toLowerCase().endsWith(".md") ? "text/markdown" : null; }

type DirectUploadResponse = { id: string; fileName: string; contentType: string; byteSize: number; kind: "image" | "document"; previewUrl?: string };

async function uploadFileBytes(sessionId: string, file: File, mimeType: string): Promise<DirectUploadResponse> {
  const response = await fetch("/api/attachments/upload", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/octet-stream",
      "Accept": "application/json",
      "X-Attachment-Session-Id": sessionId,
      "X-Attachment-File-Name": encodeURIComponent(file.name),
      "X-Attachment-Content-Type": mimeType,
      ...runtimeAuthHeaders(),
    },
    body: file,
  });
  const isJson = response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
  const payload: unknown = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string" ? (payload as { error: string }).error : "Сервис загрузки вернул некорректный ответ. Повторите попытку.";
    throw new Error(error);
  }
  if (!payload || typeof payload !== "object") throw new Error("Сервис загрузки вернул некорректный ответ. Повторите попытку.");
  const item = payload as Partial<DirectUploadResponse>;
  if (typeof item.id !== "string" || typeof item.fileName !== "string" || typeof item.contentType !== "string" || !Number.isFinite(item.byteSize) || (item.kind !== "image" && item.kind !== "document") || (item.previewUrl !== undefined && typeof item.previewUrl !== "string")) throw new Error("Сервис загрузки вернул некорректный ответ. Повторите попытку.");
  return item as DirectUploadResponse;
}
function errorPayloadMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return errorPayloadMessage(record.message) ?? errorPayloadMessage(record.error) ?? errorPayloadMessage(record.detail);
}
function publicErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : errorPayloadMessage(error) ?? fallback;
}
async function streamStartErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return fallback;
  try {
    return errorPayloadMessage(JSON.parse(body)) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function Home() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { theme, toggleTheme, setHighContrast } = useTheme();
  const [activeId, setActiveId] = useState(""); const [newConversation, setNewConversation] = useState(false); const [modelId, setModelId] = useState<ModelId>("fast"); const [search, setSearch] = useState(""); const [uploadStatus, setUploadStatus] = useState<{ sessionId: string; message: string } | null>(null); const [sidebarOpen, setSidebarOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [memoryOpen, setMemoryOpen] = useState(false); const [exportHistoryOpen, setExportHistoryOpen] = useState(false); const [templatesOpen, setTemplatesOpen] = useState(false); const [pendingChatDeletionId, setPendingChatDeletionId] = useState<string | null>(null); const [isChatDeletionConfirming, setIsChatDeletionConfirming] = useState(false); const [pendingHistoryClear, setPendingHistoryClear] = useState(false); const [isHistoryClearConfirming, setIsHistoryClearConfirming] = useState(false); const [composerDraft, setComposerDraft] = useState(""); const [draftHydratedSessionId, setDraftHydratedSessionId] = useState(""); const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]); const [sentAttachmentFallbacks, setSentAttachmentFallbacks] = useState<ChatAttachment[]>([]); const [isStreaming, setIsStreaming] = useState(false); const [isExporting, setIsExporting] = useState<"markdown" | "pdf" | null>(null); const [notice, setNotice] = useState(""); const [settingsOverride, setSettingsOverride] = useState<Record<string, unknown>>({});
  const streamAbortRef = useRef<AbortController | null>(null); const activeSessionRef = useRef(""); const pagedHistorySessionRef = useRef(""); const deleteConfirmationInFlightRef = useRef(false); const historyClearInFlightRef = useRef(false); const defaultRoleApplied = useRef(false); const themeApplied = useRef(false); const persistedDraftRef = useRef("");
  const [olderHistoryMessages, setOlderHistoryMessages] = useState<any[]>([]); const [olderHistoryCursor, setOlderHistoryCursor] = useState<string | null | undefined>(undefined); const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  const modelsQuery = trpc.models.list.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true }); const settingsQuery = trpc.settings.get.useQuery(undefined, { enabled: isAuthenticated }); const healthRefreshSeconds = Number(settingsQuery.data?.healthRefreshSeconds ?? 30); const memoryQuery = trpc.memory.get.useQuery(undefined, { enabled: isAuthenticated }); const webStatusQuery = trpc.webSearch.status.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 120_000 }); const knowledgeStatusQuery = trpc.knowledge.status.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 120_000 }); const providerDashboardQuery = trpc.providers.dashboard.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: healthRefreshSeconds > 0 ? healthRefreshSeconds * 1_000 : false, refetchOnWindowFocus: true }); const knowledgeAuditQuery = trpc.knowledge.audit.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 120_000 }); const sessionsQuery = trpc.chats.list.useQuery(undefined, { enabled: isAuthenticated, refetchOnWindowFocus: true }); const messagesQuery = trpc.chats.historyPage.useQuery({ sessionId: activeId, limit: 60 }, { enabled: isAuthenticated && Boolean(activeId) }); const attachmentsQuery = trpc.attachments.list.useQuery({ sessionId: activeId }, { enabled: isAuthenticated && Boolean(activeId) }); const draftQuery = trpc.chats.draft.useQuery({ sessionId: activeId }, { enabled: isAuthenticated && Boolean(activeId), refetchOnWindowFocus: false }); const exportsQuery = trpc.exports.list.useQuery(undefined, { enabled: isAuthenticated && exportHistoryOpen }); const searchQuery = trpc.search.query.useQuery({ query: search }, { enabled: isAuthenticated && search.trim().length >= 2 }); const ownerQuery = trpc.owner.isOwner.useQuery(undefined, { enabled: isAuthenticated, staleTime: 300_000 });
  const createMutation = trpc.chats.create.useMutation(); const deleteChatMutation = trpc.chats.delete.useMutation(); const clearHistoryMutation = trpc.chats.clearAll.useMutation(); const draftSaveMutation = trpc.chats.saveDraft.useMutation(); const draftClearMutation = trpc.chats.clearDraft.useMutation(); const settingMutation = trpc.settings.update.useMutation(); const memoryUpdateMutation = trpc.memory.update.useMutation(); const memoryAddMutation = trpc.memory.addFact.useMutation(); const memoryDeleteMutation = trpc.memory.deleteEntry.useMutation(); const memoryClearMutation = trpc.memory.clear.useMutation(); const attachmentDeleteMutation = trpc.attachments.delete.useMutation(); const exportCreateMutation = trpc.exports.create.useMutation(); const exportDeleteMutation = trpc.exports.delete.useMutation(); const knowledgeRefreshMutation = trpc.knowledge.refresh.useMutation(); const utils = trpc.useUtils();
  const settings = { ...(settingsQuery.data ?? { language: "ru" as Language, theme: "dark" as const, responseStyle: "default" as ResponseStyle, responseLength: "balanced" as const, effort: "standard" as const, thinking: 0, defaultRole: "fast" as ModelId, webSearch: 0, healthRefreshSeconds: 30, highContrast: 0 }), ...settingsOverride } as { language: Language; theme: "dark" | "light"; responseStyle: ResponseStyle; responseLength: "balanced" | "brief" | "detailed"; effort: "low" | "standard" | "high"; thinking: boolean | number; defaultRole: ModelId; webSearch: boolean | number; healthRefreshSeconds: 0 | 15 | 30 | 60; highContrast: boolean | number };
  const language = settings.language as Language; const t = copy[language]; const sessions = sessionsQuery.data ?? []; const selectedModel = MODELS.find((item) => item.modelId === modelId) ?? MODELS[0]; const activeSession = sessions.find((session) => session.id === activeId); const attachments = attachmentsQuery.data ?? [];
  const modelViews = useMemo<PublicModel[]>(() => { const byId = new Map((modelsQuery.data as PublicModel[] | undefined)?.map((model) => [model.modelId, model]) ?? []); return MODELS.map((model) => ({ ...model, status: byId.get(model.modelId)?.status, runtime: byId.get(model.modelId)?.runtime ?? null, limits: byId.get(model.modelId)?.limits })); }, [modelsQuery.data]); const modelById = useMemo(() => new Map(modelViews.map((model) => [model.modelId, model])), [modelViews]);
  const attachmentsById = new Map([...sentAttachmentFallbacks, ...attachments.map((attachment) => ({ id: attachment.id, fileName: attachment.fileName, mimeType: attachment.contentType, sizeBytes: attachment.byteSize, kind: attachment.kind, previewUrl: attachment.previewUrl } satisfies ChatAttachment))].map((attachment) => [attachment.id, attachment]));
  const historyRows = [...olderHistoryMessages, ...(messagesQuery.data?.messages ?? [])]; const uniqueHistoryRows = [...new Map(historyRows.map((message) => [String(message.id), message])).values()].sort((left: any, right: any) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || String(left.id).localeCompare(String(right.id)));
  const dbMessages = uniqueHistoryRows.map((message): Message => { const attachmentIds = message.role === "user" ? metadataAttachmentIds((message as { metadata?: unknown }).metadata) : []; const messageAttachments = attachmentIds.map((attachmentId) => attachmentsById.get(attachmentId)).filter((attachment): attachment is ChatAttachment => Boolean(attachment)); const metadata = (message as { metadata?: unknown }).metadata; return { id: String(message.id), role: message.role, content: message.content, providerLabel: message.role === "assistant" ? modelById.get(message.modelId as ModelId)?.label[language] ?? "Kairema" : undefined, model: message.role === "assistant" ? message.modelId ?? "" : undefined, status: message.role === "assistant" ? (language === "ru" ? "полный ответ" : "complete") : undefined, createdAt: message.createdAt, ...(message.role === "assistant" ? { searchStatus: metadataSearchStatus(metadata), sources: metadataSourceEvidence(metadata), webGrounding: metadataWebGrounding(metadata) } : {}), ...(messageAttachments.length ? { attachments: messageAttachments } : {}) }; }); const visibleMessages = [...dbMessages, ...optimisticMessages];
  const results = (searchQuery.data ?? []) as SearchItem[]; const sessionMatches = search.trim().length >= 2 ? [] : sessions.filter((session) => session.title.toLocaleLowerCase(language === "ru" ? "ru-RU" : "en-US").includes(search.toLocaleLowerCase()));

  useEffect(() => {
    if (sessions.length && !activeId && !newConversation) {
      const initial = sessions[0]!;
      setActiveId(initial.id);
      setNewConversation(false);
      setModelId(modelById.has(initial.modelId as ModelId) ? initial.modelId as ModelId : settings.defaultRole as ModelId);
    }
  }, [activeId, modelById, newConversation, sessions, settings.defaultRole]);
  useEffect(() => { if (!activeId && settingsQuery.data?.defaultRole && !defaultRoleApplied.current) { setModelId(settingsQuery.data.defaultRole as ModelId); defaultRoleApplied.current = true; } }, [activeId, settingsQuery.data?.defaultRole]);
  useEffect(() => { if (!themeApplied.current && settingsQuery.data?.theme) { if (settingsQuery.data.theme !== theme) toggleTheme?.(); themeApplied.current = true; } }, [settingsQuery.data?.theme, theme, toggleTheme]);
  useEffect(() => { if (settingsQuery.data?.highContrast !== undefined) setHighContrast?.(Boolean(settingsQuery.data.highContrast)); }, [settingsQuery.data?.highContrast, setHighContrast]);
  useEffect(() => { pagedHistorySessionRef.current = activeId; setOlderHistoryMessages([]); setOlderHistoryCursor(undefined); setIsLoadingOlderHistory(false); setOptimisticMessages([]); setSentAttachmentFallbacks([]); setComposerDraft(""); setDraftHydratedSessionId(""); }, [activeId]); useEffect(() => () => streamAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!activeId || !isAuthenticated || draftQuery.isLoading || draftHydratedSessionId === activeId) return;
    const restored = typeof draftQuery.data?.content === "string" ? draftQuery.data.content : "";
    setComposerDraft(restored);
    setDraftHydratedSessionId(activeId);
    persistedDraftRef.current = `${activeId}\u0000${restored}`;
  }, [activeId, draftHydratedSessionId, draftQuery.data?.content, draftQuery.isLoading, isAuthenticated]);
  useEffect(() => {
    if (!activeId || !isAuthenticated || draftHydratedSessionId !== activeId) return;
    const signature = `${activeId}\u0000${composerDraft}`;
    if (signature === persistedDraftRef.current) return;
    const timer = window.setTimeout(() => {
      const mutation = composerDraft.trim() ? draftSaveMutation.mutateAsync({ sessionId: activeId, content: composerDraft }) : draftClearMutation.mutateAsync({ sessionId: activeId });
      void mutation.then(() => { persistedDraftRef.current = signature; }).catch(() => setNotice(language === "ru" ? "Не удалось сохранить черновик. Текст остаётся в поле." : "Could not save the draft. The text remains in the composer."));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeId, composerDraft, draftClearMutation, draftHydratedSessionId, draftSaveMutation, isAuthenticated, language]);
  const persistSettings = async (patch: Record<string, unknown>) => { if (typeof patch.highContrast === "boolean") setHighContrast?.(patch.highContrast); setSettingsOverride((current) => ({ ...current, ...patch })); try { await settingMutation.mutateAsync(patch as never); await utils.settings.get.invalidate(); } catch (error) { if ((patch.theme === "dark" || patch.theme === "light") && patch.theme !== theme) toggleTheme?.(); if (typeof patch.highContrast === "boolean") setHighContrast?.(Boolean(settingsQuery.data?.highContrast)); setSettingsOverride({}); setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось сохранить настройку." : "Could not save the setting.")); } };
  const toolAccessEnabled = Boolean((settings as { toolAccess?: boolean | number }).toolAccess ?? true);
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(".kairema-select-wrap");
    const native = host?.querySelector<HTMLSelectElement>("select");
    if (!host || !native || host.querySelector("[data-kairema-role-menu]")) return;
    native.style.display = "none";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "kairema-role-menu-trigger";
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = modelViews.find((model) => model.modelId === modelId)?.label[language] ?? "Kairema";
    const menu = document.createElement("div");
    menu.className = "kairema-role-menu";
    menu.dataset.kairemaRoleMenu = "true";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    const close = () => { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
    trigger.addEventListener("click", () => { const open = menu.hidden; menu.hidden = !open; trigger.setAttribute("aria-expanded", String(open)); });
    for (const model of modelViews) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `kairema-role-menu-item ${model.modelId === modelId ? "kairema-role-menu-item-active" : ""}`;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(model.modelId === modelId));
      const copy = document.createElement("span"); copy.className = "kairema-role-menu-copy";
      const title = document.createElement("strong"); title.textContent = model.label[language];
      const description = document.createElement("small"); description.textContent = model.role[language];
      copy.append(title, description);
      const badge = document.createElement("span"); badge.className = `kairema-status ${statusClass(model.status)}`; badge.textContent = model.status?.badge ?? "…";
      item.append(copy, badge);
      item.addEventListener("click", () => { setModelId(model.modelId); close(); });
      menu.append(item);
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onPointerDown = (event: PointerEvent) => { if (!host.contains(event.target as Node)) close(); };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    if (settingsOpen || memoryOpen || sidebarOpen) close();
    host.append(trigger, menu);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onPointerDown); trigger.remove(); menu.remove(); native.style.display = ""; };
  }, [language, memoryOpen, modelId, modelViews, settingsOpen, sidebarOpen]);
  const loadOlderHistory = async () => {
    const cursor = olderHistoryCursor === undefined ? messagesQuery.data?.nextCursor : olderHistoryCursor;
    if (!activeId || !cursor || isLoadingOlderHistory) return;
    const sessionId = activeId;
    setIsLoadingOlderHistory(true);
    try {
      const page = await utils.chats.historyPage.fetch({ sessionId, before: cursor, limit: 60 });
      if (pagedHistorySessionRef.current === sessionId) {
        setOlderHistoryMessages((current) => [...page.messages, ...current]);
        setOlderHistoryCursor(page.nextCursor);
      }
    } catch (error) {
      if (pagedHistorySessionRef.current === sessionId) setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось загрузить более ранние сообщения." : "Could not load earlier messages."));
    } finally {
      if (pagedHistorySessionRef.current === sessionId) setIsLoadingOlderHistory(false);
    }
  };
  const createChat = async () => {
    if (!isAuthenticated) return startLogin();
    const safeModelId = modelById.has(modelId) ? modelId : settings.defaultRole as ModelId;
    try {
      const session = await createMutation.mutateAsync({ modelId: safeModelId });
      setModelId(safeModelId);
      activeSessionRef.current = session.id;
        activeSessionRef.current = session.id;
        setActiveId(session.id);
      setUploadStatus(null);
      setNewConversation(false);
      setSidebarOpen(false);
      await utils.chats.list.invalidate();
      return session.id;
    } catch (error) {
      setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось создать новый чат." : "Could not create a new chat."));
      return undefined;
    }
  };
  const selectSession = (id: string, sessionModel?: string) => { activeSessionRef.current = id; setActiveId(id); setUploadStatus(null); setNewConversation(false); if (sessionModel && modelById.has(sessionModel as ModelId)) setModelId(sessionModel as ModelId); setSidebarOpen(false); };
  const send = async (content: string, options?: { attachmentIds?: string[]; attachments?: ChatAttachment[]; clientMessageId?: string }): Promise<boolean> => {
    if (!isAuthenticated) { startLogin(); return false; }
    const sessionId = activeId || await createChat();
    if (!sessionId) return false;
    setComposerDraft(""); persistedDraftRef.current = `${sessionId}\u0000`;
    const selectedId = modelId;
    const assistantId = `stream-${Date.now()}`;
    const label = selectedModel.label[language];
    if (options?.attachments?.length) setSentAttachmentFallbacks((current) => [...current.filter((attachment) => !options.attachments!.some((item) => item.id === attachment.id)), ...options.attachments!]);
    setOptimisticMessages([{ id: `user-${Date.now()}`, role: "user", content, attachments: options?.attachments }, { id: assistantId, role: "assistant", content: "", providerLabel: label, model: selectedId, status: language === "ru" ? "печатает" : "typing" }]);
    setIsStreaming(true);
    const controller = new AbortController();
    streamAbortRef.current = controller;
    try {
      const response = await fetch("/api/chat/stream", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...runtimeAuthHeaders() }, signal: controller.signal, body: JSON.stringify({ sessionId, modelId: selectedId, content, settings: { style: settings.responseStyle, responseLength: settings.responseLength, effort: settings.effort, thinking: Boolean(settings.thinking), toolAccess: toolAccessEnabled }, attachmentIds: options?.attachmentIds, clientMessageId: options?.clientMessageId }) });
      if (!response.ok || !response.body) throw new Error(await streamStartErrorMessage(response, language === "ru" ? "Не удалось начать потоковый ответ." : "Could not start the stream."));
      await consumeChatStream(response, { onDelta: (delta) => setOptimisticMessages((items) => items.map((message) => message.id === assistantId ? { ...message, content: message.content + delta } : message)), onDone: (data) => setOptimisticMessages((items) => items.map((message) => message.id === assistantId ? { ...message, content: typeof data.content === "string" ? data.content : message.content, model: typeof data.modelUsed === "string" ? data.modelUsed : message.model, providerLabel: typeof data.label === "string" ? data.label : message.providerLabel, status: language === "ru" ? "полный ответ" : "complete", searchStatus: safeSearchStatus(data.searchStatus), sources: safeSourceEvidence(data.sources), webGrounding: safeWebGrounding(data.webGrounding) } : message)) });
      try {
        await utils.chats.historyPage.fetch({ sessionId, limit: 60 });
        setOptimisticMessages([]);
      } catch {
        // historyPage refetch failed: keep the just-received optimistic messages visible.
      }
      await Promise.all([utils.chats.list.invalidate(), utils.attachments.list.invalidate({ sessionId }), utils.models.list.invalidate(), utils.knowledge.status.invalidate()]);
      setComposerDraft("");
      try { await draftClearMutation.mutateAsync({ sessionId }); persistedDraftRef.current = `${sessionId}\u0000`; } catch { setNotice(language === "ru" ? "Ответ отправлен; очистка черновика будет повторена автоматически." : "The reply was sent; clearing the draft will retry automatically."); }
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") { setOptimisticMessages([]); await Promise.all([utils.chats.historyPage.invalidate({ sessionId, limit: 60 }), utils.attachments.list.invalidate({ sessionId })]); return true; }
      const errorMessage = error instanceof Error ? error.message : "Stream error";
      setOptimisticMessages((items) => [...items.filter((item) => item.id !== assistantId), { id: `stream-error-${Date.now()}`, role: "assistant", content: errorMessage, providerLabel: "Kairema", model: selectedId, status: language === "ru" ? "ошибка" : "error", isError: true }]);
      await Promise.all([utils.chats.historyPage.invalidate({ sessionId, limit: 60 }), utils.attachments.list.invalidate({ sessionId })]);
      return true;
    } finally { streamAbortRef.current = null; setIsStreaming(false); }
  };
  const uploadFiles = async (files: File[]) => { if (!isAuthenticated) { startLogin(); return { attachments: [], sessionId: activeSessionRef.current }; } const sessionId = activeId || await createChat(); if (!sessionId) return { attachments: [], sessionId: activeSessionRef.current }; const setScopedUploadStatus = (message: string) => { if (activeSessionRef.current === sessionId) setUploadStatus({ sessionId, message }); }; const accepted = files.filter((file) => contentType(file) && file.size > 0 && file.size <= 8 * 1024 * 1024); if (accepted.length !== files.length) setNotice(language === "ru" ? "Можно загрузить только PNG, JPG, WEBP, PDF, TXT или MD размером до 8 МБ." : "Only PNG, JPG, WEBP, PDF, TXT or MD files up to 8 MB can be uploaded."); const uploaded: ChatAttachment[] = []; for (const [index, file] of accepted.entries()) { try { const mimeType = contentType(file); if (!mimeType) continue; setScopedUploadStatus(language === "ru" ? `Загрузка ${index + 1} из ${accepted.length}: ${file.name}` : `Uploading ${index + 1} of ${accepted.length}: ${file.name}`); const item = await uploadFileBytes(sessionId, file, mimeType); uploaded.push({ id: item.id, fileName: item.fileName, mimeType: item.contentType, sizeBytes: item.byteSize, kind: item.kind, previewUrl: item.previewUrl }); } catch (error) { setNotice(publicErrorMessage(error, t.uploadFailed)); } } if (uploaded.length) await utils.attachments.list.invalidate({ sessionId }); setScopedUploadStatus(uploaded.length === accepted.length ? (language === "ru" ? `Загрузка завершена: ${uploaded.length} файл(а).` : `Upload complete: ${uploaded.length} file(s).`) : (language === "ru" ? `Загружено файлов: ${uploaded.length} из ${accepted.length}.` : `Uploaded ${uploaded.length} of ${accepted.length} file(s).`)); return { attachments: uploaded, sessionId }; };
  const removeTemporaryAttachment = async (attachment: ChatAttachment) => { try { await attachmentDeleteMutation.mutateAsync({ attachmentId: attachment.id }); if (activeId) await utils.attachments.list.invalidate({ sessionId: activeId }); } catch (error) { setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось удалить вложение." : "Could not remove the attachment.")); throw error; } };
  const cancelStream = () => streamAbortRef.current?.abort(); const copyMessage = async (message: Message) => { try { await navigator.clipboard.writeText(message.content); setNotice(language === "ru" ? "Сообщение скопировано в буфер обмена." : "Message copied to clipboard."); } catch { setNotice(language === "ru" ? "Не удалось скопировать сообщение." : "Could not copy the message."); } };
  const confirmChatDeletion = async () => { const sessionId = pendingChatDeletionId; if (!sessionId || deleteConfirmationInFlightRef.current) return; deleteConfirmationInFlightRef.current = true; setIsChatDeletionConfirming(true); setPendingChatDeletionId(null); const deletingActive = activeId === sessionId; if (deletingActive) { streamAbortRef.current?.abort(); setIsStreaming(false); setOptimisticMessages([]); activeSessionRef.current = ""; setActiveId(""); setUploadStatus(null); setNewConversation(true); } try { await deleteChatMutation.mutateAsync({ sessionId }); await Promise.all([utils.chats.list.invalidate(), ...(deletingActive ? [utils.chats.historyPage.invalidate({ sessionId, limit: 60 })] : [])]); } catch (error) { if (deletingActive) setNotice(language === "ru" ? "Чат уже скрыт. Обновите историю, если он всё ещё отображается." : "The chat is already hidden. Refresh history if it remains visible."); else setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось удалить чат." : "Could not delete the chat.")); } finally { deleteConfirmationInFlightRef.current = false; setIsChatDeletionConfirming(false); } };
  const confirmHistoryClear = async () => { if (historyClearInFlightRef.current) return; historyClearInFlightRef.current = true; setIsHistoryClearConfirming(true); setPendingHistoryClear(false); const previousActiveId = activeId; streamAbortRef.current?.abort(); setIsStreaming(false); setOptimisticMessages([]); try { await clearHistoryMutation.mutateAsync(); activeSessionRef.current = ""; setActiveId(""); setUploadStatus(null); setSentAttachmentFallbacks([]); setNewConversation(true); await Promise.all([utils.chats.list.invalidate(), utils.memory.get.invalidate(), ...(previousActiveId ? [utils.chats.historyPage.invalidate({ sessionId: previousActiveId, limit: 60 }), utils.attachments.list.invalidate({ sessionId: previousActiveId })] : [])]); setNotice(language === "ru" ? "История чатов очищена." : "Chat history cleared."); } catch (error) { setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось очистить историю чатов." : "Could not clear chat history.")); } finally { historyClearInFlightRef.current = false; setIsHistoryClearConfirming(false); } };
  const downloadPersistentExport = async (exportId: string, fileName: string) => { const download = await utils.exports.download.fetch({ exportId }); const link = document.createElement("a"); link.href = download.url; link.download = fileName; link.target = "_blank"; link.rel = "noopener noreferrer"; document.body.append(link); link.click(); link.remove(); };
  const exportCurrentChat = async (format: "markdown" | "pdf") => { if (!activeSession || !dbMessages.length || isExporting) return; setIsExporting(format); try { const record = await exportCreateMutation.mutateAsync({ sessionId: activeSession.id, format }); await utils.exports.list.invalidate(); await downloadPersistentExport(record.id, record.fileName); setNotice(language === "ru" ? "Экспорт создан и сохранён в истории." : "Export created and saved to history."); } catch (error) { setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось создать экспорт." : "Could not create export.")); } finally { setIsExporting(null); } };
  const deletePersistentExport = async (exportId: string) => { try { await exportDeleteMutation.mutateAsync({ exportId }); await utils.exports.list.invalidate(); setNotice(language === "ru" ? "Экспорт удалён из истории." : "Export removed from history."); } catch (error) { setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось удалить экспорт." : "Could not delete export.")); } };

  useEffect(() => {
    const footer = document.querySelector<HTMLElement>(".kairema-sidebar-footer");
    if (!footer || !isAuthenticated) return;
    const labels = language === "ru" ? { providers: "Провайдеры", rag: "Аудит RAG", close: "Закрыть", publicOnly: "Показываются только публичные сервисы. Серверные резервы, ключи и цепочки маршрутизации не раскрываются.", checked: "Проверено", next: "Следующая проверка", usage: "Успешных ответов сегодня", documents: "Фрагментов", domain: "Домен", status: "Статус", lastRun: "Последний запуск", uptime24: "Доступность за 24 часа", uptime7: "Доступность за 7 дней", timeline: "Последние 24 часа", events: "Последние события", healthy: "Все публичные сервисы доступны", degraded: "Есть ограниченные или недоступные сервисы" } : { providers: "Providers", rag: "RAG audit", close: "Close", publicOnly: "Only public services are shown. Server reserves, keys, and routing chains are not exposed.", checked: "Checked", next: "Next check", usage: "Successful answers today", documents: "Excerpts", domain: "Domain", status: "Status", lastRun: "Latest run", uptime24: "24-hour availability", uptime7: "7-day availability", timeline: "Last 24 hours", events: "Recent events", healthy: "All public services are available", degraded: "Some services are limited or unavailable" };
    const format = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
    const overlay = document.createElement("div"); overlay.className = "kairema-ops-overlay"; overlay.hidden = true;
    const panel = document.createElement("section"); panel.className = "kairema-ops-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); overlay.append(panel);
    const close = () => { overlay.hidden = true; panel.replaceChildren(); };
    const line = (title: string, value: string) => { const item = document.createElement("p"); const strong = document.createElement("b"); strong.textContent = `${title}: `; item.append(strong, value); return item; };
    const open = (kind: "providers" | "rag") => {
      panel.replaceChildren();
      const header = document.createElement("header"); const title = document.createElement("h2"); title.textContent = kind === "providers" ? labels.providers : labels.rag; const closeButton = document.createElement("button"); closeButton.type = "button"; closeButton.className = "kairema-icon-btn"; closeButton.textContent = "×"; closeButton.setAttribute("aria-label", labels.close); closeButton.addEventListener("click", close); header.append(title, closeButton); panel.append(header);
      const note = document.createElement("p"); note.className = "kairema-dialog-note"; note.textContent = kind === "providers" ? labels.publicOnly : language === "ru" ? "Источники RAG ограничены официальными RSS-лентами; атрибуция конкретного ответа отображается под ним." : "RAG sources are limited to official RSS feeds; attribution for a specific response appears beneath it."; panel.append(note);
      const list = document.createElement("div"); list.className = "kairema-ops-list";
      if (kind === "providers") {
        const entries = providerDashboardQuery.data ?? [];
        entries.forEach((entry) => { const card = document.createElement("article"); card.className = "kairema-ops-card"; const heading = document.createElement("h3"); heading.textContent = entry.label; card.append(heading, line(language === "ru" ? "Состояние" : "State", entry.capacity), line(labels.checked, format(entry.checkedAt)), line(labels.next, format(entry.nextCheckAt))); if (entry.usageToday !== null && entry.usageToday !== undefined) card.append(line(labels.usage, String(entry.usageToday))); if (entry.uptime30d?.samples) card.append(line(language === "ru" ? "Доступность за 30 дней" : "30-day availability", `${entry.uptime30d.uptime}%`)); const availability = entry.availability; if (availability) { card.append(line(labels.uptime24, availability.uptime24h.samples ? `${availability.uptime24h.uptime}%` : "—"), line(labels.uptime7, availability.uptime7d.samples ? `${availability.uptime7d.uptime}%` : "—")); const history = document.createElement("div"); history.className = "kairema-availability-history"; const historyLabel = document.createElement("span"); historyLabel.textContent = labels.timeline; const segments = document.createElement("div"); segments.className = "kairema-availability-segments"; availability.segments24h.forEach((segment) => { const cell = document.createElement("span"); cell.className = `kairema-availability-cell kairema-availability-${segment.state}`; cell.title = `${format(segment.hourStart)} · ${segment.state}`; cell.setAttribute("aria-label", cell.title); segments.append(cell); }); history.append(historyLabel, segments); card.append(history); if (availability.events.length) { const events = document.createElement("ul"); events.className = "kairema-availability-events"; const eventsTitle = document.createElement("li"); eventsTitle.textContent = labels.events; eventsTitle.className = "kairema-availability-events-title"; events.append(eventsTitle); availability.events.forEach((event) => { const item = document.createElement("li"); item.textContent = `${format(event.occurredAt)} · ${event.state}`; events.append(item); }); card.append(events); } } list.append(card); });
        const searchStatus = webStatusQuery.data;
        if (searchStatus) {
          const card = document.createElement("article"); card.className = "kairema-ops-card";
          const heading = document.createElement("h3"); heading.textContent = language === "ru" ? "Поиск" : "Search"; card.append(heading);
          card.append(line(language === "ru" ? "Общее состояние" : "Overall state", searchStatus.available ? (language === "ru" ? "Доступен" : "Available") : (language === "ru" ? "Временно ограничен" : "Temporarily limited")), line(labels.checked, format(searchStatus.checkedAt)));
          (searchStatus.layers ?? []).forEach((layer) => { const name = layer.id === "you" ? "You.com" : layer.id === "serper" ? "Serper" : layer.id === "exa" ? "Exa" : "Поисковый слой"; const state = layer.state === "ready" ? (language === "ru" ? "Доступен" : "Available") : layer.state === "limited" ? (language === "ru" ? "Ожидает сброса лимита" : "Waiting for limit reset") : layer.state === "unavailable" ? (language === "ru" ? "Временно недоступен" : "Temporarily unavailable") : (language === "ru" ? "Проверяется" : "Checking"); card.append(line(name, layer.retryAt ? `${state} · ${language === "ru" ? "повтор" : "retry"}: ${format(layer.retryAt)}` : state)); });
          list.append(card);
        }
        if (!entries.length && !searchStatus) { const empty = document.createElement("p"); empty.textContent = language === "ru" ? "Статусы пока не получены." : "Statuses are not available yet."; list.append(empty); }
      } else {
        const audit = knowledgeAuditQuery.data;
        (audit?.sources ?? []).forEach((source) => { const card = document.createElement("article"); card.className = "kairema-ops-card"; const heading = document.createElement("h3"); heading.textContent = source.name; card.append(heading, line(labels.domain, source.domain), line(labels.documents, String(source.indexedCount)), line(labels.checked, format(source.lastSuccessAt)), line(labels.status, source.state)); list.append(card); });
        if (audit?.latestRun) list.append(line(labels.lastRun, `${audit.latestRun.state} · ${format(audit.latestRun.finishedAt ?? audit.latestRun.startedAt)}`));
        if (!audit?.sources?.length) { const empty = document.createElement("p"); empty.textContent = language === "ru" ? "Официальные источники ещё не индексированы." : "Official sources have not been indexed yet."; list.append(empty); }
      }
      panel.append(list); overlay.hidden = false; closeButton.focus();
    };
    const providerButton = document.createElement("button"); providerButton.type = "button"; providerButton.className = "kairema-footer-link"; providerButton.textContent = labels.providers; providerButton.addEventListener("click", () => open("providers"));
    const ragButton = document.createElement("button"); ragButton.type = "button"; ragButton.className = "kairema-footer-link"; ragButton.textContent = labels.rag; ragButton.addEventListener("click", () => open("rag"));
    footer.prepend(ragButton); footer.prepend(providerButton); const topbar = document.querySelector<HTMLElement>(".kairema-topbar"); const entries = providerDashboardQuery.data ?? []; const searchLimited = webStatusQuery.data ? !webStatusQuery.data.available : false; const limited = entries.some((entry) => entry.state !== "ready") || searchLimited; const healthWidget = document.createElement("button"); healthWidget.type = "button"; healthWidget.className = "kairema-health-widget"; healthWidget.title = limited ? labels.degraded : labels.healthy; healthWidget.setAttribute("aria-label", healthWidget.title); const dot = document.createElement("span"); dot.className = `kairema-health-dot ${limited ? "kairema-health-dot-limited" : ""}`; const text = document.createElement("span"); text.className = "kairema-health-widget-count"; text.textContent = `${entries.filter((entry) => entry.state === "ready").length}/${entries.length || "—"}`; healthWidget.append(dot, text); healthWidget.addEventListener("click", () => open("providers")); topbar?.querySelector(".kairema-topbar-controls")?.append(healthWidget); document.body.append(overlay);
    return () => { providerButton.remove(); ragButton.remove(); healthWidget.remove(); overlay.remove(); };
  }, [isAuthenticated, language, providerDashboardQuery.data, knowledgeAuditQuery.data, webStatusQuery.data]);

  return (
    <main className="kairema-shell">
      <aside className={`kairema-sidebar ${sidebarOpen ? "kairema-sidebar-open" : "kairema-sidebar-collapsed"}`} aria-label={language === "ru" ? "Боковая навигация" : "Sidebar navigation"} inert={!sidebarOpen}>
        <div className="kairema-brand-row"><span className="kairema-logo"><Sparkles className="size-4" /></span><span>Kairema</span><button className="kairema-icon-btn md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close"><X className="size-4" /></button></div>
        <button onClick={() => void createChat()} className="kairema-new-chat" disabled={authLoading || createMutation.isPending}><MessageSquarePlus className="size-4" />{t.newChat}</button>
        <div className="kairema-sidebar-label"><CircleDot className="size-3" />{t.models}</div>
        <div className="kairema-providers">{modelViews.map((model) => <button key={model.modelId} onClick={() => { setModelId(model.modelId); setSidebarOpen(false); }} title={model.role[language]} className={`kairema-provider ${modelId === model.modelId ? "kairema-provider-selected" : ""}`}><span className="kairema-provider-icon"><Bot className="size-4" /></span><span className="kairema-provider-copy"><span className="kairema-provider-title">{model.label[language]}</span><span className="kairema-provider-role">{model.role[language]}</span><StatusIndicator status={model.status} /><RuntimeMeta runtime={model.runtime} language={language} /></span></button>)}</div>
        <div className="kairema-history-head"><span>{t.history}</span><div className="flex items-center gap-1"><button type="button" onClick={() => setPendingHistoryClear(true)} className="kairema-icon-btn" aria-label={language === "ru" ? "Очистить всю историю" : "Clear all history"} title={language === "ru" ? "Очистить всю историю" : "Clear all history"} disabled={!isAuthenticated || !sessions.length || clearHistoryMutation.isPending}><Trash2 className="size-3.5" /></button><button onClick={() => void createChat()} className="kairema-icon-btn" aria-label={t.newChat}><MessageSquarePlus className="size-4" /></button></div></div>
        <label className="kairema-search"><Search className="size-4" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.search} aria-label={t.search} /></label>
        <div className="kairema-history-list">{!isAuthenticated && <button className="kairema-history-item text-left" onClick={startLogin}><LogIn className="mr-2 inline size-3" />{t.loginHistory}</button>}{search.trim().length >= 2 ? <SearchResults results={results} labels={t} onSelect={(item) => item.sessionId && selectSession(item.sessionId)} /> : sessionMatches.map((session) => <div key={session.id} className={`kairema-history-row ${session.id === activeId ? "kairema-history-active" : ""}`}><button onClick={() => selectSession(session.id, session.modelId)} className="kairema-history-item">{session.title}</button><button type="button" onClick={() => setPendingChatDeletionId(session.id)} className="kairema-history-delete" title={t.delete} aria-label={`${t.delete}: ${session.title}`} disabled={deleteChatMutation.isPending}><Trash2 className="size-3.5" /></button></div>)}{isAuthenticated && !sessionsQuery.isLoading && !search.trim() && !sessions.length && <p className="kairema-empty">{t.noHistory}</p>}</div>
        <div className="kairema-sidebar-footer"><button className="kairema-footer-link" onClick={() => setMemoryOpen(true)}><Sparkles className="size-4" />{t.memory}</button><button className="kairema-footer-link" onClick={() => setExportHistoryOpen(true)} disabled={!isAuthenticated}><Archive className="size-4" />{language === "ru" ? "Экспорты" : "Exports"}</button><button className="kairema-footer-link" onClick={() => setSettingsOpen(true)}><SlidersHorizontal className="size-4" />{t.settings}</button>{ownerQuery.data && <button className="kairema-footer-link" onClick={() => navigate("/owner-analytics")}><Gauge className="size-4" />{language === "ru" ? "Аналитика владельца" : "Owner analytics"}</button>}<p>{t.secure}</p></div>
      </aside>
      {sidebarOpen && <button className="kairema-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close" />}
      <section className="kairema-main">
        <header className="kairema-topbar">
          <div className="kairema-topbar-left"><button className="kairema-icon-btn md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Menu"><Menu className="size-5" /></button><button className="kairema-icon-btn hidden md:grid" onClick={() => setSidebarOpen((value) => !value)} aria-label={sidebarOpen ? (language === "ru" ? "Скрыть боковую панель" : "Hide sidebar") : (language === "ru" ? "Показать боковую панель" : "Show sidebar")} aria-expanded={sidebarOpen}>{sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}</button><span className="kairema-topbar-title">{activeSession?.title ?? t.newConversation}</span></div>
          <div className="kairema-topbar-controls">{!isAuthenticated && <button type="button" className="kairema-guest-login" onClick={() => startLogin()}><LogIn className="size-4" /><span>{t.loginHistory}</span></button>}<button className="kairema-icon-btn" onClick={() => { toggleTheme?.(); void persistSettings({ theme: theme === "dark" ? "light" : "dark" }); }} title={theme === "dark" ? t.light : t.dark}>{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</button><button className="kairema-icon-btn" onClick={() => void persistSettings({ language: language === "ru" ? "en" : "ru" })} title={t.language}><Languages className="size-4" /></button><div className="kairema-select-wrap"><select value={modelId} onChange={(event) => setModelId(event.target.value as ModelId)} aria-label={t.models}>{modelViews.map((model) => <option key={model.modelId} value={model.modelId}>{model.label[language]}</option>)}</select></div><button className="kairema-icon-btn" onClick={() => setSettingsOpen(true)} title={t.openSettings}><Settings2 className="size-4" /></button></div>
        </header>
        <AIChatBox messages={visibleMessages} onSendMessage={send} onUploadFiles={uploadFiles} onRemoveAttachment={removeTemporaryAttachment} isLoading={isStreaming} onExportMarkdown={() => void exportCurrentChat("markdown")} onExportPdf={() => void exportCurrentChat("pdf")} canExport={Boolean(activeSession && dbMessages.length)} exportBusy={isExporting} exportError={notice} onCopyAssistant={(message) => void copyMessage(message)} onCopyUser={(message) => void copyMessage(message)} onCancelStream={cancelStream} composerValue={composerDraft} onComposerValueChange={setComposerDraft} onOpenTemplates={() => setTemplatesOpen(true)} composerSessionId={activeId || "new-composer"} uploadStatus={uploadStatus?.sessionId === activeId ? uploadStatus.message : ""} language={language} emptyStateMessage={isAuthenticated ? `${t.start} ${selectedModel.label[language]}` : t.loginChat} guestLoginAction={!isAuthenticated ? { label: t.loginHistory, onClick: () => startLogin() } : undefined} hasOlderHistory={Boolean(olderHistoryCursor === undefined ? messagesQuery.data?.nextCursor : olderHistoryCursor)} isLoadingOlderHistory={isLoadingOlderHistory} onLoadOlderHistory={() => void loadOlderHistory()} />
      </section>
      <CleanSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} models={modelViews} settings={settings} language={language} labels={t} onUpdate={persistSettings} onRestoreSafeSettings={async () => { if (theme !== "dark") toggleTheme?.(); await persistSettings({ theme: "dark", highContrast: true }); }} />
      <UnifiedMemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} data={memoryQuery.data} language={language} labels={t} onToast={setNotice} onUpdate={async (input) => { await memoryUpdateMutation.mutateAsync(input); await utils.memory.get.invalidate(); }} onAdd={async (fact) => { await memoryAddMutation.mutateAsync({ fact }); await utils.memory.get.invalidate(); }} onDelete={async (entryId) => { await memoryDeleteMutation.mutateAsync({ entryId }); await utils.memory.get.invalidate(); }} onClear={async () => { await memoryClearMutation.mutateAsync(); await utils.memory.get.invalidate(); }} />
      <ExportHistoryDialog open={exportHistoryOpen} onOpenChange={setExportHistoryOpen} records={exportsQuery.data ?? []} loading={exportsQuery.isLoading} language={language} busyId={exportDeleteMutation.isPending ? exportDeleteMutation.variables?.exportId : undefined} onDownload={(record) => { void downloadPersistentExport(record.id, record.fileName).catch((error) => setNotice(publicErrorMessage(error, language === "ru" ? "Не удалось открыть экспорт." : "Could not open export."))); }} onDelete={(exportId) => { void deletePersistentExport(exportId); }} />
      <PromptTemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} onInsert={(template) => { setComposerDraft(template.text); setTemplatesOpen(false); setNotice(language === "ru" ? `Шаблон «${template.title}» добавлен в запрос.` : `Template “${template.title}” was added to the prompt.`); }} onCopy={(template) => { void navigator.clipboard.writeText(template.text).then(() => setNotice(language === "ru" ? `Шаблон «${template.title}» скопирован.` : `Template “${template.title}” copied.`)).catch(() => setNotice(language === "ru" ? "Не удалось скопировать шаблон." : "Could not copy the template.")); }} />
      <AlertDialog open={Boolean(pendingChatDeletionId)} onOpenChange={(open) => { if (!open) setPendingChatDeletionId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{language === "ru" ? "Удалить чат?" : "Delete chat?"}</AlertDialogTitle>
            <AlertDialogDescription>{language === "ru" ? "Чат и его сообщения будут удалены без возможности восстановления." : "This chat and its messages will be permanently deleted."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{language === "ru" ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmChatDeletion()} disabled={isChatDeletionConfirming}>{language === "ru" ? "Удалить чат" : "Delete chat"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={pendingHistoryClear} onOpenChange={(open) => { if (!open) setPendingHistoryClear(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{language === "ru" ? "Очистить всю историю?" : "Clear all history?"}</AlertDialogTitle>
            <AlertDialogDescription>{language === "ru" ? "Будут навсегда удалены все ваши чаты, их сообщения и связанные с ними темы диалогов. Профиль и факты памяти не затрагиваются." : "All of your chats, messages and their related conversation topics will be permanently removed. Your profile and memory facts will remain."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{language === "ru" ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmHistoryClear()} disabled={isHistoryClearConfirming}>{language === "ru" ? "Да, удалить всё" : "Yes, delete all"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

type PersistentExportRecord = { id: string; fileName: string; format: "markdown" | "pdf"; byteSize: number; createdAt: Date | string };

function ExportHistoryDialog({ open, onOpenChange, records, loading, language, busyId, onDownload, onDelete }: { open: boolean; onOpenChange: (open: boolean) => void; records: PersistentExportRecord[]; loading: boolean; language: Language; busyId?: string; onDownload: (record: PersistentExportRecord) => void; onDelete: (exportId: string) => void }) {
  const date = (value: Date | string) => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{language === "ru" ? "История экспортов" : "Export history"}</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{language === "ru" ? "Здесь отображаются только ваши server-side экспорты. Они хранятся, пока вы не удалите запись; при удалении ключ и ссылка на файл убираются из истории." : "Only your server-side exports appear here. They are kept until you delete the record; deletion removes the file key and reference from history."}</p><div className="max-h-80 space-y-2 overflow-y-auto pr-1">{loading ? <p className="text-sm text-muted-foreground">{language === "ru" ? "Загрузка…" : "Loading…"}</p> : !records.length ? <p className="text-sm text-muted-foreground">{language === "ru" ? "Сохранённых экспортов пока нет." : "No saved exports yet."}</p> : records.map((record) => <div key={record.id} className="flex items-center gap-2 rounded-lg border border-border p-3"><Archive className="size-4 shrink-0 text-muted-foreground" /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => onDownload(record)}><span className="block truncate text-sm font-medium">{record.fileName}</span><small className="text-muted-foreground">{record.format.toUpperCase()} · {size(record.byteSize)} · {date(record.createdAt)}</small></button><button type="button" className="kairema-icon-btn" onClick={() => onDelete(record.id)} disabled={busyId === record.id} aria-label={language === "ru" ? `Удалить экспорт ${record.fileName}` : `Delete export ${record.fileName}`} title={language === "ru" ? "Удалить экспорт" : "Delete export"}><Trash2 className="size-3.5" /></button></div>)}</div></DialogContent></Dialog>;
}

function SearchResults({ results, labels, onSelect }: { results: SearchItem[]; labels: typeof copy.ru | typeof copy.en; onSelect: (item: SearchItem) => void }) { if (!results.length) return <p className="kairema-empty">{labels.noSearch}</p>; const icons = { chat: MessageSquare, message: Search }; return <>{results.map((result) => { const Icon = icons[result.type]; return <button className="kairema-search-result" onClick={() => onSelect(result)} key={`${result.type}-${result.id}`}><Icon className="size-3.5" /><span><b>{result.title}</b><small>{result.snippet}</small></span></button>; })}</>; }

function RuntimeMeta({ runtime, language }: { runtime?: PublicRuntime | null; language: Language }) { if (!runtime) return <small className="kairema-runtime-meta">{language === "ru" ? "Ответов пока нет" : "No responses yet"}</small>; const at = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(runtime.checkedAt)); const state = runtime.state === "backup" ? (language === "ru" ? "Резерв активен" : "Backup active") : runtime.state === "unavailable" ? (language === "ru" ? "Недоступно" : "Unavailable") : (language === "ru" ? "Готов" : "Ready"); return <small className="kairema-runtime-meta">{state} · {runtime.provider ?? "—"} · {at}</small>; }
function SettingsDialog({ open, onOpenChange, models, settings, language, labels, status, knowledge, knowledgeBusy, onRefreshKnowledge, onUpdate }: { open: boolean; onOpenChange: (open: boolean) => void; models: PublicModel[]; settings: Record<string, unknown>; language: Language; labels: typeof copy.ru | typeof copy.en; status?: { available?: boolean; reason?: string; checkedAt?: string; googleHttp?: number | null; openrouterHttp?: number | null }; knowledge?: { sources?: Array<{ name: string; lastSuccessAt: Date | string | null; indexedCount: number }>; documents?: number; lastRun?: { status?: string; finishedAt?: Date | string | null; message?: string | null } | null }; knowledgeBusy?: boolean; onRefreshKnowledge: () => void; onUpdate: (patch: Record<string, unknown>) => Promise<void> }) {
  const select = async (event: React.ChangeEvent<HTMLSelectElement>, field: string) => onUpdate({ [field]: event.target.value });
  const checkedAt = status?.checkedAt ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(status.checkedAt)) : null;
  const usingOpenRouter = status?.available && status.googleHttp === 429 && status.openrouterHttp === 200;
  const probes = [status?.googleHttp != null ? `Google: HTTP ${status.googleHttp}` : "Google: —", status?.openrouterHttp != null ? `OpenRouter: HTTP ${status.openrouterHttp}` : "OpenRouter: —"].join(" · ");
  const fmt = (value: Date | string | null | undefined) => value ? new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
  const limitCandidate = (candidate?: PublicRoleLimits["candidate"]) => candidate === "backup" ? (language === "ru" ? "Резерв активен" : "Backup active") : candidate === "unavailable" ? (language === "ru" ? "Недоступно" : "Unavailable") : (language === "ru" ? "Основной кандидат" : "Primary candidate");
  const limitQuota = (quota?: PublicRoleLimits["quota"]) => quota === "limited" ? (language === "ru" ? "Лимит" : "Limited") : quota === "unavailable" ? (language === "ru" ? "Недоступно" : "Unavailable") : (language === "ru" ? "Готов" : "Ready");
  const webStatus = status?.available
    ? usingOpenRouter ? (language === "ru" ? "Обязательный web-поиск проверяется через OpenRouter online." : "Mandatory web search is verified through OpenRouter online.") : (language === "ru" ? "Обязательный web-поиск проверяется через Google Search grounding." : "Mandatory web search is verified through Google Search grounding.")
    : (language === "ru" ? "Свежий проверяемый источник обязателен: при недоступности поиск честно остановит ответ." : "A fresh verifiable source is required: unavailability honestly stops the response.");
  const hint = (ru: string, en: string) => language === "ru" ? ru : en;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="kairema-dialog kairema-dialog-wide"><DialogHeader><DialogTitle>{labels.settings}</DialogTitle></DialogHeader><p className="kairema-dialog-note">{labels.save}</p><div className="kairema-settings-grid"><section><h3>{labels.response}</h3><label><span>{labels.style}</span><select value={String(settings.responseStyle)} onChange={(event) => void select(event, "responseStyle")}>{(Object.keys(styles) as ResponseStyle[]).map((style) => <option key={style} value={style}>{styles[style][language]}</option>)}</select><small className="kairema-setting-help">{hint("Определяет подачу ответа; содержание вопроса не меняется.", "Sets the response presentation without changing the question.")}</small></label><label><span>{labels.length}</span><select value={String(settings.responseLength)} onChange={(event) => void select(event, "responseLength")}>{Object.entries(lengths).map(([value, text]) => <option key={value} value={value}>{text[language]}</option>)}</select><small className="kairema-setting-help">{hint("Задаёт обычный объём следующего ответа; подробность можно уточнить в сообщении.", "Sets the usual next-answer length; you can still ask for detail in a message.")}</small></label><label><span>{labels.effort}</span><select value={String(settings.effort)} onChange={(event) => void select(event, "effort")}>{Object.entries(efforts).map(([value, text]) => <option key={value} value={value}>{text[language]}</option>)}</select><small className="kairema-setting-help">{hint("Балансирует скорость и глубину рассуждения для новых ответов.", "Balances speed and reasoning depth for new answers.")}</small></label><label><span>{labels.defaultRole}</span><select value={String(settings.defaultRole)} onChange={(event) => void select(event, "defaultRole")}>{models.map((model) => <option key={model.modelId} value={model.modelId}>{model.label[language]}</option>)}</select><small className="kairema-setting-help">{hint("Выбирает роль для новых чатов; в текущем чате её можно сменить сверху.", "Chooses the role for new chats; it can be changed in the current chat header.")}</small></label><label><span>{labels.healthRefresh}</span><select aria-label={labels.healthRefresh} value={String(settings.healthRefreshSeconds ?? 30)} onChange={(event) => void onUpdate({ healthRefreshSeconds: Number(event.target.value) })}><option value="0">{language === "ru" ? "Вручную" : "Manual"}</option><option value="15">15 s</option><option value="30">30 s</option><option value="60">60 s</option></select><small className="kairema-setting-help">{hint("Обновляет только публичный виджет доступности; ответы и история не передаются.", "Refreshes only the public availability widget; messages and history are not sent.")}</small></label></section><section><h3>{labels.web}</h3><SettingSwitch label={language === "ru" ? "Разрешить инструменты" : "Allow tools"} help={hint("Включает безопасную работу с вложениями в пределах разрешений аккаунта.", "Enables safe attachment work within your account permissions.")} checked={Boolean(settings.toolAccess ?? true)} onChange={(value) => void onUpdate({ toolAccess: value })} /><SettingSwitch label={labels.thinking} help={hint("Добавляет более развёрнутое объяснение, если его поддерживает выбранная роль.", "Requests a more explicit explanation when the selected role supports it.")} checked={Boolean(settings.thinking)} onChange={(value) => void onUpdate({ thinking: value })} /><p className="kairema-inline-status"><Globe2 className="size-3.5" />{webStatus}</p><p className="kairema-inline-status-meta">{probes}{checkedAt ? ` · ${language === "ru" ? "Проверено" : "Checked"}: ${checkedAt}` : ""}</p><h3 className="mt-6">RAG</h3><p className="kairema-inline-status"><Archive className="size-3.5" />{language === "ru" ? `Проверяемая база: ${knowledge?.documents ?? 0} фрагм.` : `Verifiable base: ${knowledge?.documents ?? 0} excerpts.`}</p><p className="kairema-inline-status-meta">{knowledge?.sources?.map((source) => `${source.name}: ${source.indexedCount} · ${fmt(source.lastSuccessAt)}`).join(" · ") || (language === "ru" ? "Источники ещё не обновлялись." : "Sources have not been refreshed yet.")}</p>{knowledge?.lastRun?.message && <p className="kairema-inline-status-meta">{knowledge.lastRun.message}</p>}<button type="button" className="kairema-rag-refresh" onClick={onRefreshKnowledge} disabled={knowledgeBusy}>{knowledgeBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}{language === "ru" ? "Обновить официальные источники" : "Refresh official sources"}</button><h3 className="mt-6">{labels.models}</h3>{models.map((model) => <div className="kairema-settings-provider" key={model.modelId}><span><b>{model.label[language]}</b><small>{model.role[language]}</small><RuntimeMeta runtime={model.runtime} language={language} /></span><StatusIndicator status={model.status} /></div>)}<section className="kairema-model-limits" aria-labelledby="model-limits-title"><h3 id="model-limits-title">{labels.modelLimits}</h3>{models.map((model) => { const info = model.limits; const quota = limitQuota(info?.quota); return <article className="kairema-limit-card" key={`limits-${model.modelId}`}><div><b>{model.label[language]}</b><small>{limitCandidate(info?.candidate)} · {info?.provider ?? "—"}</small><small>{language === "ru" ? "Квота" : "Quota"}: {quota}{info?.nextFallback ? ` · ${language === "ru" ? "Следующий резерв" : "Next backup"}: ${info.nextFallback}` : ""}</small></div><span className={`kairema-status ${info?.quota === "limited" ? "kairema-status-fallback" : info?.quota === "unavailable" ? "kairema-status-error" : "kairema-status-ready"}`}>{quota}</span></article>; })}</section></section></div></DialogContent></Dialog>;
}

function CleanSettingsDialog({ open, onOpenChange, models, settings, language, labels, onUpdate, onRestoreSafeSettings }: { open: boolean; onOpenChange: (open: boolean) => void; models: PublicModel[]; settings: Record<string, unknown>; language: Language; labels: typeof copy.ru | typeof copy.en; onUpdate: (patch: Record<string, unknown>) => Promise<void>; onRestoreSafeSettings: () => Promise<void> }) {
  const select = async (value: string, field: string) => onUpdate({ [field]: value });
  const hint = (ru: string, en: string) => language === "ru" ? ru : en;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkNotice, setLinkNotice] = useState("");
  const beginLinkMutation = trpc.auth.beginLink.useMutation();
  const requestLink = async () => {
    const email = linkEmail.trim();
    if (!email) return;
    setLinkNotice("");
    try {
      await beginLinkMutation.mutateAsync({ email });
      setLinkEmail("");
      setLinkNotice(hint("Если адрес доступен, на него отправлено письмо для подтверждения. Откройте ссылку в этом браузере: привязка завершится только после проверки обеих сторон.", "If the address can receive email, a confirmation message has been requested. Open its link in this browser; linking completes only after both sides are verified."));
    } catch {
      setLinkNotice(hint("Не удалось запросить подтверждение. Повторите позже.", "The confirmation request could not be started. Please try again later."));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kairema-dialog">
        <DialogHeader><DialogTitle>{labels.settings}</DialogTitle></DialogHeader>
        <p className="kairema-dialog-note">{labels.save}</p>
        <div className="kairema-settings-grid">
          <section>
            <h3>{labels.response}</h3>
            <label><span>{labels.style}</span><AppDropdown value={String(settings.responseStyle)} onValueChange={(value) => void select(value, "responseStyle")} options={(Object.keys(styles) as ResponseStyle[]).map((value) => ({ value, label: styles[value][language], description: hint("Стиль подачи без изменения смысла вопроса.", "Presentation style without changing the question.") }))} ariaLabel={labels.style} /><small className="kairema-setting-help">{hint("Выбирает подачу ответа; содержание вопроса не меняется.", "Sets response presentation without changing your question.")}</small></label>
            <label><span>{labels.length}</span><AppDropdown value={String(settings.responseLength)} onValueChange={(value) => void select(value, "responseLength")} options={Object.entries(lengths).map(([value, text]) => ({ value, label: text[language], description: value === "brief" ? hint("Коротко и по существу.", "Short and to the point.") : value === "detailed" ? hint("Подробно и структурно.", "Detailed and structured.") : hint("Сбалансированный объём.", "Balanced detail.") }))} ariaLabel={labels.length} /><small className="kairema-setting-help">{hint("Задаёт обычный объём следующего ответа.", "Sets the usual length of the next response.")}</small></label>
            <label><span>{labels.effort}</span><AppDropdown value={String(settings.effort)} onValueChange={(value) => void select(value, "effort")} options={Object.entries(efforts).map(([value, text]) => ({ value, label: text[language], description: value === "low" ? hint("Быстрый ответ для простых задач.", "Fast response for simple work.") : value === "high" ? hint("Больше времени на анализ.", "More time for analysis.") : hint("Обычный баланс скорости и глубины.", "Usual balance of speed and depth.") }))} ariaLabel={labels.effort} /><small className="kairema-setting-help">{hint("Балансирует скорость и глубину рассуждения.", "Balances response speed and reasoning depth.")}</small></label>
            <label><span>{labels.defaultRole}</span><AppDropdown value={String(settings.defaultRole)} onValueChange={(value) => void select(value, "defaultRole")} options={models.map((model) => ({ value: model.modelId, label: model.label[language], description: model.role[language] }))} ariaLabel={labels.defaultRole} /><small className="kairema-setting-help">{hint("Выбирает роль для новых разговоров.", "Chooses the role for new conversations.")}</small></label>
          </section>
          <section>
            <h3>{language === "ru" ? "Работа с сообщениями" : "Message handling"}</h3>
            <SettingSwitch label={language === "ru" ? "Разрешить инструменты" : "Allow tools"} help={hint("Включает безопасную работу с вложениями в пределах разрешений аккаунта.", "Enables safe attachment work within account permissions.")} checked={Boolean(settings.toolAccess ?? true)} onChange={(value) => void onUpdate({ toolAccess: value })} />
            <SettingSwitch label={labels.thinking} help={hint("Добавляет более развёрнутое объяснение, если его поддерживает выбранная роль.", "Requests a more explicit explanation when the selected role supports it.")} checked={Boolean(settings.thinking)} onChange={(value) => void onUpdate({ thinking: value })} />
            <SettingSwitch label={language === "ru" ? "Высокая контрастность" : "High contrast"} help={hint("Усиливает различимость текста, границ и фокуса; настройка сохраняется только для вашего аккаунта.", "Strengthens text, borders, and focus visibility; this setting is saved only for your account.")} checked={Boolean(settings.highContrast)} onChange={(value) => void onUpdate({ highContrast: value })} />
            <SettingSwitch label={language === "ru" ? "Email-уведомления" : "Email notifications"} help={hint("Сохраняет ваше согласие на будущие сервисные уведомления. Сообщения, контакты и ключи в письмо не передаются; отправка пока не подключена.", "Stores your consent for future service notifications. Messages, contacts, and keys are not sent by email; delivery is not enabled yet.")} checked={Boolean(settings.emailNotifications)} onChange={(value) => void onUpdate({ emailNotifications: value })} />
            <SettingSwitch label={language === "ru" ? "Веб-поиск" : "Web search"} help={hint("Добавляет только проверяемые свежие источники, когда они доступны; при сбое чат продолжает работу с честным статусом.", "Adds verifiable fresh sources when available; if it fails, chat continues with an honest status.")} checked={Boolean(settings.webSearch)} onChange={(value) => void onUpdate({ webSearch: value })} />
            <label><span>{labels.healthRefresh}</span><AppSelect ariaLabel={labels.healthRefresh} value={String(settings.healthRefreshSeconds ?? 30)} onValueChange={(value) => void onUpdate({ healthRefreshSeconds: Number(value) })} options={[{ value: "0", label: language === "ru" ? "Вручную" : "Manual" }, { value: "15", label: "15 s" }, { value: "30", label: "30 s" }, { value: "60", label: "60 s" }]} /><small className="kairema-setting-help">{hint("Обновляет только публичный индикатор доступности.", "Refreshes only the public availability indicator.")}</small></label>
            <section className="kairema-settings-diagnostics" aria-live="polite"><h3>{language === "ru" ? "Самодиагностика" : "Settings check"}</h3><p className="kairema-setting-help">{hint("Показывает только сохранённые пользовательские параметры, без сообщений, ключей и служебных маршрутов.", "Shows only saved user preferences, never messages, keys, or internal routing.")}</p><button type="button" className="kairema-rag-refresh" onClick={() => setDiagnosticsOpen((value) => !value)}>{language === "ru" ? "Проверить настройки" : "Check settings"}</button>{diagnosticsOpen && <div className="kairema-settings-diagnostics-result"><p>{language === "ru" ? "Тема" : "Theme"}: <b>{settings.theme === "dark" ? (language === "ru" ? "тёмная" : "dark") : (language === "ru" ? "светлая" : "light")}</b></p><p>{language === "ru" ? "Высокая контрастность" : "High contrast"}: <b>{Boolean(settings.highContrast) ? (language === "ru" ? "включена" : "on") : (language === "ru" ? "выключена" : "off")}</b></p><button type="button" className="kairema-danger-button" onClick={() => void onRestoreSafeSettings()}>{language === "ru" ? "Восстановить безопасный режим" : "Restore safe mode"}</button></div>}</section>
            <section className="kairema-settings-diagnostics" aria-live="polite"><h3>{language === "ru" ? "Привязать email-вход" : "Link email sign-in"}</h3><p className="kairema-setting-help">{hint("По желанию привяжите отдельный Stytch email-вход. Совпадение адреса никогда не объединяет аккаунты автоматически. Kairema не хранит пароль, письма, токены или ссылки сброса.", "Optionally link a separate Stytch email sign-in. Matching email addresses never merge accounts automatically. Kairema does not store passwords, email tokens, or reset links.")}</p><label className="kairema-field-label"><span>{language === "ru" ? "Email для подтверждения" : "Email to confirm"}</span><input type="email" autoComplete="email" value={linkEmail} onChange={(event) => setLinkEmail(event.target.value)} placeholder="name@example.com" /></label><button type="button" className="kairema-rag-refresh" disabled={beginLinkMutation.isPending || !linkEmail.trim()} onClick={() => void requestLink()}>{beginLinkMutation.isPending ? (language === "ru" ? "Запрашиваем…" : "Requesting…") : (language === "ru" ? "Отправить подтверждение" : "Send confirmation")}</button>{linkNotice ? <p className="kairema-setting-help">{linkNotice}</p> : null}</section>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingSwitch({ label, help, checked, disabled, onChange }: { label: string; help?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) { return <div className="kairema-switch-row"><span className="kairema-switch-copy"><b>{label}</b>{help && <small>{help}</small>}</span><Switch className="kairema-switch-control" aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} /></div>; }

function UnifiedMemoryDialog({ open, onOpenChange, data, language, labels, onUpdate, onAdd, onDelete, onClear, onToast }: { open: boolean; onOpenChange: (open: boolean) => void; data?: { settings?: { enabled?: number; autoExtract?: number }; profile?: { profile?: string | null; summary?: string | null }; facts?: Array<{ id: string; value: string }>; topics?: Array<{ id: string; value: string; role?: string | null }>; }; language: Language; labels: typeof copy.ru | typeof copy.en; onUpdate: (input: { enabled?: boolean; autoExtract?: boolean; profile?: string }) => Promise<void>; onAdd: (fact: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onClear: () => Promise<void>; onToast: (message: string) => void }) {
  const ru = language === "ru";
  const [profile, setProfile] = useState(""); const [fact, setFact] = useState(""); const [query, setQuery] = useState(""); const [filter, setFilter] = useState<"all" | "facts" | "topics">("all"); const [saving, setSaving] = useState(false); const [confirmClear, setConfirmClear] = useState(false); const [clearing, setClearing] = useState(false); const clearInFlightRef = useRef(false); const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(() => new Set());
  const sourceFacts = data?.facts ?? []; const sourceTopics = data?.topics ?? [];
  const facts = sourceFacts.filter((item) => !pendingDeleteIds.has(item.id)); const topics = sourceTopics.filter((item) => !pendingDeleteIds.has(item.id)); const normalizedQuery = query.trim().toLocaleLowerCase();
  const shownFacts = filter === "topics" ? [] : facts.filter((item) => memorySearchMatches(item.value, query));
  const shownTopics = filter === "facts" ? [] : topics.filter((item) => memorySearchMatches(item.value, query));
  useEffect(() => { if (open) { setProfile(data?.profile?.profile ?? ""); setFact(""); setQuery(""); setFilter("all"); setConfirmClear(false); setClearing(false); } }, [open, data?.profile?.profile]);
  useEffect(() => { const currentIds = new Set([...sourceFacts, ...sourceTopics].map((item) => item.id)); setPendingDeleteIds((pending) => { const next = new Set([...pending].filter((id) => currentIds.has(id))); return next.size === pending.size ? pending : next; }); }, [sourceFacts, sourceTopics]);
  const saveProfile = async () => { setSaving(true); try { await onUpdate({ profile }); onToast(ru ? "Память сохранена" : "Memory saved"); } finally { setSaving(false); } };
  const deleteEntry = async (entryId: string) => { if (pendingDeleteIds.has(entryId)) return; setPendingDeleteIds((pending) => new Set(pending).add(entryId)); try { await onDelete(entryId); onToast(ru ? "Запись памяти удалена" : "Memory entry deleted"); } catch { setPendingDeleteIds((pending) => { const next = new Set(pending); next.delete(entryId); return next; }); onToast(ru ? "Не удалось удалить запись памяти. Повторите попытку." : "Could not delete the memory entry. Please try again."); } };
  const deleteLabel = ru ? "Удалить запись памяти" : "Delete memory entry";
  const runClear = async () => { if (clearing || clearInFlightRef.current) return; clearInFlightRef.current = true; setClearing(true); try { await onClear(); setConfirmClear(false); onToast(ru ? "Память очищена" : "Memory cleared"); } finally { clearInFlightRef.current = false; setClearing(false); } };
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kairema-dialog kairema-dialog-wide">
        <DialogHeader><DialogTitle>{labels.memory}</DialogTitle></DialogHeader>
        <p className="kairema-dialog-note">{ru ? "Память приватна для вашего аккаунта. Факты и темы можно удалить в любой момент." : "Memory is private to your account. Facts and topics can be removed at any time."}</p>
        <SettingSwitch label={labels.memoryEnabled} help={ru ? "Выключение исключает сохранённые данные только из ответов; записи не удаляются." : "Turning this off removes stored data only from replies; entries are retained."} checked={Boolean(data?.settings?.enabled)} onChange={(enabled) => void onUpdate({ enabled })} />
        <SettingSwitch label={labels.autoMemory} help={ru ? "Выключение останавливает только автоматическое добавление новых записей." : "Turning this off stops only automatic capture of new entries."} checked={Boolean(data?.settings?.autoExtract)} onChange={(autoExtract) => void onUpdate({ autoExtract })} />
        {data?.profile?.summary && !data.profile.profile?.trim() ? <p className="kairema-dialog-note" aria-label={ru ? "Автоматический профиль" : "Automatic profile"}>{ru ? "Автоматический профиль: " : "Automatic profile: "}{data.profile.summary}</p> : null}
        <label className="kairema-field-label">{labels.profile}<textarea value={profile} onChange={(event) => setProfile(event.target.value)} placeholder={ru ? "Например: важный контекст, предпочтения и долгосрочные цели." : "For example: important context, preferences and long-term goals."} /></label>
        <button type="button" className="kairema-memory-save-button" disabled={saving} onClick={() => void saveProfile()}>{saving ? (ru ? "Сохраняем…" : "Saving…") : (ru ? "Сохранить" : "Save")}</button>
        <div className="kairema-memory-toolbar">
          <label className="sr-only" htmlFor="memory-entry-search">{ru ? "Поиск по памяти" : "Search memory"}</label>
          <input id="memory-entry-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={ru ? "Поиск по фактам и темам" : "Search facts and topics"} />
          <div role="group" aria-label={ru ? "Фильтр памяти" : "Memory filter"}>{(["all", "facts", "topics"] as const).map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? (ru ? "Все" : "All") : value === "facts" ? labels.facts : (ru ? "Темы" : "Topics")}</button>)}</div>
        </div>
        <section>
          <h3 className="mb-2 text-sm font-medium">{labels.facts} <span className="kairema-entry-count">{facts.length}</span></h3>
          <div className="kairema-fact-add"><input value={fact} onChange={(event) => setFact(event.target.value)} placeholder={labels.addFact} /><button type="button" disabled={fact.trim().length < 3} onClick={() => { const value = fact.trim(); setFact(""); void onAdd(value); }}><Lightbulb className="size-3.5" />{labels.addFact}</button></div>
          <div className="kairema-facts">{shownFacts.length ? shownFacts.map((item) => <div key={item.id}><span>{item.value}</span><button type="button" title={deleteLabel} aria-label={deleteLabel} disabled={pendingDeleteIds.has(item.id)} onClick={() => void deleteEntry(item.id)}><Trash2 className="size-3.5" /></button></div>) : <p className="kairema-empty">{facts.length && normalizedQuery ? (ru ? "Поиск не дал совпадений." : "No matching entries.") : (ru ? "Фактов пока нет." : "No facts yet.")}</p>}</div>
        </section>
        <section>
          <h3 className="mb-2 mt-5 text-sm font-medium">{ru ? "Темы диалогов" : "Conversation topics"} <span className="kairema-entry-count">{topics.length}</span></h3>
          <div className="kairema-facts">{shownTopics.length ? shownTopics.map((item) => <div key={item.id}><span>{item.value}</span><button type="button" title={deleteLabel} aria-label={deleteLabel} disabled={pendingDeleteIds.has(item.id)} onClick={() => void deleteEntry(item.id)}><Trash2 className="size-3.5" /></button></div>) : <p className="kairema-empty">{topics.length && normalizedQuery ? (ru ? "Поиск не дал совпадений." : "No matching entries.") : (ru ? "Темы появятся после завершённых разговоров." : "Topics appear after completed conversations.")}</p>}</div>
        </section>
        <button type="button" className="kairema-danger-button" aria-describedby="memory-clear-help" onClick={() => setConfirmClear(true)}><Trash2 className="size-4" />{ru ? "Очистить всю память" : "Clear all memory"}</button>
        <p id="memory-clear-help" className="kairema-setting-help">{ru ? "Очистка потребует отдельного подтверждения и удалит профиль, факты и темы только вашего аккаунта." : "Clearing requires separate confirmation and removes only your profile, facts and topics."}</p>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ru ? "Очистить всю память?" : "Clear all memory?"}</AlertDialogTitle>
          <AlertDialogDescription>{ru ? "Будут удалены профиль, факты и темы только вашего аккаунта. Это действие нельзя отменить." : "Your profile, facts and topics will be removed. This cannot be undone."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{ru ? "Отмена" : "Cancel"}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void runClear()} disabled={clearing}>{ru ? "Да, очистить всё" : "Yes, clear all"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
function MemoryDialog({ open, onOpenChange, data, language, labels, onUpdate, onAdd, onDelete, onClear }: { open: boolean; onOpenChange: (open: boolean) => void; data?: { profile?: { enabled?: number; autoExtract?: number; profile?: string | null }; facts?: Array<{ id: string; fact: string }>; }; language: Language; labels: typeof copy.ru | typeof copy.en; onUpdate: (input: { enabled?: boolean; autoExtract?: boolean; profile?: string }) => Promise<void>; onAdd: (fact: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onClear: () => Promise<void> }) {
  const [profile, setProfile] = useState("");
  const [fact, setFact] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => { if (open) { setProfile(data?.profile?.profile ?? ""); setSaveState("idle"); } }, [open, data?.profile?.profile]);
  const saveProfile = async () => {
    setSaveState("saving");
    await onUpdate({ profile });
    setSaveState("saved");
  };
  const saveText = language === "ru" ? "Сохранить профиль" : "Save profile";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="kairema-dialog"><DialogHeader><DialogTitle>{labels.memory}</DialogTitle></DialogHeader><SettingSwitch label={labels.memoryEnabled} checked={Boolean(data?.profile?.enabled)} onChange={(enabled) => void onUpdate({ enabled })} /><SettingSwitch label={labels.autoMemory} checked={Boolean(data?.profile?.autoExtract)} onChange={(autoExtract) => void onUpdate({ autoExtract })} /><label className="kairema-field-label">{labels.profile}<textarea value={profile} onChange={(event) => { setProfile(event.target.value); setSaveState("idle"); }} placeholder={language === "ru" ? "Например: важный контекст, предпочтения и долгосрочные цели." : "For example: important context, preferences and long-term goals."} /></label><div className="kairema-memory-save"><button type="button" className="kairema-rag-refresh" disabled={saveState === "saving"} onClick={() => void saveProfile()}>{saveState === "saving" ? (language === "ru" ? "Сохраняем…" : "Saving…") : saveText}</button><span role="status" aria-live="polite">{saveState === "saved" ? (language === "ru" ? "Профиль сохранён" : "Profile saved") : ""}</span></div><div className="kairema-fact-add"><input value={fact} onChange={(event) => setFact(event.target.value)} placeholder={labels.addFact} /><button disabled={fact.trim().length < 3} onClick={() => { const value = fact.trim(); setFact(""); void onAdd(value); }}><Lightbulb className="size-3.5" />{labels.addFact}</button></div><div className="kairema-facts">{data?.facts?.map((item) => <div key={item.id}><span>{item.fact}</span><button title={labels.delete} onClick={() => void onDelete(item.id)}><Trash2 className="size-3.5" /></button></div>)}</div><button className="kairema-danger-button" onClick={() => void onClear()}><Trash2 className="size-4" />{labels.clear}</button></DialogContent></Dialog>;
}

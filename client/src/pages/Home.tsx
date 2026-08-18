import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Bot, ChevronDown, CircleDot, Clock3, LogIn, Menu, MessageSquarePlus, PanelLeftClose, Search, Settings2, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ModelId = "google/gemma-4-26b-a4b-it:free" | "cohere/north-mini-code:free" | "dots-studio/dots-3-note-preview:free" | "openai/gpt-oss-20b:free" | "openrouter/free";
type ResponseStyle = "default" | "professional" | "friendly" | "concise" | "steps";
type StaticModel = { key: string; modelId: ModelId; label: string; role: string };
type PublicModel = StaticModel & { status?: { state: string; badge: string; category: string | null; http: number | null; checkedAt: string; confirmed: string } };

const MODELS: readonly StaticModel[] = [
  { key: "ultra", modelId: "google/gemma-4-26b-a4b-it:free", label: "Kairema Ultra (Gemma 4)", role: "Основной универсальный чат для сложных текстов, логики и общения." },
  { key: "code", modelId: "cohere/north-mini-code:free", label: "Kairema Code (North)", role: "Специализированный ИИ для генерации, разбора, рефакторинга и отладки кода." },
  { key: "long_context", modelId: "dots-studio/dots-3-note-preview:free", label: "Kairema Long-Context (Dots3)", role: "Анализ сверхбольших текстов, контекстных документов и тяжёлых файлов." },
  { key: "express", modelId: "openai/gpt-oss-20b:free", label: "Kairema Express (GPT-OSS)", role: "Молниеносные лаконичные ответы на простые повседневные вопросы без воды." },
  { key: "auto_router", modelId: "openrouter/free", label: "Kairema Auto-Router", role: "Автоматический выбор стабильной и свободной бесплатной модели на стороне OpenRouter." },
];

const statusClass = (state?: string) => state === "ready" ? "status-ready" : state === "not_configured" ? "status-muted" : state === "unavailable" ? "status-unavailable" : state === "loading" ? "status-loading" : "status-auth";
const formatTime = (value?: string) => value ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "Проверяем…";
const styleNames: Record<ResponseStyle, string> = { default: "По умолчанию", professional: "Профессиональный", friendly: "Дружелюбный", concise: "Кратко", steps: "По шагам" };

export default function Home() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [activeId, setActiveId] = useState<string>("");
  const [modelId, setModelId] = useState<ModelId>(MODELS[0].modelId);
  const [style, setStyle] = useState<ResponseStyle>("default");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const modelsQuery = trpc.models.list.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true });
  const sessionsQuery = trpc.chats.list.useQuery(undefined, { enabled: isAuthenticated, refetchOnWindowFocus: true });
  const messagesQuery = trpc.chats.messages.useQuery({ sessionId: activeId }, { enabled: isAuthenticated && Boolean(activeId) });
  const createMutation = trpc.chats.create.useMutation();
  const sendMutation = trpc.chats.send.useMutation();
  const utils = trpc.useUtils();

  const modelViews = useMemo<PublicModel[]>(() => {
    const byId = new Map((modelsQuery.data as PublicModel[] | undefined)?.map((model) => [model.modelId, model]) ?? []);
    return MODELS.map((model) => byId.get(model.modelId) ?? { ...model, status: undefined });
  }, [modelsQuery.data]);
  const modelById = useMemo(() => new Map(modelViews.map((model) => [model.modelId, model])), [modelViews]);
  const sessions = sessionsQuery.data ?? [];
  const activeSession = sessions.find((session) => session.id === activeId);
  const dbMessages = (messagesQuery.data ?? []).map((message): Message => ({
    id: String(message.id),
    role: message.role,
    content: message.content,
    providerLabel: message.role === "assistant" ? modelById.get(message.modelId as ModelId)?.label ?? "Kairema" : undefined,
    model: message.role === "assistant" ? message.modelId ?? "" : undefined,
    status: message.role === "assistant" ? "полный ответ" : undefined,
  }));
  const visibleMessages = [...dbMessages, ...optimisticMessages];
  const visibleSessions = sessions.filter((session) => session.title.toLocaleLowerCase("ru-RU").includes(search.toLocaleLowerCase("ru-RU")));
  const selectedModel = modelById.get(modelId) ?? MODELS[0];

  useEffect(() => {
    if (sessions.length && !sessions.some((session) => session.id === activeId)) {
      setActiveId(sessions[0]!.id);
      setModelId(sessions[0]!.modelId as ModelId);
    }
  }, [activeId, sessions]);

  useEffect(() => { setOptimisticMessages([]); }, [activeId]);

  const createChat = () => {
    if (!isAuthenticated) return startLogin();
    createMutation.mutate({ modelId }, {
      onSuccess: (session) => {
        setActiveId(session.id);
        setSidebarOpen(false);
        void utils.chats.list.invalidate();
      },
    });
  };

  const selectSession = (sessionId: string, sessionModel: string) => {
    setActiveId(sessionId);
    if (modelById.has(sessionModel as ModelId)) setModelId(sessionModel as ModelId);
    setSidebarOpen(false);
  };

  const send = (content: string) => {
    if (!isAuthenticated) return startLogin();
    if (!activeId) return createChat();
    const draftId = `draft-${Date.now()}`;
    setOptimisticMessages([{ id: draftId, role: "user", content }]);
    sendMutation.mutate({ sessionId: activeId, modelId, content, settings: { style } }, {
      onSuccess: async (result) => {
        setOptimisticMessages([{ id: `draft-${Date.now()}-answer`, role: "assistant", content: result.content, providerLabel: result.label, model: result.modelUsed, status: result.status.badge }]);
        await Promise.all([utils.chats.messages.invalidate({ sessionId: activeId }), utils.chats.list.invalidate()]);
        setOptimisticMessages([]);
      },
      onError: (error) => {
        setOptimisticMessages((items) => [...items, { id: `draft-${Date.now()}-error`, role: "assistant", content: error.message, providerLabel: "OpenRouter", model: modelId, status: "ошибка", isError: true }]);
      },
    });
  };

  return (
    <main className="kairema-shell">
      <aside className={`kairema-sidebar ${sidebarOpen ? "kairema-sidebar-open" : ""}`}>
        <div className="kairema-brand-row"><span className="kairema-logo"><Sparkles className="size-4" /></span><span>Kairema</span><button className="kairema-icon-btn md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Закрыть меню"><X className="size-4" /></button></div>
        <button onClick={createChat} className="kairema-new-chat" disabled={authLoading || createMutation.isPending}><MessageSquarePlus className="size-4" />Новый чат</button>
        <div className="kairema-sidebar-label"><CircleDot className="size-3" />Выбор модели</div>
        <div className="kairema-providers">
          {modelViews.map((model) => <button key={model.modelId} onClick={() => { setModelId(model.modelId); setSidebarOpen(false); }} className={`kairema-provider ${modelId === model.modelId ? "kairema-provider-selected" : ""}`}>
            <span className="kairema-provider-icon"><Bot className="size-4" /></span>
            <span className="kairema-provider-copy"><span className="kairema-provider-title">{model.label}</span><span className="kairema-provider-role">{model.role}</span>{model.status ? <span className={`kairema-status ${statusClass(model.status.state)}`}>{model.status.badge}</span> : <span className="kairema-status-loading" aria-label="Проверка статуса" />}</span>
          </button>)}
        </div>
        <div className="kairema-history-head"><span>История</span><button onClick={createChat} className="kairema-icon-btn" aria-label="Создать чат"><MessageSquarePlus className="size-4" /></button></div>
        <label className="kairema-search"><Search className="size-4" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" aria-label="Поиск по истории" /></label>
        <div className="kairema-history-list">
          {!isAuthenticated && <button className="kairema-history-item text-left" onClick={startLogin}><LogIn className="mr-2 inline size-3" />Войти для истории</button>}
          {visibleSessions.map((session) => <button key={session.id} onClick={() => selectSession(session.id, session.modelId)} className={`kairema-history-item ${session.id === activeId ? "kairema-history-active" : ""}`}>{session.title}</button>)}
          {isAuthenticated && !sessionsQuery.isLoading && !visibleSessions.length && <p className="px-2 py-3 text-xs text-slate-500">История пока пуста.</p>}
        </div>
        <div className="kairema-sidebar-footer"><div className="kairema-footer-link"><Sparkles className="size-4" />Память</div><SettingsPanel models={modelViews} style={style} onStyleChange={setStyle} /><p>Ключ OpenRouter — только на сервере</p></div>
      </aside>
      {sidebarOpen && <button className="kairema-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Закрыть боковую панель" />}
      <section className="kairema-main">
        <header className="kairema-topbar">
          <div className="flex items-center gap-2"><button className="kairema-icon-btn md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Открыть меню"><Menu className="size-5" /></button><button className="kairema-icon-btn hidden md:grid" onClick={() => setSidebarOpen((value) => !value)} aria-label="Свернуть боковую панель"><PanelLeftClose className="size-4" /></button><span className="text-sm text-slate-500">{activeSession?.title ?? "Новый разговор"}</span></div>
          <div className="flex items-center gap-2"><div className="kairema-select-wrap"><select value={modelId} onChange={(event) => setModelId(event.target.value as ModelId)} aria-label="Выбор модели">{modelViews.map((model) => <option key={model.modelId} value={model.modelId}>{model.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /></div><SettingsPanel models={modelViews} style={style} onStyleChange={setStyle} compact /></div>
        </header>
        <AIChatBox messages={visibleMessages} onSendMessage={send} isLoading={sendMutation.isPending} emptyStateMessage={isAuthenticated ? `Начните разговор с ${selectedModel.label}` : "Войдите, чтобы начать чат с Kairema"} suggestedPrompts={["Составь краткий план на день", "Объясни сложную тему простыми словами", "Помоги решить задачу по шагам"]} />
      </section>
    </main>
  );
}

function SettingsPanel({ models, style, onStyleChange, compact = false }: { models: PublicModel[]; style: ResponseStyle; onStyleChange: (style: ResponseStyle) => void; compact?: boolean }) {
  return <Dialog><DialogTrigger asChild><button className={compact ? "kairema-icon-btn" : "kairema-footer-link"} aria-label="Настройки">{compact ? <Settings2 className="size-4" /> : <><SlidersHorizontal className="size-4" />Настройки</>}</button></DialogTrigger><DialogContent className="kairema-dialog"><DialogHeader><DialogTitle className="text-xl text-white">Настройки Kairema</DialogTitle></DialogHeader><p className="text-sm leading-6 text-slate-400">Статусы и сообщения проходят только через защищённый backend. API-ключи не отображаются и не передаются в браузер.</p><div className="mt-4 space-y-2">{models.map((model) => <div key={model.modelId} className="kairema-settings-provider"><div><p className="font-medium text-slate-100">{model.label}</p><p className="text-xs text-slate-500">{model.modelId}</p></div>{model.status ? <div className="text-right"><span className={`kairema-status ${statusClass(model.status.state)}`}>{model.status.badge}</span><p className="mt-1 text-[11px] text-slate-500"><Clock3 className="mr-1 inline size-3" />{formatTime(model.status.checkedAt)}</p></div> : <p className="text-xs text-slate-500">Проверяем…</p>}</div>)}</div><div className="mt-5 border-t border-white/8 pt-4"><p className="text-sm font-medium text-white">Стиль ответа</p><div className="mt-3 flex flex-wrap gap-2">{(Object.keys(styleNames) as ResponseStyle[]).map((value) => <button key={value} onClick={() => onStyleChange(value)} className={`kairema-setting-chip ${style === value ? "kairema-setting-chip-active" : ""}`}>{styleNames[value]}</button>)}</div><p className="mt-5 text-sm font-medium text-white">Память</p><p className="mt-2 text-sm leading-6 text-slate-400">История текущих чатов сохраняется в базе данных и видна только в вашем аккаунте. Ключи и системные сообщения в историю не записываются.</p></div></DialogContent></Dialog>;
}

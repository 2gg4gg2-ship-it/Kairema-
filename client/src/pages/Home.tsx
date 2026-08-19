import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { downloadChatMarkdown, downloadChatPdf } from "@/lib/chat-export";
import { runtimeAuthHeaders } from "@/lib/runtime-auth";
import { trpc } from "@/lib/trpc";
import { Ban, Bot, ChevronDown, CircleCheck, CircleDot, Clock3, Gauge, LoaderCircle, LogIn, Menu, MessageSquarePlus, PanelLeftClose, Search, Settings2, SlidersHorizontal, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ModelId = "google/gemma-4-26b-a4b-it:free" | "cohere/north-mini-code:free" | "dots-studio/dots-3-note-preview:free" | "openai/gpt-oss-20b:free" | "openrouter/free";
type ResponseStyle = "default" | "professional" | "friendly" | "concise" | "steps";
type StaticModel = { key: string; modelId: ModelId; label: string; role: string };
type PublicStatus = { state: string; badge: string; category: string | null; http: number | null; checkedAt: string; confirmed: string };
type PublicModel = StaticModel & { status?: PublicStatus };

const MODELS: readonly StaticModel[] = [
  { key: "ultra", modelId: "google/gemma-4-26b-a4b-it:free", label: "Kairema Ultra (Gemma 4)", role: "Основной универсальный чат для сложных текстов, логики и общения." },
  { key: "code", modelId: "cohere/north-mini-code:free", label: "Kairema Code (North)", role: "Специализированный ИИ для генерации, разбора, рефакторинга и отладки кода." },
  { key: "long_context", modelId: "dots-studio/dots-3-note-preview:free", label: "Kairema Long-Context (Dots3)", role: "Анализ сверхбольших текстов, контекстных документов и тяжёлых файлов." },
  { key: "express", modelId: "openai/gpt-oss-20b:free", label: "Kairema Express (GPT-OSS)", role: "Молниеносные лаконичные ответы на простые повседневные вопросы без воды." },
  { key: "auto_router", modelId: "openrouter/free", label: "Kairema Auto-Router", role: "Автоматический выбор стабильной и свободной бесплатной модели на стороне OpenRouter." },
];

const statusClass = (status?: PublicStatus) => status?.state === "ready" ? "status-ready" : status?.category === "RATE_LIMIT" || status?.category === "QUOTA" ? "status-quota" : status?.state === "not_configured" ? "status-muted" : status?.state === "unavailable" ? "status-unavailable" : status?.state === "loading" ? "status-loading" : "status-auth";
const formatTime = (value?: string) => value ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "Проверяем…";
const styleNames: Record<ResponseStyle, string> = { default: "По умолчанию", professional: "Профессиональный", friendly: "Дружелюбный", concise: "Кратко", steps: "По шагам" };

function StatusIndicator({ status }: { status?: PublicStatus }) {
  const label = status?.badge ?? "Проверяем статус";
  const Icon = status?.state === "ready" ? CircleCheck : status?.category === "RATE_LIMIT" || status?.category === "QUOTA" ? Gauge : status?.state === "loading" || !status ? LoaderCircle : status?.state === "not_configured" ? Ban : TriangleAlert;
  return <span className={`kairema-status ${statusClass(status)}`} title={status?.confirmed ?? label} aria-label={`${label}${status?.confirmed ? `. ${status.confirmed}` : ""}`}><Icon className={`size-3 ${status?.state === "loading" || !status ? "animate-spin" : ""}`} /><span>{label}</span></span>;
}

function sseEventFromBlock(block: string) {
  const event = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
  const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  return { event, data: data ? JSON.parse(data) as Record<string, unknown> : {} };
}

export default function Home() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [activeId, setActiveId] = useState<string>("");
  const [modelId, setModelId] = useState<ModelId>(MODELS[0].modelId);
  const [style, setStyle] = useState<ResponseStyle>("default");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExporting, setIsExporting] = useState<"markdown" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string>("");
  const modelsQuery = trpc.models.list.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true });
  const sessionsQuery = trpc.chats.list.useQuery(undefined, { enabled: isAuthenticated, refetchOnWindowFocus: true });
  const messagesQuery = trpc.chats.messages.useQuery({ sessionId: activeId }, { enabled: isAuthenticated && Boolean(activeId) });
  const createMutation = trpc.chats.create.useMutation();
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
    createdAt: message.createdAt,
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

  const send = async (content: string) => {
    if (!isAuthenticated) return startLogin();
    if (!activeId) return createChat();
    const sessionId = activeId;
    const selectedId = modelId;
    const assistantId = `stream-${Date.now()}`;
    setOptimisticMessages([{ id: `user-${Date.now()}`, role: "user", content }, { id: assistantId, role: "assistant", content: "", providerLabel: selectedModel.label, model: selectedId, status: "печатает" }]);
    setIsStreaming(true);
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...runtimeAuthHeaders() },
        body: JSON.stringify({ sessionId, modelId: selectedId, content, settings: { style } }),
      });
      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => ({ error: "Не удалось начать потоковый ответ." }));
        throw new Error(typeof error.error === "string" ? error.error : "Не удалось начать потоковый ответ.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      const consumeBlock = (block: string) => {
        const { event, data } = sseEventFromBlock(block);
        if (event === "delta" && typeof data.content === "string") {
          setOptimisticMessages((items) => items.map((message) => message.id === assistantId ? { ...message, content: message.content + data.content } : message));
        }
        if (event === "error") throw new Error(typeof data.message === "string" ? data.message : "Потоковый ответ завершился с ошибкой.");
        if (event === "done") {
          done = true;
          setOptimisticMessages((items) => items.map((message) => message.id === assistantId ? { ...message, content: typeof data.content === "string" ? data.content : message.content, model: typeof data.modelUsed === "string" ? data.modelUsed : message.model, providerLabel: typeof data.label === "string" ? data.label : message.providerLabel, status: "полный ответ" } : message));
        }
      };
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? "";
        blocks.forEach(consumeBlock);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeBlock(buffer);
      if (!done) throw new Error("Поток завершился до получения итогового ответа.");
      await Promise.all([utils.chats.messages.invalidate({ sessionId }), utils.chats.list.invalidate()]);
      setOptimisticMessages([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось получить потоковый ответ.";
      setOptimisticMessages((items) => [...items.filter((item) => item.id !== assistantId), { id: `stream-error-${Date.now()}`, role: "assistant", content: message, providerLabel: "OpenRouter", model: selectedId, status: "ошибка", isError: true }]);
    } finally {
      setIsStreaming(false);
    }
  };

  const exportCurrentChat = async (format: "markdown" | "pdf") => {
    if (!activeSession || !dbMessages.length || isExporting) return;
    setExportError("");
    setIsExporting(format);
    try {
      const exportMessages = dbMessages.filter((message): message is Message & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant");
      const input = { title: activeSession.title, messages: exportMessages, exportedAt: new Date() };
      if (format === "markdown") downloadChatMarkdown(input);
      else await downloadChatPdf(input);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Не удалось подготовить файл для скачивания.");
    } finally {
      setIsExporting(null);
    }
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
            <span className="kairema-provider-copy"><span className="kairema-provider-title">{model.label}</span><span className="kairema-provider-role">{model.role}</span><StatusIndicator status={model.status} /></span>
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
        <AIChatBox messages={visibleMessages} onSendMessage={send} isLoading={isStreaming} onExportMarkdown={() => void exportCurrentChat("markdown")} onExportPdf={() => void exportCurrentChat("pdf")} canExport={Boolean(activeSession && dbMessages.length)} exportBusy={isExporting} exportError={exportError} emptyStateMessage={isAuthenticated ? `Начните разговор с ${selectedModel.label}` : "Войдите, чтобы начать чат с Kairema"} suggestedPrompts={["Составь краткий план на день", "Объясни сложную тему простыми словами", "Помоги решить задачу по шагам"]} />
      </section>
    </main>
  );
}

function SettingsPanel({ models, style, onStyleChange, compact = false }: { models: PublicModel[]; style: ResponseStyle; onStyleChange: (style: ResponseStyle) => void; compact?: boolean }) {
  return <Dialog><DialogTrigger asChild><button className={compact ? "kairema-icon-btn" : "kairema-footer-link"} aria-label="Настройки">{compact ? <Settings2 className="size-4" /> : <><SlidersHorizontal className="size-4" />Настройки</>}</button></DialogTrigger><DialogContent className="kairema-dialog"><DialogHeader><DialogTitle className="text-xl text-white">Настройки Kairema</DialogTitle></DialogHeader><p className="text-sm leading-6 text-slate-400">Статусы и сообщения проходят только через защищённый backend. API-ключи не отображаются и не передаются в браузер.</p><div className="mt-4 space-y-2">{models.map((model) => <div key={model.modelId} className="kairema-settings-provider"><div><p className="font-medium text-slate-100">{model.label}</p><p className="text-xs text-slate-500">{model.modelId}</p></div><div className="text-right"><StatusIndicator status={model.status} /><p className="mt-1 text-[11px] text-slate-500"><Clock3 className="mr-1 inline size-3" />{formatTime(model.status?.checkedAt)}</p></div></div>)}</div><div className="mt-5 border-t border-white/8 pt-4"><p className="text-sm font-medium text-white">Стиль ответа</p><div className="mt-3 flex flex-wrap gap-2">{(Object.keys(styleNames) as ResponseStyle[]).map((value) => <button key={value} onClick={() => onStyleChange(value)} className={`kairema-setting-chip ${style === value ? "kairema-setting-chip-active" : ""}`}>{styleNames[value]}</button>)}</div><p className="mt-5 text-sm font-medium text-white">Память</p><p className="mt-2 text-sm leading-6 text-slate-400">История текущих чатов сохраняется в базе данных и видна только в вашем аккаунте. Ключи и системные сообщения в историю не записываются.</p></div></DialogContent></Dialog>;
}

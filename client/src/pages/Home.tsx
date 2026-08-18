import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { BadgeCheck, Bot, ChevronDown, CircleDot, Clock3, Menu, MessageSquarePlus, PanelLeftClose, Search, Settings2, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ProviderId = "deepseek" | "gemma" | "gemini" | "openai" | "kimi" | "grok";
type ProviderView = { id: ProviderId; label: string; model: string; status: { badge: "Готов" | "Нет квоты" | "Временно недоступен" | "Ключ отклонён" | "Не настроено"; checkedAt: string } };
type Chat = { id: string; title: string; messages: Message[] };

const PROVIDERS: Array<Pick<ProviderView, "id" | "label" | "model">> = [
  { id: "deepseek", label: "DeepSeek", model: "deepseek-v4-flash" },
  { id: "gemma", label: "Gemma 4 31B", model: "gemma-4-31b-it" },
  { id: "gemini", label: "Gemini", model: "gemini-3.6-flash" },
  { id: "openai", label: "ChatGPT / OpenAI", model: "gpt-4o-mini" },
  { id: "kimi", label: "Kimi", model: "kimi-k2.6" },
  { id: "grok", label: "Grok", model: "grok-4.6" },
];
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const blankChat = (): Chat => ({ id: newId(), title: "Новый разговор", messages: [] });
const loadChats = (): Chat[] => { try { const data = JSON.parse(localStorage.getItem("kairema-chats") ?? "[]") as Chat[]; return data.length ? data : [blankChat()]; } catch { return [blankChat()]; } };
const statusClass = (value?: string) => value === "Готов" ? "status-ready" : value === "Нет квоты" ? "status-quota" : value === "Ключ отклонён" ? "status-auth" : value === "Не настроено" ? "status-muted" : "status-unavailable";
const time = (value?: string) => value ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "Проверяем…";

export default function Home() {
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeId, setActiveId] = useState(() => localStorage.getItem("kairema-active") ?? chats[0]?.id ?? "");
  const [provider, setProvider] = useState<ProviderId | "auto">("auto");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const statusQuery = trpc.providers.list.useQuery(undefined, { refetchInterval: 60_000, refetchOnWindowFocus: true });
  const chatMutation = trpc.chat.useMutation();
  const active = chats.find((chat) => chat.id === activeId) ?? chats[0];
  const statusMap = useMemo(() => new Map((statusQuery.data as ProviderView[] | undefined)?.map((item) => [item.id, item]) ?? []), [statusQuery.data]);
  const providerCards = PROVIDERS.map((item) => ({ ...item, status: statusMap.get(item.id)?.status }));
  const visibleChats = chats.filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase()));
  const selectedName = provider === "auto" ? "Авто" : statusMap.get(provider)?.label ?? PROVIDERS.find((item) => item.id === provider)?.label ?? "Авто";

  useEffect(() => { localStorage.setItem("kairema-chats", JSON.stringify(chats)); }, [chats]);
  useEffect(() => { if (activeId) localStorage.setItem("kairema-active", activeId); }, [activeId]);

  const createChat = () => { const chat = blankChat(); setChats((items) => [chat, ...items]); setActiveId(chat.id); setSidebarOpen(false); };
  const append = (chatId: string, message: Message, title?: string) => setChats((items) => items.map((chat) => chat.id === chatId ? { ...chat, title: title ?? chat.title, messages: [...chat.messages, message] } : chat));
  const send = (content: string) => {
    if (!active) return;
    const chatId = active.id;
    const user: Message = { id: newId(), role: "user", content };
    append(chatId, user, active.messages.length === 0 ? content.slice(0, 48) : undefined);
    const messages = [...active.messages, user].filter((item) => !item.isError && item.role !== "system").map(({ role, content: body }) => ({ role: role as "user" | "assistant", content: body }));
    chatMutation.mutate({ provider, messages }, {
      onSuccess: (result) => append(chatId, { id: newId(), role: "assistant", content: result.content, providerLabel: result.providerLabel, model: result.model, status: result.status }),
      onError: (error) => append(chatId, { id: newId(), role: "assistant", content: error.message, providerLabel: selectedName, model: "", status: "", isError: true }),
    });
  };

  return <main className="kairema-shell">
    <aside className={`kairema-sidebar ${sidebarOpen ? "kairema-sidebar-open" : ""}`}>
      <div className="kairema-brand-row"><span className="kairema-logo"><Sparkles className="size-4" /></span><span>Kairema</span><button className="kairema-icon-btn md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Закрыть меню"><X className="size-4" /></button></div>
      <button onClick={createChat} className="kairema-new-chat"><MessageSquarePlus className="size-4" />Новый чат</button>
      <div className="kairema-sidebar-label"><CircleDot className="size-3" />Выбор модели</div>
      <div className="kairema-providers">{providerCards.map((item) => <button key={item.id} onClick={() => { setProvider(item.id); setSidebarOpen(false); }} className={`kairema-provider ${provider === item.id ? "kairema-provider-selected" : ""}`}><span className="kairema-provider-icon"><Bot className="size-4" /></span><span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium text-slate-100">{item.label}</span><span className="block truncate text-[11px] text-slate-500">{item.model}</span></span>{item.status ? <span className={`kairema-status ${statusClass(item.status.badge)}`}>{item.status.badge}</span> : <span className="kairema-status-loading" />}</button>)}</div>
      <div className="kairema-history-head"><span>История</span><button onClick={createChat} className="kairema-icon-btn" aria-label="Создать чат"><MessageSquarePlus className="size-4" /></button></div>
      <label className="kairema-search"><Search className="size-4" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" /></label>
      <div className="kairema-history-list">{visibleChats.map((chat) => <button key={chat.id} onClick={() => { setActiveId(chat.id); setSidebarOpen(false); }} className={`kairema-history-item ${chat.id === active?.id ? "kairema-history-active" : ""}`}>{chat.title}</button>)}</div>
      <div className="kairema-sidebar-footer"><button className="kairema-footer-link"><BadgeCheck className="size-4" />Память</button><SettingsPanel cards={providerCards} /><p>Ключи остаются только на сервере</p></div>
    </aside>
    {sidebarOpen && <button className="kairema-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Закрыть боковую панель" />}
    <section className="kairema-main"><header className="kairema-topbar"><div className="flex items-center gap-2"><button className="kairema-icon-btn md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Открыть меню"><Menu className="size-5" /></button><button className="kairema-icon-btn hidden md:grid" onClick={() => setSidebarOpen((value) => !value)} aria-label="Свернуть боковую панель"><PanelLeftClose className="size-4" /></button><span className="text-sm text-slate-500">{active?.title ?? "Новый разговор"}</span></div><div className="flex items-center gap-2"><div className="kairema-select-wrap"><select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId | "auto")} aria-label="Выбор модели"><option value="auto">Авто</option>{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /></div><SettingsPanel cards={providerCards} compact /></div></header><AIChatBox messages={active?.messages ?? []} onSendMessage={send} isLoading={chatMutation.isPending} suggestedPrompts={["Составь краткий план на день", "Объясни сложную тему простыми словами", "Помоги решить задачу по шагам"]} /></section>
  </main>;
}

function SettingsPanel({ cards, compact = false }: { cards: Array<Pick<ProviderView, "id" | "label" | "model"> & { status?: ProviderView["status"] }>; compact?: boolean }) {
  return <Dialog><DialogTrigger asChild><button className={compact ? "kairema-icon-btn" : "kairema-footer-link"} aria-label="Настройки">{compact ? <Settings2 className="size-4" /> : <><SlidersHorizontal className="size-4" />Настройки</>}</button></DialogTrigger><DialogContent className="kairema-dialog"><DialogHeader><DialogTitle className="text-xl text-white">Настройки Kairema</DialogTitle></DialogHeader><p className="text-sm leading-6 text-slate-400">Статусы проверяются на сервере. API-ключи не передаются в браузер и не отображаются в приложении.</p><div className="mt-4 space-y-2">{cards.map((item) => <div key={item.id} className="kairema-settings-provider"><div><p className="font-medium text-slate-100">{item.label}</p><p className="text-xs text-slate-500">{item.model}</p></div>{item.status ? <div className="text-right"><span className={`kairema-status ${statusClass(item.status.badge)}`}>{item.status.badge}</span><p className="mt-1 text-[11px] text-slate-500"><Clock3 className="mr-1 inline size-3" />{time(item.status.checkedAt)}</p></div> : <p className="text-xs text-slate-500">Проверяем…</p>}</div>)}</div><div className="mt-5 border-t border-white/8 pt-4"><p className="text-sm font-medium text-white">Стиль ответа</p><div className="mt-3 flex flex-wrap gap-2">{["По умолчанию", "Профессиональный", "Дружелюбный", "Кратко", "По шагам"].map((value) => <span key={value} className="kairema-setting-chip">{value}</span>)}</div></div></DialogContent></Dialog>;
}

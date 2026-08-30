/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  modelId: "fast",
  sessionId: "11111111-1111-4111-8111-111111111111",
  sessions: [] as Array<{ id: string; modelId: string; title: string }>,
  messages: [] as Array<{ id: number; role: "user" | "assistant"; content: string; modelId: string | null; createdAt: Date; metadata?: string }>,
  historyNextCursor: null as string | null,
  attachments: [] as Array<{ id: string; fileName: string; contentType: string; byteSize: number; kind: "image" | "document"; previewUrl: string }>,
  prepareMarkdown: vi.fn(),
  preparePdf: vi.fn(),
  downloadPrepared: vi.fn(),
  invalidateMessages: vi.fn(),
  historyPageFetch: vi.fn(),
  invalidateSessions: vi.fn(),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  clearHistory: vi.fn(),
  updateSettings: vi.fn(),
  draft: null as { content: string; updatedAt: Date } | null,
  draftQueryInput: null as { sessionId: string } | null,
  saveDraft: vi.fn(),
  clearDraft: vi.fn(),
  toggleTheme: vi.fn(),
  updateMemory: vi.fn(),
  addMemoryFact: vi.fn(),
  deleteMemoryEntry: vi.fn(),
  clearMemory: vi.fn(),
  createExport: vi.fn(),
  deleteExport: vi.fn(),
  downloadExport: vi.fn(),
  invalidateExports: vi.fn(),
  exports: [] as Array<{ id: string; fileName: string; format: "markdown" | "pdf"; byteSize: number; createdAt: Date }>,
  uploadAttachment: vi.fn(),
  beginStytchLink: vi.fn(),
  startLogin: vi.fn(),
  isAuthenticated: true,
  authLoading: false,
  isOwner: false,
  navigate: vi.fn(),
  releaseSecondDelta: null as (() => void) | null,
  memoryData: { settings: { enabled: 1, autoExtract: 1 }, profile: { profile: "", summary: "Автоматически извлечённый нейтральный факт" }, facts: [{ id: "11111111-1111-4111-8111-111111111112", value: "Предпочитает русский язык" }], topics: [{ id: "11111111-1111-4111-8111-111111111113", value: "2026-08-21 Flash: настройка профиля", role: "fast" }] },
}));

Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  setPointerCapture: { configurable: true, value: () => undefined },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
});

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: fixtures.isAuthenticated, loading: fixtures.authLoading }) }));
vi.mock("@/const", () => ({ startLogin: fixtures.startLogin }));
vi.mock("@/lib/runtime-auth", () => ({ runtimeAuthHeaders: () => ({ Authorization: "Bearer test-session" }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: fixtures.toggleTheme, highContrast: false, setHighContrast: vi.fn() }) }));
vi.mock("@/lib/chat-export", () => ({
  prepareChatMarkdown: fixtures.prepareMarkdown,
  prepareChatPdf: fixtures.preparePdf,
  downloadPreparedChatExport: fixtures.downloadPrepared,
}));
vi.mock("wouter", () => ({ useLocation: () => ["/", fixtures.navigate] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { beginLink: { useMutation: () => ({ mutateAsync: fixtures.beginStytchLink, isPending: false }) } },
    models: { list: { useQuery: () => ({ data: [
      { key: "fast", modelId: "fast", label: "Kairema Flash", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, runtime: { state: "ready", provider: "OpenRouter", modelUsed: "Fast", checkedAt: "2026-08-19T00:00:00.000Z" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "smart", modelId: "smart", label: "Kairema Think", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "context", modelId: "context", label: "Kairema Context", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "flagship", modelId: "flagship", label: "Kairema Apex", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
    ] }) } },
    settings: { get: { useQuery: () => ({ data: { language: "ru", theme: "dark", responseStyle: "default", responseLength: "balanced", quickReplies: 1, effort: "standard", thinking: 0, defaultRole: "fast", webSearch: 0, healthRefreshSeconds: 30, highContrast: 0 } }) }, update: { useMutation: () => ({ mutateAsync: fixtures.updateSettings }) } },
    memory: { get: { useQuery: () => ({ data: fixtures.memoryData }) }, update: { useMutation: () => ({ mutateAsync: fixtures.updateMemory }) }, addFact: { useMutation: () => ({ mutateAsync: fixtures.addMemoryFact }) }, deleteEntry: { useMutation: () => ({ mutateAsync: fixtures.deleteMemoryEntry }) }, clear: { useMutation: () => ({ mutateAsync: fixtures.clearMemory }) } },
    webSearch: { status: { useQuery: () => ({ data: { available: false, reason: "Поиск сейчас недоступен", checkedAt: "2026-08-19T00:00:00.000Z", layers: [{ id: "google", state: "limited", retryAt: null }, { id: "tavily", state: "ready", retryAt: null }, { id: "openrouter", state: "ready", retryAt: null }] } }) } },
    knowledge: { status: { useQuery: () => ({ data: { documents: 0, sources: [], lastRun: null } }) }, audit: { useQuery: () => ({ data: { sources: [{ name: "OpenAI News", domain: "openai.com", ...(fixtures.isOwner ? { url: "https://openai.com/news/rss.xml" } : {}), indexedCount: 12, lastSuccessAt: "2026-08-19T00:00:00.000Z" }], latestRun: { state: "completed", startedAt: "2026-08-19T00:00:00.000Z", finishedAt: "2026-08-19T00:01:00.000Z" } } }) }, refresh: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
    providers: { dashboard: { useQuery: () => ({ data: [{ id: "openrouter", label: "OpenRouter", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "google", label: "Google AI Studio", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "groq", label: "Groq", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }] }) } },
    owner: { isOwner: { useQuery: () => ({ data: fixtures.isOwner }) }, flashTtft: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: { p50Ms: 220, p95Ms: 440, samples: 2 }, last7d: { p50Ms: 250, p95Ms: 480, samples: 5 } } : null }) }, flashTtftTrend: { useQuery: () => ({ data: fixtures.isOwner ? [{ date: "2026-08-20", p50Ms: 220, p95Ms: 440, samples: 2 }] : [] }) }, searchOutages: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: 1, last7d: 2, recent: [{ layer: "google", errorClass: "http_429", latencyMs: 120, createdAt: "2026-08-20T00:00:00.000Z" }] } : null }) } },
    search: { query: { useQuery: () => ({ data: [] }) }, qualityPanel: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: { sampleCount: 4, counts: { found: 2, empty: 1, degraded: 1, error: 0 }, verifiedSourceCount: 2, zeroSourceCount: 2, staleBlockedCount: 1, foundRate: 0.5, verificationPassRate: 0.5 }, last7d: { sampleCount: 10, counts: { found: 6, empty: 2, degraded: 1, error: 1 }, verifiedSourceCount: 6, zeroSourceCount: 4, staleBlockedCount: 2, foundRate: 0.6, verificationPassRate: 0.6 } } : null }) }, qualityChart: { useQuery: () => ({ data: fixtures.isOwner ? { daily: [{ day: "08-15", found: 1, empty: 0, degraded: 0, error: 0 }, { day: "08-21", found: 3, empty: 1, degraded: 0, error: 0 }], hourlyLayers: [{ hour: "09", layer1: 2, layer2: 1, layer3: 0 }, { hour: "10", layer1: 1, layer2: 0, layer3: 1 }] } : null }) } },
    attachments: { list: { useQuery: () => ({ data: fixtures.attachments }) }, upload: { useMutation: () => ({ mutateAsync: fixtures.uploadAttachment }) }, delete: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    exports: { list: { useQuery: () => ({ data: fixtures.exports, isLoading: false }) }, create: { useMutation: () => ({ mutateAsync: fixtures.createExport, isPending: false }) }, delete: { useMutation: () => ({ mutateAsync: fixtures.deleteExport, isPending: false, variables: undefined }) } },
    chats: {
      list: { useQuery: () => ({ data: fixtures.sessions, isLoading: false }) },
      messages: { useQuery: () => ({ data: fixtures.messages }) },
      historyPage: { useQuery: () => ({ data: { messages: fixtures.messages, nextCursor: fixtures.historyNextCursor }, isLoading: false }) },
      draft: { useQuery: (input: { sessionId: string }) => { fixtures.draftQueryInput = input; return { data: fixtures.draft, isLoading: false }; } },
      create: { useMutation: () => ({ mutateAsync: fixtures.createChat, isPending: false }) },
      delete: { useMutation: () => ({ mutateAsync: fixtures.deleteChat, isPending: false }) },
      clearAll: { useMutation: () => ({ mutateAsync: fixtures.clearHistory, isPending: false }) },
      saveDraft: { useMutation: () => ({ mutateAsync: fixtures.saveDraft, isPending: false }) },
      clearDraft: { useMutation: () => ({ mutateAsync: fixtures.clearDraft, isPending: false }) },
    },
    useUtils: () => ({ models: { list: { invalidate: vi.fn() } }, settings: { get: { invalidate: vi.fn() } }, memory: { get: { invalidate: vi.fn() } }, knowledge: { status: { invalidate: vi.fn() } }, attachments: { list: { invalidate: vi.fn() } }, exports: { list: { invalidate: fixtures.invalidateExports }, download: { fetch: fixtures.downloadExport } }, chats: { messages: { invalidate: fixtures.invalidateMessages }, historyPage: { invalidate: fixtures.invalidateMessages, fetch: fixtures.historyPageFetch }, list: { invalidate: fixtures.invalidateSessions } } }),
  },
}));
vi.mock("@/components/ui/dialog", () => ({
  useDialogComposition: () => ({ isComposing: () => false, setComposing: () => {}, justEndedComposing: () => false, markCompositionEnd: () => {} }),
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Home, { SettingSwitch } from "./Home";

const encoder = new TextEncoder();

function resetFixtures() {
  fixtures.isAuthenticated = true;
  fixtures.authLoading = false;
  fixtures.startLogin.mockReset();
  fixtures.sessions = [{ id: fixtures.sessionId, modelId: fixtures.modelId, title: "Активная история" }];
  fixtures.messages = [
    { id: 1, role: "user", content: "Старое сообщение пользователя", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:00:00.000Z") },
    { id: 2, role: "assistant", content: "Старый ответ Kairema", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:01:00.000Z") },
  ];
  fixtures.historyNextCursor = null;
  fixtures.attachments = [];
  fixtures.createExport.mockReset().mockImplementation(async ({ sessionId, format }: { sessionId: string; format: "markdown" | "pdf" }) => ({ id: format === "markdown" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sessionId, fileName: `Активная история.${format === "markdown" ? "md" : "pdf"}`, format, byteSize: 100, createdAt: new Date("2026-08-25T00:00:00.000Z") }));
  fixtures.deleteExport.mockReset().mockResolvedValue({ success: true });
  fixtures.downloadExport.mockReset().mockResolvedValue({ url: "https://storage.example.test/signed-export" });
  fixtures.invalidateExports.mockReset().mockResolvedValue(undefined);
  fixtures.exports = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fileName: "Активная история.md", format: "markdown", byteSize: 100, createdAt: new Date("2026-08-25T00:00:00.000Z") }];
  fixtures.isOwner = false;
  fixtures.navigate.mockReset();
  fixtures.toggleTheme.mockReset();
  fixtures.updateMemory.mockReset().mockResolvedValue(undefined);
  fixtures.addMemoryFact.mockReset().mockResolvedValue(undefined);
  fixtures.deleteMemoryEntry.mockReset().mockResolvedValue(undefined);
  fixtures.clearMemory.mockReset().mockResolvedValue(undefined);
  fixtures.uploadAttachment.mockReset().mockResolvedValue({ id: "55555555-5555-4555-8555-555555555555", fileName: "vision.png", contentType: "image/png", byteSize: 100, kind: "image", previewUrl: "https://preview.example.test/vision.png" });
  fixtures.beginStytchLink.mockReset().mockResolvedValue({ state: "LINK_CONFIRMATION_REQUESTED" });
  fixtures.invalidateSessions.mockReset().mockResolvedValue(undefined);
  fixtures.createChat.mockReset().mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", modelId: "fast", title: "Новый разговор" });
  fixtures.deleteChat.mockReset().mockResolvedValue({ success: true });
  fixtures.clearHistory.mockReset().mockResolvedValue({ success: true, deletedCount: 1 });
  fixtures.historyPageFetch.mockReset().mockResolvedValue({ messages: [], nextCursor: null });
  fixtures.updateSettings.mockReset().mockResolvedValue(undefined);
  fixtures.draft = null;
  fixtures.draftQueryInput = null;
  fixtures.saveDraft.mockReset().mockResolvedValue({ content: "", updatedAt: new Date() });
  fixtures.clearDraft.mockReset().mockResolvedValue({ cleared: true });
  fixtures.invalidateMessages.mockReset().mockImplementation(async () => {
    fixtures.messages = [
      ...fixtures.messages,
      { id: 3, role: "user", content: "Новый вопрос", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:02:00.000Z") },
      { id: 4, role: "assistant", content: "Первый фрагмент ответа", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:03:00.000Z") },
    ];
  });
  fixtures.releaseSecondDelta = null;
  fixtures.memoryData = { settings: { enabled: 1, autoExtract: 1 }, profile: { profile: "", summary: "Автоматически извлечённый нейтральный факт" }, facts: [{ id: "11111111-1111-4111-8111-111111111112", value: "Предпочитает русский язык" }], topics: [{ id: "11111111-1111-4111-8111-111111111113", value: "2026-08-21 Flash: настройка профиля", role: "fast" }] };
}

describe("Home integration flows", () => {
  beforeEach(() => resetFixtures());
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("always renders exactly four public role cards and never renders the removed Code role", () => {
    render(<Home />);

    const visibleRoleCards = document.querySelectorAll(".kairema-provider");
    expect(visibleRoleCards).toHaveLength(4);
    expect(screen.queryByText("Kairema Код")).toBeNull();
  });

  it("keeps the complete descriptions for all four public roles in the selector", () => {
    render(<Home />);

    expect(Array.from(document.querySelectorAll(".kairema-provider-role")).map((node) => node.textContent)).toEqual([
      "Короткие повседневные ответы без ожидания.",
      "Логика, рассуждения и сложные задачи среднего объёма.",
      "Длинные документы, большие фрагменты текста и связный контекст.",
      "Требовательные задачи, глубокий анализ и комплексные ответы.",
    ]);
  });

  it("collapses and reopens the desktop sidebar with an accessible stateful control", async () => {
    const user = userEvent.setup();
    render(<Home />);

    const sidebar = document.querySelector(".kairema-sidebar");
    expect(sidebar?.classList.contains("kairema-sidebar-collapsed")).toBe(true);
    expect(sidebar?.hasAttribute("inert")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Показать боковую панель" }));
    expect(sidebar?.classList.contains("kairema-sidebar-open")).toBe(true);
    expect(sidebar?.hasAttribute("inert")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Скрыть боковую панель" }));
    expect(sidebar?.classList.contains("kairema-sidebar-collapsed")).toBe(true);
  });

  it("always exposes a persistent guest login control in the topbar", async () => {
    const user = userEvent.setup();
    fixtures.isAuthenticated = false;
    fixtures.sessions = [];
    fixtures.messages = [];
    render(<Home />);

    const logins = screen.getAllByRole("button", { name: "Войти для истории" });
    const topbarLogin = logins.find((node) => node.classList.contains("kairema-guest-login") && !node.classList.contains("kairema-guest-login-empty"));
    const emptyStateLogin = logins.find((node) => node.classList.contains("kairema-guest-login-empty"));
    expect(topbarLogin).toBeDefined();
    expect(emptyStateLogin).toBeDefined();
    await user.click(emptyStateLogin!);
    expect(fixtures.startLogin).toHaveBeenCalledTimes(1);
  });

  it("renders an owned temporary attachment only inside the saved user bubble that references it", () => {
    fixtures.messages = [{ id: 1, role: "user", content: "Посмотри изображение", modelId: "fast", createdAt: new Date("2026-08-19T00:00:00.000Z"), metadata: JSON.stringify({ attachmentIds: ["44444444-4444-4444-8444-444444444444"] }) }];
    fixtures.attachments = [{ id: "44444444-4444-4444-8444-444444444444", fileName: "owned.png", contentType: "image/png", byteSize: 100, kind: "image", previewUrl: "https://preview.example.test/owned.png" }];
    render(<Home />);

    expect(screen.getByRole("button", { name: "Открыть предпросмотр: owned.png" })).toBeTruthy();
    expect(screen.getByText("Посмотри изображение")).toBeTruthy();
  });

  it("creates an allowed new chat when an old history item still has the removed Code role", async () => {
    const user = userEvent.setup();
    fixtures.sessions = [{ id: fixtures.sessionId, modelId: "code", title: "Старый чат" }];
    fixtures.messages = [];
    render(<Home />);

    await user.click(screen.getAllByRole("button", { name: "Новый чат" })[0]!);

    await waitFor(() => expect(fixtures.createChat).toHaveBeenCalledWith({ modelId: "fast" }));
    expect(screen.queryByText(/Invalid option/)).toBeNull();
  });

  it("renders the structured create-chat failure message instead of a raw JSON object", async () => {
    const user = userEvent.setup();
    fixtures.createChat.mockRejectedValueOnce({ error: { message: "Хранилище временно недоступно." } });
    render(<Home />);

    await user.click(screen.getAllByRole("button", { name: "Новый чат" })[0]!);

    expect(await screen.findByText("Хранилище временно недоступно.")).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]|\{"error"/)).toBeNull();
  });

  it("requires explicit in-app confirmation before deleting an active owned chat", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Удалить: Активная история" }));

    expect(screen.getByRole("alertdialog", { name: "Удалить чат?" })).toBeTruthy();
    expect(fixtures.deleteChat).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(fixtures.deleteChat).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Удалить: Активная история" }));
    await user.click(screen.getByRole("button", { name: "Удалить чат" }));
    await waitFor(() => expect(fixtures.deleteChat).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
    await waitFor(() => expect(fixtures.invalidateSessions).toHaveBeenCalled());
    expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 });
  });

  it("submits an active chat deletion only once when confirmation is activated repeatedly", async () => {
    const user = userEvent.setup();
    let resolveDelete: (() => void) | undefined;
    fixtures.deleteChat.mockImplementationOnce(() => new Promise<{ success: boolean }>((resolve) => {
      resolveDelete = () => resolve({ success: true });
    }));
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Удалить: Активная история" }));
    const confirm = screen.getByRole("button", { name: "Удалить чат" });
    await user.dblClick(confirm);

    await waitFor(() => expect(fixtures.deleteChat).toHaveBeenCalledTimes(1));
    resolveDelete?.();
    await waitFor(() => expect(fixtures.invalidateSessions).toHaveBeenCalledOnce());
  });

  it("requires explicit confirmation before bulk-clearing history and clears it once after consent", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Очистить всю историю" }));
    expect(screen.getByRole("alertdialog", { name: "Очистить всю историю?" })).toBeTruthy();
    expect(fixtures.clearHistory).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(fixtures.clearHistory).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Очистить всю историю" }));
    await user.dblClick(screen.getByRole("button", { name: "Да, удалить всё" }));
    await waitFor(() => expect(fixtures.clearHistory).toHaveBeenCalledOnce());
    await waitFor(() => expect(fixtures.invalidateSessions).toHaveBeenCalled());
    expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 });
  });

  it("creates server-side Markdown and PDF exports for only the active persisted history", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<Home />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Markdown" })).toHaveProperty("disabled", false));
    await user.click(screen.getByRole("button", { name: "Markdown" }));
    await user.click(screen.getByRole("button", { name: "PDF" }));

    await waitFor(() => expect(fixtures.createExport).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, format: "markdown" }));
    expect(fixtures.createExport).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, format: "pdf" });
    expect(fixtures.downloadExport).toHaveBeenCalledTimes(2);
    expect(fixtures.invalidateExports).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it("renders a personal persistent export history control without a permanent files panel", () => {
    render(<Home />);

    expect(screen.getByRole("button", { name: "Экспорты" })).toHaveProperty("disabled", false);
    expect(screen.queryByRole("region", { name: "Файлы" })).toBeNull();
  });

  it("keeps the owner analytics entry and inline charts hidden from a non-owner", () => {
    render(<Home />);

    expect(screen.queryByRole("button", { name: "Аналитика владельца" })).toBeNull();
    expect(screen.queryByLabelText("Графики качества поиска владельца")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Качество веб-поиска" })).toBeNull();
  });

  it("requests explicit Stytch linking without passing a frontend user identity or auto-linking", async () => {
    const user = userEvent.setup();
    render(<Home />);

    const email = screen.getByLabelText("Email для подтверждения");
    await user.type(email, "linked@example.test");
    await user.click(screen.getByRole("button", { name: "Отправить подтверждение" }));

    await waitFor(() => expect(fixtures.beginStytchLink).toHaveBeenCalledWith({ email: "linked@example.test" }));
    expect(screen.getByText(/Совпадение адреса никогда не объединяет аккаунты автоматически/)).toBeTruthy();
  });

  it("routes an owner to the dedicated analytics page instead of rendering inline metrics", async () => {
    const user = userEvent.setup();
    fixtures.isOwner = true;
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Аналитика владельца" }));

    expect(fixtures.navigate).toHaveBeenCalledWith("/owner-analytics");
    expect(screen.queryByLabelText("Графики качества поиска владельца")).toBeNull();
    expect(screen.queryByText(/http_429/i)).toBeNull();
  });

  it("shows unified private memory lists and saves the profile explicitly", async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(screen.getByRole("button", { name: "Память" }));
    expect(screen.getByText("Предпочитает русский язык")).toBeTruthy();
    expect(screen.getByLabelText("Автоматический профиль").textContent).toContain("Автоматически извлечённый нейтральный факт");
    expect(screen.getByText("2026-08-21 Flash: настройка профиля")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(fixtures.updateMemory).toHaveBeenCalledWith({ profile: "" }));
    const deleteButtons = screen.getAllByRole("button", { name: "Удалить запись памяти" });
    await user.click(deleteButtons[0]!);
    await waitFor(() => expect(fixtures.deleteMemoryEntry).toHaveBeenCalledWith({ entryId: "11111111-1111-4111-8111-111111111112" }));
    await waitFor(() => expect(screen.queryByText("Предпочитает русский язык")).toBeNull());
  });

  it("filters unlimited memory entries, keeps auto-extraction independent and requires a clear confirmation", async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(screen.getByRole("button", { name: "Память" }));

    const memoryCounts = Array.from(document.querySelectorAll(".kairema-entry-count")).map((node) => node.textContent);
    expect(memoryCounts).toEqual(["1", "1"]);
    expect(memoryCounts.every((count) => !count?.includes("/"))).toBe(true);
    await user.type(screen.getByLabelText("Поиск по памяти"), "профиля");
    expect(screen.getByText("2026-08-21 Flash: настройка профиля")).toBeTruthy();
    await user.click(within(screen.getByRole("group", { name: "Фильтр памяти" })).getByRole("button", { name: "Факты памяти" }));
    expect(screen.queryByText("2026-08-21 Flash: настройка профиля")).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Автоматически извлекать новые факты" }));
    await waitFor(() => expect(fixtures.updateMemory).toHaveBeenCalledWith({ autoExtract: false }));
    await user.click(screen.getByRole("button", { name: "Очистить всю память" }));
    expect(fixtures.clearMemory).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Очистить всю память?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Да, очистить всё" }));
    await waitFor(() => expect(fixtures.clearMemory).toHaveBeenCalledOnce());
  });

  it("submits a bulk-memory clear only once when confirmation is activated repeatedly", async () => {
    const user = userEvent.setup();
    let resolveClear: (() => void) | undefined;
    fixtures.clearMemory.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveClear = resolve;
    }));
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Память" }));
    await user.click(screen.getByRole("button", { name: "Очистить всю память" }));
    await user.dblClick(screen.getByRole("button", { name: "Да, очистить всё" }));

    await waitFor(() => expect(fixtures.clearMemory).toHaveBeenCalledOnce());
    resolveClear?.();
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Очистить всю память?" })).toBeNull());
  });

  it("shows actual counts above the former limits and allows another manual fact without truncation", async () => {
    const user = userEvent.setup();
    fixtures.memoryData = { ...fixtures.memoryData, facts: Array.from({ length: 31 }, (_, index) => ({ id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, value: `Нейтральный факт ${index + 1}` })), topics: Array.from({ length: 101 }, (_, index) => ({ id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`, value: `2026-08-21 Context: нейтральная тема ${index + 1}`, role: "context" })) };
    render(<Home />);
    await user.click(screen.getByRole("button", { name: "Память" }));

    expect(Array.from(document.querySelectorAll(".kairema-entry-count")).map((node) => node.textContent)).toEqual(["31", "101"]);
    expect(screen.queryByText(/лимит|вытеснять/i)).toBeNull();
    await user.type(document.querySelector(".kairema-fact-add input") as HTMLInputElement, "Новый нейтральный факт");
    const addButton = document.querySelector(".kairema-fact-add button") as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);
    await user.click(addButton);
    await waitFor(() => expect(fixtures.addMemoryFact).toHaveBeenCalledWith({ fact: "Новый нейтральный факт" }));
  });

  it("never renders RAG feed URLs or technical URL controls, including when an audit payload contains a URL", async () => {
    const user = userEvent.setup();
    fixtures.isOwner = true;
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Аудит RAG" }));
    expect(screen.getByText("OpenAI News")).toBeTruthy();
    expect(screen.queryByText(/https:\/\//)).toBeNull();
    expect(screen.queryByRole("button", { name: "Показать технические детали" })).toBeNull();
  });


  it("shows a streaming delta, then replaces optimistic content with the persisted final answer", async () => {
    const user = userEvent.setup();
    const release = new Promise<void>((resolve) => { fixtures.releaseSecondDelta = resolve; });
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"content":"Первый фрагмент"}\n\n'));
        await release;
        controller.enqueue(encoder.encode('event: delta\ndata: {"content":" ответа"}\n\nevent: done\ndata: {"content":"Первый фрагмент ответа","modelUsed":"google/gemma-4-26b-a4b-it:free","label":"Kairema Ultra (Gemma 4)"}\n\n'));
        controller.close();
      },
    })));
    vi.stubGlobal("fetch", fetchSpy);
    render(<Home />);

    const composer = await screen.findByPlaceholderText("Напишите сообщение…");
    await user.type(composer, "Новый вопрос");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const streamPayload = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    expect(streamPayload).toMatchObject({ sessionId: fixtures.sessionId, modelId: "fast", content: "Новый вопрос", attachmentIds: [], settings: { style: "default", responseLength: "balanced", effort: "standard", thinking: false } });
    expect(streamPayload).not.toHaveProperty("webSearch");

    await waitFor(() => expect(screen.getByText("Первый фрагмент")).toBeTruthy());
    expect(screen.queryByText("Первый фрагмент ответа")).toBeNull();
    fixtures.releaseSecondDelta?.();

    await waitFor(() => expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 }));
    await waitFor(() => expect(screen.getByText("Первый фрагмент ответа")).toBeTruthy());
    await waitFor(() => expect(fixtures.clearDraft).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
    expect((composer as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText("печатает")).toBeNull();
  });

  it("restores a persisted draft only for the active chat and debounces its scoped save", async () => {
    const user = userEvent.setup();
    fixtures.draft = { content: "Восстановленный черновик", updatedAt: new Date("2026-08-25T00:00:00.000Z") };
    render(<Home />);

    const composer = await screen.findByPlaceholderText("Напишите сообщение…");
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe("Восстановленный черновик"));
    expect(fixtures.draftQueryInput).toEqual({ sessionId: fixtures.sessionId });
    await user.type(composer, " + продолжение");

    await waitFor(() => expect(fixtures.saveDraft).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, content: "Восстановленный черновик + продолжение" }), { timeout: 1_200 });
  });

  it("keeps an optimistic sent-image preview visible when the provider fails after the user message is persisted", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/attachments/upload"
      ? new Response(JSON.stringify({ id: "55555555-5555-4555-8555-555555555555", fileName: "vision.png", contentType: "image/png", byteSize: 7, kind: "image", previewUrl: "https://files.example/vision.png" }), { status: 201, headers: { "content-type": "application/json" } })
      : new Response("unavailable", { status: 503, statusText: "Service Unavailable" })));
    render(<Home />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    await user.upload(input!, new File(["neutral"], "vision.png", { type: "image/png" }));
    await screen.findByRole("button", { name: "Открыть предпросмотр: vision.png" });
    await user.type(screen.getByPlaceholderText("Напишите сообщение…"), "Проверь вложение");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText(/Не удалось начать потоковый ответ|Service Unavailable/)).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "Открыть предпросмотр: vision.png" }).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 }));
    expect((screen.getByPlaceholderText("Напишите сообщение…") as HTMLTextAreaElement).value).toBe("");
    await waitFor(() => expect(fixtures.clearDraft).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
  });

  it("keeps a sent-image preview while persisted message hydration leads the attachment query", async () => {
    const user = userEvent.setup();
    fixtures.invalidateMessages.mockImplementation(async () => {
      fixtures.messages = [...fixtures.messages,
        { id: 3, role: "user", content: "Проверь вложение", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:02:00.000Z"), metadata: JSON.stringify({ attachmentIds: ["55555555-5555-4555-8555-555555555555"] }) },
        { id: 4, role: "assistant", content: "Готово", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:03:00.000Z") },
      ];
      fixtures.attachments = [];
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/attachments/upload"
      ? new Response(JSON.stringify({ id: "55555555-5555-4555-8555-555555555555", fileName: "vision.png", contentType: "image/png", byteSize: 7, kind: "image", previewUrl: "https://files.example/vision.png" }), { status: 201, headers: { "content-type": "application/json" } })
      : new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: done\ndata: {"content":"Готово","modelUsed":"fast","label":"Kairema Flash"}\n\n'));
          controller.close();
        },
      }))));
    render(<Home />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    await user.upload(input!, new File(["neutral"], "vision.png", { type: "image/png" }));
    await user.type(screen.getByPlaceholderText("Напишите сообщение…"), "Проверь вложение");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 }));
    expect(screen.getByRole("button", { name: "Открыть предпросмотр: vision.png" })).toBeTruthy();
  });

  it("copies an assistant reply and does not expose a regenerate request", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<Home />);

    await user.click(screen.getAllByRole("button", { name: "Копировать" })[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Старый ответ Kairema"));
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("Сообщение скопировано"))).toBe(true);

    expect(screen.queryByRole("button", { name: "Ещё вариант" })).toBeNull();
  });

  it("aborts an active stream, refreshes persisted history and retains the draft", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<Home />);

    const composer = await screen.findByPlaceholderText("Напишите сообщение…");
    await user.type(composer, "Отменяемый запрос");
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "Отменить генерацию" });
    await user.click(screen.getByRole("button", { name: "Отменить генерацию" }));

    await waitFor(() => expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Отменить генерацию" })).toBeNull());
    expect((composer as HTMLTextAreaElement).value).toBe("");
    await waitFor(() => expect(fixtures.clearDraft).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
  });

  it("updates a setting's active state immediately while its server save is still pending", async () => {
    const user = userEvent.setup();
    fixtures.updateSettings.mockImplementation(() => new Promise(() => undefined));
    render(<Home />);

    const thinking = screen.getByRole("switch", { name: /Дополнительное рассуждение/ });
    expect(thinking.getAttribute("data-state")).toBe("unchecked");

    await user.click(thinking);

    expect(thinking.getAttribute("data-state")).toBe("checked");
    expect(fixtures.updateSettings).toHaveBeenCalledWith({ thinking: true });
  });

  it("restores the local theme when its setting save fails", async () => {
    const user = userEvent.setup();
    fixtures.updateSettings.mockRejectedValueOnce(new Error("offline"));
    render(<Home />);

    await user.click(screen.getByTitle("Светлая тема"));

    await waitFor(() => expect(fixtures.updateSettings).toHaveBeenCalledWith({ theme: "light" }));
    await waitFor(() => expect(fixtures.toggleTheme).toHaveBeenCalledTimes(2));
  });

  it("keeps independent Switch semantics and stable visual-state snapshots in light and dark wrappers", () => {
    const onChange = vi.fn();
    const { rerender } = render(<div data-theme="light"><SettingSwitch label="Тестовый переключатель" help="Подсказка" checked={false} onChange={onChange} /></div>);
    const lightSwitch = screen.getByRole("switch", { name: "Тестовый переключатель" });
    expect({ theme: lightSwitch.parentElement?.parentElement?.getAttribute("data-theme"), role: lightSwitch.getAttribute("role"), checked: lightSwitch.getAttribute("aria-checked"), state: lightSwitch.getAttribute("data-state") }).toMatchInlineSnapshot(`
      {
        "checked": "false",
        "role": "switch",
        "state": "unchecked",
        "theme": "light",
      }
    `);

    rerender(<div className="dark" data-theme="dark"><SettingSwitch label="Тестовый переключатель" help="Подсказка" checked onChange={onChange} /></div>);
    const darkSwitch = screen.getByRole("switch", { name: "Тестовый переключатель" });
    const thumb = darkSwitch.querySelector('[data-slot="switch-thumb"]');
    expect({ theme: darkSwitch.parentElement?.parentElement?.getAttribute("data-theme"), role: darkSwitch.getAttribute("role"), checked: darkSwitch.getAttribute("aria-checked"), state: darkSwitch.getAttribute("data-state") }).toMatchInlineSnapshot(`
      {
        "checked": "true",
        "role": "switch",
        "state": "checked",
        "theme": "dark",
      }
    `);
    expect(darkSwitch.className).toContain("kairema-switch-root");
    expect(thumb?.className).toContain("kairema-switch-thumb");
    expect(thumb?.getAttribute("data-state")).toBe("checked");
  });

  it("filters template cards by category while preserving visible tokenized text and separate actions", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByText("YouTube-аналитика")).toBeTruthy();
    expect(screen.getByText("[ССЫЛКА ИЛИ ДАННЫЕ]")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Копировать" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Вставить в запрос" }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Аналитика" }));
    expect(screen.getByText("YouTube-аналитика")).toBeTruthy();
    expect(screen.queryByText("Контент-план на неделю")).toBeNull();
  });

  it("shows display-only role metadata in settings without exposing internal routing", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));
    expect(screen.getAllByText(/Kairema Flash/).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/Готов · OpenRouter/)).toBeTruthy();
    expect(screen.queryByText(/Authorization|Bearer|chain|Llama Fast/i)).toBeNull();
  });

  it("uses named accessible AppDropdown controls and a Switch for all five settings", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));
    const styleDropdown = screen.getByRole("combobox", { name: "Стиль" });
    expect(styleDropdown).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Длина" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Усилия" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Роль по умолчанию" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Веб-поиск" })).toBeTruthy();
    expect(styleDropdown.closest("label")?.querySelectorAll("select")).toHaveLength(0);
  });

  it("keeps the closed role dropdown compact and reveals the full role description only after opening", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));
    const roleDropdown = screen.getByRole("combobox", { name: "Роль по умолчанию" });
    expect(roleDropdown.textContent).toContain("Kairema Flash");
    expect(roleDropdown.textContent).not.toContain("Короткие повседневные ответы без ожидания.");

    await user.click(roleDropdown);
    const roleListbox = await screen.findByRole("listbox");
    expect(roleListbox.textContent).toContain("Короткие повседневные ответы без ожидания.");
    expect(roleListbox.textContent).toContain("Требовательные задачи, глубокий анализ и комплексные ответы.");
  });

  it("does not retain persistent export filters or a permanent files panel", () => {
    render(<Home />);

    expect(screen.queryByRole("combobox", { name: "Раздел экспортов" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Формат" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Период" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Сортировка" })).toBeNull();
    expect(screen.queryByText("Файлы")).toBeNull();
  });

  it("keeps the role selector to one interactive trigger without an external chevron icon", async () => {
    const { container } = render(<Home />);

    await waitFor(() => expect(container.querySelectorAll(".kairema-role-menu-trigger")).toHaveLength(1));
    expect(container.querySelectorAll(".kairema-select-wrap svg")).toHaveLength(0);
  });

  it("opens public provider and RAG audit panels without exposing server-only reserves or routing chains", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "Провайдеры" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("OpenRouter");
    expect(screen.getByRole("dialog").textContent).toContain("Google AI Studio");
    expect(screen.getByRole("dialog").textContent).not.toMatch(/SambaNova|Cerebras|Mistral|chain|Bearer/i);

    await user.click(screen.getByRole("button", { name: "Аудит RAG" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("OpenAI News");
    expect(screen.getByRole("dialog").textContent).toContain("Фрагментов");
  });
});

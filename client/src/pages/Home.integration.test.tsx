/* @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  userProviders: { providers: [{ id: "openrouter", displayName: "OpenRouter", available: true }], configs: [], activeProvider: null, storageReady: true } as Record<string, unknown>,
  modelId: "fast",
  myApiModels: [] as Array<{ id: string; name: string; displayName?: string | null; isFree?: boolean }>,
  myApiModelsLoaded: false,
  myApiCatalogError: "" as string | null,
  myApiCatalogPending: false,
  switchModelError: "" as string | null,
  myApiCatalogInputs: [] as unknown[],
  switchedModel: null as unknown,
  switchedProvider: null as unknown,
  switchProviderError: "" as string | null,
  updatedSettings: [] as Array<Record<string, unknown>>,

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
  invalidateUserProviders: () => {},
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  clearHistory: vi.fn(),
  updateSettings: vi.fn(async (input?: Record<string, unknown>) => { if (input) fixtures.updatedSettings.push(input); return {}; }),
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
  updateName: vi.fn(async () => ({ name: "Тест" })),
  startLogin: vi.fn(),
  isAuthenticated: true,
  authLoading: false,
  language: "ru" as "ru" | "en",
  authUser: { id: 42, name: "Тест", email: "", loginMethod: "stytch-password", isGuest: 0 } as { id: number; name: string | null; email: string | null; loginMethod: string | null; isGuest: number },
  logout: vi.fn(async () => undefined),
  sessionsLoading: false,
  sessionsRefetching: false,
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

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: fixtures.isAuthenticated, loading: fixtures.authLoading, user: fixtures.isAuthenticated ? fixtures.authUser : null, logout: fixtures.logout }) }));
vi.mock("@/const", () => ({ startLogin: fixtures.startLogin }));
vi.mock("@/lib/runtime-auth", () => ({ runtimeAuthHeaders: () => ({ Authorization: "Bearer test-session" }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: fixtures.toggleTheme, highContrast: false, setHighContrast: vi.fn() }) }));
vi.mock("@/lib/chat-export", () => ({
  prepareChatMarkdown: fixtures.prepareMarkdown,
  prepareChatPdf: fixtures.preparePdf,
  downloadPreparedChatExport: fixtures.downloadPrepared,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", fixtures.navigate],
  // Mirrors the real module: a client-side link to the provider settings route.
  Link: ({ href, children, ...rest }: { href: string; children?: unknown }) => (
    <a href={href} {...rest}>{children as never}</a>
  ),
}));
vi.mock("@/lib/trpc", async () => {
  const react = await import("react");
  return ({
  trpc: {
    auth: { beginLink: { useMutation: () => ({ mutateAsync: fixtures.beginStytchLink, isPending: false }) }, updateName: { useMutation: () => ({ mutateAsync: fixtures.updateName, isPending: false }) } },
    models: { list: { useQuery: () => ({ data: [
      { key: "fast", modelId: "fast", label: "Kairema Flash", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, runtime: { state: "ready", provider: "OpenRouter", modelUsed: "Fast", checkedAt: "2026-08-19T00:00:00.000Z" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "smart", modelId: "smart", label: "Kairema Think", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "context", modelId: "context", label: "Kairema Context", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "flagship", modelId: "flagship", label: "Kairema Apex", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
    ] }) } },
    settings: { get: { useQuery: () => ({ data: { language: fixtures.language, theme: "dark", responseStyle: "default", responseLength: "balanced", quickReplies: 1, effort: "standard", thinking: 0, defaultRole: "fast", webSearch: 0, healthRefreshSeconds: 30, highContrast: 0, askClarifyingQuestions: 0 } }) }, update: { useMutation: () => ({ mutateAsync: fixtures.updateSettings }) } },
    memory: { get: { useQuery: () => ({ data: fixtures.memoryData }) }, update: { useMutation: () => ({ mutateAsync: fixtures.updateMemory }) }, addFact: { useMutation: () => ({ mutateAsync: fixtures.addMemoryFact }) }, deleteEntry: { useMutation: () => ({ mutateAsync: fixtures.deleteMemoryEntry }) }, clear: { useMutation: () => ({ mutateAsync: fixtures.clearMemory }) } },
    webSearch: { status: { useQuery: () => ({ data: { available: false, reason: "Поиск сейчас недоступен", checkedAt: "2026-08-19T00:00:00.000Z", layers: [{ id: "google", state: "limited", retryAt: null }, { id: "tavily", state: "ready", retryAt: null }, { id: "openrouter", state: "ready", retryAt: null }] } }) } },
    knowledge: { status: { useQuery: () => ({ data: { documents: 0, sources: [], lastRun: null } }) }, audit: { useQuery: () => ({ data: { sources: [{ name: "OpenAI News", domain: "openai.com", ...(fixtures.isOwner ? { url: "https://openai.com/news/rss.xml" } : {}), indexedCount: 12, lastSuccessAt: "2026-08-19T00:00:00.000Z" }], latestRun: { state: "completed", startedAt: "2026-08-19T00:00:00.000Z", finishedAt: "2026-08-19T00:01:00.000Z" } } }) }, refresh: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
    providers: { dashboard: { useQuery: () => ({ data: [{ id: "openrouter", label: "OpenRouter", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "google", label: "Google AI Studio", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "groq", label: "Groq", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }] }) } },
    owner: { isOwner: { useQuery: () => ({ data: fixtures.isOwner }) }, flashTtft: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: { p50Ms: 220, p95Ms: 440, samples: 2 }, last7d: { p50Ms: 250, p95Ms: 480, samples: 5 } } : null }) }, flashTtftTrend: { useQuery: () => ({ data: fixtures.isOwner ? [{ date: "2026-08-20", p50Ms: 220, p95Ms: 440, samples: 2 }] : [] }) }, searchOutages: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: 1, last7d: 2, recent: [{ layer: "google", errorClass: "http_429", latencyMs: 120, createdAt: "2026-08-20T00:00:00.000Z" }] } : null }) } },
    search: { query: { useQuery: () => ({ data: [] }) }, qualityPanel: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: { sampleCount: 4, counts: { found: 2, empty: 1, degraded: 1, error: 0 }, verifiedSourceCount: 2, zeroSourceCount: 2, staleBlockedCount: 1, foundRate: 0.5, verificationPassRate: 0.5 }, last7d: { sampleCount: 10, counts: { found: 6, empty: 2, degraded: 1, error: 1 }, verifiedSourceCount: 6, zeroSourceCount: 4, staleBlockedCount: 2, foundRate: 0.6, verificationPassRate: 0.6 } } : null }) }, qualityChart: { useQuery: () => ({ data: fixtures.isOwner ? { daily: [{ day: "08-15", found: 1, empty: 0, degraded: 0, error: 0 }, { day: "08-21", found: 3, empty: 1, degraded: 0, error: 0 }], hourlyLayers: [{ hour: "09", layer1: 2, layer2: 1, layer3: 0 }, { hour: "10", layer1: 1, layer2: 0, layer3: 1 }] } : null }) } },
    attachments: { list: { useQuery: () => ({ data: fixtures.attachments }) }, upload: { useMutation: () => ({ mutateAsync: fixtures.uploadAttachment }) }, delete: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    exports: { list: { useQuery: () => ({ data: fixtures.exports, isLoading: false }) }, create: { useMutation: () => ({ mutateAsync: fixtures.createExport, isPending: false }) }, delete: { useMutation: () => ({ mutateAsync: fixtures.deleteExport, isPending: false, variables: undefined }) } },
    chats: {
      list: { useQuery: () => ({ data: fixtures.sessionsLoading ? undefined : fixtures.sessions, isLoading: fixtures.sessionsLoading, isFetching: fixtures.sessionsLoading || fixtures.sessionsRefetching }) },
      messages: { useQuery: () => ({ data: fixtures.messages }) },
      historyPage: { useQuery: () => ({ data: { messages: fixtures.messages, nextCursor: fixtures.historyNextCursor }, isLoading: false }) },
      draft: { useQuery: (input: { sessionId: string }) => { fixtures.draftQueryInput = input; return { data: fixtures.draft, isLoading: false }; } },
      create: { useMutation: () => ({ mutateAsync: fixtures.createChat, isPending: false }) },
      delete: { useMutation: () => ({ mutateAsync: fixtures.deleteChat, isPending: false }) },
      clearAll: { useMutation: () => ({ mutateAsync: fixtures.clearHistory, isPending: false }) },
      saveDraft: { useMutation: () => ({ mutateAsync: fixtures.saveDraft, isPending: false }) },
      clearDraft: { useMutation: () => ({ mutateAsync: fixtures.clearDraft, isPending: false }) },
    },
    userProviders: {
      // The list is a live read, and an invalidate re-renders it: that is what a provider switch
      // looks like in production, so no test can pass on a snapshot taken before the switch.
      list: { useQuery: () => {
        const [, bump] = react.useState(0);
        react.useEffect(() => { fixtures.invalidateUserProviders = () => bump((value) => value + 1); return () => { fixtures.invalidateUserProviders = () => {}; }; }, []);
        return { data: fixtures.userProviders };
      } },
      // The My API picker reuses the caller's stored key: no key is sent with the request.
      models: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            fixtures.myApiCatalogInputs.push(input);
            // A failing catalog must be observable by the screen, not swallowed.
            if (fixtures.myApiCatalogError) throw new Error(fixtures.myApiCatalogError);
            return { models: fixtures.myApiModels };
          },
          // The mock is fixture-driven: a test decides whether an attempt failed, and a retry is
          // observed by the request it issues rather than by internal cache state.
          reset: () => {},
          data: fixtures.myApiModelsLoaded ? { models: fixtures.myApiModels } : undefined,
          isPending: fixtures.myApiCatalogPending,
          isError: Boolean(fixtures.myApiCatalogError),
          error: fixtures.myApiCatalogError ? { message: fixtures.myApiCatalogError } : null,
          isSuccess: fixtures.myApiModelsLoaded && !fixtures.myApiCatalogError,
        }),
      },
      setActiveModel: { useMutation: () => ({ mutateAsync: async (input: unknown) => { if (fixtures.switchModelError) throw new Error(fixtures.switchModelError); fixtures.switchedModel = input; // The server persists the choice, so the next read of the list must show it.
        const { provider, activeModel } = input as { provider: string; activeModel: string };
        fixtures.userProviders = { ...fixtures.userProviders, configs: (fixtures.userProviders.configs as Array<Record<string, unknown>>).map((config) => config.provider === provider ? { ...config, activeModel } : config) }; return {}; }, isPending: false, error: null }) },
      // A provider switch changes only the credential; the model each provider was saved with is
      // the server's business, which is why the mock reads the fixture list live after the write.
      setActive: { useMutation: () => ({ mutateAsync: async (input: unknown) => { if (fixtures.switchProviderError) throw new Error(fixtures.switchProviderError); fixtures.switchedProvider = input; fixtures.userProviders = { ...fixtures.userProviders, activeProvider: (input as { provider: string }).provider }; return {}; }, isPending: false, error: null }) },
    },
    useUtils: () => ({ models: { list: { invalidate: vi.fn() } }, auth: { me: { invalidate: vi.fn() } }, settings: { get: { invalidate: vi.fn() } }, memory: { get: { invalidate: vi.fn() } }, knowledge: { status: { invalidate: vi.fn() } }, attachments: { list: { invalidate: vi.fn() } }, exports: { list: { invalidate: fixtures.invalidateExports }, download: { fetch: fixtures.downloadExport } }, chats: { messages: { invalidate: fixtures.invalidateMessages }, historyPage: { invalidate: fixtures.invalidateMessages, fetch: fixtures.historyPageFetch }, list: { invalidate: fixtures.invalidateSessions } }, userProviders: { list: { invalidate: () => fixtures.invalidateUserProviders() } } }),
  },
  });
});
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

/** The chat header's model pill, which carries the role selector or the My API binding. */
function headerPill(container: HTMLElement) {
  return container.querySelector(".kairema-model-pill") as HTMLElement;
}

function resetFixtures() {
  fixtures.userProviders = { providers: [{ id: "openrouter", displayName: "OpenRouter", available: true }], configs: [], activeProvider: null, storageReady: true };
  fixtures.myApiModels = [];
  fixtures.myApiModelsLoaded = false;
  fixtures.myApiCatalogInputs = [];
  fixtures.myApiCatalogError = null;
  fixtures.myApiCatalogPending = false;
  fixtures.switchModelError = null;
  fixtures.switchedModel = null;
  fixtures.switchedProvider = null;
  fixtures.switchProviderError = null;
  fixtures.updatedSettings = [];
  fixtures.isAuthenticated = true;
  fixtures.authLoading = false;
  fixtures.language = "ru";
  fixtures.authUser = { id: 42, name: "Тест", email: "", loginMethod: "stytch-password", isGuest: 0 };
  fixtures.logout.mockClear();
  fixtures.sessionsLoading = false;
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
  fixtures.updateSettings.mockReset().mockImplementation(async (input?: Record<string, unknown>) => { if (input) fixtures.updatedSettings.push(input); return {}; });
  fixtures.draft = null;
  fixtures.draftQueryInput = null;
  fixtures.saveDraft.mockReset().mockResolvedValue({ content: "", updatedAt: new Date() });
  fixtures.clearDraft.mockReset().mockResolvedValue({ cleared: true });
  const persistStreamedAnswer = async () => {
    fixtures.messages = [
      ...fixtures.messages,
      { id: 3, role: "user", content: "Новый вопрос", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:02:00.000Z") },
      { id: 4, role: "assistant", content: "Первый фрагмент ответа", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:03:00.000Z") },
    ];
    return { messages: fixtures.messages, nextCursor: null };
  };
  fixtures.invalidateMessages.mockReset().mockImplementation(persistStreamedAnswer);
  fixtures.historyPageFetch.mockReset().mockImplementation(persistStreamedAnswer);
  fixtures.releaseSecondDelta = null;
  fixtures.memoryData = { settings: { enabled: 1, autoExtract: 1 }, profile: { profile: "", summary: "Автоматически извлечённый нейтральный факт" }, facts: [{ id: "11111111-1111-4111-8111-111111111112", value: "Предпочитает русский язык" }], topics: [{ id: "11111111-1111-4111-8111-111111111113", value: "2026-08-21 Flash: настройка профиля", role: "fast" }] };
}

describe("Home integration flows", () => {
  beforeEach(() => { window.localStorage.clear(); resetFixtures(); });
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

  it("opens the desktop sidebar by default and no longer needs a topbar toggle", async () => {
    render(<Home />);

    const sidebar = document.querySelector(".kairema-sidebar");
    // On desktop the sidebar is a static column: open, focusable, reachable without any control.
    expect(sidebar?.classList.contains("kairema-sidebar-collapsed")).toBe(false);
    expect(sidebar?.classList.contains("kairema-sidebar-open")).toBe(true);
    expect(sidebar?.hasAttribute("inert")).toBe(false);
    expect(screen.queryByRole("button", { name: "Показать боковую панель" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Скрыть боковую панель" })).toBeNull();
    // Its own controls stay reachable: new chat, memory, exports, settings and the role list.
    expect(sidebar?.querySelector(".kairema-new-chat")).not.toBeNull();
    expect(sidebar?.querySelector(".kairema-providers")).not.toBeNull();
    expect(sidebar?.querySelector(".kairema-sidebar-footer")).not.toBeNull();
    // The small-screen drawer opener is untouched.
    expect(document.querySelector(".kairema-topbar-left .kairema-icon-btn")).not.toBeNull();
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
    expect(screen.getByText(/не объединяет аккаунты автоматически/)).toBeTruthy();
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

    await waitFor(() => expect(fixtures.historyPageFetch).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 }));
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
    expect(fixtures.clearDraft).not.toHaveBeenCalled();
  });

  it("keeps a sent-image preview while persisted message hydration leads the attachment query", async () => {
    const user = userEvent.setup();
    fixtures.historyPageFetch.mockImplementation(async () => {
      fixtures.messages = [...fixtures.messages,
        { id: 3, role: "user", content: "Проверь вложение", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:02:00.000Z"), metadata: JSON.stringify({ attachmentIds: ["55555555-5555-4555-8555-555555555555"] }) },
        { id: 4, role: "assistant", content: "Готово", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:03:00.000Z") },
      ];
      fixtures.attachments = [];
      return { messages: fixtures.messages, nextCursor: null };
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

    await waitFor(() => expect(fixtures.historyPageFetch).toHaveBeenCalledWith({ sessionId: fixtures.sessionId, limit: 60 }));
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

  it("aborts an active stream, refreshes persisted history and keeps the stored server draft", async () => {
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
    expect(fixtures.clearDraft).not.toHaveBeenCalled();
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

  it("keeps only the reasoning and web-search switches and persists each one to the account", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));

    expect(screen.getByRole("switch", { name: /Дополнительное рассуждение/ })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Веб-поиск" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /Разрешить инструменты/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: /Высокая контрастность/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: /Email-уведомления/ })).toBeNull();
    expect(screen.queryByText("Обновление здоровья")).toBeNull();
    expect(screen.queryByText("30 s")).toBeNull();
    expect(screen.queryByText("Обновляет только публичный индикатор доступности.")).toBeNull();
    expect(screen.queryByText("Самодиагностика")).toBeNull();
    expect(screen.queryByText("Проверить настройки")).toBeNull();
    expect(screen.queryByText("Показывает только сохранённые пользовательские параметры, без сообщений, ключей и служебных маршрутов.")).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Веб-поиск" }));

    expect(fixtures.updateSettings).toHaveBeenCalledWith({ webSearch: true });
  });

  it("opens Profile from the topbar, prefills the stored name and persists both Profile fields", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть профиль" }));

    const nameField = screen.getByRole("textbox", { name: /Как к вам обращаться/ });
    expect((nameField as HTMLInputElement).value).toBe("Тест");
    expect(screen.getByText("Ваши предпочтения применяются ко всем разговорам.")).toBeTruthy();

    const clarify = screen.getByRole("switch", { name: "Задавать уточняющие вопросы перед развёрнутым ответом" });
    expect((clarify as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
    await user.click(clarify);
    expect(fixtures.updateSettings).toHaveBeenCalledWith({ askClarifyingQuestions: true });

    await user.click(screen.getByRole("button", { name: "Обновить профиль" }));
    expect(fixtures.updateName).not.toHaveBeenCalled();
    await user.clear(nameField);
    await user.type(nameField, "Ada");
    await user.click(screen.getByRole("button", { name: "Обновить профиль" }));
    expect(fixtures.updateName).toHaveBeenCalledWith({ name: "Ada" });
  });

  it("keeps both control rows in one sticky header inside the single message scrollport", () => {
    const { container } = render(<Home />);
    const root = container;

    const modeSwitch = screen.getByRole("group", { name: "Режим чата" });
    const sticky = modeSwitch.closest(".kairema-chat-sticky");
    const viewport = sticky?.closest(".kairema-chat-scroll");
    expect(sticky).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Both rows live in the same sticky wrapper...
    expect(sticky!.querySelector(".kairema-mode-bar")).not.toBeNull();
    expect(sticky!.querySelector(".kairema-chat-tools")).not.toBeNull();
    // ...inside the one scroller that scrolls the messages, with no second scroller.
    expect(viewport!.querySelector(".kairema-chat-sticky")).not.toBeNull();
    expect(viewport!.querySelectorAll(".kairema-chat-scroll")).toHaveLength(0);
    expect(root.querySelectorAll(".kairema-chat-tools-scroll")).toHaveLength(0);
  });

  it("still opens the existing model menu from the topbar", async () => {
    const user = userEvent.setup();
    const { container } = render(<Home />);

    await waitFor(() => expect(container.querySelector(".kairema-role-menu-trigger")).not.toBeNull());
    await user.click(container.querySelector(".kairema-role-menu-trigger") as HTMLElement);

    await waitFor(() => expect(document.querySelector(".kairema-role-menu")).not.toBeNull());
    expect(document.querySelectorAll(".kairema-role-menu-item").length).toBe(4);
  });

  it("hides Profile entirely for a guest account", () => {
    fixtures.authUser = { id: 43, name: null, email: "", loginMethod: "guest", isGuest: 1 };
    render(<Home />);

    expect(screen.queryByRole("button", { name: "Открыть профиль" })).toBeNull();
    // Settings stays available for guests.
    expect(screen.getByRole("button", { name: "Открыть настройки" })).toBeTruthy();
  });

  it("opens the stored chat after a reload instead of always the newest one", async () => {
    const olderSessionId = "33333333-3333-4333-8333-333333333333";
    fixtures.sessions = [
      { id: fixtures.sessionId, modelId: fixtures.modelId, title: "Самый новый чат" },
      { id: olderSessionId, modelId: fixtures.modelId, title: "Чат из истории" },
    ];
    window.localStorage.setItem("active-chat-id", olderSessionId);
    render(<Home />);

    await waitFor(() => expect(document.querySelector(".kairema-topbar-title")?.textContent).toBe("Чат из истории"));
    expect(fixtures.draftQueryInput).toEqual({ sessionId: olderSessionId });
    expect(window.localStorage.getItem("active-chat-id")).toBe(olderSessionId);
  });

  it("keeps the stored chat id in sync when the user switches to another chat", async () => {
    const user = userEvent.setup();
    const olderSessionId = "33333333-3333-4333-8333-333333333333";
    fixtures.sessions = [
      { id: fixtures.sessionId, modelId: fixtures.modelId, title: "Самый новый чат" },
      { id: olderSessionId, modelId: fixtures.modelId, title: "Чат из истории" },
    ];
    render(<Home />);

    await waitFor(() => expect(window.localStorage.getItem("active-chat-id")).toBe(fixtures.sessionId));
    await user.click(screen.getByRole("button", { name: "Чат из истории" }));

    await waitFor(() => expect(window.localStorage.getItem("active-chat-id")).toBe(olderSessionId));
    expect(document.querySelector(".kairema-topbar-title")?.textContent).toBe("Чат из истории");
  });

  it("drops a stored chat id whose chat was deleted and stays in the empty new-conversation state", async () => {
    window.localStorage.setItem("active-chat-id", "99999999-9999-4999-8999-999999999999");
    render(<Home />);

    await waitFor(() => expect(window.localStorage.getItem("active-chat-id")).toBeNull());
    expect(document.querySelector(".kairema-topbar-title")?.textContent).toBe("Новый разговор");
    expect(document.querySelector(".kairema-history-active")).toBeNull();
    expect(fixtures.historyPageFetch).not.toHaveBeenCalled();
  });

  it("waits for the chat list to load before hydrating the stored chat id", async () => {
    const olderSessionId = "33333333-3333-4333-8333-333333333333";
    fixtures.sessions = [
      { id: fixtures.sessionId, modelId: fixtures.modelId, title: "Самый новый чат" },
      { id: olderSessionId, modelId: fixtures.modelId, title: "Чат из истории" },
    ];
    fixtures.sessionsLoading = true;
    window.localStorage.setItem("active-chat-id", olderSessionId);
    const { rerender } = render(<Home />);

    await waitFor(() => expect(screen.getByPlaceholderText("Напишите сообщение…")).toBeTruthy());
    expect(document.querySelector(".kairema-topbar-title")?.textContent).not.toBe("Чат из истории");
    expect(fixtures.draftQueryInput).not.toEqual({ sessionId: olderSessionId });
    expect(window.localStorage.getItem("active-chat-id")).toBe(olderSessionId);

  fixtures.sessionsLoading = false;
  fixtures.sessionsRefetching = false;
    rerender(<Home />);

    await waitFor(() => expect(document.querySelector(".kairema-topbar-title")?.textContent).toBe("Чат из истории"));
    expect(fixtures.draftQueryInput).toEqual({ sessionId: olderSessionId });
    expect(window.localStorage.getItem("active-chat-id")).toBe(olderSessionId);
  });

  it("keeps the stored chat id while the chat list is still being refetched", async () => {
    const olderSessionId = "33333333-3333-4333-8333-333333333333";
    const realSessions = [
      { id: fixtures.sessionId, modelId: fixtures.modelId, title: "Самый новый чат" },
      { id: olderSessionId, modelId: fixtures.modelId, title: "Чат из истории" },
    ];
    // The list is not settled yet: the cached value is momentarily empty.
    fixtures.sessions = [];
    fixtures.sessionsRefetching = true;
    window.localStorage.setItem("active-chat-id", olderSessionId);
    const { rerender } = render(<Home />);

    await waitFor(() => expect(screen.getByPlaceholderText("Напишите сообщение…")).toBeTruthy());
    expect(window.localStorage.getItem("active-chat-id")).toBe(olderSessionId);
    expect(fixtures.draftQueryInput).not.toEqual({ sessionId: olderSessionId });

    fixtures.sessions = realSessions;
    fixtures.sessionsRefetching = false;
    rerender(<Home />);

    await waitFor(() => expect(document.querySelector(".kairema-topbar-title")?.textContent).toBe("Чат из истории"));
    expect(fixtures.draftQueryInput).toEqual({ sessionId: olderSessionId });
    expect(window.localStorage.getItem("active-chat-id")).toBe(olderSessionId);
  });

  it("drops the previous identity's chat on logout and hydrates the next sign-in instead", async () => {
    const firstUserChatId = "11111111-1111-4111-8111-111111111111";
    const secondUserChatId = "22222222-2222-4222-8222-222222222222";
    fixtures.sessions = [{ id: firstUserChatId, modelId: fixtures.modelId, title: "Чат первого пользователя" }];
    const { rerender } = render(<Home />);

    await waitFor(() => expect(window.localStorage.getItem("active-chat-id")).toBe(firstUserChatId));
    expect(fixtures.draftQueryInput).toEqual({ sessionId: firstUserChatId });

    fixtures.isAuthenticated = false;
    rerender(<Home />);

    await waitFor(() => expect(fixtures.draftQueryInput).toEqual({ sessionId: "" }));
    expect(fixtures.historyPageFetch).not.toHaveBeenCalledWith({ sessionId: firstUserChatId, limit: 60 });
    expect(document.querySelector(".kairema-topbar-title")?.textContent).not.toBe("Чат первого пользователя");

    fixtures.isAuthenticated = true;
    fixtures.sessions = [{ id: secondUserChatId, modelId: fixtures.modelId, title: "Чат второго пользователя" }];
    rerender(<Home />);

    // The stored id belonged to the previous identity, so it is dropped instead of
    // silently opening a chat that is not this user's.
    await waitFor(() => expect(document.querySelector(".kairema-topbar-title")?.textContent).toBe("Новый разговор"));
    expect(document.querySelector(".kairema-topbar-title")?.textContent).not.toBe("Чат первого пользователя");
    expect(fixtures.draftQueryInput).not.toEqual({ sessionId: firstUserChatId });
    expect(fixtures.draftQueryInput).toEqual({ sessionId: "" });
    await waitFor(() => expect(window.localStorage.getItem("active-chat-id")).toBeNull());
  });

  it("shows the signed-in email account and a logout control instead of the linking form", async () => {
    const user = userEvent.setup();
    fixtures.authUser = { id: 42, name: "Тест", email: "owner@example.com", loginMethod: "stytch-password", isGuest: 0 };
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));

    expect(screen.getByLabelText("Email аккаунта")).toBeTruthy();
    expect((screen.getByLabelText("Email аккаунта") as HTMLInputElement).value).toBe("owner@example.com");
    expect(screen.getByRole("button", { name: "Выйти" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("name@example.com")).toBeNull();
    expect(screen.queryByText("Привязать email-вход")).toBeNull();
    expect(screen.queryByRole("button", { name: "Отправить подтверждение" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Выйти" }));

    expect(fixtures.logout).toHaveBeenCalledTimes(1);
  });

  it("keeps the email linking form for an account without a verified address", async () => {
    const user = userEvent.setup();
    fixtures.authUser = { id: 42, name: "Тест", email: null, loginMethod: "stytch-password", isGuest: 0 };
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));

    expect(screen.getByText("Привязать email-вход")).toBeTruthy();
    const field = screen.getByLabelText("Email для подтверждения") as HTMLInputElement;
    expect(field.value).toBe("");
    await user.type(field, "second@example.com");
    expect(field.value).toBe("second@example.com");
    expect(screen.getByRole("button", { name: "Отправить подтверждение" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Выйти" })).toBeNull();
    expect(screen.getByText(/Это не объединяет аккаунты автоматически/)).toBeTruthy();
  });

  it("clears the authenticated session on logout without deleting the chat data", async () => {
    const user = userEvent.setup();
    const sessionId = "44444444-4444-4444-8444-444444444444";
    fixtures.authUser = { id: 42, name: "Тест", email: "owner@example.com", loginMethod: "stytch-password", isGuest: 0 };
    fixtures.sessions = [{ id: sessionId, modelId: fixtures.modelId, title: "Чат до выхода" }];
    fixtures.logout.mockImplementationOnce(async () => {
      fixtures.isAuthenticated = false;
      fixtures.authUser = { id: 42, name: "Тест", email: null, loginMethod: "stytch-password", isGuest: 0 };
    });
    render(<Home />);

    await waitFor(() => expect(window.localStorage.getItem("active-chat-id")).toBe(sessionId));
    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));
    await user.click(screen.getByRole("button", { name: "Выйти" }));

    expect(fixtures.logout).toHaveBeenCalledTimes(1);
    // The server call owns the session teardown; the client must not delete user data itself.
    expect(fixtures.deleteChat).not.toHaveBeenCalled();
    expect(fixtures.clearHistory).not.toHaveBeenCalled();
    expect(fixtures.clearDraft).not.toHaveBeenCalled();
    expect(fixtures.createChat).not.toHaveBeenCalled();
  });

  it("restores the email account after signing in again", async () => {
    const user = userEvent.setup();
    fixtures.authUser = { id: 42, name: null, email: null, loginMethod: "stytch-password", isGuest: 0 };
    const { rerender } = render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));
    expect(screen.getByText("Привязать email-вход")).toBeTruthy();
    await user.keyboard("{Escape}");

    fixtures.authUser = { id: 42, name: "Тест", email: "owner@example.com", loginMethod: "stytch-password", isGuest: 0 };
    rerender(<Home />);
    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));

    expect((screen.getByLabelText("Email аккаунта") as HTMLInputElement).value).toBe("owner@example.com");
    expect(screen.queryByText("Привязать email-вход")).toBeNull();
  });

  it("closes the attachment menu when the user opens settings from the sidebar", async () => {
    const user = userEvent.setup();
    const { container } = render(<Home />);
    const menu = container.querySelector("details.kairema-attachment-menu") as HTMLDetailsElement | null;
    const trigger = menu?.querySelector("summary") as HTMLElement | null;
    if (!menu || !trigger) throw new Error("Attachment menu is missing");

    await user.click(trigger);
    expect(menu.open).toBe(true);
    expect(screen.getByRole("button", { name: "Выбрать фото" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Настройки" }));

    await waitFor(() => expect(menu.open).toBe(false));
    expect(screen.getByText("Изменения сохраняются автоматически")).toBeTruthy();
  });

  it("closes the attachment menu when the user opens chat history and picks another chat", async () => {
    const user = userEvent.setup();
    const olderSessionId = "33333333-3333-4333-8333-333333333333";
    fixtures.sessions = [
      { id: fixtures.sessionId, modelId: fixtures.modelId, title: "Самый новый чат" },
      { id: olderSessionId, modelId: fixtures.modelId, title: "Чат из истории" },
    ];
    const { container } = render(<Home />);
    const menu = container.querySelector("details.kairema-attachment-menu") as HTMLDetailsElement | null;
    const trigger = menu?.querySelector("summary") as HTMLElement | null;
    if (!menu || !trigger) throw new Error("Attachment menu is missing");

    await user.click(trigger);
    expect(menu.open).toBe(true);

    await user.click(screen.getByRole("button", { name: "Чат из истории" }));

    await waitFor(() => expect(menu.open).toBe(false));
    expect(document.querySelector(".kairema-topbar-title")?.textContent).toBe("Чат из истории");
  });

  it("closes the attachment menu when the sidebar itself is opened again", async () => {
    const user = userEvent.setup();
    const { container } = render(<Home />);
    const menu = container.querySelector("details.kairema-attachment-menu") as HTMLDetailsElement | null;
    const trigger = menu?.querySelector("summary") as HTMLElement | null;
    if (!menu || !trigger) throw new Error("Attachment menu is missing");

    await user.click(trigger);
    expect(menu.open).toBe(true);

    // Picking a role in the sidebar closes the sidebar, which drives the same navigation
    // signal the removed desktop toggle used to send.
    await user.click(container.querySelector(".kairema-providers .kairema-provider") as HTMLElement);

    await waitFor(() => expect(menu.open).toBe(false));
  });

  it("closes the attachment menu when settings are opened with the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<Home />);
    const menu = container.querySelector("details.kairema-attachment-menu") as HTMLDetailsElement | null;
    const trigger = menu?.querySelector("summary") as HTMLElement | null;
    if (!menu || !trigger) throw new Error("Attachment menu is missing");

    await user.click(trigger);
    expect(menu.open).toBe(true);

    screen.getByRole("button", { name: "Настройки" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(menu.open).toBe(false));
    expect(screen.getByText("Изменения сохраняются автоматически")).toBeTruthy();
  });

  it("clears the composer as soon as the send is accepted, before the model answers", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<Home />);

    const composer = await screen.findByPlaceholderText("Напишите сообщение…");
    await user.type(composer, "Привет");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect((composer as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("Привет")).toBeTruthy();
    await user.type(composer, "Следующий вопрос");
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe("Следующий вопрос"));

    await user.click(screen.getByRole("button", { name: "Отменить генерацию" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Отменить генерацию" })).toBeNull());
    expect((composer as HTMLTextAreaElement).value).toBe("Следующий вопрос");
  });

  it("keeps the typed text when sign-in is required before the send starts", async () => {
    const user = userEvent.setup();
    fixtures.isAuthenticated = false;
    fixtures.sessions = [];
    render(<Home />);

    const composer = (await screen.findByPlaceholderText("Напишите сообщение…")) as HTMLTextAreaElement;
    await user.type(composer, "Привет");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fixtures.startLogin).toHaveBeenCalled());
    await waitFor(() => expect(composer.value).toBe("Привет"));
  });

  it("keeps the typed text when the new chat cannot be created", async () => {
    const user = userEvent.setup();
    fixtures.sessions = [];
    fixtures.messages = [];
    fixtures.createChat.mockRejectedValueOnce(new Error("storage unavailable"));
    render(<Home />);

    const composer = (await screen.findByPlaceholderText("Напишите сообщение…")) as HTMLTextAreaElement;
    await user.type(composer, "Привет");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fixtures.createChat).toHaveBeenCalled());
    await waitFor(() => expect(composer.value).toBe("Привет"));
  });

  it("restores the local theme when its setting save fails", async () => {
    const user = userEvent.setup();
    fixtures.updateSettings.mockRejectedValueOnce(new Error("offline"));
    render(<Home />);

    // The theme control now lives in Settings rather than in the chat topbar.
    await user.click(screen.getByTitle("Открыть настройки"));
    await user.click(await screen.findByTitle("Светлая тема"));

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

describe("My API mode hides the Kairema role selector", () => {
  beforeEach(() => { window.localStorage.clear(); resetFixtures(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const customConfig = { provider: "custom-abc", displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1", modelsEndpoint: null, activeModel: "vendor/model-b", keyHint: "••••4321", updatedAt: new Date(0).toISOString() };

  // The sidebar keeps its own list of Kairema roles, so the assertions below are scoped to the
  // header pill that used to be the system model selector.

  async function enterMyApi() {
    const user = userEvent.setup();
    const view = render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    return { user, view };
  }

  it("BUG-1: replaces the Kairema role dropdown with the saved user binding", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);

    // The header offers only this provider's own models: no system role is selectable, and none
    // of the four Kairema roles appears anywhere in it.
    const pill = headerPill(container);
    for (const role of ["Kairema Flash", "Kairema Think", "Kairema Context", "Kairema Apex"]) {
      expect(pill.textContent ?? "").not.toContain(role);
      expect(Array.from(pill.querySelectorAll("option")).map((option) => option.textContent ?? "")).not.toContain(role);
    }
    // Provider and model are two controls: the pill names the model alone, and the provider is
    // chosen in the mode row, so neither has to be read out of the other.
    expect(pill.textContent ?? "").not.toContain("Мой провайдер");
    expect(screen.getByLabelText("Провайдер «Мой API»").textContent ?? "").toContain("Мой провайдер");
    // The model comes from the active provider's own catalog, not from a system role: the role
    // <select> is gone and the binding's own picker shows the saved model instead.
    expect(pill.querySelector("select")).toBeNull();
    const picker = pill.querySelector(".kairema-binding-select") as HTMLButtonElement;
    expect(picker).not.toBeNull();
    expect(picker.textContent).toBe("vendor/model-b");
    expect(picker.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("BUG-1: the four Kairema roles still work in ordinary Chat mode", async () => {
    const { container } = render(<Home />);
    const select = (await screen.findByLabelText("Роли")) as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options).toEqual(["Kairema Flash", "Kairema Think", "Kairema Context", "Kairema Apex"]);
    expect(container.querySelector(".kairema-model-pill select")).not.toBeNull();
  });

  it("BUG-2: never names a Kairema role in the My API empty state", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    // The empty state is only reachable with an empty transcript.
    fixtures.messages = [];
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await waitFor(() => expect(container.textContent).toContain("Начните разговор с Мой провайдер · vendor/model-b"));
    expect(container.textContent ?? "").not.toContain("Начните разговор с Kairema");
  });

  it("BUG-2: shows a real link to /settings/providers when nothing is configured", async () => {
    fixtures.userProviders = { providers: [], configs: [], activeProvider: null, storageReady: true };
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);

    // The header pill and the mode hint both state that nothing is configured yet.
    await waitFor(() => expect(screen.getAllByText("Мой API не настроен").length).toBeGreaterThan(0));
    expect(headerPill(container).textContent).toBe("Мой API не настроен");
    const links = screen.getAllByRole("link", { name: "Настроить провайдера →" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("href")).toBe("/settings/providers");
    expect(container.textContent).not.toContain("Начните разговор с Kairema");
  });
});

describe("My API provider and model are two independent controls", () => {
  beforeEach(() => { window.localStorage.clear(); resetFixtures(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const configA = { provider: "custom-abc", displayName: "Aria Cloud", baseUrl: "https://api.example.com/v1", modelsEndpoint: null, activeModel: "aria/fast-1", keyHint: "••••4321", updatedAt: new Date(0).toISOString() };
  const configB = { provider: "custom-xyz", displayName: "Мой провайдер", baseUrl: "https://api.groq.com/openai/v1", modelsEndpoint: null, activeModel: "vendor/model-b", keyHint: "••••1111", updatedAt: new Date(0).toISOString() };
  const twoProviders = { providers: [], configs: [configA, configB], activeProvider: "custom-abc", storageReady: true };

  async function enterMyApi(user: ReturnType<typeof userEvent.setup>) {
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    return screen.findByLabelText("Модель «Мой API»");
  }

  it("names the model in the header pill and the provider in the mode row, never both in one", async () => {
    fixtures.userProviders = twoProviders;
    fixtures.myApiModels = [{ id: "aria/fast-1", name: "Groq 4 Fast", displayName: "Groq 4 Fast", isFree: false }];
    fixtures.myApiModelsLoaded = true;
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await screen.findByLabelText("Модель «Мой API»");

    // The pill carries the model and nothing else.
    expect(headerPill(container).textContent ?? "").toContain("Groq 4 Fast");
    expect(headerPill(container).textContent ?? "").not.toContain("Aria Cloud");
    // The provider has its own control below the mode switch, with no model in it.
    const providerMenu = screen.getByLabelText("Провайдер «Мой API»");
    expect(providerMenu.textContent ?? "").toContain("Aria Cloud");
    expect(providerMenu.textContent ?? "").not.toContain("model");
  });

  it("lists only providers the user really has, and no model name in any of them", async () => {
    fixtures.userProviders = twoProviders;
    fixtures.myApiModels = [{ id: "aria/fast-1", name: "Groq 4 Fast", displayName: "Groq 4 Fast", isFree: false }];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    await enterMyApi(user);
    await user.click(screen.getByLabelText("Провайдер «Мой API»"));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent ?? "").map((text) => text.replace(/подключён/g, "").trim())).toEqual(["Aria Cloud", "Мой провайдер"]);
    // A provider the user never configured is not offered, and no entry leaks a model id.
    for (const option of options) expect(option.textContent ?? "").not.toContain("/");
  });

  it("switches the provider on the server and shows the model that provider was saved with", async () => {
    fixtures.userProviders = twoProviders;
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B", displayName: "Model B", isFree: false }];
    fixtures.myApiModelsLoaded = true;
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await screen.findByLabelText("Модель «Мой API»");
    await user.click(screen.getByLabelText("Провайдер «Мой API»"));
    await user.click(await screen.findByRole("option", { name: /Мой провайдер/ }));

    expect(fixtures.switchedProvider).toEqual({ provider: "custom-xyz" });
    // The new provider is bound; its own saved model is what the pill now shows.
    await waitFor(() => expect((screen.getByLabelText("Провайдер «Мой API»").textContent ?? "")).toContain("Мой провайдер"));
    expect(headerPill(container).textContent ?? "").not.toContain("Groq 4 Fast");
    // The catalog that matters is the new provider's, read with the new stored credential.
    await waitFor(() => expect(fixtures.myApiCatalogInputs.at(-1)).toEqual({ provider: "custom-xyz" }));
  });

  it("keeps the previous provider when the server refuses the switch", async () => {
    fixtures.userProviders = twoProviders;
    fixtures.myApiModels = [{ id: "aria/fast-1", name: "Groq 4 Fast", displayName: "Groq 4 Fast", isFree: false }];
    fixtures.myApiModelsLoaded = true;
    fixtures.switchProviderError = "Этот провайдер недоступен.";
    const user = userEvent.setup();
    await enterMyApi(user);
    await user.click(screen.getByLabelText("Провайдер «Мой API»"));
    await user.click(await screen.findByRole("option", { name: /Мой провайдер/ }));

    await screen.findByText(/Этот провайдер недоступен/);
    // Nothing moved: the binding and its model are exactly what they were.
    expect(screen.getByLabelText("Провайдер «Мой API»").textContent ?? "").toContain("Aria Cloud");
    expect(fixtures.myApiCatalogInputs.at(-1)).toEqual({ provider: "custom-abc" });
  });

  it("shows a model's own name while the request keeps the provider's real id", async () => {
    fixtures.userProviders = { ...twoProviders, configs: [{ ...configA, activeModel: "nvidia/nemotron-3-ultra" }] };
    fixtures.myApiModels = [
      { id: "nvidia/nemotron-3-ultra", name: "NVIDIA: Nemotron 3 Ultra", displayName: "Nemotron 3 Ultra", isFree: false },
      { id: "inclusionai/ling-sante:free", name: "inclusionAI: Ling (free)", displayName: "Ling", isFree: true },
    ];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    await enterMyApi(user);
    await user.click(screen.getByLabelText("Модель «Мой API»"));
    const options = await screen.findAllByRole("option");
    // The catalog's own pricing puts the free model in its own section first, and every entry
    // keeps the id the request needs even though the label drops the author prefix.
    expect(options.map((option) => option.getAttribute("title"))).toEqual(["inclusionai/ling-sante:free", "nvidia/nemotron-3-ultra"]);
    expect(options[1]!.textContent ?? "").not.toContain("NVIDIA");
    expect(within(options[0]!.parentElement as HTMLElement).getAllByText("Free").length).toBeGreaterThan(0);
    const trigger = screen.getByRole("button", { name: "Модель «Мой API»" });
    expect(trigger.textContent ?? "").toContain("Nemotron 3 Ultra");
    // The pill never shows the raw id: the request path is the only place the id is needed.
    expect(trigger.textContent ?? "").not.toContain("nvidia/");

    await user.click(options[0]!);
    expect(fixtures.switchedModel).toEqual({ provider: "custom-abc", activeModel: "inclusionai/ling-sante:free" });
  });

  it("searches the model list by both the visible name and the real id", async () => {
    fixtures.userProviders = twoProviders;
    fixtures.myApiModels = [
      { id: "vendor/model-b", name: "Model B", displayName: "Model B", isFree: false },
      { id: "vendor/model-c", name: "Model C", displayName: "Model C", isFree: false },
    ];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    await enterMyApi(user);
    await user.click(screen.getByLabelText("Модель «Мой API»"));
    await user.type(screen.getByLabelText("Поиск моделей"), "model-c");
    await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["vendor/model-c"]));
    await user.clear(screen.getByLabelText("Поиск моделей"));
    await user.type(screen.getByLabelText("Поиск моделей"), "zzz");
    expect(await screen.findByText("Ничего не найдено")).toBeTruthy();
  });
});

describe("My API model picker", () => {
  beforeEach(() => { window.localStorage.clear(); resetFixtures(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const customConfig = { provider: "custom-abc", displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1", modelsEndpoint: null, activeModel: "vendor/model-b", keyHint: "••••4321", updatedAt: new Date(0).toISOString() };

  it("offers the active provider's own live models, never a Kairema role", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }, { id: "vendor/model-c", name: "Model C" }];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);

    const picker = await screen.findByLabelText("Модель «Мой API»");
    await user.click(picker);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.getAttribute("title"))).toEqual(["vendor/model-b", "vendor/model-c"]);
    for (const role of ["Kairema Flash", "Kairema Think", "Kairema Context", "Kairema Apex"]) {
      expect(options.map((option) => option.textContent ?? "")).not.toContain(role);
    }
  });

  it("switches the active model on the server instead of guessing locally", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }, { id: "vendor/model-c", name: "Model C" }];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    const picker = await screen.findByLabelText("Модель «Мой API»");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /vendor\/model-c/ }));
    expect(fixtures.switchedModel).toEqual({ provider: "custom-abc", activeModel: "vendor/model-c" });
  });

  it("loads the catalog without ever sending a key from the browser", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    // The picker reads the server's own stored credential, so no key travels in this request.
    expect(fixtures.myApiCatalogInputs.at(-1)).toEqual({ provider: "custom-abc" });
  });

  it("states a failed catalog read and offers a retry instead of looking like an empty list", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiCatalogError = "Что произошло: Провайдер ИИ ответил ошибкой (AUTH) | Что делать: Проверьте настройки в Настройках → AI Providers.";
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);

    await screen.findByText(/Провайдер ИИ ответил ошибкой \(AUTH\)/);
    // The provider is reachable but its catalog could not be read: that is not "no models".
    expect(container.textContent ?? "").not.toContain("провайдер не вернул список моделей");

    const attemptsBefore = fixtures.myApiCatalogInputs.length;
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(fixtures.myApiCatalogInputs.length).toBeGreaterThan(attemptsBefore);
  });

  it("reads the catalog once per provider instead of on every switch into My API", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    const myApi = (await screen.findAllByRole("button", { name: "Мой API" }))[0]!;
    const chat = screen.getAllByRole("button", { name: "Чат" })[0]!;
    await user.click(myApi);
    await screen.findByLabelText("Модель «Мой API»");
    const afterFirstEntry = fixtures.myApiCatalogInputs.length;

    await user.click(chat);
    await user.click(myApi);
    await screen.findByLabelText("Модель «Мой API»");
    expect(fixtures.myApiCatalogInputs.length).toBe(afterFirstEntry);

    // A different provider, or an explicit retry, still reads it.
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-xyz", storageReady: true };
    await user.click(chat);
    await user.click(myApi);
    await waitFor(() => expect(fixtures.myApiCatalogInputs.at(-1)).toEqual({ provider: "custom-xyz" }));
  });

  it("shows an empty catalog as empty, not as a failure", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [];
    fixtures.myApiModelsLoaded = true;
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);

    await screen.findByText(/провайдер не вернул список моделей/);
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    // The saved model stays visible, so the user still knows which binding is configured.
    expect(container.textContent ?? "").toContain("vendor/model-b");
  });

  it("reports a refused model switch instead of silently reverting the picker", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }, { id: "vendor/model-c", name: "Model C" }];
    fixtures.myApiModelsLoaded = true;
    fixtures.switchModelError = "Выбранная модель отсутствует в каталоге провайдера. Обновите список моделей.";
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    const picker = await screen.findByLabelText("Модель «Мой API»");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /vendor\/model-c/ }));

    await screen.findByText(/отсутствует в каталоге провайдера/);
    // The switch never reached the server, so the binding is unchanged.
    expect(fixtures.switchedModel).toBeNull();
  });

  it("never shows the stored key in the chat screen", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await screen.findByLabelText("Модель «Мой API»");
    expect(container.textContent ?? "").not.toContain("••••");
  });

  it("hides the four Kairema roles while My API is selected and shows the binding instead", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    const { container } = render(<Home />);
    const user = userEvent.setup();
    const sidebar = () => container.querySelector(".kairema-sidebar") as HTMLElement;
    expect(sidebar().textContent ?? "").toContain("Kairema Flash");

    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await screen.findByLabelText("Модель «Мой API»");
    for (const role of ["Kairema Flash", "Kairema Think", "Kairema Context", "Kairema Apex"]) {
      expect(sidebar().textContent ?? "").not.toContain(role);
      expect(headerPill(container).textContent ?? "").not.toContain(role);
    }
    // The sidebar names the provider the turn will actually reach.
    expect(sidebar().textContent ?? "").toContain("vendor/model-b");
  });

  it("points an unconfigured My API at provider settings from the sidebar too", async () => {
    fixtures.userProviders = { providers: [], configs: [], activeProvider: null, storageReady: true };
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);

    await waitFor(() => expect((container.querySelector(".kairema-sidebar") as HTMLElement).textContent ?? "").not.toContain("Kairema Flash"));
    const links = screen.getAllByRole("link", { name: "Настроить провайдера →" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("href")).toBe("/settings/providers");
  });

  it("sends My API turns flagged for the user's own provider and never a key", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }];
    fixtures.myApiModelsLoaded = true;
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: done\ndata: {"content":"Ответ провайдера","modelUsed":"vendor/model-b","label":"Мой провайдер · vendor/model-b"}\n\n'));
        controller.close();
      },
    })));
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await user.type(await screen.findByPlaceholderText("Напишите сообщение…"), "Вопрос к своему провайдеру");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    // The server, not the browser, decides where the turn goes: the flag tells it to use the
    // active binding, and no credential is ever part of this request.
    expect(body.myApi).toBe(true);
    expect(JSON.stringify(body)).not.toContain("apiKey");
    expect(JSON.stringify(body)).not.toContain("encryptedApiKey");
    await waitFor(() => expect(fixtures.historyPageFetch).toHaveBeenCalled());
  });

  it("leaves an ordinary Chat turn unmarked so the platform path is unchanged", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: done\ndata: {"content":"Обычный ответ","modelUsed":"fast","label":"Kairema Flash"}\n\n'));
        controller.close();
      },
    })));
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<Home />);
    await user.type(await screen.findByPlaceholderText("Напишите сообщение…"), "Обычный вопрос");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.myApi).toBeUndefined();
    expect(body.modelId).toBe(fixtures.modelId);
  });

  it("keeps long provider and model names inside the header without widening it", async () => {
    fixtures.userProviders = { providers: [], configs: [{ ...customConfig, displayName: "Очень длинное имя провайдера для проверки переноса строки", activeModel: "organisation/very-long-model-identifier-for-overflow-check-2026" }], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "organisation/very-long-model-identifier-for-overflow-check-2026", name: "Very Long Model" }];
    fixtures.myApiModelsLoaded = true;
    const { container } = render(<Home />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await screen.findByLabelText("Модель «Мой API»");

    // jsdom neither lays out nor loads the stylesheet, so the contract is asserted on the
    // markup plus the rules that make a long value truncate instead of widening the bar.
    expect(container.querySelector(".kairema-binding-trigger")).not.toBeNull();
    expect(container.querySelector(".kairema-binding-select")).not.toBeNull();
    // The provider control truncates on its own, so a long provider name cannot widen the bar.
    expect(container.querySelector(".kairema-provider-trigger-text")).not.toBeNull();
    const css = readFileSync(path.join(import.meta.dirname, "../index.css"), "utf8");
    const rule = css.slice(css.indexOf(".kairema-binding-trigger-text"));
    expect(rule.slice(0, 200)).toContain("text-overflow:ellipsis");
    expect(rule.slice(0, 200)).toContain("min-width:0");
    const providerRule = css.slice(css.indexOf(".kairema-provider-trigger"));
    expect(providerRule.slice(0, 400)).toContain("text-overflow:ellipsis");
    expect(providerRule.slice(0, 400)).toContain("min-width:0");
    const pillRule = css.slice(css.indexOf(".kairema-model-pill { max-width:100%"));
    expect(pillRule.slice(0, 200)).toContain("max-width:100%");
    expect(pillRule.slice(0, 200)).toContain("overflow:hidden");
    // Narrow viewports get their own caps so the bar still truncates on a phone.
    expect(css).toContain("@media (max-width:767px)");
    expect(css).toContain("@media (max-width:430px)");
  });

  it("splits the live catalog into Free and Paid from the server's pricing verdict, never a hardcoded list", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [
      // The provider priced the first at zero, so it is Free although its id says ":extended"; the
      // third carries ":free" in its id but is billed, which the client must not second-guess.
      { id: "vendor/zero-priced:extended", name: "Vendor Free Flash", displayName: "Vendor Free Flash", isFree: true },
      { id: "vendor/model-b", name: "Model B", displayName: "Model B", isFree: false },
      { id: "vendor/free-flash:free", name: "Vendor Paid Ultra", displayName: "Vendor Paid Ultra", isFree: false },
    ];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await user.click(await screen.findByLabelText("Модель «Мой API»"));

    const groups = within(await screen.findByRole("listbox")).getAllByRole("group");
    // The grouping follows the catalog Kairema fetched, so a model the app has never seen still
    // lands in the right section on its own.
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Free", "Paid"]);
    expect(within(groups[0]!).getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["vendor/zero-priced:extended"]);
    expect(within(groups[1]!).getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["vendor/model-b", "vendor/free-flash:free"]);
    // Only the free model carries the marker, so the two sections are distinguishable per item
    // and not just by the section heading.
    const badges = (group: HTMLElement) => Array.from(group.querySelectorAll(".kairema-model-menu-badge")).map((badge) => badge.textContent);
    expect(badges(groups[0]!)).toEqual(["Free"]);
    expect(badges(groups[1]!)).toEqual([]);
  });

  it("filters both sections at once while typing, by name and by id", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [
      { id: "vendor/free-flash:free", name: "Vendor Free Flash", displayName: "Vendor Free Flash", isFree: true },
      { id: "vendor/model-b", name: "Model B", displayName: "Model B", isFree: false },
      { id: "vendor/paid-ultra:extended", name: "Vendor Paid Ultra", displayName: "Vendor Paid Ultra", isFree: false },
    ];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await user.click(await screen.findByLabelText("Модель «Мой API»"));
    const search = await screen.findByLabelText("Поиск моделей");

    await user.type(search, "flash");
    // One match, and it is the free one: the search spans both sections, it is not section-scoped.
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["vendor/free-flash:free"]);

    // The id itself is searchable too, not only the display name.
    await user.clear(search);
    await user.type(search, "paid-ultra");
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["vendor/paid-ultra:extended"]);
    // A name that lives in the other section still matches across the whole catalog.
    await user.clear(search);
    await user.type(search, "model b");
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["vendor/model-b"]);
  });

  it("says so cleanly when the search matches nothing", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await user.click(await screen.findByLabelText("Модель «Мой API»"));
    await user.type(await screen.findByLabelText("Поиск моделей"), "нет-такой-модели");

    await screen.findByText("Ничего не найдено");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // An empty result is not a failure state, so no retry is offered.
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
  });

  it("marks the saved model active and keeps it selected across close and reopen", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }, { id: "vendor/model-c", name: "Model C" }];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    const picker = await screen.findByLabelText("Модель «Мой API»");
    expect(picker.textContent).toBe("Model B");

    await user.click(picker);
    const active = (await screen.findAllByRole("option")).find((option) => option.getAttribute("aria-selected") === "true");
    expect(active?.getAttribute("title")).toBe("vendor/model-b");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    // Reopening starts from the server's saved binding, not from whatever was last clicked.
    await user.click(picker);
    const reopened = (await screen.findAllByRole("option")).find((option) => option.getAttribute("aria-selected") === "true");
    expect(reopened?.getAttribute("title")).toBe("vendor/model-b");
  });

  it("closes on a pick and sends the picked id to the server", async () => {
    fixtures.userProviders = { providers: [], configs: [customConfig], activeProvider: "custom-abc", storageReady: true };
    fixtures.myApiModels = [{ id: "vendor/model-b", name: "Model B" }, { id: "vendor/model-c", name: "Model C" }];
    fixtures.myApiModelsLoaded = true;
    const user = userEvent.setup();
    render(<Home />);
    await user.click((await screen.findAllByRole("button", { name: "Мой API" }))[0]!);
    await user.click(await screen.findByLabelText("Модель «Мой API»"));
    await user.click(await screen.findByRole("option", { name: /vendor\/model-c/ }));

    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    expect(fixtures.switchedModel).toEqual({ provider: "custom-abc", activeModel: "vendor/model-c" });
    // The search text does not survive a reopen, so the user lands on the full list again.
    await user.click(await screen.findByLabelText("Модель «Мой API»"));
    expect((await screen.findByLabelText("Поиск моделей")) as HTMLInputElement).toHaveProperty("value", "");
  });

  it("keeps the menu inside a bounded, self-scrolling black panel that cannot widen the page", () => {
    const css = readFileSync(path.join(import.meta.dirname, "../index.css"), "utf8");
    const panel = css.slice(css.indexOf(".kairema-model-menu {"));
    // A fixed, body-level panel with its own height and scroll: the catalog length can neither
    // stretch the chat page nor add a horizontal scrollbar.
    expect(panel.slice(0, 400)).toContain("position:fixed");
    expect(panel.slice(0, 400)).toContain("max-height");
    expect(panel.slice(0, 400)).toContain("overflow:hidden");
    expect(panel.slice(0, 400)).toContain("#0a0a0c");
    const list = css.slice(css.indexOf(".kairema-model-menu-list {"));
    expect(list.slice(0, 300)).toContain("overflow-y:auto");
    expect(list.slice(0, 300)).toContain("min-height:0");
    // A long model id truncates inside the item instead of stretching the panel.
    const item = css.slice(css.indexOf(".kairema-model-menu-item-title {"));
    expect(item.slice(0, 300)).toContain("text-overflow:ellipsis");
    expect(item.slice(0, 300)).toContain("min-width:0");
    // Phone widths get their own smaller type, so the same panel still fits a narrow screen.
    expect(css).toContain("@media (max-width:430px)");
    // The arrow sits inside the same wrapper as the trigger, so the open state has to reach it
    // with a descendant rule: a sibling combinator never matches and the chevron stays still.
    const chevron = css.slice(css.indexOf('.kairema-select-wrap:has(.kairema-binding-trigger[aria-expanded="true"])'));
    expect(chevron.slice(0, 200)).toContain(" .kairema-model-chevron { transform:rotate(180deg); }");
  });
});

describe("Profile", () => {
  // The dialog primitive is mocked to plain fragments here, so the profile content is queried
  // by its unique labels rather than by a dialog role.
  async function openProfile() {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(await screen.findByRole("button", { name: fixtures.language === "en" ? "Open profile" : "Открыть профиль" }));
    await screen.findByRole("textbox", { name: /Как к вам обращаться|What should we call you/ });
    return user;
  }

  beforeEach(() => { window.localStorage.clear(); resetFixtures(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("offers a compact name field and clarifying-question preference, defaulting to off", async () => {
    await openProfile();

    expect(screen.getByText("Полное имя")).not.toBeNull();
    expect(screen.getByText("Персональные предпочтения")).not.toBeNull();
    expect(screen.getByText("Ваши предпочтения применяются ко всем разговорам.")).not.toBeNull();
    const nameField = screen.getByRole("textbox", { name: /Как к вам обращаться/ }) as HTMLInputElement;
    expect(nameField.maxLength).toBe(120);
    expect(nameField.getAttribute("autocomplete")).toBe("name");
    // Default preference is OFF on a fresh account.
    const toggle = screen.getByRole("switch", { name: /Задавать уточняющие вопросы/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("reads as a plain English profile form in the English interface", async () => {
    fixtures.language = "en";
    await openProfile();

    expect(screen.getByText("Full name")).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "What should we call you?" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Update Profile/ })).not.toBeNull();
    expect(screen.getByText("Personal preferences")).not.toBeNull();
    expect(screen.getByText("What personal preferences should Kairema consider in responses?")).not.toBeNull();
    expect(screen.getByText("Your preferences will apply to all conversations.")).not.toBeNull();
    expect(screen.getByRole("switch", { name: /Ask clarifying questions before giving detailed answers/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Save Preferences/ })).not.toBeNull();
    // No internal wording leaks into the profile screen.
    expect(document.body.textContent ?? "").not.toMatch(/userId|encrypted|myApiProvider|SSRF/i);
  });

  it("saves the display name and the clarifying-questions preference independently", async () => {
    const user = await openProfile();

    await user.click(screen.getByRole("switch", { name: /Задавать уточняющие вопросы/ }));
    await user.click(screen.getByRole("button", { name: /Сохранить предпочтения/ }));
    expect(fixtures.updatedSettings.at(-1)).toEqual({ askClarifyingQuestions: true });

    const nameInput = screen.getByRole("textbox", { name: /Как к вам обращаться/ });
    await user.clear(nameInput);
    await user.type(nameInput, "Kazea");
    await user.click(screen.getByRole("button", { name: /Обновить профиль/ }));
    expect(fixtures.updateName).toHaveBeenCalledWith({ name: "Kazea" });
    // The name is not a response preference, so it must not leak into settings updates.
    expect(fixtures.updatedSettings.at(-1)).toEqual({ askClarifyingQuestions: true });
  });

  it("never writes the display name into any chat request", async () => {
    const user = await openProfile();
    const nameInput = screen.getByRole("textbox", { name: /Как к вам обращаться/ });
    await user.clear(nameInput);
    await user.type(nameInput, "Kazea");
    await user.click(screen.getByRole("button", { name: /Обновить профиль/ }));
    await user.keyboard("{Escape}");

    expect(document.body.textContent ?? "").not.toContain("Kazea");
  });
});

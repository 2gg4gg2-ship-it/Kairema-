/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  modelId: "fast",
  sessionId: "11111111-1111-4111-8111-111111111111",
  sessions: [] as Array<{ id: string; modelId: string; title: string }>,
  messages: [] as Array<{ id: number; role: "user" | "assistant"; content: string; modelId: string | null; createdAt: Date }>,
  prepareMarkdown: vi.fn(),
  preparePdf: vi.fn(),
  downloadPrepared: vi.fn(),
  createExport: vi.fn(),
  deleteExport: vi.fn(),
  deleteAllExports: vi.fn(),
  exports: [] as Array<{ id: string; fileName: string; format: "markdown" | "pdf"; createdAt: Date }>,
  invalidateExports: vi.fn(),
  invalidateMessages: vi.fn(),
  invalidateSessions: vi.fn(),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  updateSettings: vi.fn(),
  releaseSecondDelta: null as (() => void) | null,
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("@/const", () => ({ startLogin: vi.fn() }));
vi.mock("@/lib/runtime-auth", () => ({ runtimeAuthHeaders: () => ({ Authorization: "Bearer test-session" }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }) }));
vi.mock("@/lib/chat-export", () => ({
  prepareChatMarkdown: fixtures.prepareMarkdown,
  prepareChatPdf: fixtures.preparePdf,
  downloadPreparedChatExport: fixtures.downloadPrepared,
  blobToBase64: vi.fn().mockResolvedValue("dGVzdA=="),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    models: { list: { useQuery: () => ({ data: [
      { key: "fast", modelId: "fast", label: "Kairema Быстрый", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, runtime: { state: "ready", provider: "OpenRouter", modelUsed: "Llama Fast", checkedAt: "2026-08-19T00:00:00.000Z" } },
      { key: "smart", modelId: "smart", label: "Kairema Смекалистый", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" } },
      { key: "context", modelId: "context", label: "Kairema Контекст", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" } },
      { key: "flagship", modelId: "flagship", label: "Kairema Флагман", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" } },
    ] }) } },
    settings: { get: { useQuery: () => ({ data: { language: "ru", theme: "dark", responseStyle: "default", responseLength: "balanced", quickReplies: 1, effort: "standard", thinking: 0, defaultRole: "fast", webSearch: 0 } }) }, update: { useMutation: () => ({ mutateAsync: fixtures.updateSettings }) } },
    memory: { get: { useQuery: () => ({ data: { profile: "", enabled: 1, autoExtract: 1, facts: [] } }) }, update: { useMutation: () => ({ mutateAsync: vi.fn() }) }, addFact: { useMutation: () => ({ mutateAsync: vi.fn() }) }, deleteFact: { useMutation: () => ({ mutateAsync: vi.fn() }) }, clear: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    webSearch: { status: { useQuery: () => ({ data: { available: false, reason: "Поиск сейчас недоступен" } }) } },
    knowledge: { status: { useQuery: () => ({ data: { documents: 0, sources: [], lastRun: null } }) }, audit: { useQuery: () => ({ data: { sources: [{ name: "OpenAI News", url: "https://openai.com/news/rss.xml", indexedCount: 12, lastSuccessAt: "2026-08-19T00:00:00.000Z" }], latestRun: { state: "completed", startedAt: "2026-08-19T00:00:00.000Z", finishedAt: "2026-08-19T00:01:00.000Z" } } }) }, refresh: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
    providers: { dashboard: { useQuery: () => ({ data: [{ id: "openrouter", label: "OpenRouter", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "google", label: "Google AI Studio", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "groq", label: "Groq", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }] }) } },
    search: { query: { useQuery: () => ({ data: [] }) } },
    attachments: { list: { useQuery: () => ({ data: [] }) }, upload: { useMutation: () => ({ mutateAsync: vi.fn() }) }, delete: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    chats: {
      list: { useQuery: () => ({ data: fixtures.sessions, isLoading: false }) },
      messages: { useQuery: () => ({ data: fixtures.messages }) },
      create: { useMutation: () => ({ mutateAsync: fixtures.createChat, isPending: false }) },
      delete: { useMutation: () => ({ mutateAsync: fixtures.deleteChat, isPending: false }) },
    },
    exports: {
      list: { useQuery: () => ({ data: fixtures.exports, isLoading: false }) },
      create: { useMutation: () => ({ mutateAsync: fixtures.createExport }) },
      delete: { useMutation: () => ({ mutateAsync: fixtures.deleteExport }) },
      deleteAll: { useMutation: () => ({ mutateAsync: fixtures.deleteAllExports }) },
    },
    useUtils: () => ({ models: { list: { invalidate: vi.fn() } }, settings: { get: { invalidate: vi.fn() } }, memory: { get: { invalidate: vi.fn() } }, knowledge: { status: { invalidate: vi.fn() } }, attachments: { list: { invalidate: vi.fn() } }, chats: { messages: { invalidate: fixtures.invalidateMessages }, list: { invalidate: fixtures.invalidateSessions } }, exports: { list: { invalidate: fixtures.invalidateExports }, download: { fetch: vi.fn() } } }),
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

import Home from "./Home";

const encoder = new TextEncoder();

function resetFixtures() {
  fixtures.sessions = [{ id: fixtures.sessionId, modelId: fixtures.modelId, title: "Активная история" }];
  fixtures.messages = [
    { id: 1, role: "user", content: "Старое сообщение пользователя", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:00:00.000Z") },
    { id: 2, role: "assistant", content: "Старый ответ Kairema", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:01:00.000Z") },
  ];
  const markdownFile = { fileName: "Активная история.md", contentType: "text/markdown", blob: new Blob(["markdown"]) };
  const pdfFile = { fileName: "Активная история.pdf", contentType: "application/pdf", blob: new Blob(["pdf"]) };
  fixtures.prepareMarkdown.mockReset().mockResolvedValue(markdownFile);
  fixtures.preparePdf.mockReset().mockResolvedValue(pdfFile);
  fixtures.downloadPrepared.mockReset();
  fixtures.createExport.mockReset().mockResolvedValue({ id: "export-1" });
  fixtures.deleteExport.mockReset().mockResolvedValue(undefined);
  fixtures.deleteAllExports.mockReset().mockResolvedValue({ success: true, deletedCount: 1 });
  fixtures.exports = [];
  fixtures.invalidateExports.mockReset().mockResolvedValue(undefined);
  fixtures.invalidateSessions.mockReset().mockResolvedValue(undefined);
  fixtures.createChat.mockReset().mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", modelId: "fast", title: "Новый разговор" });
  fixtures.deleteChat.mockReset().mockResolvedValue({ success: true });
  fixtures.updateSettings.mockReset().mockResolvedValue(undefined);
  fixtures.invalidateMessages.mockReset().mockImplementation(async () => {
    fixtures.messages = [
      ...fixtures.messages,
      { id: 3, role: "user", content: "Новый вопрос", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:02:00.000Z") },
      { id: 4, role: "assistant", content: "Первый фрагмент ответа", modelId: fixtures.modelId, createdAt: new Date("2026-08-19T00:03:00.000Z") },
    ];
  });
  fixtures.releaseSecondDelta = null;
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

  it("creates an allowed new chat when an old history item still has the removed Code role", async () => {
    const user = userEvent.setup();
    fixtures.sessions = [{ id: fixtures.sessionId, modelId: "code", title: "Старый чат" }];
    fixtures.messages = [];
    render(<Home />);

    await user.click(screen.getAllByRole("button", { name: "Новый чат" })[0]!);

    await waitFor(() => expect(fixtures.createChat).toHaveBeenCalledWith({ modelId: "fast" }));
    expect(screen.queryByText(/Invalid option/)).toBeNull();
  });

  it("deletes the active owned chat and clears the active-message query", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Удалить: Активная история" }));

    await waitFor(() => expect(fixtures.deleteChat).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
    await waitFor(() => expect(fixtures.invalidateSessions).toHaveBeenCalled());
    expect(fixtures.invalidateMessages).toHaveBeenCalledWith();
  });

  it("exports only the active persisted history through both user-facing controls", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Markdown" })).toHaveProperty("disabled", false));
    await user.click(screen.getByRole("button", { name: "Markdown" }));
    await user.click(screen.getByRole("button", { name: "PDF" }));

    expect(fixtures.prepareMarkdown).toHaveBeenCalledWith(expect.objectContaining({ title: "Активная история", messages: [expect.objectContaining({ content: "Старое сообщение пользователя" }), expect.objectContaining({ content: "Старый ответ Kairema" })] }));
    await waitFor(() => expect(fixtures.preparePdf).toHaveBeenCalledOnce());
    expect(fixtures.createExport).toHaveBeenCalledTimes(2);
    expect(fixtures.downloadPrepared).toHaveBeenCalledTimes(2);
  });

  it("confirms before deleting all exports and refreshes the export history after the owned operation succeeds", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn().mockReturnValue(true);
    let finishDeletion: ((value: { success: true; deletedCount: number }) => void) | undefined;
    vi.stubGlobal("confirm", confirm);
    fixtures.exports = [{ id: "33333333-3333-4333-8333-333333333333", fileName: "Активная история.md", format: "markdown", createdAt: new Date("2026-08-19T00:00:00.000Z") }];
    fixtures.deleteAllExports.mockImplementation(() => new Promise((resolve) => { finishDeletion = resolve; }));
    render(<Home />);

    await user.click(await screen.findByRole("button", { name: "Удалить все экспорты" }));

    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(fixtures.deleteAllExports).toHaveBeenCalledOnce());
    await screen.findByRole("button", { name: "Удаляем…" });
    expect(screen.getByRole("button", { name: "Удаляем…" })).toHaveProperty("disabled", true);
    finishDeletion?.({ success: true, deletedCount: 1 });
    await waitFor(() => expect(fixtures.invalidateExports).toHaveBeenCalledOnce());
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
    expect(JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ sessionId: fixtures.sessionId, modelId: "fast", content: "Новый вопрос", attachmentIds: [], webSearch: false, settings: { style: "default", responseLength: "balanced", effort: "standard", thinking: false } });

    await waitFor(() => expect(screen.getByText("Первый фрагмент")).toBeTruthy());
    expect(screen.queryByText("Первый фрагмент ответа")).toBeNull();
    fixtures.releaseSecondDelta?.();

    await waitFor(() => expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
    await waitFor(() => expect(screen.getByText("Первый фрагмент ответа")).toBeTruthy());
    expect(screen.queryByText("печатает")).toBeNull();
  });

  it("copies an assistant reply and regenerates it from the previous user prompt", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const fetchSpy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: done\ndata: {"content":"Новый вариант","modelUsed":"llama-3.1-8b-instant","label":"Kairema Быстрый"}\n\n'));
        controller.close();
      },
    }))));
    vi.stubGlobal("fetch", fetchSpy);
    render(<Home />);

    await user.click(screen.getAllByRole("button", { name: "Копировать" })[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Старый ответ Kairema"));
    expect(screen.getByRole("status").textContent).toContain("Сообщение скопировано");

    await user.click(screen.getByRole("button", { name: "Ещё вариант" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const payload = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(payload).toMatchObject({ content: "Старое сообщение пользователя", regenerateMessageId: 2, sessionId: fixtures.sessionId });
    await waitFor(() => expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
  });

  it("aborts an active stream and refreshes persisted history without leaving an optimistic reply", async () => {
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

    await waitFor(() => expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Отменить генерацию" })).toBeNull());
    expect(screen.queryByText("Отменяемый запрос")).toBeNull();
  });

  it("updates a setting's active state immediately while its server save is still pending", async () => {
    const user = userEvent.setup();
    fixtures.updateSettings.mockImplementation(() => new Promise(() => undefined));
    render(<Home />);

    const thinking = screen.getByRole("button", { name: "Дополнительное рассуждение" });
    const indicator = thinking.querySelector(".kairema-switch");
    expect(indicator?.className).not.toContain("kairema-switch-on");

    await user.click(thinking);

    expect(indicator?.className).toContain("kairema-switch-on");
    expect(fixtures.updateSettings).toHaveBeenCalledWith({ thinking: true });
  });

  it("shows only safe last-provider metadata for a role in settings", () => {
    render(<Home />);

    expect(screen.getByText(/Готов · OpenRouter · Llama Fast/)).toBeTruthy();
    expect(screen.queryByText(/Authorization|Bearer|chain/i)).toBeNull();
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

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
  archiveExport: vi.fn(),
  batchArchiveExports: vi.fn(),
  deleteExport: vi.fn(),
  deleteAllExports: vi.fn(),
  exports: [] as Array<{ id: string; fileName: string; format: "markdown" | "pdf"; createdAt: Date; byteSize?: number }>,
  invalidateExports: vi.fn(),
  invalidateMessages: vi.fn(),
  invalidateSessions: vi.fn(),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  updateSettings: vi.fn(),
  isOwner: false,
  releaseSecondDelta: null as (() => void) | null,
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("@/const", () => ({ startLogin: vi.fn() }));
vi.mock("@/lib/runtime-auth", () => ({ runtimeAuthHeaders: () => ({ Authorization: "Bearer test-session" }) }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: vi.fn(), highContrast: false, setHighContrast: vi.fn() }) }));
vi.mock("@/lib/chat-export", () => ({
  prepareChatMarkdown: fixtures.prepareMarkdown,
  prepareChatPdf: fixtures.preparePdf,
  downloadPreparedChatExport: fixtures.downloadPrepared,
  blobToBase64: vi.fn().mockResolvedValue("dGVzdA=="),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    models: { list: { useQuery: () => ({ data: [
      { key: "fast", modelId: "fast", label: "Kairema Flash", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, runtime: { state: "ready", provider: "OpenRouter", modelUsed: "Fast", checkedAt: "2026-08-19T00:00:00.000Z" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "smart", modelId: "smart", label: "Kairema Think", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "context", modelId: "context", label: "Kairema Context", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
      { key: "flagship", modelId: "flagship", label: "Kairema Apex", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" }, limits: { candidate: "primary", provider: "OpenRouter", quota: "ready", nextFallback: "OrcaRouter", lastFallback: false } },
    ] }) } },
    settings: { get: { useQuery: () => ({ data: { language: "ru", theme: "dark", responseStyle: "default", responseLength: "balanced", quickReplies: 1, effort: "standard", thinking: 0, defaultRole: "fast", webSearch: 0, healthRefreshSeconds: 30, highContrast: 0, exportSortBy: "createdAt", exportSortDirection: "desc" } }) }, update: { useMutation: () => ({ mutateAsync: fixtures.updateSettings }) } },
    memory: { get: { useQuery: () => ({ data: { profile: "", enabled: 1, autoExtract: 1, facts: [] } }) }, update: { useMutation: () => ({ mutateAsync: vi.fn() }) }, addFact: { useMutation: () => ({ mutateAsync: vi.fn() }) }, deleteFact: { useMutation: () => ({ mutateAsync: vi.fn() }) }, clear: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    webSearch: { status: { useQuery: () => ({ data: { available: false, reason: "Поиск сейчас недоступен", checkedAt: "2026-08-19T00:00:00.000Z", layers: [{ id: "google", state: "limited", retryAt: null }, { id: "tavily", state: "ready", retryAt: null }, { id: "openrouter", state: "ready", retryAt: null }] } }) } },
    knowledge: { status: { useQuery: () => ({ data: { documents: 0, sources: [], lastRun: null } }) }, audit: { useQuery: () => ({ data: { sources: [{ name: "OpenAI News", url: "https://openai.com/news/rss.xml", indexedCount: 12, lastSuccessAt: "2026-08-19T00:00:00.000Z" }], latestRun: { state: "completed", startedAt: "2026-08-19T00:00:00.000Z", finishedAt: "2026-08-19T00:01:00.000Z" } } }) }, refresh: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) } },
    providers: { dashboard: { useQuery: () => ({ data: [{ id: "openrouter", label: "OpenRouter", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "google", label: "Google AI Studio", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }, { id: "groq", label: "Groq", state: "ready", category: null, capacity: "available", checkedAt: "2026-08-19T00:00:00.000Z", nextCheckAt: "2026-08-20T00:00:00.000Z" }] }) } },
    owner: { isOwner: { useQuery: () => ({ data: fixtures.isOwner }) }, flashTtft: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: { p50Ms: 220, p95Ms: 440, samples: 2 }, last7d: { p50Ms: 250, p95Ms: 480, samples: 5 } } : null }) }, flashTtftTrend: { useQuery: () => ({ data: fixtures.isOwner ? [{ date: "2026-08-20", p50Ms: 220, p95Ms: 440, samples: 2 }] : [] }) }, searchOutages: { useQuery: () => ({ data: fixtures.isOwner ? { last24h: 1, last7d: 2, recent: [{ layer: "google", errorClass: "http_429", latencyMs: 120, createdAt: "2026-08-20T00:00:00.000Z" }] } : null }) } },
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
      search: { useQuery: (input: { query: string }) => ({ data: input.query.trim().length >= 2 ? fixtures.exports.filter((entry) => entry.fileName.toLocaleLowerCase("ru-RU").includes(input.query.toLocaleLowerCase("ru-RU"))) : [] }) },
      create: { useMutation: () => ({ mutateAsync: fixtures.createExport }) },
      archive: { useMutation: () => ({ mutateAsync: fixtures.archiveExport }) },
      batchArchive: { useMutation: () => ({ mutateAsync: fixtures.batchArchiveExports, isPending: false }) },
      delete: { useMutation: () => ({ mutateAsync: fixtures.deleteExport }) },
      deleteAll: { useMutation: () => ({ mutateAsync: fixtures.deleteAllExports }) },
    },
    useUtils: () => ({ models: { list: { invalidate: vi.fn() } }, settings: { get: { invalidate: vi.fn() } }, memory: { get: { invalidate: vi.fn() } }, knowledge: { status: { invalidate: vi.fn() } }, attachments: { list: { invalidate: vi.fn() } }, chats: { messages: { invalidate: fixtures.invalidateMessages }, list: { invalidate: fixtures.invalidateSessions } }, exports: { list: { invalidate: fixtures.invalidateExports }, search: { invalidate: vi.fn() }, download: { fetch: vi.fn() } } }),
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
  fixtures.archiveExport.mockReset().mockResolvedValue({ success: true });
  fixtures.deleteExport.mockReset().mockResolvedValue(undefined);
  fixtures.deleteAllExports.mockReset().mockResolvedValue({ success: true, deletedCount: 1 });
  fixtures.exports = [];
  fixtures.isOwner = false;
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

  it("renders the structured create-chat failure message instead of a raw JSON object", async () => {
    const user = userEvent.setup();
    fixtures.createChat.mockRejectedValueOnce({ error: { message: "Хранилище временно недоступно." } });
    render(<Home />);

    await user.click(screen.getAllByRole("button", { name: "Новый чат" })[0]!);

    expect(await screen.findByText("Хранилище временно недоступно.")).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]|\{"error"/)).toBeNull();
  });

  it("deletes the active owned chat and clears the active-message query", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Удалить: Активная история" }));

    await waitFor(() => expect(fixtures.deleteChat).toHaveBeenCalledWith({ sessionId: fixtures.sessionId }));
    await waitFor(() => expect(fixtures.invalidateSessions).toHaveBeenCalled());
    expect(fixtures.invalidateMessages).toHaveBeenCalledWith({ sessionId: fixtures.sessionId });
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

  it("keeps exports and files as labelled sidebar sections with readable empty states", () => {
    render(<Home />);

    const exportsSection = screen.getByRole("region", { name: "Экспорты" });
    const filesSection = screen.getByRole("region", { name: "Файлы" });
    expect(exportsSection.querySelector(".kairema-empty")?.textContent).toContain("Экспортов пока нет");
    expect(filesSection.querySelector(".kairema-empty")?.textContent).toContain("Вложений в этом чате пока нет");
  });

  it("queries export history by file name through the server-side contract", async () => {
    const user = userEvent.setup();
    fixtures.exports = [
      { id: "33333333-3333-4333-8333-333333333333", fileName: "Проектный архив.md", format: "markdown", createdAt: new Date("2026-08-19T00:00:00.000Z") },
      { id: "44444444-4444-4444-8444-444444444444", fileName: "Итоги встречи.pdf", format: "pdf", createdAt: new Date("2026-08-18T00:00:00.000Z") },
    ];
    render(<Home />);

    await user.type(screen.getByRole("textbox", { name: "Поиск: Экспорты" }), "архив");

    expect(screen.getByText("Проектный архив.md")).toBeTruthy();
    expect(screen.queryByText("Итоги встречи.pdf")).toBeNull();
  });

  it("persists user-scoped export sorting and changes the visible order after existing filters", async () => {
    const user = userEvent.setup();
    fixtures.exports = [
      { id: "33333333-3333-4333-8333-333333333333", fileName: "Малый отчёт.pdf", format: "pdf", createdAt: new Date("2026-08-18T00:00:00.000Z"), byteSize: 1_024 },
      { id: "44444444-4444-4444-8444-444444444444", fileName: "Большой отчёт.md", format: "markdown", createdAt: new Date("2026-08-19T00:00:00.000Z"), byteSize: 8_192 },
    ];
    render(<Home />);

    const exportsRegion = screen.getByRole("region", { name: "Экспорты" });
    expect(exportsRegion.textContent?.indexOf("Большой отчёт.md")).toBeLessThan(exportsRegion.textContent?.indexOf("Малый отчёт.pdf") ?? -1);
    await user.selectOptions(screen.getByLabelText("Сортировка"), "byteSize:asc");
    await waitFor(() => expect(fixtures.updateSettings).toHaveBeenCalledWith({ exportSortBy: "byteSize", exportSortDirection: "asc" }));
    expect(exportsRegion.textContent?.indexOf("Малый отчёт.pdf")).toBeLessThan(exportsRegion.textContent?.indexOf("Большой отчёт.md") ?? -1);
  });

  it("keeps Flash TTFT and search-outage aggregates invisible to a non-owner and renders only aggregate owner data", () => {
    const { rerender } = render(<Home />);
    expect(screen.queryByRole("heading", { name: "Flash TTFT" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Сбои поиска" })).toBeNull();

    fixtures.isOwner = true;
    rerender(<Home />);

    expect(screen.getByRole("heading", { name: "Flash TTFT" }).parentElement?.textContent).toContain("p50 220 мс");
    expect(screen.getByRole("heading", { name: "Сбои поиска" }).parentElement?.textContent).toContain("24 часа: 1");
    expect(screen.queryByText(/http_429/i)).toBeNull();
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
    const streamPayload = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    expect(streamPayload).toMatchObject({ sessionId: fixtures.sessionId, modelId: "fast", content: "Новый вопрос", attachmentIds: [], settings: { style: "default", responseLength: "balanced", effort: "standard", thinking: false } });
    expect(streamPayload).not.toHaveProperty("webSearch");

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

    const thinking = screen.getByRole("switch", { name: /Дополнительное рассуждение/ });
    expect(thinking.getAttribute("data-state")).toBe("unchecked");

    await user.click(thinking);

    expect(thinking.getAttribute("data-state")).toBe("checked");
    expect(fixtures.updateSettings).toHaveBeenCalledWith({ thinking: true });
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
    expect({ theme: darkSwitch.parentElement?.parentElement?.getAttribute("data-theme"), role: darkSwitch.getAttribute("role"), checked: darkSwitch.getAttribute("aria-checked"), state: darkSwitch.getAttribute("data-state") }).toMatchInlineSnapshot(`
      {
        "checked": "true",
        "role": "switch",
        "state": "checked",
        "theme": "dark",
      }
    `);
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

  it("uses named accessible AppSelect controls in settings instead of native selects", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Открыть настройки" }));
    const styleSelect = screen.getByRole("combobox", { name: "Стиль" });
    expect(styleSelect).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Длина" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Роль по умолчанию" })).toBeTruthy();
    expect(styleSelect.closest("label")?.querySelectorAll("select")).toHaveLength(0);
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

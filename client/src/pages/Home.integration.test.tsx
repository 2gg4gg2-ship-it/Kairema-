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
  invalidateExports: vi.fn(),
  invalidateMessages: vi.fn(),
  invalidateSessions: vi.fn(),
  releaseSecondDelta: null as (() => void) | null,
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("@/const", () => ({ startLogin: vi.fn() }));
vi.mock("@/lib/runtime-auth", () => ({ runtimeAuthHeaders: () => ({ Authorization: "Bearer test-session" }) }));
vi.mock("@/lib/chat-export", () => ({
  prepareChatMarkdown: fixtures.prepareMarkdown,
  prepareChatPdf: fixtures.preparePdf,
  downloadPreparedChatExport: fixtures.downloadPrepared,
  blobToBase64: vi.fn().mockResolvedValue("dGVzdA=="),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    models: { list: { useQuery: () => ({ data: [
      { key: "fast", modelId: "fast", label: "Kairema Быстрый", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" } },
      { key: "smart", modelId: "smart", label: "Kairema Смекалистый", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" } },
      { key: "context", modelId: "context", label: "Kairema Контекст", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" } },
      { key: "flagship", modelId: "flagship", label: "Kairema Флагман", role: "Тест", status: { state: "ready", badge: "Готов", category: null, http: 200, checkedAt: "2026-08-19T00:00:00.000Z", confirmed: "Проверено" } },
    ] }) } },
    chats: {
      list: { useQuery: () => ({ data: fixtures.sessions, isLoading: false }) },
      messages: { useQuery: () => ({ data: fixtures.messages }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    exports: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      create: { useMutation: () => ({ mutateAsync: fixtures.createExport }) },
      delete: { useMutation: () => ({ mutateAsync: fixtures.deleteExport }) },
    },
    useUtils: () => ({ chats: { messages: { invalidate: fixtures.invalidateMessages }, list: { invalidate: fixtures.invalidateSessions } }, exports: { list: { invalidate: fixtures.invalidateExports }, download: { fetch: vi.fn() } } }),
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
  fixtures.invalidateExports.mockReset().mockResolvedValue(undefined);
  fixtures.invalidateSessions.mockReset().mockResolvedValue(undefined);
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

    const visibleRoleCards = screen.getAllByRole("button").filter((element) =>
      ["Kairema Быстрый", "Kairema Смекалистый", "Kairema Контекст", "Kairema Флагман"].some((label) => element.textContent?.includes(label)),
    );
    expect(visibleRoleCards).toHaveLength(4);
    expect(screen.queryByText("Kairema Код")).toBeNull();
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

  it("shows a streaming delta, then replaces optimistic content with the persisted final answer", async () => {
    const user = userEvent.setup();
    const release = new Promise<void>((resolve) => { fixtures.releaseSecondDelta = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"content":"Первый фрагмент"}\n\n'));
        await release;
        controller.enqueue(encoder.encode('event: delta\ndata: {"content":" ответа"}\n\nevent: done\ndata: {"content":"Первый фрагмент ответа","modelUsed":"google/gemma-4-26b-a4b-it:free","label":"Kairema Ultra (Gemma 4)"}\n\n'));
        controller.close();
      },
    }))));
    render(<Home />);

    const composer = await screen.findByPlaceholderText("Напишите сообщение…");
    await user.type(composer, "Новый вопрос");
    await user.keyboard("{Enter}");

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

    await user.click(screen.getByRole("button", { name: "Копировать ответ" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Старый ответ Kairema"));
    expect(screen.getByRole("status").textContent).toContain("Ответ скопирован");

    await user.click(screen.getByRole("button", { name: "Перегенерировать ответ" }));
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
});

import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatQuota } = vi.hoisted(() => ({ chatQuota: vi.fn() }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  consumeChatStreamRequestQuota: chatQuota,
}));
import { CHAT_STREAM_RATE_LIMIT, chatStreamRateLimitMessage, createChatStreamHandler, getChatStreamRuntimeGaugeSnapshot, resetChatStreamRateLimits } from "./chat-stream";

const context = { style: "default" as const, responseLength: "normal" as const, quickReplies: true, effort: "standard" as const, thinking: false };
const validRequestBody = { sessionId: "550e8400-e29b-41d4-a716-446655440000", modelId: "fast", content: "Привет" };
const transcriptWindow = (messages = [{ id: 1, role: "user" as const, content: "Привет", createdAt: new Date(0) }]) => ({
  messages,
  budget: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 },
  candidateCount: messages.length,
  selectedContentChars: messages.reduce((total, message) => total + message.content.length, 0),
  selectedPriorTurns: 0,
  truncated: false,
});

function response() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), json: vi.fn(),
  }) as unknown as Response;
}

describe("chat stream happy-path", () => {
  beforeEach(() => {
    resetChatStreamRateLimits();
    chatQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it("persists post-turn memory before emitting the client-visible done event", async () => {
    const writes: string[] = [];
    const appended: Array<{ role: string; content: string; metadata?: string }> = [];
    const order: string[] = [];
    const streamResponse = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn((chunk: string) => { writes.push(chunk); if (chunk.includes("event: done")) order.push("done"); }), end: vi.fn(() => order.push("end")), json: vi.fn(),
    }) as unknown as Response;
    const auditChatStream = vi.fn();
    const enqueueMemoryExtractionJob = vi.fn().mockImplementation(async () => { order.push("memory-enqueued"); return { created: true }; });
    const processMemoryExtractionJob = vi.fn().mockImplementation(async () => { order.push("memory-processed"); });
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", title: "Новый разговор" }),
      appendChatMessage: vi.fn(async (_userId, _sessionId, role, content, _modelId, metadata) => { appended.push({ role, content, metadata }); if (role === "assistant") order.push("assistant-saved"); return { id: appended.length, created: true }; }),
      updateChatTitle: vi.fn(), listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow()),
      buildChatContext: vi.fn().mockResolvedValue(context), enqueueMemoryExtractionJob, processMemoryExtractionJob,
      chatWithRoleStream: vi.fn(async (_modelId, _history, _settings, onDelta) => { onDelta("При"); onDelta("вет"); return { content: "Привет", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant", sources: [{ title: "Официальный источник", url: "https://example.com/fresh", domain: "example.com", publishedAt: "2026-08-23T00:00:00.000Z" }], evidence: [{ sourceUrl: "https://example.com/evidence", excerpt: "private snippet" }], ragSources: [{ title: "Private RAG", url: "https://example.com/rag", publishedAt: "2026-08-19T00:00:00.000Z" }], searchStatus: { cascadeUsed: "you", state: "found", verificationStatus: "verified", sourcesCount: 2, liveValue: { kind: "temperature", status: "confirmed" } }, webGrounding: { intent: "REQUIRED", state: "verified", sourcesCount: 1, citations: [{ title: "Официальный источник", url: "https://example.com/fresh", domain: "example.com", publishedAt: "2026-08-23T00:00:00.000Z" }] } }; }),
      auditChatStream,
    });

    await handler({ body: validRequestBody } as Request, streamResponse, vi.fn());

    expect(writes.join("")).toContain("event: start");
    expect(writes.join("")).toContain('event: delta\ndata: {"content":"При"}');
    expect(writes.join("")).toContain('event: delta\ndata: {"content":"вет"}');
    expect(writes.join("")).toContain("event: done");
    const doneChunk = String((streamResponse.write as ReturnType<typeof vi.fn>).mock.calls.find(([chunk]) => String(chunk).includes("event: done"))![0]);
    const donePayload = JSON.parse(doneChunk.match(/data: (.+)\n/)?.[1] ?? "{}");
    const persistedMetadata = JSON.parse(appended[1]?.metadata ?? "{}");
    expect(writes.join("")).toContain('"sourceDateMin":"2026-08-19T00:00:00.000Z"');
    expect(writes.join("")).toContain('"sourceDateMax":"2026-08-23T00:00:00.000Z"');
    expect(writes.join("")).not.toMatch(/Private RAG|private snippet|cascadeUsed/);
    expect(donePayload).toEqual({ content: "Привет", modelUsed: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 2, liveValue: { kind: "temperature", status: "confirmed" }, sourceDateMin: "2026-08-19T00:00:00.000Z", sourceDateMax: "2026-08-23T00:00:00.000Z" }, sources: [{ title: "Официальный источник", url: "https://example.com/fresh", publishedAt: "2026-08-23T00:00:00.000Z" }], webGrounding: { intent: "REQUIRED", state: "verified", sourcesCount: 1, citations: [{ title: "Официальный источник", url: "https://example.com/fresh", publishedAt: "2026-08-23T00:00:00.000Z" }] } });
    expect(persistedMetadata).toEqual({ searchStatus: donePayload.searchStatus, sources: donePayload.sources, webGrounding: donePayload.webGrounding });
    expect(JSON.stringify(persistedMetadata)).not.toMatch(/Private RAG|private snippet|cascadeUsed/);
    expect(appended.map(({ role, content }) => ({ role, content }))).toEqual([{ role: "user", content: "Привет" }, { role: "assistant", content: "Привет" }]);
    expect(auditChatStream).toHaveBeenCalledWith(expect.objectContaining({ event: "chat_stream.completed", userId: 42, roleId: "fast", provider: "groq", searchAttached: true, sourcesCount: 2 }));
    expect(JSON.stringify(auditChatStream.mock.calls[0][0])).not.toContain("Привет");
    expect(JSON.stringify(auditChatStream.mock.calls[0][0])).not.toContain("example.com");
    expect(streamResponse.end).toHaveBeenCalledOnce();
    expect(order).toEqual(["assistant-saved", "memory-enqueued", "memory-processed", "done", "end"]);
    expect(enqueueMemoryExtractionJob).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, sessionId: validRequestBody.sessionId, userMessageId: 1, assistantMessageId: 2, role: "fast" }));
    expect(processMemoryExtractionJob).toHaveBeenCalledWith(42, 2);
  });

  it("keeps the completed response and closes the stream when post-turn memory work fails", async () => {
    const writes: string[] = [];
    const streamResponse = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn((chunk: string) => writes.push(chunk)), end: vi.fn(), json: vi.fn(),
    }) as unknown as Response;
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Новый разговор" }),
      appendChatMessage: vi.fn().mockResolvedValueOnce({ id: 1, created: true }).mockResolvedValueOnce({ id: 2, created: true }),
      updateChatTitle: vi.fn(), listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow()),
      buildChatContext: vi.fn().mockResolvedValue(context),
      chatWithRoleStream: vi.fn().mockResolvedValue({ content: "Готово", modelUsed: "model", provider: "provider", label: "Модель" }),
      enqueueMemoryExtractionJob: vi.fn().mockRejectedValue(new Error("queue unavailable")),
      processMemoryExtractionJob: vi.fn(), auditChatStream: vi.fn(),
    });

    await handler({ body: validRequestBody } as Request, streamResponse, vi.fn());

    expect(writes.join("")).toContain("event: done");
    expect(streamResponse.end).toHaveBeenCalledOnce();
  });

  it("does not persist a partially streamed assistant reply after the client cancels", async () => {
    const appended: Array<{ role: string; content: string }> = [];
    const streamResponse = response();
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", title: "Обычный разговор" }),
      appendChatMessage: vi.fn(async (_userId, _sessionId, role, content) => { appended.push({ role, content }); }),
      updateChatTitle: vi.fn(), listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow()),
      buildChatContext: vi.fn().mockResolvedValue(context), extractMemoryFacts: vi.fn().mockResolvedValue(undefined),
      chatWithRoleStream: vi.fn(async (_modelId, _history, _settings, onDelta) => { onDelta("Неполный "); (streamResponse as unknown as EventEmitter).emit("close"); throw new DOMException("aborted", "AbortError"); }),
    });

    await handler({ body: validRequestBody } as Request, streamResponse, vi.fn());
    expect(appended).toEqual([{ role: "user", content: "Привет" }]);
    expect(streamResponse.end).not.toHaveBeenCalled();
  });

  it("returns HTTP 400 for an unknown role before any history or provider call", async () => {
    const streamResponse = response();
    const getOwnedChatSession = vi.fn();
    const chatWithRoleStream = vi.fn();
    const handler = createChatStreamHandler({ authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }), getOwnedChatSession, chatWithRoleStream });
    await handler({ body: { ...validRequestBody, modelId: "raw-upstream-model" } } as Request, streamResponse, vi.fn());
    expect(streamResponse.status).toHaveBeenCalledWith(400);
    expect(streamResponse.json).toHaveBeenCalledWith({ error: "Проверьте текст сообщения и выбранную модель." });
    expect(getOwnedChatSession).not.toHaveBeenCalled();
    expect(chatWithRoleStream).not.toHaveBeenCalled();
  });

  it("replays a completed idempotent send without a second model invocation", async () => {
    const request = { ...validRequestBody, clientMessageId: "3b6a41a8-dfb4-4e6b-92ab-0395af0ed1fb" };
    const appendChatMessage = vi.fn()
      .mockResolvedValueOnce({ id: 1, created: true })
      .mockResolvedValueOnce({ id: 2, created: true })
      .mockResolvedValueOnce({ id: 1, created: false });
    const chatWithRoleStream = vi.fn().mockResolvedValue({ content: "Готовый ответ", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant" });
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" }),
      getStoredAssistantForClientMessage: vi.fn().mockResolvedValue(undefined),
      appendChatMessage,
      listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow()),
      buildChatContext: vi.fn().mockResolvedValue(context),
      chatWithRoleStream,
      enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
      processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
      auditChatStream: vi.fn(),
    });

    await handler({ body: request } as Request, response(), vi.fn());
    const replayResponse = response();
    await handler({ body: request } as Request, replayResponse, vi.fn());

    expect(chatWithRoleStream).toHaveBeenCalledOnce();
    expect(appendChatMessage).toHaveBeenCalledTimes(2);
    expect(chatQuota).toHaveBeenCalledTimes(1);
    expect(appendChatMessage.mock.calls[0].at(-1)).toBe(request.clientMessageId);
    expect(replayResponse.write).toHaveBeenCalledWith(expect.stringContaining('"replayed":true'));
    expect(replayResponse.write).toHaveBeenCalledWith(expect.stringContaining("Готовый ответ"));
  });

  it("replays a durably stored idempotent assistant response before quota, history or provider work", async () => {
    const request = { ...validRequestBody, clientMessageId: "33333333-3333-4333-8333-333333333333" };
    const getStoredAssistantForClientMessage = vi.fn().mockResolvedValue({ id: 11, role: "assistant", content: "Сохранённый ответ", modelId: "llama-3.1-8b-instant", metadata: undefined });
    const listSessionTranscriptWindow = vi.fn();
    const chatWithRoleStream = vi.fn();
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" }),
      getStoredAssistantForClientMessage,
      listSessionTranscriptWindow,
      chatWithRoleStream,
    });
    const replayResponse = response();

    await handler({ body: request } as Request, replayResponse, vi.fn());

    expect(replayResponse.status).toHaveBeenCalledWith(200);
    expect(replayResponse.write).toHaveBeenCalledWith(expect.stringContaining("Сохранённый ответ"));
    expect(getStoredAssistantForClientMessage).toHaveBeenCalledWith(42, request.sessionId, request.clientMessageId);
    expect(chatQuota).not.toHaveBeenCalled();
    expect(listSessionTranscriptWindow).not.toHaveBeenCalled();
    expect(chatWithRoleStream).not.toHaveBeenCalled();
  });

  it("rejects an invalid client message UUID before reading chat history", async () => {
    const streamResponse = response();
    const getOwnedChatSession = vi.fn();
    const handler = createChatStreamHandler({ authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }), getOwnedChatSession });
    await handler({ body: { ...validRequestBody, clientMessageId: "not-a-uuid" } } as Request, streamResponse, vi.fn());
    expect(streamResponse.status).toHaveBeenCalledWith(400);
    expect(getOwnedChatSession).not.toHaveBeenCalled();
  });

  it("continues generation with a truthful soft-degradation warning when fresh search is unavailable", async () => {
    const writes: string[] = [];
    const streamResponse = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn((chunk: string) => writes.push(chunk)), end: vi.fn(), json: vi.fn(),
    }) as unknown as Response;
    const appendChatMessage = vi.fn().mockResolvedValue({ id: 1, created: true });
    const chatWithRoleStream = vi.fn(async (_modelId, _history, settings) => {
      expect(settings).toMatchObject({ freshnessWarning: "Свежие источники сейчас недоступны, поэтому я не могу надёжно подтвердить актуальные сведения." });
      return { content: "Свежие источники сейчас недоступны, поэтому я не могу надёжно подтвердить актуальные сведения.", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant" };
    });
    const buildChatContext = vi.fn().mockResolvedValue({ ...context, freshnessWarning: "Свежие источники сейчас недоступны, поэтому я не могу надёжно подтвердить актуальные сведения." });
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Новый разговор" }),
      appendChatMessage,
      updateChatTitle: vi.fn().mockResolvedValue(undefined),
      listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow()),
      buildChatContext,
      chatWithRoleStream,
      enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
      processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
      auditChatStream: vi.fn(),
    });

    await handler({ body: validRequestBody } as Request, streamResponse, vi.fn());

    expect(buildChatContext).toHaveBeenCalledWith(42, validRequestBody.sessionId, expect.objectContaining({
      attachmentIds: undefined,
      query: "Привет",
      role: "fast",
      capacityActor: { userId: 42, requestKey: "stream:42:1" },
    }));
    expect(streamResponse.status).toHaveBeenCalledWith(200);
    expect(chatWithRoleStream).toHaveBeenCalledOnce();
    expect(appendChatMessage).toHaveBeenCalledTimes(2);
    expect(writes.join("")).toContain("event: done");
  });

  it("denies a durable quota-exhausted user before history or provider work", async () => {
    const auditChatStream = vi.fn();
    const getOwnedChatSession = vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" });
    const listSessionTranscriptWindow = vi.fn();
    const chatWithRoleStream = vi.fn();
    chatQuota.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 37 });
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 73 }),
      getOwnedChatSession,
      listSessionTranscriptWindow,
      chatWithRoleStream,
      auditChatStream,
    });

    const limitedResponse = response();
    await handler({ body: validRequestBody } as Request, limitedResponse, vi.fn());

    expect(limitedResponse.status).toHaveBeenCalledWith(429);
    expect(limitedResponse.set).toHaveBeenCalledWith("Retry-After", "37");
    expect(limitedResponse.json).toHaveBeenCalledWith({ error: chatStreamRateLimitMessage("fast") });
    expect(auditChatStream).toHaveBeenLastCalledWith(expect.objectContaining({ event: "chat_stream.rate_limited", userId: 73 }));
    expect(getOwnedChatSession).toHaveBeenCalledOnce();
    expect(listSessionTranscriptWindow).not.toHaveBeenCalled();
    expect(chatWithRoleStream).not.toHaveBeenCalled();
  });

  it("fails closed when durable quota storage is unavailable before history or provider work", async () => {
    const getOwnedChatSession = vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" });
    const listSessionTranscriptWindow = vi.fn();
    const chatWithRoleStream = vi.fn();
    chatQuota.mockRejectedValueOnce(new Error("quota database unavailable"));
    const handler = createChatStreamHandler({ authenticateRequest: vi.fn().mockResolvedValue({ id: 77 }), getOwnedChatSession, listSessionTranscriptWindow, chatWithRoleStream });

    const unavailableResponse = response();
    await handler({ body: validRequestBody } as Request, unavailableResponse, vi.fn());

    expect(unavailableResponse.status).toHaveBeenCalledWith(503);
    expect(unavailableResponse.json).toHaveBeenCalledWith({ error: "Проверка лимита временно недоступна. Повторите попытку позже." });
    expect(listSessionTranscriptWindow).not.toHaveBeenCalled();
    expect(chatWithRoleStream).not.toHaveBeenCalled();
  });

  it("limits per-instance active streams per user before history work and releases capacity after completion", async () => {
    const resolvers: Array<(result: { content: string; modelUsed: string; provider: "groq"; label: string }) => void> = [];
    const chatWithRoleStream = vi.fn().mockImplementation(() => {
      if (resolvers.length < 2) return new Promise((resolve) => { resolvers.push(resolve); });
      return Promise.resolve({ content: "Готово", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Модель" });
    });
    const listSessionTranscriptWindow = vi.fn().mockResolvedValue(transcriptWindow());
    const appendChatMessage = vi.fn().mockResolvedValue({ id: 1, created: true });
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 91 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" }),
      appendChatMessage,
      listSessionTranscriptWindow,
      buildChatContext: vi.fn().mockResolvedValue(context),
      chatWithRoleStream,
      enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
      processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
      auditChatStream: vi.fn(),
    });

    const first = handler({ body: validRequestBody } as Request, response(), vi.fn());
    const second = handler({ body: validRequestBody } as Request, response(), vi.fn());
    await vi.waitFor(() => expect(chatWithRoleStream).toHaveBeenCalledTimes(2));
    const limitedResponse = response();
    await handler({ body: validRequestBody } as Request, limitedResponse, vi.fn());

    expect(limitedResponse.status).toHaveBeenCalledWith(503);
    expect(limitedResponse.json).toHaveBeenCalledWith({ error: "Сервис временно занят. Повторите попытку позже." });
    expect(getChatStreamRuntimeGaugeSnapshot()).toMatchObject({
      scope: "local_process",
      queue: { entered: 0, timedOut: 0, waitSamples: 0 },
      active: { streams: 2, userBuckets: 1 },
      outcomes: { accepted: 2, capacityRejected: 1, perUserCapacityRejected: 1 },
    });
    expect(listSessionTranscriptWindow).toHaveBeenCalledTimes(2);
    expect(appendChatMessage).toHaveBeenCalledTimes(2);

    resolvers.forEach((resolve, index) => resolve({ content: `Ответ ${index + 1}`, modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Модель" }));
    await Promise.all([first, second]);

    const resumedResponse = response();
    await handler({ body: validRequestBody } as Request, resumedResponse, vi.fn());
    expect(resumedResponse.status).toHaveBeenCalledWith(200);
    expect(chatWithRoleStream).toHaveBeenCalledTimes(3);
    const runtime = getChatStreamRuntimeGaugeSnapshot();
    expect(runtime.active).toEqual({ streams: 0, userBuckets: 0 });
    expect(runtime.outcomes).toMatchObject({ accepted: 3, capacityRejected: 1, completed: 3 });
    expect(runtime.samples.count.activeDuration).toBe(3);
    expect(JSON.stringify(runtime)).not.toMatch(/userId|sessionId|content|prompt|response|Привет/);
  });

  it("keeps durable quotas isolated between authenticated users", async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({ id: 81 });
    const chatWithRoleStream = vi.fn().mockResolvedValue({ content: "Готово", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant" });
    chatQuota.mockImplementation(async (userId: number) => userId === 81
      ? { allowed: false, retryAfterSeconds: 11 }
      : { allowed: true, retryAfterSeconds: 0 });
    const handler = createChatStreamHandler({
      authenticateRequest,
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" }),
      appendChatMessage: vi.fn().mockResolvedValue({ id: 1, created: true }), updateChatTitle: vi.fn(),
      listSessionTranscriptWindow: vi.fn().mockResolvedValue(transcriptWindow()),
      buildChatContext: vi.fn().mockResolvedValue(context), enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }), processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
      chatWithRoleStream,
      auditChatStream: vi.fn(),
    });

    const firstUserResponse = response();
    await handler({ body: validRequestBody } as Request, firstUserResponse, vi.fn());
    authenticateRequest.mockResolvedValueOnce({ id: 82 });
    const secondUserResponse = response();
    await handler({ body: validRequestBody } as Request, secondUserResponse, vi.fn());

    expect(firstUserResponse.status).toHaveBeenCalledWith(429);
    expect(secondUserResponse.status).toHaveBeenCalledWith(200);
    expect(chatWithRoleStream).toHaveBeenCalledOnce();
    expect(chatQuota).toHaveBeenNthCalledWith(1, 81, "fast", CHAT_STREAM_RATE_LIMIT, 60_000);
    expect(chatQuota).toHaveBeenNthCalledWith(2, 82, "fast", CHAT_STREAM_RATE_LIMIT, 60_000);
  });
});

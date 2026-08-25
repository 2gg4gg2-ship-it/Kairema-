import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_STREAM_RATE_LIMIT, createChatStreamHandler, resetChatStreamRateLimits } from "./chat-stream";

const context = { style: "default" as const, responseLength: "normal" as const, quickReplies: true, effort: "standard" as const, thinking: false };
const validRequestBody = { sessionId: "550e8400-e29b-41d4-a716-446655440000", modelId: "fast", content: "Привет" };

function response() {
  return Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), json: vi.fn(),
  }) as unknown as Response;
}

describe("chat stream happy-path", () => {
  beforeEach(() => resetChatStreamRateLimits());

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
      updateChatTitle: vi.fn(), listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      buildChatContext: vi.fn().mockResolvedValue(context), enqueueMemoryExtractionJob, processMemoryExtractionJob,
      chatWithRoleStream: vi.fn(async (_modelId, _history, _settings, onDelta) => { onDelta("При"); onDelta("вет"); return { content: "Привет", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant", sources: [{ title: "Официальный источник", url: "https://example.com/fresh", domain: "example.com", publishedAt: "2026-08-23T00:00:00.000Z" }], evidence: [{ sourceUrl: "https://example.com/evidence", excerpt: "private snippet" }], ragSources: [{ title: "Private RAG", url: "https://example.com/rag", publishedAt: "2026-08-19T00:00:00.000Z" }], searchStatus: { cascadeUsed: "you", state: "found", verificationStatus: "verified", sourcesCount: 2 } }; }),
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
    expect(donePayload).toEqual({ content: "Привет", modelUsed: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", searchStatus: { state: "found", verificationStatus: "verified", sourcesCount: 2, sourceDateMin: "2026-08-19T00:00:00.000Z", sourceDateMax: "2026-08-23T00:00:00.000Z" }, sources: [{ title: "Официальный источник", url: "https://example.com/fresh", publishedAt: "2026-08-23T00:00:00.000Z" }] });
    expect(persistedMetadata).toEqual({ searchStatus: donePayload.searchStatus, sources: donePayload.sources });
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
      updateChatTitle: vi.fn(), listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
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
      updateChatTitle: vi.fn(), listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
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
      appendChatMessage,
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
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
    expect(appendChatMessage.mock.calls[0].at(-1)).toBe(request.clientMessageId);
    expect(replayResponse.write).toHaveBeenCalledWith(expect.stringContaining('"replayed":true'));
    expect(replayResponse.write).toHaveBeenCalledWith(expect.stringContaining("Готовый ответ"));
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
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      buildChatContext,
      chatWithRoleStream,
      enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }),
      processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
      auditChatStream: vi.fn(),
    });

    await handler({ body: validRequestBody } as Request, streamResponse, vi.fn());

    expect(buildChatContext).toHaveBeenCalledWith(42, validRequestBody.sessionId, { attachmentIds: undefined, query: "Привет", role: "fast" });
    expect(streamResponse.status).toHaveBeenCalledWith(200);
    expect(chatWithRoleStream).toHaveBeenCalledOnce();
    expect(appendChatMessage).toHaveBeenCalledTimes(2);
    expect(writes.join("")).toContain("event: done");
  });

  it("limits each authenticated user to 60 stream requests per rolling in-memory minute", async () => {
    const auditChatStream = vi.fn();
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 73 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" }),
      appendChatMessage: vi.fn().mockResolvedValue({ id: 1, created: true }), updateChatTitle: vi.fn(),
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      buildChatContext: vi.fn().mockResolvedValue(context), enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }), processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
      chatWithRoleStream: vi.fn().mockResolvedValue({ content: "Готово", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant" }),
      auditChatStream,
    });

    for (let index = 0; index < CHAT_STREAM_RATE_LIMIT; index += 1) {
      await handler({ body: validRequestBody } as Request, response(), vi.fn());
    }
    const limitedResponse = response();
    await handler({ body: validRequestBody } as Request, limitedResponse, vi.fn());

    expect(limitedResponse.status).toHaveBeenCalledWith(429);
    expect(limitedResponse.set).toHaveBeenCalledWith("Retry-After", "60");
    expect(limitedResponse.json).toHaveBeenCalledWith({ error: "Слишком много запросов. Подождите минуту." });
    expect(auditChatStream).toHaveBeenLastCalledWith(expect.objectContaining({ event: "chat_stream.rate_limited", userId: 73 }));
  });

  it("keeps quotas isolated between authenticated users", async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({ id: 81 });
    const chatWithRoleStream = vi.fn().mockResolvedValue({ content: "Готово", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant" });
    const handler = createChatStreamHandler({
      authenticateRequest,
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" }),
      appendChatMessage: vi.fn().mockResolvedValue({ id: 1, created: true }), updateChatTitle: vi.fn(),
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      buildChatContext: vi.fn().mockResolvedValue(context), enqueueMemoryExtractionJob: vi.fn().mockResolvedValue({ created: true }), processMemoryExtractionJob: vi.fn().mockResolvedValue(undefined),
      chatWithRoleStream,
      auditChatStream: vi.fn(),
    });

    for (let index = 0; index < CHAT_STREAM_RATE_LIMIT; index += 1) {
      await handler({ body: validRequestBody } as Request, response(), vi.fn());
    }
    authenticateRequest.mockResolvedValueOnce({ id: 82 });
    const secondUserResponse = response();
    await handler({ body: validRequestBody } as Request, secondUserResponse, vi.fn());

    expect(secondUserResponse.status).toHaveBeenCalledWith(200);
    expect(chatWithRoleStream).toHaveBeenCalledTimes(CHAT_STREAM_RATE_LIMIT + 1);
  });
});

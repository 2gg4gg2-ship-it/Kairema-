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

  it("emits start, incremental delta and done events before persisting the completed assistant reply", async () => {
    const writes: string[] = [];
    const appended: Array<{ role: string; content: string }> = [];
    const streamResponse = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(), write: vi.fn((chunk: string) => writes.push(chunk)), end: vi.fn(), json: vi.fn(),
    }) as unknown as Response;
    const auditChatStream = vi.fn();
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", title: "Новый разговор" }),
      appendChatMessage: vi.fn(async (_userId, _sessionId, role, content) => { appended.push({ role, content }); }),
      updateChatTitle: vi.fn(), listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      buildChatContext: vi.fn().mockResolvedValue(context), extractMemoryFacts: vi.fn().mockResolvedValue(undefined),
      chatWithRoleStream: vi.fn(async (_modelId, _history, _settings, onDelta) => { onDelta("При"); onDelta("вет"); return { content: "Привет", modelUsed: "llama-3.1-8b-instant", provider: "groq", label: "Llama 3.1 8B Instant" }; }),
      auditChatStream,
    });

    await handler({ body: validRequestBody } as Request, streamResponse, vi.fn());

    expect(writes.join("")).toContain("event: start");
    expect(writes.join("")).toContain('event: delta\ndata: {"content":"При"}');
    expect(writes.join("")).toContain('event: delta\ndata: {"content":"вет"}');
    expect(writes.join("")).toContain("event: done");
    expect(appended).toEqual([{ role: "user", content: "Привет" }, { role: "assistant", content: "Привет" }]);
    expect(auditChatStream).toHaveBeenCalledWith(expect.objectContaining({ event: "chat_stream.completed", userId: 42, roleId: "fast", provider: "groq" }));
    expect(JSON.stringify(auditChatStream.mock.calls[0][0])).not.toContain("Привет");
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

  it("limits each authenticated user to 60 stream requests per rolling in-memory minute", async () => {
    const auditChatStream = vi.fn();
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 73 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: validRequestBody.sessionId, title: "Обычный разговор" }),
      appendChatMessage: vi.fn(), updateChatTitle: vi.fn(),
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      buildChatContext: vi.fn().mockResolvedValue(context), extractMemoryFacts: vi.fn().mockResolvedValue(undefined),
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
      appendChatMessage: vi.fn(), updateChatTitle: vi.fn(),
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      buildChatContext: vi.fn().mockResolvedValue(context), extractMemoryFacts: vi.fn().mockResolvedValue(undefined),
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

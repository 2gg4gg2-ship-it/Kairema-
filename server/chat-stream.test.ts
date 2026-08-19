import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createChatStreamHandler } from "./chat-stream";

describe("chat stream happy-path", () => {
  it("emits start, incremental delta and done events before persisting the completed assistant reply", async () => {
    const writes: string[] = [];
    const appended: Array<{ role: string; content: string }> = [];
    const response = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => writes.push(chunk)),
      end: vi.fn(),
      json: vi.fn(),
    }) as unknown as Response;
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", title: "Новый разговор" }),
      appendChatMessage: vi.fn(async (_userId, _sessionId, role, content) => {
        appended.push({ role, content });
      }),
      updateChatTitle: vi.fn(),
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      chatWithRoleStream: vi.fn(async (_modelId, _history, _settings, onDelta) => {
        onDelta("При");
        onDelta("вет");
        return { content: "Привет", modelUsed: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" };
      }),
    });

    await handler(
      { body: { sessionId: "550e8400-e29b-41d4-a716-446655440000", modelId: "fast", content: "Привет" } } as Request,
      response,
      vi.fn(),
    );

    expect(writes.join("")).toContain("event: start");
    expect(writes.join("")).toContain('event: delta\ndata: {"content":"При"}');
    expect(writes.join("")).toContain('event: delta\ndata: {"content":"вет"}');
    expect(writes.join("")).toContain("event: done");
    expect(appended).toEqual([{ role: "user", content: "Привет" }, { role: "assistant", content: "Привет" }]);
    expect(response.end).toHaveBeenCalledOnce();
  });

  it("does not persist a partially streamed assistant reply after the client cancels", async () => {
    const appended: Array<{ role: string; content: string }> = [];
    const response = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      json: vi.fn(),
    }) as unknown as Response;
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession: vi.fn().mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", title: "Обычный разговор" }),
      appendChatMessage: vi.fn(async (_userId, _sessionId, role, content) => {
        appended.push({ role, content });
      }),
      updateChatTitle: vi.fn(),
      listSessionMessages: vi.fn().mockResolvedValue([{ role: "user", content: "Привет" }]),
      chatWithRoleStream: vi.fn(async (_modelId, _history, _settings, onDelta) => {
        onDelta("Неполный ");
        (response as unknown as EventEmitter).emit("close");
        throw new DOMException("aborted", "AbortError");
      }),
    });

    await handler(
      { body: { sessionId: "550e8400-e29b-41d4-a716-446655440000", modelId: "fast", content: "Привет" } } as Request,
      response,
      vi.fn(),
    );

    expect(appended).toEqual([{ role: "user", content: "Привет" }]);
    expect(response.end).not.toHaveBeenCalled();
  });

  it("returns HTTP 400 for an unknown role before any history or provider call", async () => {
    const response = Object.assign(new EventEmitter(), {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }) as unknown as Response;
    const getOwnedChatSession = vi.fn();
    const chatWithRoleStream = vi.fn();
    const handler = createChatStreamHandler({
      authenticateRequest: vi.fn().mockResolvedValue({ id: 42 }),
      getOwnedChatSession,
      chatWithRoleStream,
    });

    await handler(
      { body: { sessionId: "550e8400-e29b-41d4-a716-446655440000", modelId: "raw-upstream-model", content: "Привет" } } as Request,
      response,
      vi.fn(),
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: "Проверьте текст сообщения и выбранную модель." });
    expect(getOwnedChatSession).not.toHaveBeenCalled();
    expect(chatWithRoleStream).not.toHaveBeenCalled();
  });
});

import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { appendChatMessage, getOwnedChatSession, listSessionMessages, updateChatTitle } from "./db";
import { sdk } from "./_core/sdk";
import { MODEL_IDS, chatWithRoleStream, publicChatError } from "./providers";
import { buildChatContext, extractMemoryFacts } from "./chat-context";

const streamInputSchema = z.object({
  sessionId: z.string().uuid(),
  modelId: z.enum(MODEL_IDS),
  content: z.string().trim().min(1).max(16_000),
  regenerateMessageId: z.number().int().positive().optional(),
  settings: z.object({ style: z.enum(["default", "professional", "friendly", "concise", "steps"]).optional() }).optional(),
  attachmentIds: z.array(z.string().uuid()).max(4).optional(),
  webSearch: z.boolean().optional(),
});

export function writeEvent(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function historyError(error: unknown) {
  return error instanceof Error && /чат|хранилище/i.test(error.message)
    ? "История чата временно недоступна. Повторите попытку позже."
    : "Не удалось подготовить потоковый ответ. Повторите попытку позже.";
}

type StreamDependencies = {
  authenticateRequest: (request: Request) => Promise<{ id: number } | null>;
  getOwnedChatSession: typeof getOwnedChatSession;
  appendChatMessage: typeof appendChatMessage;
  updateChatTitle: typeof updateChatTitle;
  listSessionMessages: typeof listSessionMessages;
  chatWithRoleStream: typeof chatWithRoleStream;
  buildChatContext: typeof buildChatContext;
  extractMemoryFacts: typeof extractMemoryFacts;
};

const defaultDependencies: StreamDependencies = {
  authenticateRequest: async (request) => sdk.authenticateRequest(request) as Promise<{ id: number }>,
  getOwnedChatSession,
  appendChatMessage,
  updateChatTitle,
  listSessionMessages,
  chatWithRoleStream,
  buildChatContext,
  extractMemoryFacts,
};

export function createChatStreamHandler(overrides: Partial<StreamDependencies> = {}): RequestHandler {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (req: Request, res: Response) => {
    const user = await dependencies.authenticateRequest(req).catch(() => null);
    if (!user) {
      res.status(401).json({ error: "Войдите, чтобы продолжить разговор." });
      return;
    }

    const parsed = streamInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Проверьте текст сообщения и выбранную модель." });
      return;
    }

    const input = parsed.data;
    try {
      const session = await dependencies.getOwnedChatSession(user.id, input.sessionId);
      if (!session) throw new Error("Чат не найден или недоступен.");
      const storedSettings = await dependencies.buildChatContext(user.id, input.sessionId, { attachmentIds: input.attachmentIds, webSearch: input.webSearch, query: input.content });
      const effectiveSettings = { ...storedSettings, ...(input.settings?.style ? { style: input.settings.style } : {}) };
      let history;
      if (input.regenerateMessageId) {
        const currentHistory = await dependencies.listSessionMessages(user.id, input.sessionId);
        const targetIndex = currentHistory.findIndex((message) => message.id === input.regenerateMessageId && message.role === "assistant");
        const promptIndex = targetIndex < 0 ? -1 : currentHistory.slice(0, targetIndex).map((message) => message.role).lastIndexOf("user");
        if (promptIndex < 0) throw new Error("Исходный запрос для регенерации не найден.");
        history = currentHistory.slice(0, targetIndex);
      } else {
        await dependencies.appendChatMessage(user.id, input.sessionId, "user", input.content, input.modelId);
        if (session.title === "Новый разговор") await dependencies.updateChatTitle(user.id, input.sessionId, input.content.slice(0, 72));
        history = await dependencies.listSessionMessages(user.id, input.sessionId);
      }

      res.status(200);
      res.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      const controller = new AbortController();
      let closed = false;
      let finished = false;
      res.on("close", () => {
        if (!finished) {
          closed = true;
          controller.abort();
        }
      });
      writeEvent(res, "start", { sessionId: input.sessionId, regenerated: Boolean(input.regenerateMessageId) });

      try {
        const result = await dependencies.chatWithRoleStream(
          input.modelId,
          history.map((message) => ({ role: message.role, content: message.content })),
          effectiveSettings,
          (delta: string) => {
            if (!closed) writeEvent(res, "delta", { content: delta });
          },
          controller.signal,
        );
        if (!closed) {
          await dependencies.appendChatMessage(user.id, input.sessionId, "assistant", result.content, result.modelUsed, result.sources?.length ? JSON.stringify({ sources: result.sources }) : undefined);
          if (!input.regenerateMessageId) await dependencies.extractMemoryFacts(user.id, input.content).catch(() => undefined);
          writeEvent(res, "done", result);
          finished = true;
          res.end();
        }
      } catch (error) {
        if (!closed) {
          writeEvent(res, "error", { message: publicChatError(input.modelId, error) });
          finished = true;
          res.end();
        }
      }
    } catch (error) {
      res.status(400).json({ error: historyError(error) });
    }
  };
}

export function registerChatStreamRoute(app: Express) {
  app.post("/api/chat/stream", createChatStreamHandler());
}

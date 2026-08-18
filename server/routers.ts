import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { appendChatMessage, createChatSession, getOwnedChatSession, listChatSessions, listSessionMessages, updateChatTitle } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { MODEL_IDS, chatWithOpenRouter, getModelViews, publicChatError } from "./providers";

const settingsSchema = z.object({
  style: z.enum(["default", "professional", "friendly", "concise", "steps"]).optional(),
}).optional();

const modelIdSchema = z.enum(MODEL_IDS);

function storageError(error: unknown) {
  return error instanceof Error && /чат|хранилище/i.test(error.message)
    ? error.message
    : "История чата временно недоступна. Повторите попытку позже.";
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  models: router({
    list: publicProcedure.query(() => getModelViews()),
  }),
  chats: router({
    list: protectedProcedure.query(({ ctx }) => listChatSessions(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({ modelId: modelIdSchema }))
      .mutation(({ ctx, input }) => createChatSession(ctx.user.id, input.modelId)),
    messages: protectedProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        try {
          return await listSessionMessages(ctx.user.id, input.sessionId);
        } catch (error) {
          throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
        }
      }),
    rename: protectedProcedure
      .input(z.object({ sessionId: z.string().uuid(), title: z.string().trim().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        try {
          await updateChatTitle(ctx.user.id, input.sessionId, input.title);
          return { success: true } as const;
        } catch (error) {
          throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
        }
      }),
    send: protectedProcedure
      .input(z.object({
        sessionId: z.string().uuid(),
        modelId: modelIdSchema,
        content: z.string().trim().min(1).max(16_000),
        settings: settingsSchema,
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const session = await getOwnedChatSession(ctx.user.id, input.sessionId);
          if (!session) throw new Error("Чат не найден или недоступен.");
          await appendChatMessage(ctx.user.id, input.sessionId, "user", input.content, input.modelId);
          if (session.title === "Новый разговор") await updateChatTitle(ctx.user.id, input.sessionId, input.content.slice(0, 72));
          const history = await listSessionMessages(ctx.user.id, input.sessionId);
          const result = await chatWithOpenRouter(input.modelId, history.map((message) => ({ role: message.role, content: message.content })), input.settings);
          await appendChatMessage(ctx.user.id, input.sessionId, "assistant", result.content, result.modelUsed);
          return result;
        } catch (error) {
          if (error instanceof Error && /чат|хранилище/i.test(error.message)) {
            throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
          }
          throw new TRPCError({ code: "BAD_REQUEST", message: publicChatError(input.modelId, error) });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;

import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { appendChatMessage, createChatExportRecord, createChatSession, deleteOwnedChatExport, getOwnedChatExport, getOwnedChatSession, listChatExports, listChatSessions, listSessionMessages, updateChatTitle } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { MODEL_IDS, chatWithRole, getModelViews, publicChatError } from "./providers";
import { storageGetSignedUrl, storagePut } from "./storage";

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
          const result = await chatWithRole(input.modelId, history.map((message) => ({ role: message.role, content: message.content })), input.settings);
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
  exports: router({
    list: protectedProcedure.query(({ ctx }) => listChatExports(ctx.user.id)),
    create: protectedProcedure.input(z.object({
      sessionId: z.string().uuid(),
      format: z.enum(["markdown", "pdf"]),
      fileName: z.string().trim().min(1).max(255),
      contentType: z.string().trim().min(1).max(128),
      contentBase64: z.string().min(1).max(4_300_000),
    })).mutation(async ({ ctx, input }) => {
      try {
        const extension = input.format === "pdf" ? "pdf" : "md";
        const bytes = Buffer.from(input.contentBase64, "base64");
        if (!bytes.length || bytes.length > 3_000_000) throw new Error("Размер экспортируемого файла превышает допустимый предел.");
        const id = randomUUID();
        const { key } = await storagePut(`exports/${ctx.user.id}/${id}.${extension}`, bytes, input.contentType);
        return await createChatExportRecord(ctx.user.id, { id, sessionId: input.sessionId, fileKey: key, fileName: input.fileName, format: input.format, contentType: input.contentType, byteSize: bytes.length });
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error && /размер/i.test(error.message) ? error.message : "Не удалось сохранить экспорт. Повторите попытку позже." });
      }
    }),
    download: protectedProcedure.input(z.object({ exportId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const record = await getOwnedChatExport(ctx.user.id, input.exportId);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Экспорт не найден или недоступен." });
      return { fileName: record.fileName, url: await storageGetSignedUrl(record.fileKey) };
    }),
    delete: protectedProcedure.input(z.object({ exportId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const deleted = await deleteOwnedChatExport(ctx.user.id, input.exportId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Экспорт не найден или недоступен." });
      return { success: true } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;

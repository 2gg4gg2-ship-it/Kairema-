import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { appendChatMessage, clearMemory, createChatExportRecord, createChatSession, createMemoryFact, deleteAllOwnedChatExports, deleteMemoryFact, deleteOwnedChatAttachment, deleteOwnedChatExport, deleteOwnedChatSession, getFlashTtftStats, getMemoryProfile, getOwnedChatExport, getOwnedChatSession, getUserSettings, listChatExports, listChatSessions, listMemoryFacts, listSessionAttachments, listSessionMessages, searchUserContent, updateChatTitle, updateMemoryFact, updateMemoryProfile, updateUserSettings } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { MODEL_IDS, chatWithRole, getModelViews, getPublicProviderDashboard, publicChatError } from "./providers";
import { storageGetSignedUrl, storagePut } from "./storage";
import { getOwnedAttachmentDownload, uploadOwnedChatAttachment } from "./attachments";
import { buildChatContext, extractMemoryFacts } from "./chat-context";
import { getWebSearchStatus, probeWebSearchStatus } from "./web-search";
import { getKnowledgeAudit, getKnowledgeStatus, refreshKnowledgeBase } from "./knowledge";

const settingsSchema = z.object({
  style: z.enum(["default", "professional", "friendly", "concise", "steps"]).optional(),
  responseLength: z.enum(["brief", "balanced", "detailed"]).optional(),
  effort: z.enum(["low", "standard", "high"]).optional(),
  thinking: z.boolean().optional(),
  toolAccess: z.boolean().optional(),
}).optional();

const modelIdSchema = z.enum(MODEL_IDS);

const userSettingsSchema = z.object({
  language: z.enum(["ru", "en"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  responseStyle: z.enum(["default", "professional", "friendly", "concise", "steps"]).optional(),
  responseLength: z.enum(["brief", "balanced", "detailed"]).optional(),
  quickReplies: z.boolean().optional(),
  effort: z.enum(["low", "standard", "high"]).optional(),
  thinking: z.boolean().optional(),
  defaultRole: z.enum(MODEL_IDS).optional(),
  webSearch: z.boolean().optional(),
  toolAccess: z.boolean().optional(),
  healthRefreshSeconds: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
});

const attachmentInputSchema = z.object({
  sessionId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown"]),
  contentBase64: z.string().min(1).max(11_200_000),
});

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
  providers: router({
    dashboard: protectedProcedure.query(() => getPublicProviderDashboard()),
  }),
  owner: router({
    isOwner: protectedProcedure.query(({ ctx }) => Boolean(ENV.ownerOpenId && ctx.user.openId === ENV.ownerOpenId)),
    flashTtft: protectedProcedure.query(async ({ ctx }) => {
      if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) throw new TRPCError({ code: "FORBIDDEN", message: "Панель производительности доступна только владельцу." });
      return getFlashTtftStats();
    }),
  }),
  settings: router({
    get: protectedProcedure.query(({ ctx }) => getUserSettings(ctx.user.id)),
    update: protectedProcedure.input(userSettingsSchema).mutation(async ({ ctx, input }) => {
      const { quickReplies, thinking, webSearch, toolAccess, ...rest } = input;
      return updateUserSettings(ctx.user.id, {
        ...rest,
        ...(quickReplies === undefined ? {} : { quickReplies: quickReplies ? 1 : 0 }),
        ...(thinking === undefined ? {} : { thinking: thinking ? 1 : 0 }),
        ...(webSearch === undefined ? {} : { webSearch: webSearch ? 1 : 0 }),
        ...(toolAccess === undefined ? {} : { toolAccess: toolAccess ? 1 : 0 }),
      });
    }),
  }),
  memory: router({
    get: protectedProcedure.query(async ({ ctx }) => ({ profile: await getMemoryProfile(ctx.user.id), facts: await listMemoryFacts(ctx.user.id) })),
    update: protectedProcedure.input(z.object({ enabled: z.boolean().optional(), autoExtract: z.boolean().optional(), profile: z.string().max(5_000).optional() })).mutation(async ({ ctx, input }) => {
      const { enabled, autoExtract, ...rest } = input;
      return updateMemoryProfile(ctx.user.id, {
        ...rest,
        ...(enabled === undefined ? {} : { enabled: enabled ? 1 : 0 }),
        ...(autoExtract === undefined ? {} : { autoExtract: autoExtract ? 1 : 0 }),
      });
    }),
    addFact: protectedProcedure.input(z.object({ fact: z.string().trim().min(3).max(280) })).mutation(async ({ ctx, input }) => {
      const fact = await createMemoryFact(ctx.user.id, input.fact);
      if (!fact) throw new TRPCError({ code: "CONFLICT", message: "Такой факт уже есть в памяти." });
      return fact;
    }),
    updateFact: protectedProcedure.input(z.object({ factId: z.string().uuid(), fact: z.string().trim().min(3).max(280) })).mutation(async ({ ctx, input }) => {
      const fact = await updateMemoryFact(ctx.user.id, input.factId, input.fact);
      if (!fact) throw new TRPCError({ code: "NOT_FOUND", message: "Факт не найден, недоступен или конфликтует с существующим." });
      return fact;
    }),
    deleteFact: protectedProcedure.input(z.object({ factId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!await deleteMemoryFact(ctx.user.id, input.factId)) throw new TRPCError({ code: "NOT_FOUND", message: "Факт не найден или недоступен." });
      return { success: true } as const;
    }),
    clear: protectedProcedure.mutation(async ({ ctx }) => {
      await clearMemory(ctx.user.id);
      return { success: true } as const;
    }),
  }),
  search: router({
    query: protectedProcedure.input(z.object({ query: z.string().trim().min(2).max(120) })).query(({ ctx, input }) => searchUserContent(ctx.user.id, input.query)),
  }),
  webSearch: router({
    status: protectedProcedure.query(async () => getWebSearchStatus()),
    probe: protectedProcedure.mutation(async () => probeWebSearchStatus()),
  }),
  knowledge: router({
    status: protectedProcedure.query(async () => getKnowledgeStatus()),
    audit: protectedProcedure.query(async () => getKnowledgeAudit()),
    refresh: protectedProcedure.mutation(async () => {
      const current = await getKnowledgeStatus();
      const latest = current.runs[0];
      if (latest && Date.now() - latest.startedAt.getTime() < 60_000) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Обновление уже выполнялось недавно. Повторите через минуту." });
      }
      return refreshKnowledgeBase("manual");
    }),
  }),
  attachments: router({
    list: protectedProcedure.input(z.object({ sessionId: z.string().uuid() })).query(({ ctx, input }) => listSessionAttachments(ctx.user.id, input.sessionId)),
    upload: protectedProcedure.input(attachmentInputSchema).mutation(async ({ ctx, input }) => {
      try {
        return await uploadOwnedChatAttachment(ctx.user.id, input);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Не удалось загрузить вложение." });
      }
    }),
    download: protectedProcedure.input(z.object({ attachmentId: z.string().uuid() })).query(async ({ ctx, input }) => {
      try {
        return await getOwnedAttachmentDownload(ctx.user.id, input.attachmentId);
      } catch (error) {
        throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "Вложение не найдено или недоступно." });
      }
    }),
    delete: protectedProcedure.input(z.object({ attachmentId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!await deleteOwnedChatAttachment(ctx.user.id, input.attachmentId)) throw new TRPCError({ code: "NOT_FOUND", message: "Вложение не найдено или недоступно." });
      return { success: true } as const;
    }),
  }),
  chats: router({
    list: protectedProcedure.query(({ ctx }) => listChatSessions(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({ modelId: modelIdSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await createChatSession(ctx.user.id, input.modelId);
        } catch (error) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: storageError(error) });
        }
      }),
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
    delete: protectedProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (!await deleteOwnedChatSession(ctx.user.id, input.sessionId)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
        }
        return { success: true } as const;
      }),
    send: protectedProcedure
      .input(z.object({
        sessionId: z.string().uuid(),
        modelId: modelIdSchema,
        content: z.string().trim().min(1).max(16_000),
        settings: settingsSchema,
        attachmentIds: z.array(z.string().uuid()).max(4).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const session = await getOwnedChatSession(ctx.user.id, input.sessionId);
          if (!session) throw new Error("Чат не найден или недоступен.");
          await appendChatMessage(ctx.user.id, input.sessionId, "user", input.content, input.modelId);
          if (session.title === "Новый разговор") await updateChatTitle(ctx.user.id, input.sessionId, input.content.slice(0, 72));
          const history = await listSessionMessages(ctx.user.id, input.sessionId);
          const storedSettings = await buildChatContext(ctx.user.id, input.sessionId, { attachmentIds: input.attachmentIds, query: input.content, role: input.modelId });
          const result = await chatWithRole(input.modelId, history.map((message) => ({ role: message.role, content: message.content })), { ...storedSettings, ...input.settings });
          const sourceMetadata = result.sources?.length || result.ragSources?.length
            ? JSON.stringify({ ...(result.sources?.length ? { sources: result.sources } : {}), ...(result.ragSources?.length ? { ragSources: result.ragSources } : {}) })
            : undefined;
          await appendChatMessage(ctx.user.id, input.sessionId, "assistant", result.content, result.modelUsed, sourceMetadata);
          await extractMemoryFacts(ctx.user.id, input.content).catch(() => undefined);
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
    deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
      const deletedCount = await deleteAllOwnedChatExports(ctx.user.id);
      return { success: true, deletedCount } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;

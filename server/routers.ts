import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { appendChatMessage, clearAllMemory, clearMemory, clearMemoryByCategory, createChatSession, deleteMemoryEntry, deleteOwnedChatAttachment, deleteOwnedChatSession, enqueueMemoryExtractionJob, getFlashTtftStats, getFlashTtftTrend, getMemoryProfile, getMemorySettings, getOwnedChatSession, getSearchOutageSummary, getSearchQualityChart, getSearchQualityPanel, getUserSettings, listChatSessions, listMemoryEntries, listSessionAttachments, listSessionMessages, searchUserContent, updateChatTitle, updateMemoryProfile, updateMemorySettings, updateUserSettings, upsertMemoryEntry } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { MODEL_IDS, chatWithRole, getModelViews, getPublicProviderDashboard, publicChatError } from "./providers";
import { getOwnedAttachmentDownload, uploadOwnedChatAttachment } from "./attachments";
import { buildChatContext, processMemoryExtractionJob } from "./chat-context";
import { getWebSearchStatus, probeWebSearchStatus } from "./web-search";
import { getKnowledgeAudit, getKnowledgeStatus, refreshKnowledgeBase } from "./knowledge";
import { ownerClaimFingerprint } from "./owner-claim";

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
  effort: z.enum(["low", "standard", "high"]).optional(),
  thinking: z.boolean().optional(),
  defaultRole: z.enum(MODEL_IDS).optional(),
  webSearch: z.boolean().optional(),
  toolAccess: z.boolean().optional(),
  healthRefreshSeconds: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(60)]).optional(),
  highContrast: z.boolean().optional(),
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
    claimDiagnostic: protectedProcedure.query(({ ctx }) => ({
      comparedClaim: "openId" as const,
      configured: Boolean(ENV.ownerOpenId),
      expectedFingerprint: ownerClaimFingerprint(ENV.ownerOpenId),
      sessionFingerprint: ownerClaimFingerprint(ctx.user.openId),
      matches: Boolean(ENV.ownerOpenId && ctx.user.openId === ENV.ownerOpenId),
    })),
    flashTtft: protectedProcedure.query(async ({ ctx }) => {
      if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) throw new TRPCError({ code: "FORBIDDEN", message: "Панель производительности доступна только владельцу." });
      return getFlashTtftStats();
    }),
    flashTtftTrend: protectedProcedure.input(z.object({ days: z.union([z.literal(7), z.literal(30)]) })).query(async ({ ctx, input }) => {
      if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) throw new TRPCError({ code: "FORBIDDEN", message: "Панель производительности доступна только владельцу." });
      return getFlashTtftTrend(input.days);
    }),
    searchOutages: protectedProcedure.query(async ({ ctx }) => {
      if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) throw new TRPCError({ code: "FORBIDDEN", message: "Журнал поиска доступен только владельцу." });
      return getSearchOutageSummary();
    }),
  }),
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const { quickReplies: _legacyQuickReplies, ...settings } = await getUserSettings(ctx.user.id);
      return settings;
    }),
    update: protectedProcedure.input(userSettingsSchema).mutation(async ({ ctx, input }) => {
      const { thinking, webSearch, toolAccess, highContrast, ...rest } = input;
      return updateUserSettings(ctx.user.id, {
        ...rest,
        ...(thinking === undefined ? {} : { thinking: thinking ? 1 : 0 }),
        ...(webSearch === undefined ? {} : { webSearch: webSearch ? 1 : 0 }),
        ...(toolAccess === undefined ? {} : { toolAccess: toolAccess ? 1 : 0 }),
        ...(highContrast === undefined ? {} : { highContrast: highContrast ? 1 : 0 }),
      });
    }),
  }),
  memory: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const [settings, profile, facts, topics] = await Promise.all([
        getMemorySettings(ctx.user.id), getMemoryProfile(ctx.user.id), listMemoryEntries(ctx.user.id, "fact"), listMemoryEntries(ctx.user.id, "dialog_topic"),
      ]);
      return { settings, profile, facts, topics };
    }),
    update: protectedProcedure.input(z.object({ enabled: z.boolean().optional(), autoExtract: z.boolean().optional(), profile: z.string().max(5_000).optional() })).mutation(async ({ ctx, input }) => {
      const { enabled, autoExtract, ...rest } = input;
      const [settings, profile] = await Promise.all([
        updateMemorySettings(ctx.user.id, { ...(enabled === undefined ? {} : { enabled: enabled ? 1 : 0 }), ...(autoExtract === undefined ? {} : { autoExtract: autoExtract ? 1 : 0 }) }),
        updateMemoryProfile(ctx.user.id, rest),
      ]);
      return { settings, profile };
    }),
    addFact: protectedProcedure.input(z.object({ fact: z.string().trim().min(3).max(280) })).mutation(async ({ ctx, input }) => {
      const fact = await upsertMemoryEntry(ctx.user.id, "fact", input.fact, { source: "manual" });
      if (!fact) throw new TRPCError({ code: "CONFLICT", message: "Такой факт уже есть в памяти." });
      return fact;
    }),
    listEntries: protectedProcedure.input(z.object({ category: z.enum(["profile", "fact", "dialog_topic"]) })).query(({ ctx, input }) => listMemoryEntries(ctx.user.id, input.category)),
    addEntry: protectedProcedure.input(z.object({ category: z.enum(["profile", "fact", "dialog_topic"]), value: z.string().trim().min(3).max(500) })).mutation(async ({ ctx, input }) => {
      if (input.category === "dialog_topic") throw new TRPCError({ code: "BAD_REQUEST", message: "Темы диалога формируются только после завершённого ответа." });
      const entry = await upsertMemoryEntry(ctx.user.id, input.category, input.value, { source: "manual" });
      if (!entry) throw new TRPCError({ code: "CONFLICT", message: "Такая запись уже есть в памяти." });
      return entry;
    }),
    deleteEntry: protectedProcedure.input(z.object({ entryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!await deleteMemoryEntry(ctx.user.id, input.entryId)) throw new TRPCError({ code: "NOT_FOUND", message: "Запись памяти не найдена или недоступна." });
      return { success: true } as const;
    }),
    clearCategory: protectedProcedure.input(z.object({ category: z.enum(["profile", "fact", "dialog_topic"]) })).mutation(async ({ ctx, input }) => {
      await clearMemoryByCategory(ctx.user.id, input.category);
      return { success: true } as const;
    }),
    clear: protectedProcedure.mutation(async ({ ctx }) => {
      await clearAllMemory(ctx.user.id);
      return { success: true } as const;
    }),
  }),
  search: router({
    query: protectedProcedure.input(z.object({ query: z.string().trim().min(2).max(120) })).query(({ ctx, input }) => searchUserContent(ctx.user.id, input.query)),
    qualityPanel: protectedProcedure.query(async ({ ctx }) => {
      if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) throw new TRPCError({ code: "FORBIDDEN", message: "Панель качества поиска доступна только владельцу." });
      return getSearchQualityPanel();
    }),
    qualityChart: protectedProcedure.query(async ({ ctx }) => {
      if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) throw new TRPCError({ code: "FORBIDDEN", message: "График качества поиска доступен только владельцу." });
      return getSearchQualityChart();
    }),
  }),
  webSearch: router({
    status: protectedProcedure.query(async () => getWebSearchStatus()),
    probe: protectedProcedure.mutation(async () => probeWebSearchStatus()),
  }),
  knowledge: router({
    status: protectedProcedure.query(async () => getKnowledgeStatus()),
    audit: protectedProcedure.query(async ({ ctx }) => getKnowledgeAudit(Boolean(ENV.ownerOpenId && ctx.user.openId === ENV.ownerOpenId))),
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
    list: protectedProcedure.input(z.object({ sessionId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const attachments = await listSessionAttachments(ctx.user.id, input.sessionId);
      return Promise.all(attachments.map(async (attachment) => ({
        ...attachment,
        previewUrl: (await getOwnedAttachmentDownload(ctx.user.id, attachment.id)).url,
      })));
    }),
    upload: protectedProcedure.input(attachmentInputSchema).mutation(async ({ ctx, input }) => {
      try {
        const attachment = await uploadOwnedChatAttachment(ctx.user.id, input);
        return { ...attachment, previewUrl: (await getOwnedAttachmentDownload(ctx.user.id, attachment.id)).url };
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
        const deleted = await deleteOwnedChatSession(ctx.user.id, input.sessionId);
        return { success: true, alreadyDeleted: !deleted } as const;
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
          const attachmentMetadata = input.attachmentIds?.length ? JSON.stringify({ attachmentIds: Array.from(new Set(input.attachmentIds)) }) : undefined;
          const savedUser = await appendChatMessage(ctx.user.id, input.sessionId, "user", input.content, input.modelId, attachmentMetadata);
          if (session.title === "Новый разговор") await updateChatTitle(ctx.user.id, input.sessionId, input.content.slice(0, 72));
          const history = await listSessionMessages(ctx.user.id, input.sessionId);
          const storedSettings = await buildChatContext(ctx.user.id, input.sessionId, { attachmentIds: input.attachmentIds, query: input.content, role: input.modelId });
          const result = await chatWithRole(input.modelId, history.map((message) => ({ role: message.role, content: message.content })), { ...storedSettings, ...input.settings });
          const sourceMetadata = result.sources?.length || result.evidence?.length || result.ragSources?.length || result.searchStatus
            ? JSON.stringify({
              ...(result.sources?.length ? { sources: result.sources } : {}),
              ...(result.evidence?.length ? { evidence: result.evidence } : {}),
              ...(result.ragSources?.length ? { ragSources: result.ragSources } : {}),
              ...(result.searchStatus ? { searchStatus: result.searchStatus } : {}),
            })
            : undefined;
          const savedAssistant = await appendChatMessage(ctx.user.id, input.sessionId, "assistant", result.content, result.modelUsed, sourceMetadata);
          void enqueueMemoryExtractionJob({ userId: ctx.user.id, sessionId: input.sessionId, userMessageId: savedUser.id, assistantMessageId: savedAssistant.id, role: input.modelId })
            .then(() => processMemoryExtractionJob(ctx.user.id, savedAssistant.id)).catch(() => undefined);
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

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { appendChatMessage, clearAllMemory, clearMemory, clearMemoryByCategory, clearOwnedChatDraft, createChatSession, createStytchLinkIntent, deleteAllOwnedChatSessions, deleteMemoryEntry, deleteOwnedChatAttachment, deleteOwnedChatExport, deleteOwnedChatSession, enqueueMemoryExtractionJob, getFlashTtftStats, getFlashTtftTrend, getMemoryProfile, getMemorySettings, getOwnedChatDraft, getOwnedChatSession, getOwnerObservabilitySnapshot, getSearchOutageSummary, getSearchQualityChart, getSearchQualityPanel, getUserSettings, listChatSessions, listMemoryEntries, listOwnedChatExports, listProviderControlFlags, listSessionAttachments, listSessionMessages, recordTechnicalEvent, saveOwnedChatDraft, searchUserContent, updateChatTitle, updateMemoryProfile, updateMemorySettings, updateUserSettings, upsertMemoryEntry, upsertProviderControlFlag } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { clearStytchLinkIntentCookie, clearStytchResetCookie, clearStytchSessionCookie, getStytchCallbackUrl, getStytchClient, getStytchResetToken, getStytchSessionToken, getVerifiedStytchEmail, revokeStytchSessionToken, setStytchLinkIntentCookie, setStytchSessionCookie, STYTCH_PROVIDER, STYTCH_SESSION_DURATION_MINUTES, stytchCanonicalOpenId, toSafeStytchError } from "./stytch";
import { resolveOrCreateProviderUser } from "./db";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { MODEL_IDS, OWNER_CONTROL_TARGETS, chatWithRole, getModelViews, getPublicProviderDashboard, isOwnerControlTarget, publicChatError } from "./providers";
import { getOwnedAttachmentDownload, uploadOwnedChatAttachment } from "./attachments";
import { createPersistentChatExport, getOwnedChatExportDownload } from "./chat-exports";
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

const providerControlSchema = z.object({
  targetKey: z.string().trim().min(1).max(160),
  targetType: z.enum(["provider", "model"]),
  disabled: z.boolean(),
  preference: z.enum(["normal", "prefer", "avoid"]),
});

function requireOwner(ctx: { user: { id: number; openId: string } }) {
  if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Инструменты владельца доступны только владельцу." });
  }
  return ctx.user;
}

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
  emailNotifications: z.boolean().optional(),
});

const attachmentInputSchema = z.object({
  sessionId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown"]),
  contentBase64: z.string().min(1).max(11_200_000),
});

const stytchCredentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(256),
});
const stytchEmailSchema = z.object({ email: z.string().trim().email().max(320) });

function stytchErrorToTrpc(error: unknown) {
  const safe = toSafeStytchError(error);
  if (safe.safeCode === "UNAVAILABLE") {
    return new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Вход через защищённый email временно недоступен. Повторите попытку позже." });
  }
  return new TRPCError({ code: "UNAUTHORIZED", message: "Не удалось подтвердить email или пароль. Проверьте данные либо используйте восстановление пароля." });
}

async function resolveVerifiedStytchUser(user: { user_id: string; emails: { email: string; verified: boolean }[]; name?: { first_name?: string | null } | null }) {
  const verifiedEmail = getVerifiedStytchEmail(user);
  if (!verifiedEmail) return null;
  return resolveOrCreateProviderUser({
    provider: STYTCH_PROVIDER,
    providerSubject: user.user_id,
    canonicalOpenId: stytchCanonicalOpenId(user.user_id),
    verifiedEmail,
    displayName: user.name?.first_name ?? null,
    loginMethod: "stytch-password",
  });
}

function storageError(error: unknown) {
  return error instanceof Error && /чат|хранилище/i.test(error.message)
    ? error.message
    : "История чата временно недоступна. Повторите попытку позже.";
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      await revokeStytchSessionToken(getStytchSessionToken(ctx.req));
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      clearStytchSessionCookie(ctx.res, ctx.req);
      clearStytchResetCookie(ctx.res, ctx.req);
      clearStytchLinkIntentCookie(ctx.res, ctx.req);
      return { success: true } as const;
    }),
    stytch: router({
      register: publicProcedure.input(stytchCredentialsSchema).mutation(async ({ input }) => {
        try {
          await getStytchClient().passwords.create({ email: input.email, password: input.password });
          const callbackUrl = getStytchCallbackUrl();
          await getStytchClient().magicLinks.email.loginOrCreate({ email: input.email, locale: "en", login_magic_link_url: callbackUrl, signup_magic_link_url: callbackUrl });
          return { state: "VERIFICATION_REQUIRED" as const };
        } catch (error) {
          throw stytchErrorToTrpc(error);
        }
      }),
      resendVerification: publicProcedure.input(stytchEmailSchema).mutation(async ({ input }) => {
        try {
          const callbackUrl = getStytchCallbackUrl();
          await getStytchClient().magicLinks.email.loginOrCreate({ email: input.email, locale: "en", login_magic_link_url: callbackUrl, signup_magic_link_url: callbackUrl });
        } catch (error) {
          if (toSafeStytchError(error).safeCode === "UNAVAILABLE") throw stytchErrorToTrpc(error);
        }
        // Deliberately generic to avoid account enumeration.
        return { state: "DELIVERY_REQUESTED" as const };
      }),
      login: publicProcedure.input(stytchCredentialsSchema).mutation(async ({ ctx, input }) => {
        try {
          const result = await getStytchClient().passwords.authenticate({
            email: input.email,
            password: input.password,
            session_duration_minutes: STYTCH_SESSION_DURATION_MINUTES,
          });
          const canonicalUser = await resolveVerifiedStytchUser(result.user);
          if (!canonicalUser) {
            await revokeStytchSessionToken(result.session_token);
            const callbackUrl = getStytchCallbackUrl();
            await getStytchClient().magicLinks.email.loginOrCreate({ email: input.email, locale: "en", login_magic_link_url: callbackUrl, signup_magic_link_url: callbackUrl });
            return { state: "VERIFICATION_REQUIRED" as const };
          }
          setStytchSessionCookie(ctx.res, ctx.req, result.session_token);
          ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
          return { state: "SIGNED_IN" as const };
        } catch (error) {
          throw stytchErrorToTrpc(error);
        }
      }),
      requestPasswordReset: publicProcedure.input(stytchEmailSchema).mutation(async ({ input }) => {
        try {
          const callbackUrl = getStytchCallbackUrl();
          await getStytchClient().passwords.email.resetStart({ email: input.email, locale: "en", reset_password_redirect_url: callbackUrl, login_redirect_url: callbackUrl });
        } catch (error) {
          if (toSafeStytchError(error).safeCode === "UNAVAILABLE") throw stytchErrorToTrpc(error);
        }
        return { state: "DELIVERY_REQUESTED" as const };
      }),
      completePasswordReset: publicProcedure.input(z.object({ password: z.string().min(8).max(256) })).mutation(async ({ ctx, input }) => {
        const providerResetToken = getStytchResetToken(ctx.req);
        if (!providerResetToken) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ссылка для восстановления истекла или уже использована. Запросите новую." });
        }
        try {
          const result = await getStytchClient().passwords.email.reset({
            token: providerResetToken,
            password: input.password,
            session_duration_minutes: STYTCH_SESSION_DURATION_MINUTES,
          });
          const canonicalUser = await resolveVerifiedStytchUser(result.user);
          if (!canonicalUser) {
            await revokeStytchSessionToken(result.session_token);
            throw new TRPCError({ code: "FORBIDDEN", message: "Подтвердите email по ссылке провайдера, затем войдите снова." });
          }
          setStytchSessionCookie(ctx.res, ctx.req, result.session_token);
          ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
          clearStytchResetCookie(ctx.res, ctx.req);
          return { state: "SIGNED_IN" as const };
        } catch (error) {
          clearStytchResetCookie(ctx.res, ctx.req);
          if (error instanceof TRPCError) throw error;
          throw stytchErrorToTrpc(error);
        }
      }),
      beginLink: protectedProcedure.input(stytchEmailSchema).mutation(async ({ ctx, input }) => {
        try {
          const linkIntent = await createStytchLinkIntent(ctx.user.id);
          const callbackUrl = getStytchCallbackUrl();
          await getStytchClient().magicLinks.email.loginOrCreate({ email: input.email, locale: "en", login_magic_link_url: callbackUrl, signup_magic_link_url: callbackUrl });
          // No user ID is stored in the browser: callback re-verifies the
          // source session, then atomically consumes its server-bound intent.
          setStytchLinkIntentCookie(ctx.res, ctx.req, linkIntent);
        } catch (error) {
          if (toSafeStytchError(error).safeCode === "UNAVAILABLE") throw stytchErrorToTrpc(error);
        }
        return { state: "LINK_CONFIRMATION_REQUESTED" as const };
      }),
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
    observability: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return getOwnerObservabilitySnapshot();
    }),
    providerControls: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return listProviderControlFlags();
    }),
    providerControlTargets: protectedProcedure.query(({ ctx }) => {
      requireOwner(ctx);
      return OWNER_CONTROL_TARGETS;
    }),
    updateProviderControl: protectedProcedure.input(providerControlSchema).mutation(async ({ ctx, input }) => {
      const owner = requireOwner(ctx);
      if (!isOwnerControlTarget(input.targetType, input.targetKey)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Недопустимая цель управления провайдером." });
      }
      const control = await upsertProviderControlFlag({ ...input, actorUserId: owner.id });
      await recordTechnicalEvent({ kind: "owner_flag", title: input.disabled ? "Кандидат отключён владельцем" : "Настройка кандидата обновлена", code: `${input.targetType}:${input.targetKey}`, actorUserId: owner.id });
      return control;
    }),
  }),
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const { quickReplies: _legacyQuickReplies, ...settings } = await getUserSettings(ctx.user.id);
      return settings;
    }),
    update: protectedProcedure.input(userSettingsSchema).mutation(async ({ ctx, input }) => {
      const { thinking, webSearch, toolAccess, highContrast, emailNotifications, ...rest } = input;
      return updateUserSettings(ctx.user.id, {
        ...rest,
        ...(thinking === undefined ? {} : { thinking: thinking ? 1 : 0 }),
        ...(webSearch === undefined ? {} : { webSearch: webSearch ? 1 : 0 }),
        ...(toolAccess === undefined ? {} : { toolAccess: toolAccess ? 1 : 0 }),
        ...(highContrast === undefined ? {} : { highContrast: highContrast ? 1 : 0 }),
        ...(emailNotifications === undefined ? {} : { emailNotifications: emailNotifications ? 1 : 0 }),
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
      try {
        const attachments = await listSessionAttachments(ctx.user.id, input.sessionId);
        return Promise.all(attachments.map(async (attachment) => ({
          ...attachment,
          previewUrl: (await getOwnedAttachmentDownload(ctx.user.id, attachment.id)).url,
        })));
      } catch (error) {
        throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
      }
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
  exports: router({
    list: protectedProcedure.input(z.object({ sessionId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
      try {
        return await listOwnedChatExports(ctx.user.id, input?.sessionId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
      }
    }),
    create: protectedProcedure.input(z.object({ sessionId: z.string().uuid(), format: z.enum(["markdown", "pdf"]) })).mutation(async ({ ctx, input }) => {
      try {
        return await createPersistentChatExport(ctx.user.id, input);
      } catch (error) {
        if (error instanceof Error && /чат не найден|недоступен/i.test(error.message)) throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Не удалось подготовить экспорт." });
      }
    }),
    download: protectedProcedure.input(z.object({ exportId: z.string().uuid() })).query(async ({ ctx, input }) => {
      try {
        return await getOwnedChatExportDownload(ctx.user.id, input.exportId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Экспорт не найден или недоступен." });
      }
    }),
    delete: protectedProcedure.input(z.object({ exportId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!await deleteOwnedChatExport(ctx.user.id, input.exportId)) throw new TRPCError({ code: "NOT_FOUND", message: "Экспорт не найден или недоступен." });
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
    draft: protectedProcedure.input(z.object({ sessionId: z.string().uuid() })).query(async ({ ctx, input }) => {
      try {
        return await getOwnedChatDraft(ctx.user.id, input.sessionId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
      }
    }),
    saveDraft: protectedProcedure.input(z.object({ sessionId: z.string().uuid(), content: z.string().max(16_000) })).mutation(async ({ ctx, input }) => {
      try {
        return await saveOwnedChatDraft(ctx.user.id, input.sessionId, input.content);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
      }
    }),
    clearDraft: protectedProcedure.input(z.object({ sessionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      try {
        return await clearOwnedChatDraft(ctx.user.id, input.sessionId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
      }
    }),
    rename: protectedProcedure
      .input(z.object({ sessionId: z.string().uuid(), title: z.string().trim().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        try {
          if (!await updateChatTitle(ctx.user.id, input.sessionId, input.title)) throw new Error("Чат не найден или недоступен.");
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
    clearAll: protectedProcedure
      .mutation(async ({ ctx }) => {
        const deletedCount = await deleteAllOwnedChatSessions(ctx.user.id);
        return { success: true, deletedCount } as const;
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
          // Make the post-turn topic durable before this non-stream response is
          // returned. The durable job still owns retry recovery if extraction
          // itself has a soft failure.
          try {
            await enqueueMemoryExtractionJob({ userId: ctx.user.id, sessionId: input.sessionId, userMessageId: savedUser.id, assistantMessageId: savedAssistant.id, role: input.modelId });
            await processMemoryExtractionJob(ctx.user.id, savedAssistant.id);
          } catch {
            // A completed answer must remain usable when optional extraction fails.
          }
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

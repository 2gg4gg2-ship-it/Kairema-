import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { appendChatMessage, clearAllMemory, clearMemory, clearMemoryByCategory, clearOwnedChatDraft, createChatSession, createStytchLinkIntent, deleteAllOwnedChatSessions, deleteMemoryEntry, deleteOwnedChatAttachment, deleteOwnedChatExport, deleteOwnedChatSession, deleteOwnedFailedUserMessage, deleteUserProviderConfig, enqueueMemoryExtractionJob, getFlashTtftStats, getFlashTtftTrend, getMemoryProfile, getMemorySettings, getOwnedChatDraft, getOwnedChatSession, getOwnerDashboardSummary, getOwnerObservabilitySnapshot, getSearchOutageSummary, getSearchQualityChart, getSearchQualityPanel, getUserProviderConfig, getUserSettings, listChatSessions, listMemoryEntries, listOwnedChatExports, listProviderControlFlags, listSessionAttachments, listSessionMessages, listSessionMessagesPage, listSessionTranscriptWindow, listUserProviderConfigs, recordTechnicalEvent, saveOwnedChatDraft, searchUserContent, setActiveUserProvider, setUserProviderActiveModel, updateChatTitle, updateMemoryProfile, updateMemorySettings, updateUserName, updateUserProfileDetails, updateUserSettings, upsertMemoryEntry, upsertProviderControlFlag, upsertUserProviderConfig } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { clearStytchLinkIntentCookie, clearStytchOtpEmailIdCookie, clearStytchPasswordRecoveryEmailCookie, clearStytchPasswordSessionCookie, clearStytchResetCookie, clearStytchSessionCookie, getSafeStytchDeliveryFailure, getStytchCallbackUrl, getStytchClient, getStytchOtpEmailId, getStytchPasswordRecoveryEmail, getStytchPasswordSessionToken, getStytchResetToken, getStytchSessionToken, getVerifiedStytchEmail, logSafeStytchDiagnostic, revokeStytchSessionToken, setStytchLinkIntentCookie, setStytchOtpEmailIdCookie, setStytchPasswordRecoveryEmailCookie, setStytchPasswordSessionCookie, setStytchSessionCookie, STYTCH_PROVIDER, STYTCH_SESSION_DURATION_MINUTES, stytchCanonicalOpenId, toSafeStytchError } from "./stytch";
import Stytch, { StytchError } from "stytch";
import { resolveOrCreateProviderUser } from "./db";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, guestProcedure, userOrGuestProcedure } from "./_core/trpc";
import { ENV } from "./_core/env";
import { MODEL_IDS, MODEL_ROLES, OWNER_CONTROL_TARGETS, PUBLIC_DASHBOARD_PROVIDERS, chatWithRole, getModelViews, getPublicProviderDashboard, isOwnerControlTarget, publicChatError } from "./providers";
import { getOwnedAttachmentDownload, uploadOwnedChatAttachment } from "./attachments";
import { createPersistentChatExport, getOwnedChatExportDownload } from "./chat-exports";
import { buildChatContext, processMemoryExtractionJob } from "./chat-context";
import { getWebGroundedRuntimeGaugeSnapshot, getWebSearchStatus, probeWebSearchStatus } from "./web-search";
import { getKnowledgeAudit, getKnowledgeStatus, refreshKnowledgeBase } from "./knowledge";
import { ownerClaimFingerprint, isOwnerAccount, isOwnerConfigured } from "./owner-access";
import { CHAT_STREAM_RATE_LIMIT, CHAT_STREAM_RATE_WINDOW_SECONDS, getChatStreamRuntimeGaugeSnapshot } from "./chat-stream";
import { getCapacityControllerSnapshot, getCapacityPolicy, listCapacityProviderBudgets, updateCapacityPolicy, updateCapacityProviderBudget } from "./capacity-controller";
import { promoteGuest, clearGuestCookie } from "./_core/guest-session";
import { GUEST_COOKIE_NAME } from "@shared/const";
import { decryptUserProviderSecret, encryptUserProviderSecret, isUserProviderKeyEncryptionConfigured, userProviderKeyHint, UserProviderKeyConfigurationError, UserProviderKeyDecryptionError } from "./user-provider-secrets";
import { builtInUserProviderTarget, customUserProviderTarget, isCustomUserProviderId, listUserProviderModels, listUserProviders, newCustomUserProviderId, readyUserProvider, verifyUserProviderKey, UserProviderError, UserProviderNotImplementedError } from "./user-providers";
import { MAX_ENDPOINT_URL_LENGTH, MAX_PROVIDER_NAME_LENGTH, UserProviderEndpointError } from "./user-provider-endpoints";

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

const positiveCapacityValue = z.number().int().min(1).max(100_000);
const capacityPolicySchema = z.object({
  enabled: z.boolean().optional(),
  globalGenerationWcuLimit: positiveCapacityValue.nullable().optional(),
  globalSearchWcuLimit: positiveCapacityValue.nullable().optional(),
  globalGenerationConcurrency: z.number().int().min(1).max(128).nullable().optional(),
  globalSearchConcurrency: z.number().int().min(1).max(64).nullable().optional(),
  globalGenerationInflightWcuLimit: positiveCapacityValue.nullable().optional(),
  perUserGenerationWcuLimit: positiveCapacityValue.optional(),
  perUserSearchWcuLimit: positiveCapacityValue.optional(),
  perUserGenerationConcurrency: z.number().int().min(1).max(12).optional(),
  perUserSearchConcurrency: z.number().int().min(1).max(6).optional(),
  apexPressureReservePercent: z.number().int().min(0).max(80).optional(),
  roleWeights: z.object({ fast: z.number().int().min(1).max(32), smart: z.number().int().min(1).max(32), context: z.number().int().min(1).max(32), flagship: z.number().int().min(1).max(32) }).optional(),
  modifierWeights: z.object({ thinking: z.number().int().min(1).max(32), vision: z.number().int().min(1).max(32), detailed: z.number().int().min(1).max(32), highEffort: z.number().int().min(1).max(32), webResearch: z.number().int().min(1).max(32) }).optional(),
  queueMaxWaitMs: z.number().int().min(0).max(1_500).optional(),
  queueMaxDepth: z.number().int().min(0).max(64).optional(),
  queueEligibleRoles: z.array(z.literal("fast")).max(1).optional(),
  reservationTtlSeconds: z.number().int().min(30).max(900).optional(),
  degradationMode: z.enum(["normal", "elevated", "high", "critical", "exhausted"]).optional(),
}).strict();
const capacityProviderBudgetSchema = z.object({
  provider: z.enum(PUBLIC_DASHBOARD_PROVIDERS),
  modelId: z.string().trim().min(1).max(160).nullable().optional(),
  enabled: z.boolean().optional(),
  generationWcuLimit: positiveCapacityValue.nullable().optional(),
  maxConcurrent: positiveCapacityValue.nullable().optional(),
  rpmLimit: positiveCapacityValue.nullable().optional(),
  tpmLimit: positiveCapacityValue.nullable().optional(),
  dailyUnitsLimit: positiveCapacityValue.nullable().optional(),
  dailyRequestLimit: positiveCapacityValue.nullable().optional(),
  dailyTokenLimit: positiveCapacityValue.nullable().optional(),
  resetWindow: z.string().trim().min(1).max(96).nullable().optional(),
  cooldownState: z.enum(["unknown", "inherit_provider_health", "cooldown"]).optional(),
  roleEligibility: z.array(z.enum(["fast", "smart", "context", "flagship"])).max(4).nullable().optional(),
  searchEligibility: z.enum(["unknown", "eligible", "not_eligible"]).optional(),
  eligibilityState: z.enum(["unknown", "eligible", "not_eligible", "paid_required"]).optional(),
  billingState: z.enum(["unknown", "free", "paid", "not_configured"]).optional(),
  billingSafe: z.boolean().nullable().optional(),
  quotaState: z.enum(["unknown", "operator_configured"]).optional(),
}).strict();

/**
 * The single server-side owner gate.
 *
 * Every owner route funnels through here, and the decision itself lives in `isOwnerAccount`, which
 * is also what grants the `admin` role on sign-in. The two therefore cannot disagree: an account
 * that reaches the owner dashboard is exactly the account that satisfies `adminProcedure`.
 *
 * It reads only the authenticated context user and server-side configuration. A guest, an
 * unauthenticated caller, a different email, or a deployment with no `OWNER_EMAIL` all fail here.
 */
function requireOwner<T extends { id: number; openId: string; email?: string | null }>(ctx: { user: T | null | undefined }): T {
  if (!isOwnerAccount(ctx.user ?? undefined)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Инструменты владельца доступны только владельцу." });
  }
  return ctx.user as T;
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
  askClarifyingQuestions: z.boolean().optional(),
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

function stytchResetErrorToTrpc(error: unknown) {
  if (error instanceof StytchError) {
    if (error.error_type === "invalid_email" || error.status_code === 400) {
      return new TRPCError({ code: "BAD_REQUEST", message: "Некорректный или неизвестный email." });
    }
    if (error.error_type === "rate_limited" || error.status_code === 429) {
      return new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Слишком много запросов на восстановление пароля. Подождите перед повторной попыткой." });
    }
    if (error.error_type === "invalid_redirect_url" || error.error_type === "callback_url_rejected") {
      return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Ошибка конфигурации ссылки восстановления. Обратитесь к администратору." });
    }
    if (error.status_code === 408 || error.status_code >= 500) {
      return new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Сервис восстановления пароля временно недоступен. Повторите попытку позже." });
    }
  }
  const safe = toSafeStytchError(error);
  if (safe.safeCode === "UNAVAILABLE") {
    return new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Сервис восстановления пароля временно недоступен. Повторите попытку позже." });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Ошибка восстановления пароля. Повторите попытку позже." });
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

/**
 * The public shape of a saved provider. The encrypted envelope and the plaintext key are
 * deliberately absent from this type, so no procedure can return them by accident.
 */
function publicUserProviderConfig(row: { provider: string; activeModel: string; keyHint: string; updatedAt: Date; displayName?: string | null; baseUrl?: string | null; modelsEndpoint?: string | null }) {
  return {
    provider: row.provider,
    activeModel: row.activeModel,
    keyHint: row.keyHint,
    updatedAt: row.updatedAt.toISOString(),
    displayName: row.displayName ?? null,
    baseUrl: row.baseUrl ?? null,
    modelsEndpoint: row.modelsEndpoint ?? null,
  };
}

/**
 * Resolves a row that the caller must own. Looking it up by (ctx user, provider) means a
 * provider belonging to somebody else is reported as missing rather than decrypted.
 */
async function requireOwnedUserProviderConfig(userId: number, provider: string) {
  const config = await getUserProviderConfig(userId, provider);
  if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Этот провайдер ещё не подключён." });
  return config;
}

/** A typed key is used as-is when supplied; otherwise the caller's own stored key is used. */
async function resolveUserProviderKeyInput(userId: number, provider: string, apiKey?: string) {
  if (apiKey) return apiKey;
  const config = await requireOwnedUserProviderConfig(userId, provider);
  return decryptUserProviderSecret(config.encryptedApiKey);
}

/**
 * Produces the HTTP target for either a built-in provider or one the user defined.
 *
 * A custom provider is resolved from the caller's own row, so its URL is re-validated on every
 * use and never taken from the request that is being served. When the user is still typing a
 * new provider, `draft` carries the not-yet-saved values; nothing from a draft is ever stored
 * as a side effect of asking for a catalog or a connection check.
 */
async function resolveUserProviderTarget(userId: number, provider: string, draft?: { baseUrl?: string; modelsEndpoint?: string; displayName?: string }) {
  if (isCustomUserProviderId(provider)) {
    const saved = await getUserProviderConfig(userId, provider);
    const baseUrl = saved?.baseUrl ?? draft?.baseUrl;
    if (!saved && !baseUrl) throw new TRPCError({ code: "NOT_FOUND", message: "Этот провайдер ещё не добавлен." });
    const displayName = saved?.displayName ?? draft?.displayName ?? "Мой провайдер";
    return customUserProviderTarget({ id: provider, displayName, baseUrl: baseUrl!, modelsEndpoint: saved?.modelsEndpoint ?? draft?.modelsEndpoint });
  }
  // Unsaved draft values are ignored for a built-in provider: its endpoints are code-owned.
  return builtInUserProviderTarget(readyUserProvider(provider));
}

/** Provider problems reach the client as their fixed, already-sanitised text. */
function userProviderTrpcError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof UserProviderNotImplementedError) return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  if (error instanceof UserProviderKeyConfigurationError) return new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  // A stored envelope that no longer opens is a recoverable per-user condition, not a server fault.
  if (error instanceof UserProviderKeyDecryptionError) return new TRPCError({ code: "BAD_REQUEST", message: "Сохранённый API-ключ не удалось расшифровать. Укажите ключ заново." });
  // An unsafe or malformed endpoint is the user's own input, not a provider failure.
  if (error instanceof UserProviderEndpointError) return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  if (error instanceof UserProviderError) return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Не удалось выполнить операцию с провайдером. Повторите попытку позже." });
}

const userProviderIdSchema = z.string().trim().min(1).max(32);
const userProviderKeySchema = z.string().trim().min(8).max(400);
const userProviderDraftSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_PROVIDER_NAME_LENGTH).optional(),
  baseUrl: z.string().trim().min(1).max(MAX_ENDPOINT_URL_LENGTH).optional(),
  modelsEndpoint: z.string().trim().min(1).max(MAX_ENDPOINT_URL_LENGTH).optional(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    updateName: protectedProcedure
      .input(z.object({ name: z.string().trim().max(120) }))
      .mutation(async ({ ctx, input }) => {
        // Scoped to the caller's own row only; a client-supplied userId is never accepted.
        await updateUserName(ctx.user.id, input.name || null);
        return { name: input.name || null };
      }),
    /**
     * The address form and the personal preferences. Separate from `updateName` on purpose: the
     * full name and the form of address are two different answers to two different questions, and
     * one save must never overwrite the other. Scoped to the caller's own row; a client-supplied
     * userId is never accepted, and neither value is ever read back into a prompt.
     */
    updateProfileDetails: protectedProcedure
      .input(z.object({
        preferredName: z.string().trim().max(120).optional(),
        personalPreferences: z.string().trim().max(4000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const preferredName = input.preferredName === undefined ? undefined : input.preferredName || null;
        const personalPreferences = input.personalPreferences === undefined ? undefined : input.personalPreferences || null;
        await updateUserProfileDetails(ctx.user.id, { preferredName, personalPreferences });
        return { preferredName: preferredName ?? null, personalPreferences: personalPreferences ?? null };
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      await revokeStytchSessionToken(getStytchSessionToken(ctx.req));
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      clearStytchSessionCookie(ctx.res, ctx.req);
      clearStytchResetCookie(ctx.res, ctx.req);
      clearStytchLinkIntentCookie(ctx.res, ctx.req);
      return { success: true } as const;
    }),
    promoteGuest: guestProcedure
      .input(z.object({ email: z.string().trim().email().max(320), name: z.string().max(120).optional(), loginMethod: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const result = await promoteGuest({ guestUserId: ctx.user.id, email: input.email, name: input.name ?? null, loginMethod: input.loginMethod });
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Guest session not found or already promoted." });
        // Clear guest cookie after promotion
        clearGuestCookie(ctx.res, ctx.req);
        return { success: true, openId: result.openId };
      }),
    stytch: router({
      register: publicProcedure.input(stytchCredentialsSchema).mutation(async ({ ctx, input }) => {
        try {
          const createResult = await getStytchClient().passwords.create({ email: input.email, password: input.password });
          const otpResult = await getStytchClient().otps.email.send({
            email: input.email,
            expiration_minutes: 10,
            session_token: createResult.session_token,
          });
          setStytchOtpEmailIdCookie(ctx.res, ctx.req, otpResult.email_id);
          setStytchPasswordSessionCookie(ctx.res, ctx.req, createResult.session_token);
          return { state: "OTP_REQUIRED" as const };
        } catch (error) {
          throw stytchErrorToTrpc(error);
        }
      }),
      resendVerification: publicProcedure.input(stytchEmailSchema).mutation(async ({ input }) => {
        try {
          const callbackUrl = getStytchCallbackUrl();
          await getStytchClient().magicLinks.email.loginOrCreate({ email: input.email, locale: "en", login_magic_link_url: callbackUrl, signup_magic_link_url: callbackUrl });
        } catch (error) {
          const deliveryFailure = getSafeStytchDeliveryFailure(error);
          try {
            // Best-effort operational telemetry. It never receives request data
            // or provider identifiers, and cannot alter the public response.
            await recordTechnicalEvent({ kind: "provider", title: "Stytch verification delivery request rejected", code: deliveryFailure });
          } catch {
            // Observability must not affect an anti-enumeration auth flow.
          }
          // Keep the pre-observability availability decision exactly aligned
          // with the established provider error normalizer.
          if (toSafeStytchError(error).safeCode === "UNAVAILABLE") throw stytchErrorToTrpc(error);
        }
// Deliberately generic to avoid account enumeration.
        return { state: "DELIVERY_REQUESTED" as const };
      }),
      startPasswordRecovery: publicProcedure.input(stytchEmailSchema).mutation(async ({ ctx, input }) => {
        try {
          const otpResult = await getStytchClient().otps.email.send({
            email: input.email,
            expiration_minutes: 10,
          });
          setStytchOtpEmailIdCookie(ctx.res, ctx.req, otpResult.email_id);
          setStytchPasswordRecoveryEmailCookie(ctx.res, ctx.req, input.email);
          console.error("[PASSWORD_RECOVERY_OTP_SENT] status=200");
          return { state: "OTP_REQUIRED" as const };
        } catch (error) {
          if (error instanceof StytchError) {
            console.error(`[PASSWORD_RECOVERY_OTP_ERROR] status_code=${error.status_code} error_type=${error.error_type} request_id=${error.request_id}`);
          }
          logSafeStytchDiagnostic(error, "start_password_recovery");
          throw stytchErrorToTrpc(error);
        }
      }),
      login: publicProcedure.input(stytchCredentialsSchema).mutation(async ({ ctx, input }) => {
        try {
          const result = await getStytchClient().passwords.authenticate({
            email: input.email,
            password: input.password,
            session_duration_minutes: STYTCH_SESSION_DURATION_MINUTES,
          });
          const otpResult = await getStytchClient().otps.email.send({
            email: input.email,
            expiration_minutes: 10,
            session_token: result.session_token,
          });
          setStytchOtpEmailIdCookie(ctx.res, ctx.req, otpResult.email_id);
          setStytchPasswordSessionCookie(ctx.res, ctx.req, result.session_token);
          console.error(`[login] otp_sent emailIdPrefix=${otpResult.email_id?.slice(0,8) ?? "none"} sessionPrefix=${result.session_token?.slice(0,8) ?? "none"}`);
          return { state: "OTP_REQUIRED" as const };
        } catch (error) {
          logSafeStytchDiagnostic(error, "login");
          throw stytchErrorToTrpc(error);
        }
      }),
      verifyOtp: publicProcedure.input(z.object({ code: z.string().min(6).max(6) })).mutation(async ({ ctx, input }) => {
        const emailId = getStytchOtpEmailId(ctx.req);
        const passwordSessionToken = getStytchPasswordSessionToken(ctx.req);
        console.error(`[verifyOtp] entry hasEmailId=${!!emailId} hasPasswordSession=${!!passwordSessionToken} emailIdPrefix=${emailId?.slice(0,8) ?? "none"} sessionPrefix=${passwordSessionToken?.slice(0,8) ?? "none"}`);
        if (!emailId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Запросите код подтверждения." });
        }
        if (!passwordSessionToken) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Сессия пароля истекла. Войдите снова." });
        }
        try {
          const result = await getStytchClient().otps.authenticate({
            method_id: emailId,
            code: input.code,
            session_token: passwordSessionToken,
            session_duration_minutes: STYTCH_SESSION_DURATION_MINUTES,
          });
          console.error(`[verifyOtp] stytch_ok user_id=${result.user.user_id}`);
          const verifiedEmail = getVerifiedStytchEmail(result.user);
          if (!verifiedEmail) {
            await revokeStytchSessionToken(result.session_token);
            clearStytchOtpEmailIdCookie(ctx.res, ctx.req);
            clearStytchPasswordSessionCookie(ctx.res, ctx.req);
            throw new TRPCError({ code: "FORBIDDEN", message: "Email не подтверждён." });
          }
          let canonicalUser;
          try {
            canonicalUser = await resolveOrCreateProviderUser({
              provider: STYTCH_PROVIDER,
              providerSubject: result.user.user_id,
              canonicalOpenId: stytchCanonicalOpenId(result.user.user_id),
              verifiedEmail,
              displayName: result.user.name?.first_name ?? null,
              loginMethod: "stytch-password",
            });
            console.error("[CANONICAL_USER_OK] stage=canonical_user");
          } catch (error) {
            console.error(`[CANONICAL_USER_ERROR] stage=resolve_provider error_name=${error?.constructor?.name ?? "Error"}`);
            throw error;
          }
          if (!canonicalUser) {
            await revokeStytchSessionToken(result.session_token);
            clearStytchOtpEmailIdCookie(ctx.res, ctx.req);
            clearStytchPasswordSessionCookie(ctx.res, ctx.req);
            throw new TRPCError({ code: "FORBIDDEN", message: "Пользователь не найден." });
          }
          setStytchSessionCookie(ctx.res, ctx.req, result.session_token);
          clearStytchOtpEmailIdCookie(ctx.res, ctx.req);
          clearStytchPasswordSessionCookie(ctx.res, ctx.req);
          ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
          return { state: "SIGNED_IN" as const };
        } catch (error) {
          clearStytchOtpEmailIdCookie(ctx.res, ctx.req);
          clearStytchPasswordSessionCookie(ctx.res, ctx.req);
          if (error instanceof StytchError) {
            console.error(`[OTP Verify StytchError] status_code=${error.status_code} error_type=${error.error_type} request_id=${error.request_id} safe_message="Stytch authentication failed"`);
          }
          if (error instanceof TRPCError) throw error;
          throw stytchErrorToTrpc(error);
        }
      }),
      requestPasswordReset: publicProcedure.input(stytchEmailSchema).mutation(async ({ input }) => {
        try {
          const callbackUrl = getStytchCallbackUrl();
          await getStytchClient().passwords.email.resetStart({ email: input.email, locale: "en", reset_password_redirect_url: callbackUrl, login_redirect_url: callbackUrl });
          return { state: "DELIVERY_REQUESTED" as const };
        } catch (error) {
          if (error instanceof StytchError) {
            console.error(`[PASSWORD_RESET_ERROR] status_code=${error.status_code} error_type=${error.error_type} request_id=${error.request_id}`);
          }
          throw stytchResetErrorToTrpc(error);
        }
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
    isOwner: protectedProcedure.query(({ ctx }) => isOwnerAccount(ctx.user ?? undefined)),
    /**
     * Minimal operational summary for the owner.
     *
     * `protectedProcedure` already rejects guests and unauthenticated callers, and `requireOwner`
     * rejects every account that is not the single configured owner, so this is a server-side gate
     * independent of anything the frontend does. The payload is aggregate counts only: no emails,
     * no openIds, no API keys, no BYOK secrets, no session or database credentials, and no owner
     * configuration is echoed back to the client.
     */
    dashboard: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      const summary = await getOwnerDashboardSummary();
      return {
        ...summary,
        quota: {
          limitPerRole: CHAT_STREAM_RATE_LIMIT,
          windowSeconds: CHAT_STREAM_RATE_WINDOW_SECONDS,
          roles: MODEL_IDS.map((roleId) => {
            const role = MODEL_ROLES.find((item) => item.key === roleId);
            return { roleId, label: role?.label ?? roleId };
          }),
        },
      };
    }),
    claimDiagnostic: protectedProcedure.query(({ ctx }) => ({
      comparedClaim: "email" as const,
      configured: isOwnerConfigured(),
      expectedFingerprint: ownerClaimFingerprint(ENV.ownerEmail),
      sessionFingerprint: ownerClaimFingerprint(ctx.user.email),
      matches: isOwnerAccount(ctx.user ?? undefined),
    })),
    flashTtft: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return getFlashTtftStats();
    }),
    flashTtftTrend: protectedProcedure.input(z.object({ days: z.union([z.literal(7), z.literal(30)]) })).query(async ({ ctx, input }) => {
      requireOwner(ctx);
      return getFlashTtftTrend(input.days);
    }),
    searchOutages: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return getSearchOutageSummary();
    }),
    observability: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return {
        ...(await getOwnerObservabilitySnapshot()),
        runtime: getChatStreamRuntimeGaugeSnapshot(),
        webGroundingRuntime: getWebGroundedRuntimeGaugeSnapshot(),
      };
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
    capacitySnapshot: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return getCapacityControllerSnapshot();
    }),
    capacityPolicy: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return getCapacityPolicy();
    }),
    updateCapacityPolicy: protectedProcedure.input(capacityPolicySchema).mutation(async ({ ctx, input }) => {
      const owner = requireOwner(ctx);
      const policy = await updateCapacityPolicy(input);
      await recordTechnicalEvent({ kind: "owner_flag", title: "Политика controller мощности обновлена", code: "capacity-policy", actorUserId: owner.id });
      return policy;
    }),
    capacityProviderBudgets: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return listCapacityProviderBudgets();
    }),
    updateCapacityProviderBudget: protectedProcedure.input(capacityProviderBudgetSchema).mutation(async ({ ctx, input }) => {
      const owner = requireOwner(ctx);
      if (input.modelId && !OWNER_CONTROL_TARGETS.models.includes(`${input.provider}:${input.modelId}`)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Недопустимая цель provider/model budget." });
      }
      const budget = await updateCapacityProviderBudget({
        target: { provider: input.provider, modelId: input.modelId ?? null },
        enabled: input.enabled,
        generationWcuLimit: input.generationWcuLimit,
        maxConcurrent: input.maxConcurrent,
        rpmLimit: input.rpmLimit,
        tpmLimit: input.tpmLimit,
        dailyUnitsLimit: input.dailyUnitsLimit,
        dailyRequestLimit: input.dailyRequestLimit,
        dailyTokenLimit: input.dailyTokenLimit,
        resetWindow: input.resetWindow,
        cooldownState: input.cooldownState,
        roleEligibility: input.roleEligibility,
        searchEligibility: input.searchEligibility,
        eligibilityState: input.eligibilityState,
        billingState: input.billingState,
        billingSafe: input.billingSafe,
        quotaState: input.quotaState,
      });
      await recordTechnicalEvent({ kind: "owner_flag", title: "Provider budget controller обновлён", code: input.modelId ? `model:${input.provider}:${input.modelId}` : `provider:${input.provider}`, actorUserId: owner.id });
      return budget;
    }),
  }),
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const { quickReplies: _legacyQuickReplies, ...settings } = await getUserSettings(ctx.user.id);
      return settings;
    }),
    update: protectedProcedure.input(userSettingsSchema).mutation(async ({ ctx, input }) => {
      const { thinking, webSearch, toolAccess, highContrast, emailNotifications, askClarifyingQuestions, ...rest } = input;
      return updateUserSettings(ctx.user.id, {
        ...rest,
        ...(thinking === undefined ? {} : { thinking: thinking ? 1 : 0 }),
        ...(webSearch === undefined ? {} : { webSearch: webSearch ? 1 : 0 }),
        ...(toolAccess === undefined ? {} : { toolAccess: toolAccess ? 1 : 0 }),
        ...(highContrast === undefined ? {} : { highContrast: highContrast ? 1 : 0 }),
        ...(emailNotifications === undefined ? {} : { emailNotifications: emailNotifications ? 1 : 0 }),
        ...(askClarifyingQuestions === undefined ? {} : { askClarifyingQuestions: askClarifyingQuestions ? 1 : 0 }),
      });
    }),
  }),
  /**
   * BYOK settings. Every procedure is protected, so a guest is rejected before any storage is
   * touched, and each one resolves the owner from the request context: no input carries a
   * userId, and a provider name only ever selects a row that already belongs to the caller.
   */
  userProviders: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const [configs, settings] = await Promise.all([listUserProviderConfigs(ctx.user.id), getUserSettings(ctx.user.id)]);
      return {
        providers: listUserProviders(),
        configs: configs.map(publicUserProviderConfig),
        activeProvider: settings.myApiProvider ?? null,
        storageReady: isUserProviderKeyEncryptionConfigured(),
      };
    }),
    /**
     * Reads the provider's live catalog. A typed key is used when supplied, so a first-time user
     * can browse models before saving. Draft values let a brand-new custom provider be probed
     * before it is stored; nothing from a draft is written as a side effect of asking.
     *
     * This must stay a mutation, never a query: tRPC sends query input in the GET query string,
     * which would put a plaintext API key into the request URL and therefore into proxy and
     * access logs. As a mutation the key travels in the POST body like every other credential
     * in this router.
     */
    models: protectedProcedure.input(z.object({ provider: userProviderIdSchema, apiKey: userProviderKeySchema.optional(), draft: userProviderDraftSchema.optional() })).mutation(async ({ ctx, input }) => {
      try {
        const target = await resolveUserProviderTarget(ctx.user.id, input.provider, input.draft);
        const apiKey = input.apiKey ?? (await resolveUserProviderKeyInput(ctx.user.id, target.id));
        return { models: await listUserProviderModels(target, apiKey) };
      } catch (error) {
        throw userProviderTrpcError(error);
      }
    }),
    /**
     * Creates a provider the user defined. The URL is validated before anything is stored, and
     * the credential is encrypted on the way in, so no plaintext key ever reaches the database.
     */
    createCustom: protectedProcedure.input(z.object({ displayName: z.string().trim().min(1).max(MAX_PROVIDER_NAME_LENGTH), baseUrl: z.string().trim().min(1).max(MAX_ENDPOINT_URL_LENGTH), modelsEndpoint: z.string().trim().max(MAX_ENDPOINT_URL_LENGTH).optional(), apiKey: userProviderKeySchema, activeModel: z.string().trim().min(1).max(191), makeActive: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
      try {
        const apiKey = input.apiKey.trim();
        const provider = newCustomUserProviderId();
        const target = customUserProviderTarget({ id: provider, displayName: input.displayName, baseUrl: input.baseUrl, modelsEndpoint: input.modelsEndpoint });
        // The catalog is read before the row exists, so an unreachable or rejected endpoint can
        // never leave a half-configured provider behind.
        const models = await listUserProviderModels(target, apiKey);
        if (!models.some((model) => model.id === input.activeModel)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Выбранная модель отсутствует в каталоге провайдера. Проверьте подключение и обновите список моделей." });
        }
        const config = await upsertUserProviderConfig({
          userId: ctx.user.id,
          provider,
          activeModel: input.activeModel,
          encryptedApiKey: encryptUserProviderSecret(apiKey),
          keyHint: userProviderKeyHint(apiKey),
          displayName: target.displayName,
          baseUrl: input.baseUrl.trim(),
          modelsEndpoint: input.modelsEndpoint?.trim() || null,
        });
        if (input.makeActive) await setActiveUserProvider(ctx.user.id, provider);
        return publicUserProviderConfig(config!);
      } catch (error) {
        throw userProviderTrpcError(error);
      }
    }),
    /** Replaces the endpoint, name and credential of a provider the caller already owns. */
    updateCustom: protectedProcedure.input(z.object({ provider: userProviderIdSchema, displayName: z.string().trim().min(1).max(MAX_PROVIDER_NAME_LENGTH).optional(), baseUrl: z.string().trim().min(1).max(MAX_ENDPOINT_URL_LENGTH).optional(), modelsEndpoint: z.string().trim().max(MAX_ENDPOINT_URL_LENGTH).optional(), apiKey: userProviderKeySchema, activeModel: z.string().trim().min(1).max(191) })).mutation(async ({ ctx, input }) => {
      try {
        if (!isCustomUserProviderId(input.provider)) throw new TRPCError({ code: "BAD_REQUEST", message: "Этот провайдер не является пользовательским." });
        const existing = await requireOwnedUserProviderConfig(ctx.user.id, input.provider);
        const apiKey = input.apiKey.trim();
        const target = customUserProviderTarget({
          id: input.provider,
          displayName: input.displayName ?? existing.displayName ?? "Мой провайдер",
          baseUrl: input.baseUrl ?? existing.baseUrl ?? "",
          modelsEndpoint: input.modelsEndpoint ?? existing.modelsEndpoint,
        });
        const models = await listUserProviderModels(target, apiKey);
        if (!models.some((model) => model.id === input.activeModel)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Выбранная модель отсутствует в каталоге провайдера. Проверьте подключение и обновите список моделей." });
        }
        const config = await upsertUserProviderConfig({
          userId: ctx.user.id,
          provider: input.provider,
          activeModel: input.activeModel,
          encryptedApiKey: encryptUserProviderSecret(apiKey),
          keyHint: userProviderKeyHint(apiKey),
          displayName: target.displayName,
          baseUrl: (input.baseUrl ?? existing.baseUrl ?? "").trim(),
          modelsEndpoint: (input.modelsEndpoint ?? existing.modelsEndpoint) || null,
        });
        return publicUserProviderConfig(config!);
      } catch (error) {
        throw userProviderTrpcError(error);
      }
    }),
    /** Auth and credit probe only. It runs no inference and never sends a user prompt. */
    test: protectedProcedure.input(z.object({ provider: userProviderIdSchema, apiKey: userProviderKeySchema.optional(), draft: userProviderDraftSchema.optional() })).mutation(async ({ ctx, input }) => {
      try {
        const target = await resolveUserProviderTarget(ctx.user.id, input.provider, input.draft);
        const apiKey = input.apiKey ?? (await resolveUserProviderKeyInput(ctx.user.id, target.id));
        const result = await verifyUserProviderKey(target, apiKey);
        // Metadata only: provider and verdict. The key and the upstream body are never logged.
        console.info("[Kairema BYOK]", JSON.stringify({ event: "byok.connection_test", provider: target.id, result: result.ok ? "success" : "failure", category: result.ok ? null : result.category }));
        return result.ok
          ? ({ ok: true as const, provider: target.id, label: result.label, message: "API-ключ принят провайдером." })
          : ({ ok: false as const, provider: target.id, category: result.category, http: result.http, message: result.message });
      } catch (error) {
        throw userProviderTrpcError(error);
      }
    }),
    /** Requires the key on every save, so a row can never exist without a usable credential. */
    save: protectedProcedure.input(z.object({ provider: userProviderIdSchema, apiKey: userProviderKeySchema, activeModel: z.string().trim().min(1).max(191), makeActive: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
      try {
        if (isCustomUserProviderId(input.provider)) throw new TRPCError({ code: "BAD_REQUEST", message: "Для своего провайдера используйте отдельное сохранение." });
        const target = builtInUserProviderTarget(readyUserProvider(input.provider));
        const apiKey = input.apiKey.trim();
        // The model must exist in the catalog the provider returns right now, so the screen
        // can never persist an invented model id.
        const models = await listUserProviderModels(target, apiKey);
        if (!models.some((model) => model.id === input.activeModel)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Выбранная модель отсутствует в каталоге провайдера. Обновите список моделей." });
        }
        const config = await upsertUserProviderConfig({
          userId: ctx.user.id,
          provider: target.id,
          activeModel: input.activeModel,
          encryptedApiKey: encryptUserProviderSecret(apiKey),
          keyHint: userProviderKeyHint(apiKey),
        });
        if (input.makeActive) await setActiveUserProvider(ctx.user.id, target.id);
        return publicUserProviderConfig(config!);
      } catch (error) {
        throw userProviderTrpcError(error);
      }
    }),
    /**
     * Switches the model of an already connected provider, which is what the My API model picker
     * calls. The saved key is reused, so the client never has to send it again, and the model is
     * checked against the provider's live catalog before it is stored.
     */
    setActiveModel: protectedProcedure.input(z.object({ provider: userProviderIdSchema, activeModel: z.string().trim().min(1).max(191) })).mutation(async ({ ctx, input }) => {
      try {
        const existing = await requireOwnedUserProviderConfig(ctx.user.id, input.provider);
        const target = await resolveUserProviderTarget(ctx.user.id, input.provider);
        // Re-reads the catalog with the caller's own stored credential, so an invented model id
        // can never become the active one.
        const models = await listUserProviderModels(target, decryptUserProviderSecret(existing.encryptedApiKey));
        if (!models.some((model) => model.id === input.activeModel)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Выбранная модель отсутствует в каталоге провайдера. Обновите список моделей." });
        }
        const config = await setUserProviderActiveModel(ctx.user.id, input.provider, input.activeModel);
        return publicUserProviderConfig(config!);
      } catch (error) {
        throw userProviderTrpcError(error);
      }
    }),
    setActive: protectedProcedure.input(z.object({ provider: userProviderIdSchema })).mutation(async ({ ctx, input }) => {
      // Ownership is the only check: a built-in id and a user's own custom row are both valid
      // targets, while somebody else's row is simply not found.
      const config = await requireOwnedUserProviderConfig(ctx.user.id, input.provider);
      if (!isCustomUserProviderId(input.provider)) readyUserProvider(config.provider);
      const settings = await setActiveUserProvider(ctx.user.id, input.provider);
      return { activeProvider: settings.myApiProvider ?? null };
    }),
    remove: protectedProcedure.input(z.object({ provider: userProviderIdSchema })).mutation(async ({ ctx, input }) => {
      await deleteUserProviderConfig(ctx.user.id, input.provider);
      return { removed: true as const, provider: input.provider };
    }),
  }),
  memory: router({
    get: userOrGuestProcedure.query(async ({ ctx }) => {
      const [settings, profile, facts, topics] = await Promise.all([
        getMemorySettings(ctx.user.id), getMemoryProfile(ctx.user.id), listMemoryEntries(ctx.user.id, "fact"), listMemoryEntries(ctx.user.id, "dialog_topic"),
      ]);
      return { settings, profile, facts, topics };
    }),
    update: userOrGuestProcedure.input(z.object({ enabled: z.boolean().optional(), autoExtract: z.boolean().optional(), profile: z.string().max(5_000).optional() })).mutation(async ({ ctx, input }) => {
      const { enabled, autoExtract, ...rest } = input;
      const [settings, profile] = await Promise.all([
        updateMemorySettings(ctx.user.id, { ...(enabled === undefined ? {} : { enabled: enabled ? 1 : 0 }), ...(autoExtract === undefined ? {} : { autoExtract: autoExtract ? 1 : 0 }) }),
        updateMemoryProfile(ctx.user.id, rest),
      ]);
      return { settings, profile };
    }),
    addFact: userOrGuestProcedure.input(z.object({ fact: z.string().trim().min(3).max(280) })).mutation(async ({ ctx, input }) => {
      const fact = await upsertMemoryEntry(ctx.user.id, "fact", input.fact, { source: "manual" });
      if (!fact) throw new TRPCError({ code: "CONFLICT", message: "Такой факт уже есть в памяти." });
      return fact;
    }),
    listEntries: userOrGuestProcedure.input(z.object({ category: z.enum(["profile", "fact", "dialog_topic"]) })).query(({ ctx, input }) => listMemoryEntries(ctx.user.id, input.category)),
    addEntry: userOrGuestProcedure.input(z.object({ category: z.enum(["profile", "fact", "dialog_topic"]), value: z.string().trim().min(3).max(500) })).mutation(async ({ ctx, input }) => {
      if (input.category === "dialog_topic") throw new TRPCError({ code: "BAD_REQUEST", message: "Темы диалога формируются только после завершённого ответа." });
      const entry = await upsertMemoryEntry(ctx.user.id, input.category, input.value, { source: "manual" });
      if (!entry) throw new TRPCError({ code: "CONFLICT", message: "Такая запись уже есть в памяти." });
      return entry;
    }),
    deleteEntry: userOrGuestProcedure.input(z.object({ entryId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      if (!await deleteMemoryEntry(ctx.user.id, input.entryId)) throw new TRPCError({ code: "NOT_FOUND", message: "Запись памяти не найдена или недоступна." });
      return { success: true } as const;
    }),
    clearCategory: userOrGuestProcedure.input(z.object({ category: z.enum(["profile", "fact", "dialog_topic"]) })).mutation(async ({ ctx, input }) => {
      await clearMemoryByCategory(ctx.user.id, input.category);
      return { success: true } as const;
    }),
    clear: userOrGuestProcedure.mutation(async ({ ctx }) => {
      await clearAllMemory(ctx.user.id);
      return { success: true } as const;
    }),
  }),
  search: router({
    query: protectedProcedure.input(z.object({ query: z.string().trim().min(2).max(120) })).query(({ ctx, input }) => searchUserContent(ctx.user.id, input.query)),
    qualityPanel: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return getSearchQualityPanel();
    }),
    qualityChart: protectedProcedure.query(async ({ ctx }) => {
      requireOwner(ctx);
      return getSearchQualityChart();
    }),
  }),
  webSearch: router({
    status: protectedProcedure.query(async () => getWebSearchStatus()),
    probe: protectedProcedure.mutation(async ({ ctx }) => {
      requireOwner(ctx);
      return probeWebSearchStatus();
    }),
  }),
  knowledge: router({
    status: protectedProcedure.query(async () => getKnowledgeStatus()),
    audit: protectedProcedure.query(async ({ ctx }) => getKnowledgeAudit(isOwnerAccount(ctx.user ?? undefined))),
    refresh: protectedProcedure.mutation(async ({ ctx }) => {
      requireOwner(ctx);
      const current = await getKnowledgeStatus();
      const latest = current.runs[0];
      if (latest && Date.now() - latest.startedAt.getTime() < 60_000) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Обновление уже выполнялось недавно. Повторите через минуту." });
      }
      return refreshKnowledgeBase("manual");
    }),
  }),
  attachments: router({
    list: userOrGuestProcedure.input(z.object({ sessionId: z.string().uuid() })).query(async ({ ctx, input }) => {
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
    upload: userOrGuestProcedure.input(attachmentInputSchema).mutation(async ({ ctx, input }) => {
      try {
        const attachment = await uploadOwnedChatAttachment(ctx.user.id, input);
        return { ...attachment, previewUrl: (await getOwnedAttachmentDownload(ctx.user.id, attachment.id)).url };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Не удалось загрузить вложение." });
      }
    }),
    download: userOrGuestProcedure.input(z.object({ attachmentId: z.string().uuid() })).query(async ({ ctx, input }) => {
      try {
        return await getOwnedAttachmentDownload(ctx.user.id, input.attachmentId);
      } catch (error) {
        throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "Вложение не найдено или недоступно." });
      }
    }),
    delete: userOrGuestProcedure.input(z.object({ attachmentId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
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
    list: userOrGuestProcedure.query(({ ctx }) => listChatSessions(ctx.user.id)),
    create: userOrGuestProcedure
      .input(z.object({ modelId: modelIdSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await createChatSession(ctx.user.id, input.modelId);
        } catch (error) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: storageError(error) });
        }
      }),
    messages: userOrGuestProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        try {
          return await listSessionMessages(ctx.user.id, input.sessionId);
        } catch (error) {
          throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
        }
      }),
    /**
     * Removes the question of a turn that produced no answer, from the stored transcript.
     *
     * The client hides a failed question for a short grace period so it can be read and copied, and
     * this is what makes the removal real rather than cosmetic: without it the question comes back
     * on the next page load and is visible to the user from any other client. Ownership is enforced
     * by the caller id in the delete itself, so a session or client id belonging to someone else
     * simply removes nothing. Only the named user message goes — never the session, never the
     * messages around it, and never an assistant reply.
     */
    discardFailedTurn: userOrGuestProcedure
      .input(z.object({ sessionId: z.string().uuid(), clientMessageId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return { removed: await deleteOwnedFailedUserMessage(ctx.user.id, input.sessionId, input.clientMessageId) };
        } catch (error) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: storageError(error) });
        }
      }),
    historyPage: userOrGuestProcedure      .input(z.object({ sessionId: z.string().uuid(), before: z.string().min(1).max(512).optional(), limit: z.number().int().min(1).max(100).default(60) }))
      .query(async ({ ctx, input }) => {
        try {
          console.error("[HISTORY_PAGE]", {
            userId: ctx.user.id,
            sessionId: input.sessionId,
            before: input.before ?? null,
            limit: input.limit,
          });
          return await listSessionMessagesPage(ctx.user.id, input.sessionId, { before: input.before, limit: input.limit });
        } catch (error) {
          console.error("[HISTORY_PAGE_ERROR]", {
            error_name: error?.constructor?.name ?? "Error",
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            userId: ctx.user.id,
            sessionId: input.sessionId,
          });
          if (error instanceof Error && error.message.includes("Курсор истории")) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Некорректный курсор истории." });
          }
          throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
        }
      }),
    draft: userOrGuestProcedure.input(z.object({ sessionId: z.string().uuid() })).query(async ({ ctx, input }) => {
      try {
        return await getOwnedChatDraft(ctx.user.id, input.sessionId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
      }
    }),
    saveDraft: userOrGuestProcedure.input(z.object({ sessionId: z.string().uuid(), content: z.string().max(16_000) })).mutation(async ({ ctx, input }) => {
      try {
        return await saveOwnedChatDraft(ctx.user.id, input.sessionId, input.content);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
      }
    }),
    clearDraft: userOrGuestProcedure.input(z.object({ sessionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      try {
        return await clearOwnedChatDraft(ctx.user.id, input.sessionId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "Чат не найден или недоступен." });
      }
    }),
    rename: userOrGuestProcedure
      .input(z.object({ sessionId: z.string().uuid(), title: z.string().trim().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        try {
          if (!await updateChatTitle(ctx.user.id, input.sessionId, input.title)) throw new Error("Чат не найден или недоступен.");
          return { success: true } as const;
        } catch (error) {
          throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
        }
      }),
    delete: userOrGuestProcedure
      .input(z.object({ sessionId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const deleted = await deleteOwnedChatSession(ctx.user.id, input.sessionId);
        return { success: true, alreadyDeleted: !deleted } as const;
      }),
    clearAll: userOrGuestProcedure
      .mutation(async ({ ctx }) => {
        const deletedCount = await deleteAllOwnedChatSessions(ctx.user.id);
        return { success: true, deletedCount } as const;
      }),
    /**
     * Stores a turn that was answered in the page rather than by the server.
     *
     * A browser-direct call never passes through this process, so nothing would otherwise be
     * written to the transcript and the answer would disappear on the next history load. Only the
     * finished text is accepted — never a key, never a provider response body — and both messages
     * are written to the caller's own session, so this cannot be used to plant content in someone
     * else's conversation.
     */
    persistDirectTurn: userOrGuestProcedure
      .input(z.object({
        sessionId: z.string().uuid(),
        clientMessageId: z.string().uuid(),
        content: z.string().trim().min(1).max(16_000),
        answer: z.string().trim().min(1).max(64_000),
        modelId: z.string().min(1).max(120),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const session = await getOwnedChatSession(ctx.user.id, input.sessionId);
          if (!session) throw new Error("Чат не найден или недоступен.");
          // `modelId` here is the user's own model ("vendor/model"), not a Kairema role. Memory
          // extraction is keyed by role, so the session's own role is what it is filed under.
          const role = session.modelId as "fast" | "smart" | "context" | "flagship";
          const savedUser = await appendChatMessage(ctx.user.id, input.sessionId, "user", input.content, input.modelId, undefined, input.clientMessageId);
          if (session.title === "Новый разговор") await updateChatTitle(ctx.user.id, input.sessionId, input.content.slice(0, 72));
          // A direct answer is attributed to the model the user actually selected, so the history
          // reads the same as a server-rendered one instead of claiming a Kairema role produced it.
          const savedAssistant = await appendChatMessage(ctx.user.id, input.sessionId, "assistant", input.answer, input.modelId, JSON.stringify({ direct: true }));
          try {
            await enqueueMemoryExtractionJob({ userId: ctx.user.id, sessionId: input.sessionId, userMessageId: savedUser.id, assistantMessageId: savedAssistant.id, role });
            await processMemoryExtractionJob(ctx.user.id, savedAssistant.id);
          } catch {
            // A completed answer must remain usable when optional extraction fails.
          }
          return { saved: true };
        } catch (error) {
          if (error instanceof Error && /чат|хранилище/i.test(error.message)) {
            throw new TRPCError({ code: "NOT_FOUND", message: storageError(error) });
          }
          throw new TRPCError({ code: "BAD_REQUEST", message: "Не удалось сохранить ответ." });
        }
      }),
    send: userOrGuestProcedure
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
          const transcript = await listSessionTranscriptWindow(ctx.user.id, input.sessionId, input.modelId, { throughMessageId: savedUser.id });
          const storedSettings = await buildChatContext(ctx.user.id, input.sessionId, {
            attachmentIds: input.attachmentIds,
            query: input.content,
            role: input.modelId,
            capacityActor: { userId: ctx.user.id, requestKey: `message:${ctx.user.id}:${savedUser.id}` },
          });
          const result = await chatWithRole(
            input.modelId,
            transcript.messages.map((message) => ({ role: message.role, content: message.content })),
            { ...storedSettings, ...input.settings },
            { userId: ctx.user.id, requestKey: `message:${ctx.user.id}:${savedUser.id}` },
          );
          const sourceMetadata = result.sources?.length || result.evidence?.length || result.ragSources?.length || result.searchStatus || result.webGrounding
            ? JSON.stringify({
              ...(result.sources?.length ? { sources: result.sources } : {}),
              ...(result.evidence?.length ? { evidence: result.evidence } : {}),
              ...(result.ragSources?.length ? { ragSources: result.ragSources } : {}),
              ...(result.searchStatus ? { searchStatus: result.searchStatus } : {}),
              ...(result.webGrounding ? { webGrounding: result.webGrounding } : {}),
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

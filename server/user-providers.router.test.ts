import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { TrpcContext } from "./_core/context";

const scopedDb = vi.hoisted(() => ({
  listUserProviderConfigs: vi.fn(),
  getUserProviderConfig: vi.fn(),
  upsertUserProviderConfig: vi.fn(),
  deleteUserProviderConfig: vi.fn(),
  setActiveUserProvider: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...scopedDb,
}));

const providerApi = vi.hoisted(() => ({
  listUserProviderModels: vi.fn(),
  verifyUserProviderKey: vi.fn(),
}));

vi.mock("./user-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./user-providers")>()),
  ...providerApi,
}));

import { appRouter, type AppRouter } from "./routers";
import { __resetUserProviderKeyCacheForTests, encryptUserProviderSecret } from "./user-provider-secrets";

process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = "d".repeat(64);
__resetUserProviderKeyCacheForTests();

const KEY = "sk-or-v1-secret-value-9999";
const MODEL = "vendor/model-a";

function configFor(userId: number, provider = "openrouter") {
  return {
    id: userId,
    userId,
    provider,
    activeModel: MODEL,
    encryptedApiKey: encryptUserProviderSecret(KEY),
    keyHint: "••••9999",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function callerFor(userId = 42, isGuest = 0) {
  return appRouter.createCaller({
    user: { id: userId, openId: `user-${userId}`, email: "user@example.com", name: "User", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), isGuest },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

beforeEach(() => {
  __resetUserProviderKeyCacheForTests();
  scopedDb.listUserProviderConfigs.mockReset().mockResolvedValue([]);
  scopedDb.getUserProviderConfig.mockReset().mockResolvedValue(undefined);
  scopedDb.upsertUserProviderConfig.mockReset().mockImplementation(async (input) => configFor(input.userId, input.provider));
  scopedDb.deleteUserProviderConfig.mockReset().mockResolvedValue({ removed: true as const });
  scopedDb.setActiveUserProvider.mockReset().mockImplementation(async (_userId, provider) => ({ myApiProvider: provider ?? null }));
  scopedDb.getUserSettings.mockReset().mockResolvedValue({ myApiProvider: null });
  providerApi.listUserProviderModels.mockReset().mockResolvedValue([{ id: MODEL, name: "Model A" }, { id: "vendor/model-b", name: "Model B" }]);
  providerApi.verifyUserProviderKey.mockReset().mockResolvedValue({ ok: true, label: "kairema" });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("userProviders.list", () => {
  it("scopes stored configs to the caller and never returns the encrypted blob", async () => {
    scopedDb.listUserProviderConfigs.mockResolvedValue([configFor(42)]);
    const result = await callerFor(42).userProviders.list();
    expect(scopedDb.listUserProviderConfigs).toHaveBeenCalledWith(42);
    expect(result.configs).toEqual([{ provider: "openrouter", activeModel: MODEL, keyHint: "••••9999", updatedAt: new Date(0).toISOString(), displayName: null, baseUrl: null, modelsEndpoint: null }]);
    expect(JSON.stringify(result)).not.toContain("encryptedApiKey");
    expect(JSON.stringify(result)).not.toContain("kbyok1");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("marks unimplemented providers as unavailable so the client cannot offer them", async () => {
    const result = await callerFor(42).userProviders.list();
    const openrouter = result.providers.find((provider) => provider.id === "openrouter");
    expect(openrouter?.available).toBe(true);
    for (const id of ["openai", "anthropic", "google"]) {
      const provider = result.providers.find((item) => item.id === id);
      expect(provider?.available).toBe(false);
      expect(JSON.stringify(provider)).not.toContain("Endpoint");
    }
  });

  it("rejects a guest before any storage is read", async () => {
    await expect(callerFor(7, 1).userProviders.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(scopedDb.listUserProviderConfigs).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(appRouter.createCaller({ user: null, isGuest: true, req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] }).userProviders.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("userProviders.save", () => {
  it("stores an encrypted envelope and only a masked hint, scoped to the caller", async () => {
    const result = await callerFor(42).userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: MODEL, makeActive: true });
    const input = scopedDb.upsertUserProviderConfig.mock.calls[0]![0] as { userId: number; encryptedApiKey: string; keyHint: string };
    expect(input.userId).toBe(42);
    expect(input.encryptedApiKey.startsWith("kbyok1.")).toBe(true);
    expect(input.encryptedApiKey).not.toContain(KEY);
    expect(input.keyHint).toBe("••••9999");
    expect(scopedDb.setActiveUserProvider).toHaveBeenCalledWith(42, "openrouter");
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(input.encryptedApiKey);
  });

  it("refuses a model that the provider's live catalog does not offer", async () => {
    await expect(callerFor(42).userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: "vendor/invented" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(scopedDb.upsertUserProviderConfig).not.toHaveBeenCalled();
  });

  it("refuses an unimplemented provider", async () => {
    await expect(callerFor(42).userProviders.save({ provider: "anthropic", apiKey: KEY, activeModel: MODEL })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(scopedDb.upsertUserProviderConfig).not.toHaveBeenCalled();
  });

  it("fails closed with a configuration error when the encryption key is absent", async () => {
    delete process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY;
    __resetUserProviderKeyCacheForTests();
    await expect(callerFor(42).userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: MODEL })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(scopedDb.upsertUserProviderConfig).not.toHaveBeenCalled();
    process.env.USER_PROVIDER_KEY_ENCRYPTION_KEY = "d".repeat(64);
    __resetUserProviderKeyCacheForTests();
  });

  it("rejects a guest", async () => {
    await expect(callerFor(7, 1).userProviders.save({ provider: "openrouter", apiKey: KEY, activeModel: MODEL })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("userProviders.models", () => {
  it("reads the catalog with a typed key and returns no secret material", async () => {
    const result = await callerFor(42).userProviders.models({ provider: "openrouter", apiKey: KEY });
    expect(providerApi.listUserProviderModels).toHaveBeenCalledWith(expect.objectContaining({ id: "openrouter", isCustom: false, chatEndpoint: "https://openrouter.ai/api/v1/chat/completions" }), KEY);
    expect(result.models).toEqual([{ id: MODEL, name: "Model A" }, { id: "vendor/model-b", name: "Model B" }]);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("cannot read a catalog through a stored key it cannot decrypt", async () => {
    scopedDb.getUserProviderConfig.mockImplementation(async (userId: number, provider: string) => (userId === 42 && provider === "openrouter" ? { ...configFor(42), encryptedApiKey: "kbyok1.aXYxLnRhZw.cGF5bG9hZA" } : undefined));
    await expect(callerFor(42).userProviders.models({ provider: "openrouter" })).rejects.toThrow();
    expect(providerApi.listUserProviderModels).not.toHaveBeenCalled();
  });

  it("cannot list another user's provider with their key", async () => {
    scopedDb.getUserProviderConfig.mockImplementation(async (userId: number) => (userId === 42 ? configFor(42) : undefined));
    await expect(callerFor(99).userProviders.models({ provider: "openrouter" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(providerApi.listUserProviderModels).not.toHaveBeenCalled();
  });

  it("refuses an unimplemented provider", async () => {
    await expect(callerFor(42).userProviders.models({ provider: "anthropic", apiKey: KEY })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(providerApi.listUserProviderModels).not.toHaveBeenCalled();
  });
});

describe("userProviders.test", () => {
  it("runs the auth probe and returns only a verdict", async () => {
    providerApi.verifyUserProviderKey.mockResolvedValue({ ok: true, label: "kairema" });
    const result = await callerFor(42).userProviders.test({ provider: "openrouter", apiKey: KEY });
    expect(providerApi.verifyUserProviderKey).toHaveBeenCalledWith(expect.objectContaining({ id: "openrouter", isCustom: false, keyProbeEndpoint: "https://openrouter.ai/api/v1/key" }), KEY);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("returns the sanitized category for a rejected key without the upstream body", async () => {
    providerApi.verifyUserProviderKey.mockResolvedValue({ ok: false, category: "AUTH", http: 401, message: "Провайдер отклонил API-ключ. Проверьте ключ и его статус в аккаунте провайдера." });
    const result = await callerFor(42).userProviders.test({ provider: "openrouter", apiKey: KEY });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("rejects a guest", async () => {
    await expect(callerFor(7, 1).userProviders.test({ provider: "openrouter", apiKey: KEY })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("userProviders.setActive and remove", () => {
  it("makes a provider active only when the caller owns that configuration", async () => {
    scopedDb.getUserProviderConfig.mockImplementation(async (userId: number, provider: string) => (userId === 42 && provider === "openrouter" ? configFor(42) : undefined));
    await expect(callerFor(99).userProviders.setActive({ provider: "openrouter" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(scopedDb.setActiveUserProvider).not.toHaveBeenCalled();
    const result = await callerFor(42).userProviders.setActive({ provider: "openrouter" });
    expect(scopedDb.setActiveUserProvider).toHaveBeenCalledWith(42, "openrouter");
    expect(result.activeProvider).toBe("openrouter");
  });

  it("deletes only the caller's own row", async () => {
    await callerFor(99).userProviders.remove({ provider: "openrouter" });
    expect(scopedDb.deleteUserProviderConfig).toHaveBeenCalledWith(99, "openrouter");
  });

  it("rejects a guest for both mutations", async () => {
    await expect(callerFor(7, 1).userProviders.setActive({ provider: "openrouter" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(callerFor(7, 1).userProviders.remove({ provider: "openrouter" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(scopedDb.deleteUserProviderConfig).not.toHaveBeenCalled();
  });
});

/**
 * Transport-level regression guard for B-1.
 *
 * A direct caller() test cannot see the wire, so this mounts the real router on a real HTTP
 * server, calls it with the same client configuration the app uses in the browser, and inspects
 * the request that actually went out. tRPC puts query input in the GET query string, so if
 * `userProviders.models` were a query again the typed key would be part of the recorded URL and
 * every proxy or access log upstream would hold it.
 */
describe("userProviders.models over real HTTP", () => {
  type Captured = { method: string; url: string };
  let server: ReturnType<express.Express["listen"]> | null = null;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  });

  it("sends the API key in the POST body and never in the URL", async () => {
    const captured: Captured[] = [];
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      captured.push({ method: req.method, url: req.originalUrl });
      next();
    });
    app.use("/api/trpc", createExpressMiddleware({
      router: appRouter,
      transformer: superjson,
      createContext: ({ req, res }) => ({
        user: { id: 42, openId: "user-42", email: "user@example.com", name: "User", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), isGuest: 0 },
        req: req as unknown as TrpcContext["req"],
        res: res as unknown as TrpcContext["res"],
      }),
    }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Не удалось запустить test server.");

    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `http://127.0.0.1:${address.port}/api/trpc`, transformer: superjson })],
    });
    const result = await client.userProviders.models.mutate({ provider: "openrouter", apiKey: KEY });

    // The catalog itself still works exactly as before.
    expect(providerApi.listUserProviderModels).toHaveBeenCalledWith(expect.objectContaining({ id: "openrouter", isCustom: false, chatEndpoint: "https://openrouter.ai/api/v1/chat/completions" }), KEY);
    expect(result.models).toEqual([{ id: MODEL, name: "Model A" }, { id: "vendor/model-b", name: "Model B" }]);

    const modelsRequest = captured.find((request) => request.url.includes("userProviders.models"));
    expect(modelsRequest).toBeDefined();
    expect(modelsRequest?.method).toBe("POST");
    // Nothing secret anywhere in the request line: not the key, not even the field name.
    expect(modelsRequest?.url).not.toContain(KEY);
    expect(modelsRequest?.url).not.toContain("apiKey");
    expect(modelsRequest?.url).not.toContain("input=");
    // Nor in any other request the batch produced on the way out.
    for (const request of captured) expect(request.url).not.toContain(KEY);
  });
});

const CUSTOM_ID = "custom-abc123";
const BASE_URL = "https://api.example.com/v1";

function customConfigFor(userId: number, provider = CUSTOM_ID) {
  return {
    ...configFor(userId, provider),
    displayName: "Мой провайдер",
    baseUrl: BASE_URL,
    modelsEndpoint: null,
  };
}

describe("userProviders.createCustom", () => {
  it("validates the URL, reads the catalog and only then stores an encrypted envelope", async () => {
    const result = await callerFor(42).userProviders.createCustom({ displayName: "Мой провайдер", baseUrl: BASE_URL, apiKey: KEY, activeModel: MODEL, makeActive: true });

    // The probe happens before the write, so an unreachable endpoint leaves nothing behind.
    expect(providerApi.listUserProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ isCustom: true, modelsEndpoint: "https://api.example.com/v1/models", chatEndpoint: "https://api.example.com/v1/chat/completions" }),
      KEY,
    );
    const input = scopedDb.upsertUserProviderConfig.mock.calls[0]![0] as { userId: number; provider: string; baseUrl: string; encryptedApiKey: string };
    expect(input.userId).toBe(42);
    expect(input.provider.startsWith("custom-")).toBe(true);
    expect(input.baseUrl).toBe(BASE_URL);
    expect(input.encryptedApiKey.startsWith("kbyok1.")).toBe(true);
    expect(input.encryptedApiKey).not.toContain(KEY);
    expect(scopedDb.setActiveUserProvider).toHaveBeenCalledWith(42, input.provider);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("refuses an insecure or internal URL without storing anything", async () => {
    for (const baseUrl of ["http://api.example.com/v1", "https://127.0.0.1/v1", "https://169.254.169.254/v1", "https://localhost/v1", "https://api.example.com:8443/v1"]) {
      await expect(callerFor(42).userProviders.createCustom({ displayName: "X", baseUrl, apiKey: KEY, activeModel: MODEL })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(scopedDb.upsertUserProviderConfig).not.toHaveBeenCalled();
  });

  it("refuses a model the provider does not actually offer", async () => {
    await expect(callerFor(42).userProviders.createCustom({ displayName: "X", baseUrl: BASE_URL, apiKey: KEY, activeModel: "vendor/invented" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(scopedDb.upsertUserProviderConfig).not.toHaveBeenCalled();
  });
});

describe("userProviders custom target resolution", () => {
  it("re-validates the stored URL on every use instead of trusting the request", async () => {
    scopedDb.getUserProviderConfig.mockResolvedValue(customConfigFor(42));
    await callerFor(42).userProviders.models({ provider: CUSTOM_ID });
    expect(providerApi.listUserProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ id: CUSTOM_ID, isCustom: true, chatEndpoint: "https://api.example.com/v1/chat/completions" }),
      expect.any(String),
    );
  });

  it("probes an unsaved draft without persisting it as a side effect of asking", async () => {
    await callerFor(42).userProviders.models({
      provider: "custom-draft",
      apiKey: KEY,
      draft: { displayName: "Черновик", baseUrl: BASE_URL },
    });
    expect(providerApi.listUserProviderModels).toHaveBeenCalledWith(expect.objectContaining({ isCustom: true, chatEndpoint: "https://api.example.com/v1/chat/completions" }), KEY);
    expect(scopedDb.upsertUserProviderConfig).not.toHaveBeenCalled();
  });

  it("will not borrow another user's custom row", async () => {
    scopedDb.getUserProviderConfig.mockResolvedValue(undefined);
    await expect(callerFor(42).userProviders.models({ provider: CUSTOM_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("probes a custom provider on its catalog, not a guessed key URL", async () => {
    providerApi.verifyUserProviderKey.mockResolvedValue({ ok: true, label: "example" });
    scopedDb.getUserProviderConfig.mockResolvedValue(customConfigFor(42));
    const result = await callerFor(42).userProviders.test({ provider: CUSTOM_ID });
    // No `/key` path exists on an OpenAI-compatible host, so the probe must fall back to the
    // catalog: a real GET that costs no tokens, and never a POST that would run inference.
    expect(providerApi.verifyUserProviderKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: CUSTOM_ID, isCustom: true, keyProbeEndpoint: null, modelsEndpoint: "https://api.example.com/v1/models" }),
      expect.any(String),
    );
    expect(result.ok).toBe(true);
  });
});

describe("userProviders.setActive with a custom provider", () => {
  it("accepts the caller's own custom row and refuses somebody else's", async () => {
    scopedDb.getUserProviderConfig.mockResolvedValue(customConfigFor(42));
    await expect(callerFor(42).userProviders.setActive({ provider: CUSTOM_ID })).resolves.toEqual({ activeProvider: CUSTOM_ID });

    scopedDb.getUserProviderConfig.mockResolvedValue(undefined);
    await expect(callerFor(42).userProviders.setActive({ provider: CUSTOM_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("never routes a custom provider through the built-in catalog lookup", async () => {
    scopedDb.getUserProviderConfig.mockResolvedValue(customConfigFor(42));
    await callerFor(42).userProviders.setActive({ provider: CUSTOM_ID });
    expect(scopedDb.setActiveUserProvider).toHaveBeenCalledWith(42, CUSTOM_ID);
  });
});

describe("userProviders custom credentials over real HTTP", () => {
  it("keeps a custom provider's key and URL out of the request line", async () => {
    scopedDb.getUserProviderConfig.mockResolvedValue(customConfigFor(42));
    const captured: string[] = [];
    const customServer = express();
    customServer.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext: () => ({ user: { id: 42, openId: "user-42", email: "user@example.com", name: "User", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), isGuest: 0 }, req: { headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] }) }));
    customServer.use((req, _res, next) => {
      captured.push(req.url);
      next();
    });
    const listening = customServer.listen(0);
    await new Promise<void>((resolve) => listening?.once("listening", resolve));
    const address = listening.address();
    if (!address || typeof address === "string") throw new Error("Не удалось запустить test server.");

    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `http://127.0.0.1:${address.port}/api/trpc`, transformer: superjson })] });
    await client.userProviders.models.mutate({ provider: CUSTOM_ID });

    for (const url of captured) {
      expect(url).not.toContain(KEY);
      expect(url).not.toContain("apiKey");
      expect(url).not.toContain("api.example.com");
    }
  });
});

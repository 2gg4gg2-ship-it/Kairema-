import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { appRouter } from "./routers";
import { __resetUserProviderKeyCacheForTests } from "./user-provider-secrets";

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
    encryptedApiKey: "kbyok1.aXYxLnRhZw.cGF5bG9hZA",
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
    expect(result.configs).toEqual([{ provider: "openrouter", activeModel: MODEL, keyHint: "••••9999", updatedAt: new Date(0).toISOString() }]);
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
    expect(providerApi.listUserProviderModels).toHaveBeenCalledWith("openrouter", KEY);
    expect(result.models).toEqual([{ id: MODEL, name: "Model A" }, { id: "vendor/model-b", name: "Model B" }]);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("cannot read a catalog through a stored key it cannot decrypt", async () => {
    scopedDb.getUserProviderConfig.mockImplementation(async (userId: number, provider: string) => (userId === 42 && provider === "openrouter" ? configFor(42) : undefined));
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
    expect(providerApi.verifyUserProviderKey).toHaveBeenCalledWith("openrouter", KEY);
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

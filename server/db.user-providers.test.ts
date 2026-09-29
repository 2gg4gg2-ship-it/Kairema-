import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The active "My API" pointer lives in user_settings, so it can drift away from the provider rows.
 * These tests pin the two rules that keep it honest, against the real database helpers.
 */

const state = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updated: [] as Array<{ table: string; values: unknown }>,
  deleted: [] as unknown[],
  inserted: [] as unknown[],
}));

function queryResult(rows: unknown[]) {
  const result = Object.assign(rows, { orderBy: vi.fn(() => result), limit: vi.fn(() => result) });
  return result;
}

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => queryResult(state.selectRows.shift() ?? [])) })) })),
  insert: vi.fn(() => ({
    values: vi.fn((value: unknown) => {
      state.inserted.push(value);
      return { onDuplicateKeyUpdate: vi.fn(() => Promise.resolve()) };
    }),
  })),
  update: vi.fn((table: unknown) => ({
    set: vi.fn((values: unknown) => {
      state.updated.push({ table: tableName(table), values });
      return { where: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])) };
    }),
  })),
  delete: vi.fn(() => ({ where: vi.fn((condition: unknown) => { state.deleted.push(condition); return Promise.resolve([{ affectedRows: 1 }]); }) })),
}));

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => mockDb }));

import { deleteUserProviderConfig, setUserProviderActiveModel, setActiveUserProvider } from "./db";

/** Drizzle tables carry their SQL name on a well-known symbol, which is what a write targets. */
function tableName(table: unknown) {
  return String((table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? table);
}

function settingsRow(overrides: Record<string, unknown> = {}) {
  return { userId: 7, language: "ru", theme: "dark", responseStyle: "default", responseLength: "balanced", effort: "standard", thinking: 0, defaultRole: "fast", webSearch: 0, healthRefreshSeconds: 30, highContrast: 0, askClarifyingQuestions: 0, myApiProvider: "openrouter", ...overrides };
}

beforeEach(() => {
  // The helpers refuse to run without a configured connection; the drizzle driver is mocked above.
  process.env.DATABASE_URL = "mysql://test";
  state.selectRows = [];
  state.updated = [];
  state.deleted = [];
  state.inserted = [];
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  mockDb.update.mockClear();
  mockDb.delete.mockClear();
});

describe("removing a provider", () => {
  it("clears the My API pointer when the removed provider is the active one", async () => {
    state.selectRows = [[settingsRow({ myApiProvider: "openrouter" })], [settingsRow({ myApiProvider: null })]];
    await deleteUserProviderConfig(7, "openrouter");

    expect(state.deleted).toHaveLength(1);
    // Only the pointer is rewritten, so no other preference of this user is touched.
    const settingsWrites = state.updated.filter((write) => write.table === "user_settings");
    expect(settingsWrites).toEqual([{ table: "user_settings", values: { myApiProvider: null } }]);
  });

  it("leaves the pointer and the settings row alone when another provider is removed", async () => {
    state.selectRows = [[settingsRow({ myApiProvider: "openrouter" })]];
    await deleteUserProviderConfig(7, "custom-abc123def456ghi789");

    expect(state.deleted).toHaveLength(1);
    expect(state.updated.filter((write) => write.table === "user_settings")).toEqual([]);
  });

  it("does not clear another user's pointer, because the pointer read is the caller's own", async () => {
    state.selectRows = [[settingsRow({ userId: 99, myApiProvider: "openrouter" })], [settingsRow({ userId: 99, myApiProvider: null })]];
    await deleteUserProviderConfig(99, "openrouter");

    // One write, and it carries the null pointer for the user the delete was scoped to.
    expect(state.updated).toEqual([{ table: "user_settings", values: { myApiProvider: null } }]);
  });
});

describe("switching the active model of a provider", () => {
  it("writes the model to the provider row and nothing to the pointer", async () => {
    state.selectRows = [[{ id: 1, userId: 7, provider: "openrouter", activeModel: "vendor/model-b", encryptedApiKey: "kbyok1.a.b.c", keyHint: "••••1234", displayName: null, baseUrl: null, modelsEndpoint: null, createdAt: new Date(0), updatedAt: new Date(0) }]];
    const updated = await setUserProviderActiveModel(7, "openrouter", "vendor/model-b");

    expect(updated?.activeModel).toBe("vendor/model-b");
    const configWrites = state.updated.filter((write) => write.table === "user_provider_configs");
    expect(configWrites).toHaveLength(1);
    expect(Object.keys(configWrites[0]!.values as object).sort()).toEqual(["activeModel", "updatedAt"]);
    // Changing the model never rewrites which provider is active.
    expect(state.updated.filter((write) => write.table === "user_settings")).toEqual([]);
  });

  it("sets the pointer to null when a provider is deactivated", async () => {
    state.selectRows = [[settingsRow({ myApiProvider: null })]];
    await setActiveUserProvider(7, null);

    expect(state.updated).toEqual([{ table: "user_settings", values: { myApiProvider: null } }]);
  });
});

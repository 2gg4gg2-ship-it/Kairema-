import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const scopedDb = vi.hoisted(() => ({
  updateMemoryProfile: vi.fn(),
  updateMemorySettings: vi.fn(),
  updateUserSettings: vi.fn(),
  updateUserName: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  ...scopedDb,
}));

import { appRouter } from "./routers";

function callerFor(userId = 42, isGuest = 0) {
  return appRouter.createCaller({
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: "user@example.com",
      name: "User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      isGuest,
    },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

describe("profile and settings router ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scopedDb.updateMemorySettings.mockResolvedValue({ userId: 42, enabled: 1, autoExtract: 1 });
    scopedDb.updateMemoryProfile.mockResolvedValue({ userId: 42, profile: "", summary: "" });
    scopedDb.updateUserSettings.mockResolvedValue({ userId: 42, language: "ru", emailNotifications: 0 });
  });

  it("derives profile and memory settings updates from ctx.user.id instead of a forged user ID", async () => {
    await callerFor(42).memory.update({ enabled: false, autoExtract: true, profile: "Краткий профиль", userId: 999 } as never);

    expect(scopedDb.updateMemorySettings).toHaveBeenCalledWith(42, { enabled: 0, autoExtract: 1 });
    expect(scopedDb.updateMemoryProfile).toHaveBeenCalledWith(42, { profile: "Краткий профиль" });
    expect(scopedDb.updateMemorySettings).not.toHaveBeenCalledWith(999, expect.anything());
    expect(scopedDb.updateMemoryProfile).not.toHaveBeenCalledWith(999, expect.anything());
  });

  it("derives user settings updates from ctx.user.id and normalizes notification consent server-side", async () => {
    await callerFor(42).settings.update({ language: "en", emailNotifications: true, userId: 999 } as never);

    expect(scopedDb.updateUserSettings).toHaveBeenCalledWith(42, expect.objectContaining({ language: "en", emailNotifications: 1 }));
    expect(scopedDb.updateUserSettings).not.toHaveBeenCalledWith(999, expect.anything());
  });

  it("stores the clarifying-questions preference as an int on the caller's own row", async () => {
    await callerFor(42).settings.update({ askClarifyingQuestions: true, userId: 999 } as never);

    expect(scopedDb.updateUserSettings).toHaveBeenCalledWith(42, expect.objectContaining({ askClarifyingQuestions: 1 }));
    expect(scopedDb.updateUserSettings).not.toHaveBeenCalledWith(999, expect.anything());
  });

  it("derives the display-name update from ctx.user.id and ignores a forged user ID", async () => {
    await callerFor(42).auth.updateName({ name: "Ada", userId: 999 } as never);

    expect(scopedDb.updateUserName).toHaveBeenCalledWith(42, "Ada");
    expect(scopedDb.updateUserName).not.toHaveBeenCalledWith(999, expect.anything());
  });

  it("normalizes a blank display name to null", async () => {
    await callerFor(42).auth.updateName({ name: "   " });

    expect(scopedDb.updateUserName).toHaveBeenCalledWith(42, null);
  });

  it("rejects profile writes from a guest account", async () => {
    await expect(callerFor(43, 1).auth.updateName({ name: "Ada" })).rejects.toThrow(/Please login/i);
    await expect(callerFor(43, 1).settings.update({ askClarifyingQuestions: true })).rejects.toThrow(/Please login/i);

    expect(scopedDb.updateUserName).not.toHaveBeenCalled();
    expect(scopedDb.updateUserSettings).not.toHaveBeenCalled();
  });
});

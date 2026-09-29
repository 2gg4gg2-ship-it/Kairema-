import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { getOwnerObservabilitySnapshot, listProviderControlFlags, recordTechnicalEvent, upsertProviderControlFlag } = vi.hoisted(() => ({
  getOwnerObservabilitySnapshot: vi.fn(),
  listProviderControlFlags: vi.fn(),
  recordTechnicalEvent: vi.fn(),
  upsertProviderControlFlag: vi.fn(),
}));

vi.mock("./_core/env", () => ({ ENV: { ownerOpenId: "owner-open-id" } }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getOwnerObservabilitySnapshot,
  listProviderControlFlags,
  recordTechnicalEvent,
  upsertProviderControlFlag,
}));

import { appRouter } from "./routers";

function callerFor(openId: string, id = 42) {
  return appRouter.createCaller({
    user: { id, openId, email: "user@example.com", name: "User", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), isGuest: 0 },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

function guestCaller() {
  return appRouter.createCaller({
    user: null,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

describe("owner observability and fail-safe controls", () => {
  beforeEach(() => {
    getOwnerObservabilitySnapshot.mockReset().mockResolvedValue({
      providers: [{ provider: "openrouter", state: "ready", category: null, checkedAt: new Date("2026-08-25T10:00:00Z"), blockedUntil: null }],
      events: [{ id: 1, kind: "fallback", title: "Резервный кандидат использован", code: "openrouter", roleId: "fast", createdAt: new Date("2026-08-25T10:00:00Z") }],
      memory: { facts: 3, topics: 2, profiles: 1 },
      search: { samples24h: 4, outages24h: 1 },
    });
    listProviderControlFlags.mockReset().mockResolvedValue([]);
    upsertProviderControlFlag.mockReset().mockResolvedValue({ targetType: "provider", targetKey: "openrouter", disabled: true, preference: "normal", updatedAt: new Date() });
    recordTechnicalEvent.mockReset().mockResolvedValue(undefined);
  });

  it("rejects a non-owner before reading observability or controls", async () => {
    const caller = callerFor("different-open-id");
    await expect(caller.owner.observability()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.owner.providerControls()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOwnerObservabilitySnapshot).not.toHaveBeenCalled();
    expect(listProviderControlFlags).not.toHaveBeenCalled();
  });

  it("rejects a guest before any owner diagnostic read", async () => {
    await expect(guestCaller().owner.observability()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getOwnerObservabilitySnapshot).not.toHaveBeenCalled();
  });

  it("returns bounded technical metadata only to the configured owner", async () => {
    const snapshot = await callerFor("owner-open-id").owner.observability();
    expect(snapshot).toMatchObject({ memory: { facts: 3, topics: 2 }, search: { samples24h: 4, outages24h: 1 } });
    expect(JSON.stringify(snapshot)).not.toMatch(/userId|openId|content|prompt|response|attachment|https?:\/\//i);
  });

  it("exposes only server allowlisted control targets to the owner", async () => {
    const targets = await callerFor("owner-open-id").owner.providerControlTargets();
    expect(targets.providers).toContain("openrouter");
    expect(targets.models.every((target) => target.includes(":"))).toBe(true);
    expect(targets.providers).not.toContain("untrusted-provider");
  });

  it("rejects an arbitrary target before it can write a control", async () => {
    await expect(callerFor("owner-open-id").owner.updateProviderControl({ targetType: "provider", targetKey: "untrusted-provider", disabled: true, preference: "normal" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(upsertProviderControlFlag).not.toHaveBeenCalled();
  });

  it("stores an owner-scoped fail-safe control and a metadata-only audit event", async () => {
    await expect(callerFor("owner-open-id", 77).owner.updateProviderControl({ targetType: "provider", targetKey: "openrouter", disabled: true, preference: "normal" })).resolves.toMatchObject({ targetKey: "openrouter", disabled: true });
    expect(upsertProviderControlFlag).toHaveBeenCalledWith({ targetType: "provider", targetKey: "openrouter", disabled: true, preference: "normal", actorUserId: 77 });
    expect(recordTechnicalEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "owner_flag", code: "provider:openrouter", actorUserId: 77 }));
  });
});

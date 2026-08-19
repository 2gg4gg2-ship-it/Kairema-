import express from "express";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  consumeQuota: vi.fn(),
  recordAudit: vi.fn(),
  chatWithDev: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: fixtures.authenticateRequest } }));
vi.mock("./db", () => ({ consumeDevApiRequestQuota: fixtures.consumeQuota, recordDevApiAudit: fixtures.recordAudit }));
vi.mock("./providers", () => ({ OpenRouterError: class OpenRouterError extends Error {}, chatWithDev: fixtures.chatWithDev }));

import { registerDevRoute } from "./dev-api";

let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = null;
});

beforeEach(() => {
  fixtures.authenticateRequest.mockReset().mockResolvedValue(null);
  fixtures.consumeQuota.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
  fixtures.recordAudit.mockReset().mockResolvedValue(undefined);
  fixtures.chatWithDev.mockReset().mockResolvedValue({ content: "готово" });
});

async function request(body = { messages: [{ role: "user", content: "Напиши код" }] }) {
  const app = express();
  app.use(express.json());
  registerDevRoute(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Не удалось запустить test server.");
  return fetch(`http://127.0.0.1:${address.port}/api/dev`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("Dev API access control", () => {
  it("rejects unauthenticated requests before attempting a provider call", async () => {
    const response = await request();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Доступ к Dev API разрешён только администратору." });
    expect(fixtures.recordAudit).toHaveBeenCalledWith({ userId: undefined, outcome: "denied", status: 403 });
    expect(fixtures.consumeQuota).not.toHaveBeenCalled();
    expect(fixtures.chatWithDev).not.toHaveBeenCalled();
  });

  it("treats a role change as immediate access revocation", async () => {
    fixtures.authenticateRequest.mockResolvedValue({ id: 17, role: "user" });
    const response = await request();

    expect(response.status).toBe(403);
    expect(fixtures.recordAudit).toHaveBeenCalledWith({ userId: 17, outcome: "denied", status: 403 });
    expect(fixtures.consumeQuota).not.toHaveBeenCalled();
    expect(fixtures.chatWithDev).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After and never calls a provider after the per-admin limit", async () => {
    fixtures.authenticateRequest.mockResolvedValue({ id: 17, role: "admin" });
    fixtures.consumeQuota.mockResolvedValue({ allowed: false, retryAfterSeconds: 31 });
    const response = await request();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("31");
    expect(fixtures.recordAudit).toHaveBeenCalledWith({ userId: 17, outcome: "rate_limited", status: 429 });
    expect(fixtures.chatWithDev).not.toHaveBeenCalled();
  });

  it("audits an allowed request with metadata only", async () => {
    fixtures.authenticateRequest.mockResolvedValue({ id: 17, role: "admin" });
    const response = await request({ messages: [{ role: "user", content: "секретное содержимое запроса" }] });

    expect(response.status).toBe(200);
    expect(fixtures.chatWithDev).toHaveBeenCalledOnce();
    expect(fixtures.recordAudit).toHaveBeenCalledWith({ userId: 17, outcome: "allowed", status: 200 });
    expect(JSON.stringify(fixtures.recordAudit.mock.calls)).not.toContain("секретное содержимое запроса");
  });
});

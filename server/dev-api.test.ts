import express from "express";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { registerDevRoute } from "./dev-api";

let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = null;
});

describe("Dev API access control", () => {
  it("rejects unauthenticated requests before attempting a provider call", async () => {
    const app = express();
    app.use(express.json());
    registerDevRoute(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Не удалось запустить test server.");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/dev`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Напиши код" }] }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Доступ к Dev API разрешён только администратору." });
  });
});

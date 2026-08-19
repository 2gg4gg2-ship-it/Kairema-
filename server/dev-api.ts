import type { Express, Request, Response } from "express";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import { consumeDevApiRequestQuota, recordDevApiAudit } from "./db";
import { chatWithDev, OpenRouterError } from "./providers";

const inputSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(16_000) })).min(1).max(24),
});

function rejection(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

async function audit(userId: number | undefined, outcome: "allowed" | "denied" | "invalid" | "rate_limited" | "provider_error", status: number): Promise<void> {
  await recordDevApiAudit({ userId, outcome, status });
}

/** Deliberately separate from the client router: only an authenticated Manus admin can call it. */
export function registerDevRoute(app: Express) {
  app.post("/api/dev", async (req: Request, res: Response) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user || user.role !== "admin") {
      await audit(user?.id, "denied", 403).catch(() => undefined);
      return rejection(res, 403, "Доступ к Dev API разрешён только администратору.");
    }
    let quota: { allowed: boolean; retryAfterSeconds: number };
    try {
      quota = await consumeDevApiRequestQuota(user.id);
    } catch {
      await audit(user.id, "provider_error", 503).catch(() => undefined);
      return rejection(res, 503, "Dev API временно недоступен.");
    }
    if (!quota.allowed) {
      await audit(user.id, "rate_limited", 429).catch(() => undefined);
      res.setHeader("Retry-After", String(quota.retryAfterSeconds));
      return rejection(res, 429, "Превышен лимит Dev API: не более 30 запросов в минуту.");
    }
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      await audit(user.id, "invalid", 400).catch(() => undefined);
      return rejection(res, 400, "Некорректный формат Dev-запроса.");
    }
    try {
      const result = await chatWithDev(parsed.data.messages);
      await audit(user.id, "allowed", 200).catch(() => undefined);
      return res.json(result);
    } catch (error) {
      const message = error instanceof OpenRouterError ? "Dev-модели временно недоступны. Повторите попытку позже." : "Dev API временно недоступен.";
      await audit(user.id, "provider_error", 503).catch(() => undefined);
      return rejection(res, 503, message);
    }
  });
}

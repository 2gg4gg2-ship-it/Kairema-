import type { Express, Request, Response } from "express";
import { z } from "zod";
import { sdk } from "./_core/sdk";
import { chatWithDev, OpenRouterError } from "./providers";

const inputSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(16_000) })).min(1).max(24),
});

function rejection(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

/** Deliberately separate from the client router: only an authenticated Manus admin can call it. */
export function registerDevRoute(app: Express) {
  app.post("/api/dev", async (req: Request, res: Response) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user || user.role !== "admin") return rejection(res, 403, "Доступ к Dev API разрешён только администратору.");
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return rejection(res, 400, "Некорректный формат Dev-запроса.");
    try {
      const result = await chatWithDev(parsed.data.messages);
      return res.json(result);
    } catch (error) {
      const message = error instanceof OpenRouterError ? "Dev-модели временно недоступны. Повторите попытку позже." : "Dev API временно недоступен.";
      return rejection(res, 503, message);
    }
  });
}

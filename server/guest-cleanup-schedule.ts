import type { Request, RequestHandler, Response } from "express";
import { sdk } from "./_core/sdk";
import { cleanupExpiredGuests } from "./_core/guest-session";

export function createGuestCleanupScheduleHandler(): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron) {
        res.status(403).json({ error: "cron-only" });
        return;
      }
      const deletedCount = await cleanupExpiredGuests();
      res.json({ ok: true, deletedCount });
    } catch (error) {
      res.status(500).json({
        error: "guest-cleanup-failed",
        timestamp: new Date().toISOString(),
      });
    }
  };
}

export function registerGuestCleanupScheduleRoute(app: { post: (path: string, handler: RequestHandler) => unknown }) {
  app.post("/api/scheduled/guest-cleanup", createGuestCleanupScheduleHandler());
}
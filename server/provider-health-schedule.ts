import type { Request, RequestHandler, Response } from "express";
import { sdk } from "./_core/sdk";
import { refreshProviderHealth } from "./providers";

/** Authenticated project-level heartbeat: no frontend ping and no secrets in its response. */
export function createProviderHealthScheduleHandler(): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron) {
        res.status(403).json({ error: "cron-only" });
        return;
      }
      const refreshed = await refreshProviderHealth({ force: true });
      res.json({ ok: true, refreshed });
    } catch (error) {
      res.status(500).json({
        error: "provider-health-refresh-failed",
        timestamp: new Date().toISOString(),
      });
    }
  };
}

export function registerProviderHealthScheduleRoute(app: { post: (path: string, handler: RequestHandler) => unknown }) {
  const handler = createProviderHealthScheduleHandler();
  app.post("/api/scheduled/provider-health", handler);
  app.post("/api/scheduled/provider-health-check", handler);
}

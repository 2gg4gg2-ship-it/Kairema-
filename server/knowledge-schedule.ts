import type { Request, RequestHandler, Response } from "express";
import { sdk } from "./_core/sdk";
import { cleanupExpiredChatAttachments, cleanupSearchQualityMetrics } from "./db";
import { refreshKnowledgeBase } from "./knowledge";

/** Project-level Heartbeat callback. Registration happens only after production publication. */
export function createKnowledgeRefreshScheduleHandler(): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron) {
        res.status(403).json({ error: "cron-only" });
        return;
      }
      const [outcomes, expiredAttachmentMetadata, expiredSearchQualityMetrics] = await Promise.all([
        refreshKnowledgeBase("scheduled"),
        cleanupExpiredChatAttachments().catch(() => 0),
        cleanupSearchQualityMetrics().catch(() => 0),
      ]);
      res.json({ ok: true, expiredAttachmentMetadata, expiredSearchQualityMetrics, sources: outcomes.map(({ sourceId, state, fetchedCount, indexedCount, updatedCount }) => ({ sourceId, state, fetchedCount, indexedCount, updatedCount })) });
    } catch (error) {
      res.status(500).json({ error: "knowledge-refresh-failed", context: { path: "/api/scheduled/knowledge-refresh" }, timestamp: new Date().toISOString(), detail: error instanceof Error ? error.message.slice(0, 180) : "unknown" });
    }
  };
}

export function registerKnowledgeScheduleRoute(app: { post: (path: string, handler: RequestHandler) => unknown }) {
  app.post("/api/scheduled/knowledge-refresh", createKnowledgeRefreshScheduleHandler());
}

import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { storagePut, storageGetSignedUrl, storageCopy, storageDelete } from "./storage";

export function registerB2SmokeTestRoute(app: Express) {
  app.post("/api/diagnostic/b2-smoke-test", async (req: Request, res: Response) => {
    const token = req.headers["x-smoke-test-token"] as string | undefined;
    if (!token || token !== ENV.b2SmokeTestToken || !ENV.b2SmokeTestToken) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const results: Record<string, unknown> = {};
    const testId = crypto.randomUUID();
    const originalKey = `__kairema_smoke__/${testId}/original`;
    const copyKey = `__kairema_smoke__/${testId}/copy`;
    let originalUrl = "";
    let copyUrl = "";
    let actualOriginalKey = "";
    let actualCopyKey = "";

    try {
      const putResult = await storagePut(originalKey, "b2-smoke-test-data", "text/plain");
      actualOriginalKey = putResult.key;
      originalUrl = putResult.url;
      results.put = { key: actualOriginalKey, url: putResult.url };

      const signedUrl = await storageGetSignedUrl(actualOriginalKey);
      results.getSignedUrl = { url: signedUrl };

      const copyResult = await storageCopy(actualOriginalKey, copyKey);
      actualCopyKey = copyResult.key;
      copyUrl = copyResult.url;
      results.copy = { key: actualCopyKey, url: copyResult.url };

      const copySignedUrl = await storageGetSignedUrl(actualCopyKey);
      results.copySignedUrl = { url: copySignedUrl };

      const deleteOriginal = await storageDelete(actualOriginalKey);
      results.deleteOriginal = { success: deleteOriginal };

      const deleteCopy = await storageDelete(actualCopyKey);
      results.deleteCopy = { success: deleteCopy };

      res.json({ ok: true, results });
    } catch (error) {
      console.error("[B2SmokeTest] failed:", error);
      try {
        if (originalUrl) await storageDelete(actualOriginalKey);
        if (copyUrl) await storageDelete(actualCopyKey);
      } catch (cleanupError) {
        console.error("[B2SmokeTest] cleanup failed:", cleanupError);
      }
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error", results });
    }
  });
}
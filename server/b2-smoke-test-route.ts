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
    const originalKey = `smoke-test/original-${crypto.randomUUID()}`;
    const copyKey = `smoke-test/copy-${crypto.randomUUID()}`;
    let originalUrl = "";
    let copyUrl = "";

    try {
      const putResult = await storagePut(originalKey, "b2-smoke-test-data", "text/plain");
      originalUrl = putResult.url;
      results.put = { key: putResult.key, url: putResult.url };

      const signedUrl = await storageGetSignedUrl(originalKey);
      results.getSignedUrl = { url: signedUrl };

      const copyResult = await storageCopy(originalKey, copyKey);
      copyUrl = copyResult.url;
      results.copy = { key: copyResult.key, url: copyResult.url };

      const copySignedUrl = await storageGetSignedUrl(copyKey);
      results.copySignedUrl = { url: copySignedUrl };

      const deleteOriginal = await storageDelete(originalKey);
      results.deleteOriginal = { success: deleteOriginal };

      const deleteCopy = await storageDelete(copyKey);
      results.deleteCopy = { success: deleteCopy };

      res.json({ ok: true, results });
    } catch (error) {
      console.error("[B2SmokeTest] failed:", error);
      try {
        if (originalUrl) await storageDelete(originalKey);
        if (copyUrl) await storageDelete(copyKey);
      } catch (cleanupError) {
        console.error("[B2SmokeTest] cleanup failed:", cleanupError);
      }
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error", results });
    }
  });
}
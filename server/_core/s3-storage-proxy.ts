import type { Express } from "express";
import { storageGetSignedUrl } from "../storage-s3";

export function registerS3StorageProxy(app: Express) {
  app.get("/api/storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    try {
      const url = await storageGetSignedUrl(key);
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[S3StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

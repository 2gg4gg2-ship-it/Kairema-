import type { Express } from "express";
import { storageGetSignedUrl } from "../storage";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    try {
      // B2 storage backend only
      const signedUrl = await storageGetSignedUrl(key);
      if (!signedUrl) {
        res.status(502).send("Empty signed URL from B2 backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, signedUrl);
    } catch (err) {
      console.error("[StorageProxy] b2 failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

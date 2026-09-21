import type { Express } from "express";
import { ENV } from "./env";
import { storageGetSignedUrl, getCurrentBackend } from "../storage";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    const backend = getCurrentBackend();

    if (backend === "forge") {
      if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
        res.status(500).send("Storage proxy not configured");
        return;
      }

      try {
        const forgeUrl = new URL(
          "v1/storage/presign/get",
          ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
        );
        forgeUrl.searchParams.set("path", key);

        const forgeResp = await fetch(forgeUrl, {
          headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
        });

        if (!forgeResp.ok) {
          const body = await forgeResp.text().catch(() => "");
          console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
          res.status(502).send("Storage backend error");
          return;
        }

        const { url } = (await forgeResp.json()) as { url: string };
        if (!url) {
          res.status(502).send("Empty signed URL from backend");
          return;
        }

        res.set("Cache-Control", "no-store");
        res.redirect(307, url);
      } catch (err) {
        console.error("[StorageProxy] forge failed:", err);
        res.status(502).send("Storage proxy error");
      }
    } else if (backend === "b2") {
      try {
        // Use B2 storageGetSignedUrl which handles signed URL generation internally
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
    } else {
      res.status(500).send(`Unknown storage backend: ${backend}`);
    }
  });
}

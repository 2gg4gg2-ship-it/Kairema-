import type { Express, Request, Response } from "express";
import express from "express";
import { uploadOwnedChatAttachmentBytes } from "./attachments";
import { sdk } from "./_core/sdk";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const uploadParser = express.raw({ type: "application/octet-stream", limit: MAX_ATTACHMENT_BYTES });

function reject(res: Response, status: number, error: string) {
  res.status(status).set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff").json({ error });
}

function requiredHeader(req: Request, name: string) {
  const value = req.get(name)?.trim();
  if (!value) throw new Error("Некорректный запрос загрузки.");
  return value;
}

function decodedFileName(req: Request) {
  try {
    return decodeURIComponent(requiredHeader(req, "X-Attachment-File-Name"));
  } catch {
    throw new Error("Некорректное имя прикрепляемого файла.");
  }
}

async function handleUpload(req: Request, res: Response) {
  try {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      return reject(res, 401, "Войдите, чтобы загрузить вложение.");
    }
    if (!user) return reject(res, 401, "Войдите, чтобы загрузить вложение.");
    const sessionId = requiredHeader(req, "X-Attachment-Session-Id");
    const contentType = requiredHeader(req, "X-Attachment-Content-Type");
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const attachment = await uploadOwnedChatAttachmentBytes(user.id, { sessionId, fileName: decodedFileName(req), contentType, bytes });
    return res.status(201).set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff").json(attachment);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Не удалось обработать вложение.";
    return reject(res, 400, message);
  }
}

/** Receives bytes outside the JSON/tRPC gateway, while preserving the existing authenticated owner scope. */
export function registerAttachmentUploadRoute(app: Express) {
  app.post("/api/attachments/upload", (req, res, next) => uploadParser(req, res, (error?: unknown) => {
    if (error) return reject(res, 413, "Размер вложения должен быть от 1 байта до 8 МБ.");
    void handleUpload(req, res).catch(next);
  }));
}

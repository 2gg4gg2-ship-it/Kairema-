import type { Express, Request, Response } from "express";
import express from "express";
import { AttachmentPublicError, uploadOwnedChatAttachmentBytes } from "./attachments";
import { sdk } from "./_core/sdk";
import { getOrCreateGuestUser } from "./_core/guest-session";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const uploadParser = express.raw({ type: "application/octet-stream", limit: MAX_ATTACHMENT_BYTES });

class UploadRequestError extends Error {}

type UploadDependencies = {
  authenticateRequest: (request: Request) => Promise<{ id: number } | null>;
  getOrCreateGuestUser: (request: Request, response: Response) => Promise<{ id: number; isGuest: boolean } | null>;
  upload: typeof uploadOwnedChatAttachmentBytes;
};

const productionUploadDependencies: UploadDependencies = {
  authenticateRequest: request => sdk.authenticateRequest(request),
  getOrCreateGuestUser: async (request, response) => {
    try {
      const guest = await getOrCreateGuestUser(request, response);
      return { id: guest.userId, isGuest: guest.isNew || true };
    } catch {
      return null;
    }
  },
  upload: uploadOwnedChatAttachmentBytes,
};

function reject(res: Response, status: number, error: string) {
  res.status(status).set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff").json({ error });
}

function requiredHeader(req: Request, name: string) {
  const value = req.get(name)?.trim();
  if (!value) throw new UploadRequestError("Некорректный запрос загрузки.");
  return value;
}

function decodedFileName(req: Request) {
  try {
    return decodeURIComponent(requiredHeader(req, "X-Attachment-File-Name"));
  } catch {
    throw new UploadRequestError("Некорректное имя прикрепляемого файла.");
  }
}

export async function handleAttachmentUpload(req: Request, res: Response, dependencies: UploadDependencies = productionUploadDependencies) {
  try {
    let user;
    let isGuest = false;
    try {
      user = await dependencies.authenticateRequest(req);
    } catch {
      // Fall through to guest creation
    }
    if (!user) {
      const guest = await dependencies.getOrCreateGuestUser(req, res).catch(() => null);
      if (guest) {
        user = { id: guest.id } as { id: number };
        isGuest = true;
      }
    }
    if (!user) return reject(res, 401, "Войдите, чтобы загрузить вложение.");
    const sessionId = requiredHeader(req, "X-Attachment-Session-Id");
    const contentType = requiredHeader(req, "X-Attachment-Content-Type");
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const attachment = await dependencies.upload(user.id, { sessionId, fileName: decodedFileName(req), contentType, bytes });
    return res.status(201).set("Cache-Control", "no-store").set("X-Content-Type-Options", "nosniff").json(attachment);
  } catch (error) {
    if (error instanceof AttachmentPublicError || error instanceof UploadRequestError) {
      return reject(res, 400, error.message);
    }
    return reject(res, 503, "Не удалось загрузить вложение. Повторите попытку позже.");
  }
}

/** Receives bytes outside the JSON/tRPC gateway, while preserving the existing authenticated owner scope. */
export function registerAttachmentUploadRoute(app: Express) {
  app.post("/api/attachments/upload", (req, res, next) => uploadParser(req, res, (error?: unknown) => {
    if (error) return reject(res, 413, "Размер вложения должен быть от 1 байта до 8 МБ.");
    void handleAttachmentUpload(req, res).catch(next);
  }));
}

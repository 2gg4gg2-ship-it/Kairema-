import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { AttachmentPublicError } from "./attachments";
import { handleAttachmentUpload } from "./attachment-upload";

function request(headers: Record<string, string>, body = Buffer.from("x")) {
  return {
    body,
    get: (name: string) => headers[name],
  } as unknown as Request;
}

function response() {
  const res = {
    json: vi.fn(),
    set: vi.fn(),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.set.mockReturnValue(res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

const validHeaders = {
  "X-Attachment-Session-Id": "session-safe",
  "X-Attachment-Content-Type": "text/plain",
  "X-Attachment-File-Name": "note.txt",
};

describe("binary attachment upload failure boundary", () => {
  it("returns a retry-safe 503 without exposing a storage/database error", async () => {
    const res = response();
    const rawFailure = "storagePut failed: internal endpoint/token=should-not-leak";

    await handleAttachmentUpload(request(validHeaders), res, {
      authenticateRequest: async () => ({ id: 7 }),
      upload: async () => { throw new Error(rawFailure); },
    });

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Не удалось загрузить вложение. Повторите попытку позже." });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(rawFailure);
  });

  it("preserves deliberate client-safe attachment validation errors", async () => {
    const res = response();

    await handleAttachmentUpload(request(validHeaders), res, {
      authenticateRequest: async () => ({ id: 7 }),
      upload: async () => { throw new AttachmentPublicError("Поддерживаются PNG, JPG, WEBP, PDF, TXT и MD."); },
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Поддерживаются PNG, JPG, WEBP, PDF, TXT и MD." });
  });

  it("denies an unauthenticated upload before any upload dependency runs", async () => {
    const res = response();
    const upload = vi.fn();

    await handleAttachmentUpload(request(validHeaders), res, {
      authenticateRequest: async () => null,
      upload,
    });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Войдите, чтобы загрузить вложение." });
    expect(upload).not.toHaveBeenCalled();
  });
});

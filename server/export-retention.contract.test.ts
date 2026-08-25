import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const dbSource = readFileSync(`${projectRoot}/server/db.ts`, "utf8");
const homeSource = readFileSync(`${projectRoot}/client/src/pages/Home.tsx`, "utf8");

describe("persistent export retention contract", () => {
  it("keeps retention user-controlled and explains logical cleanup in export history", () => {
    expect(homeSource).toContain("Они хранятся, пока вы не удалите запись");
    expect(homeSource).toContain("ключ и ссылка на файл убираются из истории");
  });

  it("removes an owned export metadata record rather than offering an unsupported storage delete path", () => {
    const deleteStart = dbSource.indexOf("export async function deleteOwnedChatExport");
    const deleteEnd = dbSource.indexOf("\nexport ", deleteStart + 1);
    const deleteBody = dbSource.slice(deleteStart, deleteEnd === -1 ? undefined : deleteEnd);

    expect(deleteBody).toContain("eq(chatExports.userId, userId)");
    expect(deleteBody).toContain("eq(chatExports.id, exportId)");
    expect(deleteBody).not.toMatch(/storageDelete|presign\/delete|deleteObject/i);
  });
});

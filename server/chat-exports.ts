import { randomUUID } from "node:crypto";
import { jsPDF } from "jspdf";
import { buildChatMarkdown, exportFileStem, type ChatExportInput } from "@shared/chat-export";
import { createChatExport, getOwnedChatExport, getOwnedChatSession, listSessionMessages, type ChatExportFormat } from "./db";
import { storageGetSignedUrl, storagePut } from "./storage-s3";

const PDF_FONT_KEY = "kairema-export-dejavu_a34427d0.ttf";
const EXPORTABLE_ROLES = new Set(["user", "assistant"]);
const MAX_EXPORT_MESSAGE_COUNT = 1_000;
const MAX_EXPORT_CONTENT_CHARS = 2_000_000;

function asBinary(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    for (let index = offset; index < Math.min(offset + chunkSize, bytes.length); index += 1) binary += String.fromCharCode(bytes[index]!);
  }
  return binary;
}

async function buildPdf(input: ChatExportInput): Promise<Buffer> {
  const fontResponse = await fetch(await storageGetSignedUrl(PDF_FONT_KEY));
  if (!fontResponse.ok) throw new Error("Шрифт для PDF временно недоступен.");
  const document = new jsPDF({ unit: "mm", format: "a4", compress: true });
  document.addFileToVFS("KairemaExport.ttf", asBinary(await fontResponse.arrayBuffer()));
  document.addFont("KairemaExport.ttf", "KairemaExport", "normal");
  document.setFont("KairemaExport", "normal");
  document.setProperties({ title: input.title || "Разговор с Kairema", subject: "Экспорт истории чата Kairema", author: "Kairema" });

  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 18;
  const lineHeight = 5.2;
  let y = margin;
  const ensureSpace = (lines = 1) => {
    if (y + lines * lineHeight <= pageHeight - margin) return;
    document.addPage();
    y = margin;
  };
  const writeText = (text: string, size: number, emphasis = false) => {
    document.setFontSize(size);
    const lines = document.splitTextToSize(text || " ", pageWidth - margin * 2) as string[];
    ensureSpace(lines.length);
    for (const line of lines) {
      ensureSpace();
      document.text(line, margin, y);
      y += lineHeight;
    }
    if (emphasis) y += 1.4;
  };

  writeText(input.title.trim() || "Разговор с Kairema", 18, true);
  document.setTextColor(100, 116, 139);
  writeText(`Экспорт из Kairema · ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(input.exportedAt ?? new Date())}`, 9, true);
  document.setTextColor(15, 23, 42);
  input.messages.forEach((message, index) => {
    const author = message.role === "user" ? "Вы" : (message.providerLabel || "Kairema");
    const label = message.role === "assistant" && message.model ? `${author} · ${message.model}` : author;
    ensureSpace(3);
    writeText(`${index + 1}. ${label}`, 11, true);
    document.setTextColor(51, 65, 85);
    writeText(message.content.trim(), 10);
    document.setTextColor(15, 23, 42);
    y += 3;
  });
  return Buffer.from(new Uint8Array(document.output("arraybuffer")));
}

export async function createPersistentChatExport(userId: number, input: { sessionId: string; format: ChatExportFormat }) {
  const session = await getOwnedChatSession(userId, input.sessionId);
  if (!session) throw new Error("Чат не найден или недоступен.");
  const messages = (await listSessionMessages(userId, input.sessionId)).filter((message) => EXPORTABLE_ROLES.has(message.role));
  const contentLength = messages.reduce((total, message) => total + message.content.length, 0);
  if (!messages.length) throw new Error("В чате пока нет сообщений для экспорта.");
  if (messages.length > MAX_EXPORT_MESSAGE_COUNT || contentLength > MAX_EXPORT_CONTENT_CHARS) throw new Error("Этот чат слишком большой для одного экспорта. Разделите историю на части.");

  const exportedAt = new Date();
  const exportInput: ChatExportInput = { title: session.title, messages, exportedAt };
  const extension = input.format === "markdown" ? "md" : "pdf";
  const contentType = input.format === "markdown" ? "text/markdown; charset=utf-8" : "application/pdf";
  const fileName = `${exportFileStem(session.title)}.${extension}`;
  const bytes = input.format === "markdown" ? Buffer.from(buildChatMarkdown(exportInput), "utf8") : await buildPdf(exportInput);
  const stored = await storagePut(`exports/${userId}/${input.sessionId}/${randomUUID()}.${extension}`, bytes, contentType);
  return createChatExport(userId, {
    sessionId: input.sessionId,
    fileKey: stored.key,
    fileName,
    format: input.format,
    contentType,
    byteSize: bytes.byteLength,
    searchText: `${session.title} ${fileName}`.slice(0, 65_000),
  });
}

/** Resolves the user-owned record before requesting the transient signed object URL. */
export async function getOwnedChatExportDownload(userId: number, exportId: string) {
  const record = await getOwnedChatExport(userId, exportId);
  if (!record) throw new Error("Экспорт не найден или недоступен.");
  return { export: record, url: await storageGetSignedUrl(record.fileKey) };
}

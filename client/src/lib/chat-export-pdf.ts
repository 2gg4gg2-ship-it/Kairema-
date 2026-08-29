import { exportFileStem, type ChatExportInput } from "@shared/chat-export";
import { jsPDF } from "jspdf";
import type { PreparedChatExport } from "./chat-export";

const PDF_FONT_URL = "/api/storage/kairema-export-dejavu_a34427d0.ttf";

function binaryFromArrayBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]!);
  }
  return binary;
}

async function addRussianFont(document: jsPDF) {
  const response = await fetch(PDF_FONT_URL);
  if (!response.ok) throw new Error("Шрифт для PDF временно недоступен.");
  document.addFileToVFS("KairemaExport.ttf", binaryFromArrayBuffer(await response.arrayBuffer()));
  document.addFont("KairemaExport.ttf", "KairemaExport", "normal");
  document.setFont("KairemaExport", "normal");
}

export async function prepareChatPdfDocument(input: ChatExportInput): Promise<PreparedChatExport> {
  const document = new jsPDF({ unit: "mm", format: "a4", compress: true });
  await addRussianFont(document);
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
  return { blob: document.output("blob"), fileName: `${exportFileStem(input.title)}.pdf`, contentType: "application/pdf" };
}

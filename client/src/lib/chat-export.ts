import { buildChatMarkdown, exportFileStem, type ChatExportInput } from "@shared/chat-export";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A zero-delay revoke can cancel the browser's deferred download, especially
  // on mobile Safari/Chromium. Keep the opaque URL alive briefly, then release it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PreparedChatExport = {
  blob: Blob;
  fileName: string;
  contentType: string;
};

export function downloadPreparedChatExport(file: PreparedChatExport) {
  saveBlob(file.blob, file.fileName);
}

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

export async function blobToBase64(blob: Blob) {
  return globalThis.btoa(binaryFromArrayBuffer(await blob.arrayBuffer()));
}

export async function prepareChatMarkdown(input: ChatExportInput): Promise<PreparedChatExport> {
  const markdown = buildChatMarkdown(input);
  return { blob: new Blob([markdown], { type: "text/markdown;charset=utf-8" }), fileName: `${exportFileStem(input.title)}.md`, contentType: "text/markdown;charset=utf-8" };
}

export async function prepareChatPdf(input: ChatExportInput): Promise<PreparedChatExport> {
  const { prepareChatPdfDocument } = await import("./chat-export-pdf");
  return prepareChatPdfDocument(input);
}

export async function downloadChatMarkdown(input: ChatExportInput) {
  const file = await prepareChatMarkdown(input);
  downloadPreparedChatExport(file);
  return file;
}

export async function downloadChatPdf(input: ChatExportInput) {
  const file = await prepareChatPdf(input);
  downloadPreparedChatExport(file);
  return file;
}

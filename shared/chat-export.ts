export type ChatExportMessage = {
  role: "user" | "assistant";
  content: string;
  providerLabel?: string;
  model?: string;
  createdAt?: Date | string | null;
};

export type ChatExportInput = {
  title: string;
  messages: ChatExportMessage[];
  exportedAt?: Date;
};

function formatDate(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function exportFileStem(title: string) {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || "разговор-kairema";
}

export function buildChatMarkdown({ title, messages, exportedAt = new Date() }: ChatExportInput) {
  const heading = title.trim() || "Разговор с Kairema";
  const sections = messages.map((message, index) => {
    const author = message.role === "user" ? "Вы" : (message.providerLabel || "Kairema");
    const model = message.role === "assistant" && message.model ? ` · ${message.model}` : "";
    const timestamp = formatDate(message.createdAt);
    const meta = [timestamp, model.replace(/^ · /, "")].filter(Boolean).join(" · ");
    return `## ${index + 1}. ${author}\n${meta ? `_${meta}_\n` : ""}\n${message.content.trim()}`;
  });

  return [
    `# ${heading}`,
    "",
    `_Экспорт из Kairema: ${formatDate(exportedAt)}_`,
    "",
    ...sections,
    "",
  ].join("\n");
}

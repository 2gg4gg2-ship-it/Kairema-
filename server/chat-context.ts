import { getAttachmentPromptText, getOwnedAttachmentDownload } from "./attachments";
import { createMemoryFact, getMemoryProfile, getOwnedChatAttachments, getUserSettings, listRelevantMemoryFacts } from "./db";
import type { ChatSettings } from "./providers";
import { WebSearchUnavailableError, searchWeb } from "./web-search";
import { retrieveRagContext, type RagRole } from "./knowledge";

/** Public roles allowed to request live web data. The set is server-side so UI switches never expand policy. */
export const WEB_RESEARCH_ROLE_POLICY: ReadonlySet<RagRole> = new Set<RagRole>(["fast", "smart", "context", "flagship"]);

function memoryContext(profile: { profile: string; summary: string }, facts: Array<{ fact: string }>) {
  const rows = [profile.profile.trim(), profile.summary.trim(), ...facts.slice(0, 20).map((fact) => `• ${fact.fact}`)].filter(Boolean);
  return rows.join("\n").slice(0, 2_000);
}

export async function buildChatContext(userId: number, sessionId: string, input: { attachmentIds?: string[]; webSearch?: boolean; query?: string; role?: RagRole }): Promise<ChatSettings> {
  const [preferences, profile, facts] = await Promise.all([getUserSettings(userId), getMemoryProfile(userId), listRelevantMemoryFacts(userId, input.query ?? "", 20)]);
  const attachments = preferences.toolAccess && input.attachmentIds?.length ? await getOwnedChatAttachments(userId, sessionId, input.attachmentIds.slice(0, 4)) : [];
  const documentContext = getAttachmentPromptText(attachments);
  const imageUrls = await Promise.all(attachments.filter((attachment) => attachment.kind === "image").map(async (attachment) => (await getOwnedAttachmentDownload(userId, attachment.id)).url));

  const context: ChatSettings = {
    style: preferences.responseStyle,
    responseLength: preferences.responseLength,
    quickReplies: Boolean(preferences.quickReplies),
    effort: preferences.effort,
    thinking: Boolean(preferences.thinking),
    toolAccess: Boolean(preferences.toolAccess),
    ...(profile.enabled ? { memoryContext: memoryContext(profile, facts) } : {}),
    ...(documentContext ? { documentContext } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
  };

  if (preferences.toolAccess && preferences.webSearch && input.webSearch && WEB_RESEARCH_ROLE_POLICY.has(input.role ?? "flagship")) {
    try {
      const search = await searchWeb("Собери только релевантные актуальные факты и источники для запроса пользователя:\n" + (input.query?.slice(0, 8_000) ?? ""));
      context.webResearch = search.summary;
      context.webSources = search.sources;
    } catch (error) {
      if (!(error instanceof WebSearchUnavailableError)) throw error;
      // Search has already persisted a final honest status. The chat remains usable without invented sources.
    }
  }
  try {
    const rag = await retrieveRagContext(input.query ?? "", input.role ?? "flagship");
    if (rag) {
      context.ragResearch = rag.context;
      context.ragSources = rag.sources.map(({ title, url, publishedAt }) => ({ title, url, publishedAt }));
    }
  } catch {
    // RAG is optional: a temporary knowledge-base fault never blocks a private chat.
  }
  return context;
}

/** Conservative asynchronous extraction keeps private text on the server and never delays an accepted chat turn. */
export async function extractMemoryFacts(userId: number, userText: string, sourceMessageId?: number | null) {
  const profile = await getMemoryProfile(userId);
  if (!profile.enabled || !profile.autoExtract) return;
  const patterns = [
    /(?:меня зовут|моё имя)\s*[:—-]?\s*([^.!?\n]{2,80})/i,
    /(?:я живу|живу я)\s+(?:в|на)\s+([^.!?\n]{2,100})/i,
    /(?:я предпочитаю|мне нравится|мне удобнее)\s+([^.!?\n]{3,160})/i,
    /(?:я работаю|работаю я)\s+(?:в|как|над)\s+([^.!?\n]{3,160})/i,
  ];
  const candidates = patterns.flatMap((pattern) => {
    const matched = userText.match(pattern)?.[1]?.trim();
    return matched ? [matched.replace(/[«»"']/g, "")] : [];
  });
  await Promise.all(candidates.slice(0, 2).map((fact) => createMemoryFact(userId, fact, sourceMessageId, "auto")));
}

import { getAttachmentPromptText, getOwnedAttachmentDownload } from "./attachments";
import { createMemoryFact, getMemoryProfile, getOwnedChatAttachments, getUserSettings, listMemoryFacts } from "./db";
import type { ChatSettings } from "./providers";
import { searchWeb } from "./web-search";

function memoryContext(profile: { profile: string; summary: string }, facts: Array<{ fact: string }>) {
  const rows = [profile.profile.trim(), profile.summary.trim(), ...facts.slice(0, 16).map((fact) => `• ${fact.fact}`)].filter(Boolean);
  return rows.join("\n").slice(0, 5_000);
}

export async function buildChatContext(userId: number, sessionId: string, input: { attachmentIds?: string[]; webSearch?: boolean; query?: string }): Promise<ChatSettings> {
  const [preferences, profile, facts] = await Promise.all([getUserSettings(userId), getMemoryProfile(userId), listMemoryFacts(userId)]);
  const attachments = input.attachmentIds?.length ? await getOwnedChatAttachments(userId, sessionId, input.attachmentIds.slice(0, 4)) : [];
  const documentContext = getAttachmentPromptText(attachments);
  const imageUrls = await Promise.all(attachments.filter((attachment) => attachment.kind === "image").map(async (attachment) => (await getOwnedAttachmentDownload(userId, attachment.id)).url));

  const context: ChatSettings = {
    style: preferences.responseStyle,
    responseLength: preferences.responseLength,
    quickReplies: Boolean(preferences.quickReplies),
    effort: preferences.effort,
    thinking: Boolean(preferences.thinking),
    ...(profile.enabled ? { memoryContext: memoryContext(profile, facts) } : {}),
    ...(documentContext ? { documentContext } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
  };

  if (preferences.webSearch && input.webSearch) {
    const search = await searchWeb("Собери только релевантные актуальные факты и источники для запроса пользователя:\n" + (input.query?.slice(0, 8_000) ?? ""));
    context.webResearch = search.summary;
    context.webSources = search.sources;
  }
  return context;
}

/** Conservative server-side extraction avoids sending private chat text to another processor solely for memory. */
export async function extractMemoryFacts(userId: number, userText: string) {
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
  await Promise.all(candidates.slice(0, 2).map((fact) => createMemoryFact(userId, fact)));
}

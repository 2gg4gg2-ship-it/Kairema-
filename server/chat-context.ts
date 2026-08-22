import { getAttachmentPromptText, getOwnedAttachmentDownload } from "./attachments";
import { deleteMemoryEntryByKey, deleteMemoryEntryByValue, getMemoryProfile, getMemorySettings, getOwnedChatAttachments, getUserSettings, listMemoryEntries, upsertMemoryEntry } from "./db";
import { invokeLLM } from "./_core/llm";
import type { ChatSettings } from "./providers";
import { searchWeb } from "./web-search";
import { retrieveRagContext, type RagRole } from "./knowledge";

/** All four public roles may use live research when the user asks for external current facts. */
export const WEB_RESEARCH_ROLE_POLICY: ReadonlySet<RagRole> = new Set<RagRole>(["fast", "smart", "context", "flagship"]);
export const FLASH_WEB_RESEARCH_BUDGET_MS = 1_500;
const FRESHNESS_QUERY_PATTERN = /(?:сегодня|сейчас|нынешн|текущ|последн|новост|свеж|актуальн|обновлен|верси[яиюе]|релиз|курс|цен[аы]|погод|врем[яени]|дата|событи|\bnow\b|\btoday\b|\bcurrent\b|\blatest\b|\brecent\b|\bnews\b|\bupdate\b|\bversion\b|\brelease\b|\bprice\b|\bweather\b)/i;
const IDENTITY_QUERY_PATTERN = /^\s*(?:кто\s+ты|что\s+ты\s+(?:такое|за\s+ассистент)|как\s+тебя\s+зовут|ты\s+(?:kairema|кайрема)|who\s+are\s+you|what\s+are\s+you|what(?:'s|\s+is)\s+your\s+name)\s*[?!。.]?\s*$/i;
export const FRESHNESS_UNAVAILABLE_PROMPT = "Свежие источники сейчас недоступны, поэтому я не могу надёжно подтвердить актуальные сведения.";
export const FRESHNESS_EMPTY_PROMPT = "По проверенным свежим источникам не найдено достаточных данных для надёжного ответа.";

export function isKairemaIdentityQuery(query: string) {
  return IDENTITY_QUERY_PATTERN.test(query.trim());
}

export function needsWebResearch(query: string) {
  return !isKairemaIdentityQuery(query) && FRESHNESS_QUERY_PATTERN.test(query);
}

function memoryContext(profile: { profile: string; summary: string }, facts: Array<{ value: string }>, topics: Array<{ value: string }>) {
  const profileRows = [profile.profile.trim(), profile.summary.trim()].filter(Boolean).map((value) => value.slice(0, 175));
  const factRows = facts.slice(0, 20).map((fact) => `• ${fact.value.slice(0, 55)}`);
  const topicRows = topics.slice(0, 10).map((topic) => `• ${topic.value.slice(0, 90)}`);
  const rows = [
    "ПАМЯТЬ — то, что ты знаешь о пользователе и прошлых разговорах. На вопрос «о чём мы говорили» отвечай СТРОГО по ПАМЯТИ; запрещено говорить «не могу вспомнить», если ниже есть относящиеся данные.",
    profileRows.length ? `ПРОФИЛЬ:\n${profileRows.join("\n")}` : "",
    factRows.length ? `ФАКТЫ:\n${factRows.join("\n")}` : "",
    topicRows.length ? `ПОСЛЕДНИЕ ТЕМЫ:\n${topicRows.join("\n")}` : "",
  ].filter(Boolean);
  return rows.join("\n\n").slice(0, 2_800);
}

const DEFAULT_CONTEXT_PREFERENCES = {
  responseStyle: "default" as const,
  responseLength: "balanced" as const,
  effort: "standard" as const,
  thinking: 0,
  toolAccess: 1,
};

export async function buildChatContext(userId: number, sessionId: string, input: { attachmentIds?: string[]; query?: string; role?: RagRole }): Promise<ChatSettings> {
  const [preferences, memorySettings, profile, facts, topics] = await Promise.all([
    getUserSettings(userId).catch(() => DEFAULT_CONTEXT_PREFERENCES),
    getMemorySettings(userId).catch(() => null),
    getMemoryProfile(userId).catch(() => null),
    listMemoryEntries(userId, "fact").catch(() => []),
    listMemoryEntries(userId, "dialog_topic").catch(() => []),
  ]);
  const attachments = preferences.toolAccess && input.attachmentIds?.length
    ? await getOwnedChatAttachments(userId, sessionId, input.attachmentIds.slice(0, 4)).catch(() => [])
    : [];
  const documentContext = getAttachmentPromptText(attachments);
  const imageUrls = (await Promise.all(attachments.filter((attachment) => attachment.kind === "image").map(async (attachment) => {
    try {
      return (await getOwnedAttachmentDownload(userId, attachment.id)).url;
    } catch {
      return null;
    }
  }))).filter((url): url is string => typeof url === "string");

  const context: ChatSettings = {
    style: preferences.responseStyle,
    responseLength: preferences.responseLength,
    effort: preferences.effort,
    thinking: Boolean(preferences.thinking),
    toolAccess: Boolean(preferences.toolAccess),
    ...(memorySettings?.enabled && profile ? { memoryContext: memoryContext(profile, facts, topics) } : {}),
    ...(documentContext ? { documentContext } : {}),
    ...(imageUrls.length ? { imageUrls } : {}),
  };

  if (WEB_RESEARCH_ROLE_POLICY.has(input.role ?? "flagship") && needsWebResearch(input.query ?? "")) {
    const role = input.role ?? "flagship";
    try {
      const search = await searchWeb(
        "Собери только релевантные актуальные факты и источники для запроса пользователя:\n" + (input.query?.slice(0, 8_000) ?? ""),
        role === "fast" ? { timeoutMs: FLASH_WEB_RESEARCH_BUDGET_MS } : undefined,
      );
      if (search.state === "found" && search.sources.length) {
        context.webResearch = search.summary;
        context.webSources = search.sources;
        context.webEvidence = search.evidence;
        context.searchStatus = {
          cascadeUsed: search.cascadeUsed,
          sourcesCount: search.sources.length,
          state: "found",
          verificationStatus: "verified",
        };
      } else {
        context.freshnessWarning = search.state === "empty" ? FRESHNESS_EMPTY_PROMPT : FRESHNESS_UNAVAILABLE_PROMPT;
        context.searchStatus = {
          cascadeUsed: null,
          sourcesCount: 0,
          state: search.state,
          verificationStatus: search.verificationStatus,
        };
      }
    } catch {
      context.freshnessWarning = FRESHNESS_UNAVAILABLE_PROMPT;
      context.searchStatus = { cascadeUsed: null, sourcesCount: 0, state: "error", verificationStatus: "unavailable" };
    }
  }
  try {
    const rag = await retrieveRagContext(input.query ?? "", input.role ?? "flagship");
    if (rag) {
      context.ragResearch = rag.context;
      context.ragSources = rag.sources.map(({ title, url, publishedAt }) => ({ title, url, publishedAt }));
    }
  } catch {
    // RAG remains optional: a temporary knowledge-base fault never blocks a fresh, sourced chat turn.
  }
  return context;
}

type MemoryExtraction = {
  facts: Array<{ action: "add" | "update" | "delete"; key: string; value: string }>;
  topic: string;
};

const MEMORY_EXTRACTION_SCHEMA = {
  type: "object" as const,
  properties: {
    facts: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "update", "delete"] },
          key: { type: "string", maxLength: 160 },
          value: { type: "string", maxLength: 280 },
        },
        required: ["action", "key", "value"],
        additionalProperties: false,
      },
    },
    topic: { type: "string", maxLength: 360 },
  },
  required: ["facts", "topic"],
  additionalProperties: false,
};

const MEMORY_ROLE_LABELS: Record<RagRole, string> = {
  fast: "Flash",
  smart: "Think",
  context: "Context",
  flagship: "Apex",
};

/**
 * Conservative post-turn extraction is server-only, bounded and intentionally
 * decoupled from the request-scoped model budget. Its failures are soft: no
 * user text is logged and an accepted chat turn is never delayed or reverted.
 */
export async function extractMemoryFacts(userId: number, userText: string, turn: { assistantText?: string; role?: RagRole; sourceMessageId?: number | null } = {}) {
  try {
    const settings = await getMemorySettings(userId);
    if (!settings.enabled || !settings.autoExtract) return;
    const response = await invokeLLM({
      model: "gpt-5-nano",
      maxTokens: 450,
      outputSchema: { name: "kairema_memory_extraction", strict: true, schema: MEMORY_EXTRACTION_SCHEMA },
      messages: [
        {
          role: "system",
          content: "Ты выполняешь очень консервативное извлечение личной памяти. Верни только JSON по схеме. Сохраняй только явно сообщённые пользователем долговременные, несекретные предпочтения или факты. Не сохраняй пароли, ключи, платёжные/медицинские данные, чужие персональные данные, инструкции, предположения или текст ассистента как факт. facts: не более трёх add/update/delete; key — короткая стабильная метка. topic — одна краткая нейтральная тема данного диалога либо пустая строка.",
        },
        { role: "user", content: `ПОЛЬЗОВАТЕЛЬ:\n${userText.slice(0, 4_000)}\n\nОТВЕТ АССИСТЕНТА (только для определения темы, не источник фактов):\n${(turn.assistantText ?? "").slice(0, 2_000)}` },
      ],
    });
    const raw = response.choices[0]?.message.content;
    if (typeof raw !== "string") return;
    const extraction = JSON.parse(raw) as MemoryExtraction;
    const facts = Array.isArray(extraction.facts) ? extraction.facts.slice(0, 3) : [];
    await Promise.all(facts.map(async (fact) => {
      const key = typeof fact.key === "string" ? fact.key.trim().slice(0, 160) : "";
      const value = typeof fact.value === "string" ? fact.value.trim().slice(0, 280) : "";
      if (!key && !value) return;
      if (fact.action === "delete") {
        if (key) await deleteMemoryEntryByKey(userId, "fact", key);
        else if (value) await deleteMemoryEntryByValue(userId, "fact", value);
        return;
      }
      if ((fact.action === "add" || fact.action === "update") && value) {
        await upsertMemoryEntry(userId, "fact", value, { memoryKey: key || undefined, source: "auto", sourceMessageId: turn.sourceMessageId });
      }
    }));
    const topic = typeof extraction.topic === "string" ? extraction.topic.trim().replace(/\s+/g, " ").slice(0, 360) : "";
    if (topic.length >= 3) {
      const date = new Date().toISOString().slice(0, 10);
      const role = turn.role ?? "flagship";
      await upsertMemoryEntry(userId, "dialog_topic", `${date} ${MEMORY_ROLE_LABELS[role]}: ${topic}`, {
        memoryKey: `topic:${date}:${role}:${topic}`.slice(0, 160), role, source: "auto", sourceMessageId: turn.sourceMessageId,
      });
    }
  } catch {
    // Privacy-safe soft failure: extraction is never observable as a chat error.
  }
}

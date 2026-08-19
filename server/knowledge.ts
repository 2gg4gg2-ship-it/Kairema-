import { createHash, randomUUID } from "node:crypto";
import { createKnowledgeRun, ensureKnowledgeSource, finishKnowledgeRun, listKnowledgeDocuments, listKnowledgeRuns, listKnowledgeSources, recordKnowledgeDocument, trimKnowledgeDocuments, upsertKnowledgeSource } from "./db";

export const OFFICIAL_RSS_SOURCES = [
  { id: "openai-news", displayName: "OpenAI News", feedUrl: "https://openai.com/news/rss.xml" },
  { id: "google-ai-blog", displayName: "Google AI Blog", feedUrl: "https://blog.google/technology/ai/rss/" },
] as const;

const MAX_FEED_BYTES = 2_000_000;
const MAX_ITEMS_PER_SOURCE = 30;
const MAX_DOCUMENTS_PER_SOURCE = 120;
const MAX_EXCERPT_CHARS = 1_200;
const MAX_DOCUMENT_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

type FeedEntry = { title: string; sourceUrl: string; excerpt: string; publishedAt: Date | null };
type RunTrigger = "manual" | "scheduled" | "startup";

class FeedFetchError extends Error {
  constructor(readonly status?: number) {
    super(status ? `RSS HTTP ${status}` : "RSS unavailable");
  }
}

function plainText(value: string | undefined) {
  return (value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/&(?:lt|#60);/gi, "<")
    .replace(/&(?:gt|#62);/gi, ">")
    .replace(/&(?:quot|#34);/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function tagValue(block: string, tag: string) {
  const escaped = tag.replace(/[:]/g, "\\:");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return plainText(match?.[1]);
}

function linkValue(block: string) {
  const attribute = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>(?:\s*<\/link>)?/i)?.[1];
  return plainText(attribute ?? tagValue(block, "link"));
}

function parseDate(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/** Parses feed data as inert text; only title, link, excerpt and date are retained. */
export function parseOfficialFeed(xml: string): FeedEntry[] {
  const blocks: string[] = [];
  const pattern = /<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) blocks.push(match[1]);
  return blocks.slice(0, MAX_ITEMS_PER_SOURCE).flatMap((block) => {
    const title = tagValue(block, "title").slice(0, 512);
    const sourceUrl = linkValue(block).slice(0, 512);
    const excerpt = (tagValue(block, "description") || tagValue(block, "summary") || tagValue(block, "content:encoded") || tagValue(block, "content")).slice(0, MAX_EXCERPT_CHARS);
    if (!title || !sourceUrl || !/^https:\/\//i.test(sourceUrl)) return [];
    return [{ title, sourceUrl, excerpt: excerpt || title, publishedAt: parseDate(tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated")) }];
  });
}

function safeFeedError(error: unknown) {
  return error instanceof FeedFetchError && error.status ? `RSS-источник вернул HTTP ${error.status}.` : "RSS-источник временно недоступен.";
}

async function fetchOfficialFeed(feedUrl: string): Promise<FeedEntry[]> {
  const response = await fetch(feedUrl, {
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "User-Agent": "Kairema-RAG/1.0" },
    signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new FeedFetchError(); });
  if (!response.ok) throw new FeedFetchError(response.status);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FEED_BYTES) throw new FeedFetchError();
  const xml = await response.text();
  if (xml.length > MAX_FEED_BYTES) throw new FeedFetchError();
  return parseOfficialFeed(xml);
}

export async function refreshKnowledgeBase(trigger: RunTrigger = "manual") {
  const outcomes: Array<{ sourceId: string; state: "success" | "failed"; fetchedCount: number; indexedCount: number; updatedCount: number }> = [];
  for (const source of OFFICIAL_RSS_SOURCES) {
    const runId = randomUUID();
    const startedAt = new Date();
    await ensureKnowledgeSource(source);
    await createKnowledgeRun({ id: runId, sourceId: source.id, trigger, state: "failed", fetchedCount: 0, indexedCount: 0, updatedCount: 0, error: null });
    try {
      const entries = await fetchOfficialFeed(source.feedUrl);
      let indexedCount = 0;
      let updatedCount = 0;
      for (const entry of entries) {
        const fingerprint = createHash("sha256").update(`${entry.sourceUrl}\n${entry.title}\n${entry.excerpt}`).digest("hex");
        const action = await recordKnowledgeDocument({ id: randomUUID(), sourceId: source.id, sourceUrl: entry.sourceUrl, title: entry.title, excerpt: entry.excerpt, fingerprint, publishedAt: entry.publishedAt });
        if (action === "created") indexedCount += 1;
        else updatedCount += 1;
      }
      await trimKnowledgeDocuments(source.id, MAX_DOCUMENTS_PER_SOURCE);
      await upsertKnowledgeSource({ ...source, state: "ready", lastFetchedAt: startedAt, lastSuccessAt: new Date(), lastError: null, indexedCount: entries.length });
      await finishKnowledgeRun(runId, { state: "success", fetchedCount: entries.length, indexedCount, updatedCount, error: null });
      outcomes.push({ sourceId: source.id, state: "success", fetchedCount: entries.length, indexedCount, updatedCount });
    } catch (error) {
      const reason = safeFeedError(error);
      await upsertKnowledgeSource({ ...source, state: "unavailable", lastFetchedAt: startedAt, lastSuccessAt: null, lastError: reason, indexedCount: 0 });
      await finishKnowledgeRun(runId, { state: "failed", fetchedCount: 0, indexedCount: 0, updatedCount: 0, error: reason });
      outcomes.push({ sourceId: source.id, state: "failed", fetchedCount: 0, indexedCount: 0, updatedCount: 0 });
    }
  }
  return outcomes;
}

const STOP_WORDS = new Set(["это", "как", "для", "что", "или", "про", "the", "and", "with", "from", "are", "was", "have", "что", "мне", "тебе", "пожалуйста"]);
function queryTerms(query: string) {
  return Array.from(new Set((query.toLocaleLowerCase("ru-RU").match(/[A-Za-zА-Яа-яЁё0-9]{3,}/g) ?? []).filter((term) => !STOP_WORDS.has(term)))).slice(0, 14);
}

export type RagSource = { title: string; url: string; publishedAt: string | null; sourceId: string };
export type RagResearch = { context: string; sources: RagSource[] };
export type RagRole = "fast" | "smart" | "context" | "flagship";

/** Keeps automatic retrieval proportional to each public role without exposing its provider chain. */
export const RAG_CONTEXT_PROFILES: Record<RagRole, { maxSources: number; maxContextChars: number }> = {
  fast: { maxSources: 1, maxContextChars: 1_400 },
  smart: { maxSources: 2, maxContextChars: 2_200 },
  context: { maxSources: 3, maxContextChars: 3_000 },
  flagship: { maxSources: 3, maxContextChars: 3_500 },
};

/** Conservative lexical retrieval avoids external embedding providers and only yields attributable public excerpts. */
export async function retrieveRagContext(query: string, role: RagRole = "flagship"): Promise<RagResearch | null> {
  const terms = queryTerms(query);
  if (!terms.length) return null;
  const cutoff = Date.now() - MAX_DOCUMENT_AGE_MS;
  const profile = RAG_CONTEXT_PROFILES[role];
  const documents = (await listKnowledgeDocuments()).filter((document) => document.publishedAt && document.publishedAt.getTime() >= cutoff);
  const scored = documents.map((document) => {
    const title = document.title.toLocaleLowerCase("ru-RU");
    const excerpt = document.excerpt.toLocaleLowerCase("ru-RU");
    const score = terms.reduce((total, term) => total + (title.includes(term) ? 4 : 0) + (excerpt.includes(term) ? 1 : 0), 0);
    return { document, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || Number(b.document.publishedAt ?? 0) - Number(a.document.publishedAt ?? 0)).slice(0, profile.maxSources);
  if (!scored.length) return null;
  const sources = scored.map(({ document }) => ({ title: document.title, url: document.sourceUrl, publishedAt: document.publishedAt?.toISOString() ?? null, sourceId: document.sourceId }));
  const context = ["Проверяемый справочный контекст RAG из официальных RSS. Используй его только по релевантности, учитывай дату публикации и не подменяй им web search.", ...scored.map(({ document }, index) => `[${index + 1}] ${document.title}\nИсточник: ${document.sourceUrl}\nДата: ${document.publishedAt?.toISOString().slice(0, 10) ?? "не указана"}\nФрагмент: ${document.excerpt.slice(0, 800)}`)].join("\n\n").slice(0, profile.maxContextChars);
  return { context, sources };
}

export async function getKnowledgeStatus() {
  return { sources: await listKnowledgeSources(), runs: await listKnowledgeRuns() };
}

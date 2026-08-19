import { getKnowledgeStatus, refreshKnowledgeBase, retrieveRagContext } from "../server/knowledge";

const outcomes = await refreshKnowledgeBase("manual");
const status = await getKnowledgeStatus();
const result = await retrieveRagContext("OpenAI и Google AI новости");

console.log(JSON.stringify({
  outcomes,
  sources: status.sources.map(({ id, displayName, state, indexedCount, lastFetchedAt, lastSuccessAt, lastError }) => ({ id, displayName, state, indexedCount, lastFetchedAt, lastSuccessAt, lastError })),
  latestRuns: status.runs.slice(0, 4).map(({ sourceId, trigger, state, fetchedCount, indexedCount, updatedCount, error }) => ({ sourceId, trigger, state, fetchedCount, indexedCount, updatedCount, error })),
  retrieval: result ? { sourceCount: result.sources.length, titles: result.sources.map(({ title }) => title), urls: result.sources.map(({ url }) => url) } : null,
}, null, 2));

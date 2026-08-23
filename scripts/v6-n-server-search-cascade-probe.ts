import { searchWeb } from "../server/web-search";

const result = await searchWeb("latest GPT model release 2026", { timeoutMs: 25_000 });
const dates = result.sources
  .map((source) => source.publishedAt)
  .filter((value): value is string => typeof value === "string")
  .sort();

console.log(JSON.stringify({
  event: "v6-n.server-search-cascade-probe",
  checkedAt: new Date().toISOString(),
  state: result.state,
  verificationStatus: result.verificationStatus,
  respondedLayer: result.cascadeUsed,
  sourceCount: result.sources.length,
  sourceDateMin: dates[0] ?? null,
  sourceDateMax: dates.at(-1) ?? null,
}, null, 2));

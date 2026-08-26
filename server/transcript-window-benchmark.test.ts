import { describe, expect, it } from "vitest";
import { runTranscriptWindowBenchmark } from "../scripts/transcript-window-benchmark";

describe("deterministic transcript-window benchmark isolation", () => {
  it("uses synthetic records only and demonstrates bounded selector output without network attempts", () => {
    const result = runTranscriptWindowBenchmark();
    const largest = result.tiers.at(-1);
    const contextRole = largest?.roles.find((role) => role.role === "context");

    expect(result.scope).toBe("isolated-in-memory-simulation");
    expect(result.networkGuardBlockedAttempts).toBe(0);
    expect(result.tiers.map((tier) => tier.historyRecords)).toEqual([100, 1_000, 10_000, 50_000]);
    expect(contextRole?.legacyFullHistory.recordReadsProxy).toBe(50_000);
    expect(contextRole?.boundedTranscript.recordReadsProxy).toBeLessThanOrEqual(contextRole?.budget.maxCandidateMessages ?? 0);
    expect(contextRole?.boundedTranscript.selectedMessages).toBeLessThanOrEqual(contextRole?.budget.maxCandidateMessages ?? 0);
    expect(contextRole?.selectedRecordRatio).toBeLessThan(0.001);
    expect(JSON.stringify(result)).not.toMatch(/user-|session-|secret|prompt|response/i);
  });
});

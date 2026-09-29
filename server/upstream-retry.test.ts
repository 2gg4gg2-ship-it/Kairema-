import { describe, expect, it, vi } from "vitest";

import { backoffMs, decideRetry, keyFingerprint, parseRetryAfter, retryUpstream, RETRY_BASE_MS, RETRY_MAX_BACKOFF_MS } from "./upstream-retry";

const MAX = 4;
const noSleep = vi.fn(async () => undefined);

describe("Retry-After", () => {
  it("reads a delay in seconds", () => {
    expect(parseRetryAfter("2")).toBe(2_000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(" 7 ")).toBe(7_000);
  });

  it("reads an HTTP date as an absolute instant", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
    // A date already in the past means "now", never a negative wait.
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:00 GMT", now + 5_000)).toBe(0);
  });

  it("treats a missing or unparsable header as absent", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });

  it("never waits longer than a minute, however large the header", () => {
    expect(parseRetryAfter("3600")).toBe(60_000);
  });
});

describe("exponential backoff", () => {
  const noJitter = () => 0;

  it("starts at the base and doubles", () => {
    expect(backoffMs(0, noJitter)).toBe(RETRY_BASE_MS);
    expect(backoffMs(1, noJitter)).toBe(1_000);
    expect(backoffMs(2, noJitter)).toBe(2_000);
    expect(backoffMs(3, noJitter)).toBe(4_000);
  });

  it("is capped so a long chain does not become an unbounded wait", () => {
    expect(backoffMs(10, noJitter)).toBe(RETRY_MAX_BACKOFF_MS);
  });

  it("adds jitter without ever shortening the wait", () => {
    for (let i = 0; i < 20; i += 1) {
      const withJitter = backoffMs(i);
      expect(withJitter).toBeGreaterThanOrEqual(backoffMs(i, noJitter));
      expect(withJitter).toBeLessThan(backoffMs(i, noJitter) + 251);
    }
  });
});

describe("deciding to retry", () => {
  it("retries a 429 within budget", () => {
    expect(decideRetry({ status: 429, retryAfterMs: null, attemptsUsed: 1, maxAttempts: MAX, retryIndex: 0 }).retry).toBe(true);
  });

  it("refuses a retry once the budget is spent", () => {
    const decision = decideRetry({ status: 429, retryAfterMs: null, attemptsUsed: MAX, maxAttempts: MAX, retryIndex: 0 });
    expect(decision.retry).toBe(false);
    expect(decision.reason).toBe("budget_exhausted");
  });

  it("waits exactly as long as Retry-After says", () => {
    expect(decideRetry({ status: 429, retryAfterMs: 1_500, attemptsUsed: 1, maxAttempts: MAX, retryIndex: 0 }).delayMs).toBe(1_500);
  });

  it("falls back to backoff when Retry-After is absent", () => {
    // The default jitter makes the value non-deterministic, so it is checked as a range around the
    // doubled base rather than an exact figure.
    const delay = decideRetry({ status: 429, retryAfterMs: null, attemptsUsed: 1, maxAttempts: MAX, retryIndex: 1 }).delayMs;
    expect(delay).toBeGreaterThanOrEqual(1_000);
    expect(delay).toBeLessThan(1_000 + 251);
  });

  it("does not repeat failures that would come back identical", () => {
    for (const status of [400, 401, 403, 404, 422, 500, 502, null]) {
      expect(decideRetry({ status, retryAfterMs: null, attemptsUsed: 1, maxAttempts: MAX, retryIndex: 0 }).retry, `status ${status}`).toBe(false);
    }
  });
});

describe("running an upstream request with retries", () => {
  it("waits for the named Retry-After before the next attempt", async () => {
    const sleep = vi.fn(async () => undefined);
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, status: 429, error: new Error("rate limited"), retryAfterMs: 1_500 })
      .mockResolvedValueOnce({ ok: true as const, value: "answer" });

    const result = await retryUpstream({ maxAttempts: MAX, run, sleep });

    expect(result.value).toBe("answer");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_500);
  });

  it("backs off when the provider gives no Retry-After", async () => {
    const sleep = vi.fn(async () => undefined);
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, status: 429, error: new Error("rate limited") })
      .mockResolvedValueOnce({ ok: false as const, status: 429, error: new Error("rate limited") })
      .mockResolvedValueOnce({ ok: true as const, value: "answer" });

    await retryUpstream({ maxAttempts: MAX, run, sleep });

    // 500ms then 1s: each retry waits longer than the one before.
    const delays = sleep.mock.calls.map(([ms]) => ms as number);
    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[0]).toBeGreaterThanOrEqual(RETRY_BASE_MS);
    expect(delays[1]).toBeGreaterThanOrEqual(1_000);
  });

  it("never exceeds the shared budget, however long the provider says it is limited", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false as const, status: 429, error: new Error("rate limited"), retryAfterMs: 10 });
    const result = await retryUpstream({ maxAttempts: MAX, run, sleep: noSleep });
    // Four attempts is the whole budget. There is no second budget behind this one.
    expect(run).toHaveBeenCalledTimes(MAX);
    expect(result.attempts).toHaveLength(MAX);
    expect(result.rateLimited).toBe(true);
  });

  it("counts a retry against the budget the caller already spent", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false as const, status: 429, error: new Error("rate limited"), retryAfterMs: 1 });
    // Two attempts were already used elsewhere, so only two remain of the four.
    await retryUpstream({ maxAttempts: MAX, attemptsUsed: 2, run, sleep: noSleep });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stops immediately on a success and does not spend the rest of the budget", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true as const, value: "answer" });
    const result = await retryUpstream({ maxAttempts: MAX, run, sleep: noSleep });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.value).toBe("answer");
    expect(result.rateLimited).toBe(false);
  });

  it("does not repeat an error that is not a rate limit", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false as const, status: 401, error: new Error("bad key") });
    const result = await retryUpstream({ maxAttempts: MAX, run, sleep: noSleep });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.rateLimited).toBe(false);
    expect((result.error as Error).message).toBe("bad key");
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort();
      return { ok: false as const, status: 429, error: new Error("rate limited"), retryAfterMs: 5_000 };
    });
    await retryUpstream({ maxAttempts: MAX, run, sleep: noSleep, signal: controller.signal });
    // The pending wait is abandoned rather than slept through after the user cancelled.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports each attempt's status so a rate limit is visible in diagnostics", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, status: 429, error: new Error("a"), retryAfterMs: 1 })
      .mockResolvedValueOnce({ ok: true as const, value: "answer" });
    const result = await retryUpstream({ maxAttempts: MAX, run, sleep: noSleep });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([429, 200]);
  });
});

describe("the key fingerprint used in diagnostics", () => {
  const key = "sk-or-v1-abcdefghijklmnop";

  it("is stable for one key and different for another", () => {
    expect(keyFingerprint(key)).toBe(keyFingerprint(key));
    expect(keyFingerprint(key)).not.toBe(keyFingerprint("sk-or-v1-zyxwvutsrqponm"));
  });

  it("is short and prefixed, so it reads as a fingerprint and not as a credential", () => {
    expect(keyFingerprint(key)).toMatch(/^kf_[0-9a-f]{12}$/);
  });

  it("never contains any part of the key itself", () => {
    const fingerprint = keyFingerprint(key);
    expect(fingerprint).not.toContain(key);
    expect(fingerprint).not.toContain(key.slice(-8));
    expect(fingerprint.toLowerCase()).not.toContain("sk-or");
  });
});

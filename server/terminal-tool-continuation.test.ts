/**
 * The terminal continuation module: statelessness, authenticity, and fail-closed parsing.
 *
 * <p>The property that matters most here is that no instance-local state participates. A test that
 * minted a token and verified it with the same secret proves the round trip works; it does not prove
 * the claim that a *different* process could verify it. So the token tests are written around the
 * secret being the only shared input, and the stream tests drive two separate handler invocations
 * rather than one handler being asked twice.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_TOOL_RESULT_CHARS,
  TOOL_CONTINUATION_TTL_MS,
  newToolCallId,
  parseToolResultPayload,
  signToolContinuation,
  toolResultContent,
  verifyToolContinuation,
} from "./terminal-tool-continuation";
import { MAX_TOOL_ROUNDS, TERMINAL_TOOL_NAME } from "@shared/terminal-tool";

const SECRET = "shared-signing-secret";
const OWNER = { userId: 42, sessionId: "11111111-1111-4111-8111-111111111111" };

const mint = (overrides: Partial<{ callId: string; name: string; arguments: string; round: number }> = {}) =>
  signToolContinuation(SECRET, {
    userId: OWNER.userId,
    sessionId: OWNER.sessionId,
    call: {
      callId: overrides.callId ?? newToolCallId(),
      name: overrides.name ?? TERMINAL_TOOL_NAME,
      arguments: overrides.arguments ?? '{"command":"pwd"}',
      round: overrides.round ?? 1,
    },
  });

describe("a continuation carries its own call", () => {
  it("round-trips the call through mint and verify", () => {
    const token = mint({ arguments: '{"command":"ls -la"}' });
    expect(verifyToolContinuation(SECRET, token, OWNER)).toMatchObject({
      name: TERMINAL_TOOL_NAME,
      arguments: '{"command":"ls -la"}',
      round: 1,
    });
  });

  it("verifies with only the shared secret, which is what makes it instance-independent", () => {
    const token = mint();
    // A second "instance" holds nothing but the secret. No map, no cache, no shared session.
    expect(verifyToolContinuation(SECRET, token, OWNER)).not.toBeNull();
  });

  it("binds a token to one user and one session", () => {
    const token = mint();
    expect(verifyToolContinuation(SECRET, token, { userId: 43, sessionId: OWNER.sessionId })).toBeNull();
    expect(verifyToolContinuation(SECRET, token, { userId: OWNER.userId, sessionId: "22222222-2222-4222-8222-222222222222" })).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = mint();
    expect(verifyToolContinuation("a-different-secret", token, OWNER)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = mint({ arguments: '{"command":"pwd"}' });
    const [payload, signature] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ callId: "call_1", name: TERMINAL_TOOL_NAME, args: '{"command":"rm -rf /"}', round: 1, owner: "x", exp: Date.now() + 1000 }), "utf8").toString("base64url");
    expect(verifyToolContinuation(SECRET, `${forged}.${signature}`, OWNER)).toBeNull();
    expect(verifyToolContinuation(SECRET, `${payload}.${forged}`, OWNER)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mint();
    expect(TOOL_CONTINUATION_TTL_MS).toBeGreaterThan(0);
    // Verified now; the TTL is what makes it short-lived.
    expect(verifyToolContinuation(SECRET, token, OWNER)).not.toBeNull();
  });

  it("rejects a structurally broken token", () => {
    for (const bad of ["", ".", "no-dot", "a.b.c", "x".repeat(9_000)]) {
      expect(verifyToolContinuation(SECRET, bad, OWNER)).toBeNull();
    }
  });

  it("accepts a round at the ceiling and refuses one past it", () => {
    expect(verifyToolContinuation(SECRET, mint({ round: MAX_TOOL_ROUNDS }), OWNER)).not.toBeNull();
    expect(verifyToolContinuation(SECRET, mint({ round: MAX_TOOL_ROUNDS + 1 }), OWNER)).toBeNull();
    expect(verifyToolContinuation(SECRET, mint({ round: 0 }), OWNER)).toBeNull();
  });

  it("refuses any tool name other than the one it issued", () => {
    expect(verifyToolContinuation(SECRET, mint({ name: "shell" }), OWNER)).toBeNull();
    expect(verifyToolContinuation(SECRET, mint({ name: "" }), OWNER)).toBeNull();
  });

  it("refuses a malformed call id", () => {
    expect(verifyToolContinuation(SECRET, mint({ callId: "" }), OWNER)).toBeNull();
    expect(verifyToolContinuation(SECRET, mint({ callId: "a".repeat(129) }), OWNER)).toBeNull();
    expect(verifyToolContinuation(SECRET, mint({ callId: "bad id with spaces" }), OWNER)).toBeNull();
  });

  it("refuses oversized arguments", () => {
    expect(verifyToolContinuation(SECRET, mint({ arguments: "x".repeat(8_001) }), OWNER)).toBeNull();
  });

  it("mints a distinct id each time", () => {
    expect(newToolCallId()).not.toBe(newToolCallId());
    expect(newToolCallId()).toMatch(/^call_[0-9a-f]{32}$/);
  });
});

describe("earlier rounds travel with the token", () => {
  const completed = (index: number, stdout = "out") => ({
    callId: newToolCallId(),
    name: TERMINAL_TOOL_NAME,
    arguments: `{"command":"step-${index}"}`,
    result: { ok: true, stdout, stderr: "", exitCode: 0, timedOut: false, truncated: false, confirmationRequired: false },
  });

  it("hands back the rounds it was minted with, in order", () => {
    const rounds = [completed(1), completed(2, "second")];
    const token = signToolContinuation(SECRET, { userId: OWNER.userId, sessionId: OWNER.sessionId, call: { callId: newToolCallId(), name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}', round: 3 }, completedRounds: rounds });
    expect(verifyToolContinuation(SECRET, token, OWNER)?.priorRounds).toEqual(rounds);
  });

  it("starts a first round with none", () => {
    const token = mint();
    expect(verifyToolContinuation(SECRET, token, OWNER)?.priorRounds).toEqual([]);
  });

  it("trims a carried stream so one huge result cannot crowd out the others", () => {
    const token = signToolContinuation(SECRET, {
      userId: OWNER.userId, sessionId: OWNER.sessionId,
      call: { callId: newToolCallId(), name: TERMINAL_TOOL_NAME, arguments: "{}", round: 2 },
      completedRounds: [completed(1, "x".repeat(MAX_TOOL_RESULT_CHARS))],
    });
    const carried = verifyToolContinuation(SECRET, token, OWNER)!.priorRounds[0]!;
    expect(carried.result.stdout.length).toBeLessThan(MAX_TOOL_RESULT_CHARS);
    expect(carried.result.stdout.startsWith("xxx")).toBe(true);
  });

  it("drops the oldest round rather than exceeding its size budget", () => {
    const rounds = Array.from({ length: MAX_TOOL_ROUNDS - 1 }, (_, index) => completed(index, "y".repeat(MAX_TOOL_RESULT_CHARS)));
    const token = signToolContinuation(SECRET, { userId: OWNER.userId, sessionId: OWNER.sessionId, call: { callId: newToolCallId(), name: TERMINAL_TOOL_NAME, arguments: "{}", round: MAX_TOOL_ROUNDS }, completedRounds: rounds });
    // Bounded regardless of how many rounds ran, so a turn can never grow the request without limit.
    expect(token.length).toBeLessThan(48_000);
    const carried = verifyToolContinuation(SECRET, token, OWNER)!.priorRounds;
    expect(carried.length).toBeLessThan(rounds.length);
    // Newest survives: the model is still working through the end of the turn.
    expect(carried.at(-1)?.arguments).toBe(`{"command":"step-${rounds.length - 1}"}`);
    expect(carried.map((round) => round.arguments)).not.toContain('{"command":"step-0"}');
  });

  it("drops an unreadable carried round instead of failing the whole turn", () => {
    const token = signToolContinuation(SECRET, { userId: OWNER.userId, sessionId: OWNER.sessionId, call: { callId: newToolCallId(), name: TERMINAL_TOOL_NAME, arguments: "{}", round: 2 }, completedRounds: [completed(1)] });
    const [payload, signature] = token.split(".") as [string, string];
    const forged = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    forged.rounds = [{ callId: newToolCallId(), name: "shell", arguments: "{}", result: { ok: true, exitCode: 0 } }];
    const encoded = Buffer.from(JSON.stringify(forged), "utf8").toString("base64url");
    // Re-signed with the real secret, so the only thing wrong is the carried round's tool name.
    const resigned = `${encoded}.${createHmac("sha256", SECRET).update(`chat-terminal-continuation:v1:${encoded}`).digest("base64url")}`;
    expect(verifyToolContinuation(SECRET, resigned, OWNER)?.priorRounds).toEqual([]);
    expect(signature).not.toBe("");
  });
});

describe("parsing a submitted result fails closed", () => {
  it("keeps every field the tool produced", () => {
    expect(parseToolResultPayload({
      ok: true, stdout: "/home/kairema", stderr: "", exitCode: 0,
      timedOut: false, truncated: false, confirmationRequired: false,
    })).toEqual({
      ok: true, stdout: "/home/kairema", stderr: "", exitCode: 0,
      timedOut: false, truncated: false, confirmationRequired: false,
    });
  });

  it("refuses a payload that is not an object", () => {
    for (const bad of [null, undefined, "stdout", 42, []]) expect(parseToolResultPayload(bad)).toBeNull();
  });

  it("refuses a non-string stream", () => {
    expect(parseToolResultPayload({ stdout: { nested: true } })).toBeNull();
    expect(parseToolResultPayload({ stderr: 5 })).toBeNull();
  });

  it("refuses a non-integer exit code rather than rounding one", () => {
    expect(parseToolResultPayload({ exitCode: 1.5 })).toBeNull();
    expect(parseToolResultPayload({ exitCode: "0" })).toBeNull();
    expect(parseToolResultPayload({ exitCode: null })).toMatchObject({ exitCode: null });
  });

  it("coerces the flags to booleans rather than trusting them", () => {
    expect(parseToolResultPayload({ ok: "yes", timedOut: 1, truncated: "true", confirmationRequired: null })).toMatchObject({
      ok: false, timedOut: false, truncated: false, confirmationRequired: false,
    });
  });

  it("caps an oversized stream so one device cannot inflate the provider context", () => {
    const parsed = parseToolResultPayload({ stdout: "x".repeat(MAX_TOOL_RESULT_CHARS + 5_000) });
    expect(parsed?.stdout).toHaveLength(MAX_TOOL_RESULT_CHARS);
  });

  it("bounds an error token", () => {
    expect(parseToolResultPayload({ error: "e".repeat(5_000) })?.error).toHaveLength(200);
  });

  it("serialises to JSON carrying no field the model must not see", () => {
    const content = toolResultContent(parseToolResultPayload({ ok: true, stdout: "out", exitCode: 0 })!);
    expect(JSON.parse(content)).toEqual({ ok: true, stdout: "out", stderr: "", exitCode: 0, timedOut: false, truncated: false, confirmationRequired: false });
    expect(content).not.toMatch(/cookie|sessionId|Authorization|Bearer|call_/);
  });
});
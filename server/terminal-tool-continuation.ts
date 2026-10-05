/**
 * Resuming a model turn that paused for a tool call, with no server-side state.
 *
 * <p>The shape of the problem: the model asks to run a command, the command can only run on the
 * phone, and the phone is a different HTTP client. Something has to remember what the model asked
 * for between the two requests. The obvious thing — a map from call id to pending call — is exactly
 * what cannot be used: Render may hold more than one instance, the SSE stream and the follow-up
 * request can land on different ones, and the follow-up would arrive at an instance that has never
 * heard of the call. A single-instance deployment would hide the bug completely.
 *
 * <p>So nothing is remembered. The call is carried back to the client inside a signed, expiring
 * token, and the client's own request carries it home. HMAC is a pure function of the secret and the
 * payload, so every instance can verify a token another instance minted without talking to it. That
 * makes correctness independent of how the load balancer happens to route, and it adds no table, no
 * cache and no new infrastructure.
 *
 * <p>What the token buys is authenticity of everything the server would otherwise have to trust:
 * the tool name, the arguments and the call id all come back <em>signed</em>, so a client cannot
 * invent an assistant turn that asked for some other tool. The one thing that stays untrusted is the
 * tool result itself, which is unavoidable — it is output from a program the user asked to run — and
 * which is only ever fed back to the model as data. Nothing in this module executes anything.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { MAX_TOOL_ROUNDS, TERMINAL_TOOL_NAME } from "@shared/terminal-tool";

/** Bound on one tool result. Generous enough for a capped 8 KB stream plus its metadata. */
export const MAX_TOOL_RESULT_CHARS = 24_000;

/** How long a minted continuation stays usable. One round-trip is seconds, not minutes. */
export const TOOL_CONTINUATION_TTL_MS = 120_000;

/** A provider tool call id is opaque, but it must still be a short bounded token. */
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Ceiling on one carried tool result inside the token.
 *
 * <p>A result the model already read does not need to be re-sent at full length on every later
 * round, but it does need to be there: the model is stateless, so dropping an earlier round's output
 * would leave it reasoning about a working directory or a file listing it can no longer see.
 */
const CARRIED_RESULT_CHARS = 4_000;

/**
 * Ceiling on the whole encoded token.
 *
 * <p>This is what keeps the design viable without a database. Everything needed to resume the turn
 * rides in a value the client already has to send back, so the token must stay a fixed, modest size
 * however long the turn runs. When the budget is reached the <em>oldest</em> round is dropped, which
 * is the same rule the transcript window already applies to older conversation turns.
 */
const MAX_TOKEN_CHARS = 24_000;

/**
 * Longest token this module will look at, which is what the HTTP layer must accept.
 *
 * <p>Exported so the request schema and the verifier cannot disagree: a schema bound below the real
 * one would refuse legitimate turns once a turn had carried a few rounds, and a schema bound above it
 * would only invite oversized bodies the verifier then rejects anyway.
 */
export const MAX_CONTINUATION_TOKEN_CHARS = MAX_TOKEN_CHARS * 2;

/** The parts of a tool call the server signs. None of it is secret; all of it must be authentic. */
export type SignedToolCall = {
  callId: string;
  name: string;
  /** The raw JSON argument string the model produced, forwarded to the executor unchanged. */
  arguments: string;
  /** 1 for the first round of the turn. */
  round: number;
};

/** One completed round of the turn, as later rounds must see it. */
export type CarriedRound = {
  callId: string;
  name: string;
  arguments: string;
  result: ToolResultPayload;
};

/** The executor's answer, reduced to what a model may legitimately read. */
export type ToolResultPayload = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  confirmationRequired: boolean;
  error?: string;
};

/**
 * Parses a tool result submitted by a device, failing closed.
 *
 * <p>Every field is validated rather than coerced: an executor that invents a field, or a client
 * that posts something else entirely, yields null and the request is refused. The sizes are what
 * actually matter here — this payload is about to be forwarded to a provider, so an unbounded string
 * would let one device turn into an unbounded bill and an unbounded context.
 */
export function parseToolResultPayload(value: unknown): ToolResultPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = (input: unknown): string | null => {
    if (input === undefined || input === null) return "";
    if (typeof input !== "string") return null;
    return input.length > MAX_TOOL_RESULT_CHARS ? input.slice(0, MAX_TOOL_RESULT_CHARS) : input;
  };
  const stdout = text(record.stdout);
  const stderr = text(record.stderr);
  if (stdout === null || stderr === null) return null;
  const exitCode = record.exitCode;
  if (exitCode !== null && exitCode !== undefined && !Number.isInteger(exitCode)) return null;
  const error = record.error === undefined || record.error === null ? undefined : String(record.error).slice(0, 200);
  return {
    ok: record.ok === true,
    stdout,
    stderr,
    exitCode: typeof exitCode === "number" ? exitCode : null,
    timedOut: record.timedOut === true,
    truncated: record.truncated === true,
    confirmationRequired: record.confirmationRequired === true,
    ...(error ? { error } : {}),
  };
}

/** The exact JSON a model is given for one tool result. */
export function toolResultContent(payload: ToolResultPayload): string {
  return JSON.stringify(payload);
}

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret).update(`chat-terminal-continuation:v1:${payload}`).digest("base64url");
}

/** Binds a token to one user and one session, so it cannot be replayed into another conversation. */
function ownerTag(secret: string, userId: number, sessionId: string) {
  return createHmac("sha256", secret).update(`chat-terminal-owner:v1:${userId}:${sessionId}`).digest("base64url").slice(0, 24);
}

/**
 * Mints the opaque continuation handed to the client alongside the call.
 *
 * <p>Carries nothing secret: the tool name, the arguments and a random call id were all already
 * going to the client, which is the device that has to run them.
 *
 * <p>`completedRounds` are the rounds of this turn that have already run, newest last. They travel
 * with the token for the reason described on {@link CarriedRound}: without them the next request
 * would show the model only the last command it ran, and a turn like `cd` then `ls` would lose the
 * working directory it was asked about.
 */
export function signToolContinuation(secret: string, input: { userId: number; sessionId: string; call: SignedToolCall; completedRounds?: readonly CarriedRound[] }): string {
  const encode = (rounds: readonly CarriedRound[]) => Buffer.from(JSON.stringify({
    callId: input.call.callId,
    name: input.call.name,
    args: input.call.arguments,
    round: input.call.round,
    rounds: rounds.map(compactRound),
    owner: ownerTag(secret, input.userId, input.sessionId),
    exp: Date.now() + TOOL_CONTINUATION_TTL_MS,
  }), "utf8").toString("base64url");
  // Oldest first out, so what survives is the part of the turn the model is still working through.
  let carried = [...(input.completedRounds ?? [])];
  let payload = encode(carried);
  while (carried.length > 1 && payload.length > MAX_TOKEN_CHARS) {
    carried = carried.slice(1);
    payload = encode(carried);
  }
  return `${payload}.${signature(secret, payload)}`;
}

/** Trims a stream on the way in, so a long result cannot dominate the token budget. */
function compactRound(round: CarriedRound): CarriedRound {
  const clip = (value: string) => (value.length > CARRIED_RESULT_CHARS ? value.slice(0, CARRIED_RESULT_CHARS) : value);
  return { callId: round.callId, name: round.name, arguments: round.arguments.slice(0, 2_000), result: { ...round.result, stdout: clip(round.result.stdout), stderr: clip(round.result.stderr) } };
}

/**
 * Returns the trusted call behind a submitted token, or null.
 *
 * <p>Null covers every way this can be wrong — wrong shape, tampered payload, another user or
 * session, expired, a name that is not the one tool, a malformed call id, or a round past the
 * ceiling. The caller refuses the request on null rather than substituting anything, because every
 * one of these is a client that is not entitled to the call it is claiming.
 */
export function verifyToolContinuation(secret: string, token: string, input: { userId: number; sessionId: string }): SignedToolCall & { priorRounds: CarriedRound[] } | null {
  if (typeof token !== "string" || token.length > MAX_CONTINUATION_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = signature(secret, parts[0]!);
  const given = Buffer.from(parts[1]!);
  const expectedBuffer = Buffer.from(expected);
  if (given.length !== expectedBuffer.length || !timingSafeEqual(given, expectedBuffer)) return null;
  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { callId, name, args, round, owner, exp, rounds } = decoded;
  if (owner !== ownerTag(secret, input.userId, input.sessionId)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp < Date.now()) return null;
  if (typeof callId !== "string" || !CALL_ID_PATTERN.test(callId)) return null;
  // Only the one tool. A client cannot present a signed name of its own choosing, and this makes the
  // single-tool assumption explicit rather than implied.
  if (name !== TERMINAL_TOOL_NAME) return null;
  if (typeof args !== "string" || args.length > 8_000) return null;
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > MAX_TOOL_ROUNDS) return null;
  return { callId, name, arguments: args, round, priorRounds: parseCarriedRounds(rounds) };
}

/**
 * Reads back the earlier rounds, dropping any that do not parse.
 *
 * <p>Dropping rather than failing is deliberate and narrow: the current call is already authenticated
 * by the signature, so a malformed earlier round is a token this module itself would not have
 * produced. Refusing the whole request over it would turn a cosmetic defect into a dead turn.
 */
function parseCarriedRounds(value: unknown): CarriedRound[] {
  if (!Array.isArray(value)) return [];
  const parsed: CarriedRound[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const result = parseToolResultPayload(record.result);
    if (!result || typeof record.callId !== "string" || !CALL_ID_PATTERN.test(record.callId)) continue;
    if (record.name !== TERMINAL_TOOL_NAME || typeof record.arguments !== "string" || record.arguments.length > 8_000) continue;
    parsed.push({ callId: record.callId, name: TERMINAL_TOOL_NAME, arguments: record.arguments, result });
  }
  return parsed.slice(-MAX_TOOL_ROUNDS);
}

/** A fresh, provider-safe call id. */
export function newToolCallId(): string {
  return `call_${randomUUID().replace(/-/g, "")}`;
}
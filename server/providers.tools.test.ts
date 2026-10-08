/**
 * The provider-side tool-calling layer, tested against the real module rather than a copy of it.
 *
 * <p>Everything asserted here is observed through the exported surface: what actually goes into a
 * provider request, what actually comes back out, and what `chatWithRole`/`chatWithRoleStream` do
 * with a turn that stopped to call a tool. The two properties that matter most and are easiest to
 * lose are that a tool-only turn is a valid answer (it used to be filed as a PARSE failure and
 * discarded), and that `tools` is offered to exactly one provider and never to the rest of the chain.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  listProviderHealth: vi.fn().mockResolvedValue([]),
  upsertProviderHealth: vi.fn().mockResolvedValue(undefined),
  listRoleRuntimeStatus: vi.fn().mockResolvedValue([]),
  upsertRoleRuntimeStatus: vi.fn().mockResolvedValue(undefined),
  incrementProviderDailySuccess: vi.fn().mockResolvedValue(undefined),
  getProviderDailySuccess: vi.fn().mockResolvedValue(0),
  recordFlashTtftMetric: vi.fn().mockResolvedValue(undefined),
  recordTechnicalEvent: vi.fn().mockResolvedValue(undefined),
  listProviderControlFlags: vi.fn().mockResolvedValue([]),
}));

import { TERMINAL_SYSTEM_PROMPT, TERMINAL_TOOL, TERMINAL_TOOL_NAME } from "@shared/terminal-tool";
import { supportsToolCalling } from "@shared/provider-capabilities";
import {
  __resetProviderHealthForTests,
  chatWithRole,
  chatWithRoleStream,
  createToolCallAssembler,
  isToolsUnsupportedRejection,
  providerToolCalls,
  toApiChatMessage,
  type ChatSettings,
  type ToolCall,
} from "./providers";

const encoder = new TextEncoder();

/** The body of every provider request, in call order. */
function sentBodies(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => JSON.parse(String((call[1] as { body?: unknown } | undefined)?.body ?? "{}")) as Record<string, unknown>);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textResponse(content: string) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

/** A stream of raw SSE frames, exactly as a gateway sends them. */
function sseResponse(frames: unknown[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const toolOnlyBody = (id = "call_1") => ({ choices: [{ message: { content: null, tool_calls: [{ id, type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' } }] } }] });

const deltaFrame = (toolCalls: unknown[]) => ({ choices: [{ delta: { tool_calls: toolCalls } }] });

/** Stubs the providers the fast role chain tries first, leaving the rest unconfigured. */
function stubChainKeys(options: { openrouter?: string; orcarouter?: string; groq?: string; gemini?: string } = {}) {
  vi.stubEnv("OPENROUTER_API_KEY", options.openrouter ?? "");
  vi.stubEnv("ORCAROUTER_API_KEY", options.orcarouter ?? "");
  vi.stubEnv("GROQ_API_KEY", options.groq ?? "");
  vi.stubEnv("GEMINI_API_KEY", options.gemini ?? "");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetProviderHealthForTests();
});

describe("reading a completed turn", () => {
  it("returns no calls for an ordinary text answer", () => {
    expect(providerToolCalls(textResponse("Просто текст"))).toEqual([]);
  });

  it("returns no calls when the answer carries neither text nor tools", () => {
    expect(providerToolCalls({ choices: [{ message: { content: null } }] })).toEqual([]);
  });

  it("reads a tool call out of choices[].message.tool_calls", () => {
    expect(providerToolCalls(toolOnlyBody())).toEqual([
      { id: "call_1", type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' } },
    ]);
  });

  it("keeps the tool name the model asked for", () => {
    const [call] = providerToolCalls({ choices: [{ message: { tool_calls: [{ id: "c", function: { name: "some_other_tool", arguments: "{}" } }] } }] });
    expect(call!.function.name).toBe("some_other_tool");
  });

  it("keeps the argument string verbatim, including whitespace and quoting", () => {
    const raw = '{"command":"grep -n \'a b\' f.txt | wc -l"}';
    expect(providerToolCalls({ choices: [{ message: { tool_calls: [{ id: "c", function: { name: TERMINAL_TOOL_NAME, arguments: raw } }] } }] })[0]!.function.arguments).toBe(raw);
  });

  it("keeps every call of a turn that asked for several", () => {
    const body = { choices: [{ message: { tool_calls: [
      { id: "c1", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' } },
      { id: "c2", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"ls"}' } },
    ] } }] };
    expect(providerToolCalls(body).map((call) => call.id)).toEqual(["c1", "c2"]);
  });

  it("turns absent arguments into an empty object rather than an unparseable string", () => {
    expect(providerToolCalls({ choices: [{ message: { tool_calls: [{ id: "c", function: { name: TERMINAL_TOOL_NAME } }] } }] })[0]!.function.arguments).toBe("{}");
  });

  it("drops a call with no name, which cannot be dispatched", () => {
    expect(providerToolCalls({ choices: [{ message: { tool_calls: [{ id: "c", function: { arguments: "{}" } }] } }] })).toEqual([]);
  });

  it("survives a frame that is not an object at all", () => {
    for (const bad of [null, undefined, "text", 42]) expect(providerToolCalls(bad)).toEqual([]);
  });
});

describe("a tool-only turn is an answer, not a failure", () => {
  it("resolves with the calls instead of throwing a PARSE failure", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse(toolOnlyBody())));

    const result = await chatWithRole("fast", [{ role: "user", content: "Где я?" }], undefined, undefined, [TERMINAL_TOOL]);

    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([{ id: "call_1", type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' } }]);
    // Not retried onto another provider, and not reported as broken.
    expect(result.status.state).toBe("ready");
    expect(result.provider).toBe("openrouter");
  });

  it("still fails when a turn has neither text nor a tool call", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse({ choices: [{ message: { content: "" } }] })));

    await expect(chatWithRole("fast", [{ role: "user", content: "Пусто" }], undefined, undefined, [TERMINAL_TOOL])).rejects.toBeTruthy();
    // A genuinely empty answer is still a PARSE failure and is reported as one, exactly as before
    // this feature existed. The difference is that a *tool* turn no longer lands here.
    expect(fetchSpy.mock.calls.filter((call) => String(call[0]).includes("openrouter"))).toHaveLength(1);
  });
});

describe("projecting a conversation for the wire", () => {
  it("leaves an ordinary message byte-identical", () => {
    expect(toApiChatMessage({ role: "user", content: "hi" })).toEqual({ role: "user", content: "hi" });
    expect(Object.keys(toApiChatMessage({ role: "assistant", content: "yo" }))).toEqual(["role", "content"]);
  });

  it("serialises a tool result with the id and name it answers", () => {
    expect(toApiChatMessage({ role: "tool", content: "{}", tool_call_id: "c1", name: TERMINAL_TOOL_NAME }))
      .toEqual({ role: "tool", content: "{}", tool_call_id: "c1", name: TERMINAL_TOOL_NAME });
  });

  it("keeps tool_calls on the assistant turn that asked", () => {
    const call: ToolCall = { id: "c1", type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: "{}" } };
    expect(toApiChatMessage({ role: "assistant", content: "", tool_calls: [call] })).toEqual({ role: "assistant", content: "", tool_calls: [call] });
  });

  it("sends a resumed turn as assistant call plus matching tool result", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Ты в /home/kairema"));
    const call: ToolCall = { id: "c1", type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' } };

    await chatWithRole("fast", [
      { role: "user", content: "Где я?" },
      { role: "assistant", content: "", tool_calls: [call] },
      { role: "tool", content: '{"ok":true}', tool_call_id: "c1", name: TERMINAL_TOOL_NAME },
    ]);

    const messages = sentBodies(fetchSpy)[0]!.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(4);
    expect(messages[0]!.role).toBe("system");
    expect(messages[2]).toMatchObject({ role: "assistant", tool_calls: [call] });
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "c1", name: TERMINAL_TOOL_NAME });
  });
});

describe("which providers are offered tools", () => {
  it("sends the tool definition to OpenRouter unchanged", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(textResponse("ок")));

    await chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL]);

    expect(sentBodies(fetchSpy)[0]!.tools).toEqual([TERMINAL_TOOL]);
  });

  it("sends the tool definition to OrcaRouter because it supports tools", async () => {
    stubChainKeys({ orcarouter: "test-orcarouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(textResponse("ок")));

    const result = await chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL]);

    expect(result.provider).toBe("orcarouter");
    expect(sentBodies(fetchSpy)[0]!.tools).toEqual([TERMINAL_TOOL]);
  });

  it("sends no tools when the caller offered none", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(textResponse("ок")));

    await chatWithRole("fast", [{ role: "user", content: "hi" }]);

    expect("tools" in sentBodies(fetchSpy)[0]!).toBe(false);
  });

  it("sends no tools to a chain candidate without supportsTools", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key", gemini: "test-gemini-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.reject(new Error("upstream down")))
      .mockImplementation(() => Promise.resolve(textResponse("ок")));

    const result = await chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL]);

    expect(result.provider).toBe("google");
    const bodies = sentBodies(fetchSpy);
    expect("tools" in bodies.at(-1)!).toBe(false);
    const systemMsg = (bodies.at(-1)!.messages as Array<Record<string, unknown>>).find((m) => m.role === "system");
    expect((systemMsg?.content as string) ?? "").not.toContain(TERMINAL_SYSTEM_PROMPT);
  });

  it("claims tool support only for the provider whose contract was checked", () => {
    expect(supportsToolCalling("openrouter")).toBe(true);
    for (const provider of ["orcarouter", "zenmux", "groq", "sambanova", "mistral", "cerebras"]) {
      expect(supportsToolCalling(provider)).toBe(true);
    }
    for (const provider of ["dots", "deepseek", "google"]) {
      expect(supportsToolCalling(provider)).toBe(false);
    }
  });

  it("refuses tools for a provider that is not in the registry at all", () => {
    expect(supportsToolCalling("a-provider-that-does-not-exist")).toBe(false);
  });

  it("includes the terminal prompt in the system message only when the tool is offered", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(textResponse("ок")));

    await chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL]);

    const systemMsg = (sentBodies(fetchSpy)[0]!.messages as Array<Record<string, unknown>>).find((m) => m.role === "system");
    expect((systemMsg?.content as string) ?? "").toContain(TERMINAL_SYSTEM_PROMPT);
  });

  it("omits the terminal prompt from the system message when no tool is offered", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(textResponse("ок")));

    await chatWithRole("fast", [{ role: "user", content: "hi" }]);

    const systemMsg = (sentBodies(fetchSpy)[0]!.messages as Array<Record<string, unknown>>).find((m) => m.role === "system");
    expect((systemMsg?.content as string) ?? "").not.toContain(TERMINAL_SYSTEM_PROMPT);
  });
});

describe("a provider that rejects the tools key", () => {
  const toolsRejected = () => jsonResponse({ error: { message: "Unknown parameter: 'tools' is not supported" } }, 400);

  it("recognises only a 400 that names tools", () => {
    expect(isToolsUnsupportedRejection(400, { error: { message: "Unknown parameter: 'tools'" } })).toBe(true);
    expect(isToolsUnsupportedRejection(400, { message: "tool_choice is not allowed here" })).toBe(true);
  });

  it("does not mistake an ordinary 400 for a tools rejection", () => {
    expect(isToolsUnsupportedRejection(400, { error: { message: "model not found" } })).toBe(false);
  });

  it("does not mistake a 500 that happens to mention tools", () => {
    expect(isToolsUnsupportedRejection(500, { message: "the tools pipeline failed" })).toBe(false);
  });

  it("retries once without tools and the terminal prompt and returns that answer", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(toolsRejected())
      .mockResolvedValueOnce(textResponse("Ответ без tools"));

    const result = await chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL]);

    expect(result.content).toBe("Ответ без tools");
    const bodies = sentBodies(fetchSpy);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.tools).toEqual([TERMINAL_TOOL]);
    expect("tools" in bodies[1]!).toBe(false);
    const retrySystem = (bodies[1]!.messages as Array<Record<string, unknown>>).find((m) => m.role === "system");
    expect((retrySystem?.content as string) ?? "").not.toContain(TERMINAL_SYSTEM_PROMPT);
  });

  it("drops the terminal instruction when it retries without tools", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(toolsRejected())
      .mockResolvedValueOnce(textResponse("Ответ без tools"));

    // `terminalTool: true` means the first attempt's system prompt mentions the terminal. A 400 that
    // rejects `tools` retries as a plain chat, so the second attempt must NOT be told about a terminal
    // it cannot call — otherwise the model describes commands as text instead of staying a normal turn.
    await chatWithRole("fast", [{ role: "user", content: "hi" }], { terminalTool: true }, undefined, [TERMINAL_TOOL]);

    const bodies = sentBodies(fetchSpy);
    const secondMessages = bodies[1]!.messages as Array<Record<string, unknown>>;
    const secondSystem = String(secondMessages[0]!.content ?? "");
    expect(secondSystem).not.toContain("ТЕРМИНАЛ");
  });

  it("retries at most once, so a provider refusing tools twice cannot loop", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(toolsRejected());

    await expect(chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL])).rejects.toBeTruthy();

    // One original attempt plus one retry. No third request to the same provider.
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("does not retry an ordinary 400", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse({ error: { message: "model not found" } }, 400)));

    await expect(chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL])).rejects.toBeTruthy();

    const toOpenRouter = fetchSpy.mock.calls.filter((call) => String(call[0]).includes("openrouter")).length;
    expect(toOpenRouter).toBe(1);
  });

  it("does not retry a 500 that mentions tools", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(jsonResponse({ message: "tools subsystem down" }, 500)));

    await expect(chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL])).rejects.toBeTruthy();

    expect(fetchSpy.mock.calls.filter((call) => String(call[0]).includes("openrouter"))).toHaveLength(1);
  });

  it("remembers the refusal instead of paying for it on every later turn", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    // A fresh Response per call: a body can only be read once, so a reused instance would fail for
    // the wrong reason and hide what this test is about.
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(toolsRejected()))
      .mockImplementation(() => Promise.resolve(textResponse("ок")));

    await chatWithRole("fast", [{ role: "user", content: "one" }], undefined, undefined, [TERMINAL_TOOL]);
    await chatWithRole("fast", [{ role: "user", content: "two" }], undefined, undefined, [TERMINAL_TOOL]);

    const bodies = sentBodies(fetchSpy);
    // The second turn is a single request, and it goes out without the key.
    expect(bodies).toHaveLength(3);
    expect("tools" in bodies[2]!).toBe(false);
  });

  it("forgets the refusal when the per-process provider state is reset", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(toolsRejected()))
      .mockImplementation(() => Promise.resolve(textResponse("ок")));

    await chatWithRole("fast", [{ role: "user", content: "one" }], undefined, undefined, [TERMINAL_TOOL]);
    __resetProviderHealthForTests();
    await chatWithRole("fast", [{ role: "user", content: "two" }], undefined, undefined, [TERMINAL_TOOL]);

    const bodies = sentBodies(fetchSpy);
    // Discovery is paid again, exactly as it would be in a freshly started process: first turn
    // discovered it (request with tools, retry without), second turn starts over from the top.
    expect(bodies).toHaveLength(3);
    expect(bodies.at(-1)!.tools).toEqual([TERMINAL_TOOL]);
  });
});

describe("reassembling streamed tool calls", () => {
  it("still delivers ordinary streamed text", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(sseResponse([
      { choices: [{ delta: { content: "При" } }] },
      { choices: [{ delta: { content: "вет" } }] },
    ])));
    const deltas: string[] = [];

    const result = await chatWithRoleStream("fast", [{ role: "user", content: "hi" }], undefined, (delta) => deltas.push(delta), undefined, undefined, [TERMINAL_TOOL]);

    expect(deltas.join("")).toBe("Привет");
    expect(result.content).toBe("Привет");
    expect(result.toolCalls).toBeUndefined();
  });

  it("joins the fragments of one call into whole JSON arguments", () => {
    const assembler = createToolCallAssembler();
    assembler.push(deltaFrame([{ index: 0, id: "c1", function: { name: TERMINAL_TOOL_NAME, arguments: '{"comm' } }]));
    assembler.push(deltaFrame([{ index: 0, function: { arguments: 'and":"pwd"}' } }]));
    expect(assembler.finish()).toEqual([{ id: "c1", type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"pwd"}' } }]);
  });

  it("keeps two parallel calls apart by index", () => {
    const assembler = createToolCallAssembler();
    assembler.push(deltaFrame([{ index: 0, id: "c1", function: { name: TERMINAL_TOOL_NAME, arguments: '{"comm' } }]));
    assembler.push(deltaFrame([{ index: 1, id: "c2", function: { name: TERMINAL_TOOL_NAME, arguments: '{"comm' } }]));
    assembler.push(deltaFrame([{ index: 1, function: { arguments: 'and":"ls"}' } }]));
    assembler.push(deltaFrame([{ index: 0, function: { arguments: 'and":"pwd"}' } }]));
    expect(assembler.finish().map((call) => [call.id, call.function.arguments])).toEqual([
      ["c1", '{"command":"pwd"}'],
      ["c2", '{"command":"ls"}'],
    ]);
  });

  it("orders calls by index however they arrived", () => {
    const assembler = createToolCallAssembler();
    assembler.push(deltaFrame([{ index: 1, id: "second", function: { name: TERMINAL_TOOL_NAME, arguments: "{}" } }]));
    assembler.push(deltaFrame([{ index: 0, id: "first", function: { name: TERMINAL_TOOL_NAME, arguments: "{}" } }]));
    expect(assembler.finish().map((call) => call.id)).toEqual(["first", "second"]);
  });

  it("treats a call that never arrived as empty arguments rather than dropping it", () => {
    const assembler = createToolCallAssembler();
    assembler.push(deltaFrame([{ index: 0, id: "c1", function: { name: TERMINAL_TOOL_NAME } }]));
    expect(assembler.finish()).toEqual([{ id: "c1", type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: "{}" } }]);
  });

  it("resolves a streamed tool-only turn instead of calling it a PARSE failure", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(sseResponse([
      deltaFrame([{ index: 0, id: "call_x", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"ls"}' } }]),
    ])));
    const deltas: string[] = [];

    const result = await chatWithRoleStream("fast", [{ role: "user", content: "Что здесь?" }], undefined, (delta) => deltas.push(delta), undefined, undefined, [TERMINAL_TOOL]);

    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([{ id: "call_x", type: "function", function: { name: TERMINAL_TOOL_NAME, arguments: '{"command":"ls"}' } }]);
    // A command is not prose and must not leak into the visible answer.
    expect(deltas.join("")).toBe("");
  });
});

describe("the existing fallback behaviour is untouched", () => {
  it("still moves to the next candidate when the first provider fails outright", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key", orcarouter: "test-orcarouter-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.reject(new Error("upstream down")))
      .mockImplementationOnce(() => Promise.resolve(textResponse("Ответ резервного кандидата")));

    const result = await chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL]);

    expect(result.provider).toBe("orcarouter");
    expect(result.fallbackUsed).toBe(true);
    expect(result.content).toBe("Ответ резервного кандидата");
    expect(sentBodies(fetchSpy)[1]!.tools).toEqual([TERMINAL_TOOL]);
  });

  it("does not send tools or the terminal prompt to a fallback that does not support tools", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key", gemini: "test-gemini-key" });
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.reject(new Error("upstream down")))
      .mockImplementationOnce(() => Promise.resolve(textResponse("Ответ без tools")));

    const result = await chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL]);

    expect(result.provider).toBe("google");
    expect(result.fallbackUsed).toBe(true);
    const bodies = sentBodies(fetchSpy);
    expect("tools" in bodies.at(-1)!).toBe(false);
    const systemMsg = (bodies.at(-1)!.messages as Array<Record<string, unknown>>).find((m) => m.role === "system");
    expect((systemMsg?.content as string) ?? "").not.toContain(TERMINAL_SYSTEM_PROMPT);
  });

  it("reports a totally failed chain rather than inventing an answer", async () => {
    stubChainKeys({ openrouter: "test-openrouter-key" });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("upstream down")));

    await expect(chatWithRole("fast", [{ role: "user", content: "hi" }], undefined, undefined, [TERMINAL_TOOL])).rejects.toBeTruthy();
  });
});
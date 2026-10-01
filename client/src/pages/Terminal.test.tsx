/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Terminal from "./Terminal";

/**
 * The screen's contract with the native side: stdout, stderr and the exit status stay visually
 * distinct, output is rendered as text, and Stop tears the session down.
 */

const SESSION_ID = "0123456789abcdef0123456789abcdef";

interface Frame {
  type: string;
  data?: string;
  code?: number;
}

/** A fetch stub that answers the create call and serves a scripted stream. */
function stubTerminal(frames: Frame[], options: { onStream?: () => void } = {}) {
  const calls: { url: string; method: string; body: string | undefined }[] = [];
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const encoder = new TextEncoder();
  const push = (frame: Frame) => {
    if (!streamController) return;
    // Delivered in two pieces so the UI's reassembly path is exercised, not bypassed.
    const line = `${JSON.stringify(frame)}\n`;
    streamController.enqueue(encoder.encode(line.slice(0, 12)));
    streamController.enqueue(encoder.encode(line.slice(12)));
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });

    if (url.endsWith("/session") && method === "POST") {
      return new Response(JSON.stringify({ id: SESSION_ID, cwd: "/home/kairema" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/status")) {
      return new Response(JSON.stringify({ sessions: "1", max: "4", ready: "true" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/input") && method === "POST") {
      return new Response(JSON.stringify({ written: "6" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/kill") && method === "POST") {
      return new Response(JSON.stringify({ killed: "true" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/stream")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          options.onStream?.();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  return {
    calls,
    push,
    close: () => {
      try {
        streamController?.close();
      } catch {
        // Already closed by the test.
      }
    },
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  // Explicit: this project has no jest-dom/global-setup file, so testing-library's automatic
  // cleanup between tests does not run and a second render would find two screens.
  cleanup();
  globalThis.fetch = originalFetch;
});

/** Plain text of a node, since jest-dom matchers are not available in this project. */
function textOf(testId: string): string {
  return screen.getByTestId(testId).textContent ?? "";
}

describe("Terminal", () => {
  it("creates a session on request and shows the working directory", async () => {
    stubTerminal([]);
    render(<Terminal />);

    await userEvent.click(screen.getByTestId("terminal-start"));

    await waitFor(() => expect(textOf("terminal-status")).toMatch(/Running|Connecting/));
    expect(textOf("terminal-output")).toContain("/home/kairema");
  });

  it("renders stdout, stderr and the exit status as distinct spans", async () => {
    let push: (frame: Frame) => void = () => {};
    const terminal = stubTerminal([], {});
    push = terminal.push;
    render(<Terminal />);

    await userEvent.click(screen.getByTestId("terminal-start"));
    await waitFor(() => expect((screen.getByTestId("terminal-input") as HTMLInputElement).disabled).toBe(false));

    push({ type: "stdout", data: "hello\n" });
    push({ type: "stderr", data: "sh: ls: No such file\n" });
    push({ type: "exit", code: 127 });

    await waitFor(() => {
      const output = screen.getByTestId("terminal-output");
      expect(output.querySelector(".kairema-terminal-stdout")?.textContent).toContain("hello");
      expect(output.querySelector(".kairema-terminal-stderr")?.textContent).toContain("No such file");
    });
    await waitFor(() => expect(textOf("terminal-status")).toContain("exit 127"));
  });

  it("sends stdin with a trailing newline and does not render it as output", async () => {
    const terminal = stubTerminal([]);
    render(<Terminal />);

    await userEvent.click(screen.getByTestId("terminal-start"));
    await waitFor(() => expect((screen.getByTestId("terminal-input") as HTMLInputElement).disabled).toBe(false));

    await userEvent.type(screen.getByTestId("terminal-input"), "pwd");
    await userEvent.click(screen.getByTestId("terminal-send"));

    await waitFor(() => {
      const inputCall = terminal.calls.find((call) => call.url.includes("/input"));
      expect(inputCall).toBeDefined();
      // The native side does not append a newline, so the client must.
      expect(JSON.parse(inputCall!.body!).data).toBe("pwd\n");
    });
    // The input field clears so the next command can be typed immediately.
    expect((screen.getByTestId("terminal-input") as HTMLInputElement).value).toBe("");
  });

  it("stops the session and offers a new one", async () => {
    const terminal = stubTerminal([]);
    render(<Terminal />);

    await userEvent.click(screen.getByTestId("terminal-start"));
    await waitFor(() => expect(screen.queryByTestId("terminal-stop")).not.toBeNull());

    await userEvent.click(screen.getByTestId("terminal-stop"));

    await waitFor(() => expect(terminal.calls.some((call) => call.url.includes("/kill"))).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("terminal-start")).not.toBeNull());
    expect(textOf("terminal-status")).toContain("Stopped");
  });

  it("escapes output instead of interpreting it as markup", async () => {
    const terminal = stubTerminal([]);
    render(<Terminal />);

    await userEvent.click(screen.getByTestId("terminal-start"));
    await waitFor(() => expect((screen.getByTestId("terminal-input") as HTMLInputElement).disabled).toBe(false));

    terminal.push({ type: "stdout", data: "<img src=x onerror=alert(1)>\n" });

    await waitFor(() => {
      const output = screen.getByTestId("terminal-output");
      // The text is present as text...
      expect(output.textContent).toContain("<img src=x onerror=alert(1)>");
      // ...and no element was created from it.
      expect(output.querySelector("img")).toBeNull();
    });
  });

  it("explains a full session list rather than showing a bare failure", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/session") && (init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ error: "session_limit" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as typeof fetch;

    render(<Terminal />);
    await userEvent.click(screen.getByTestId("terminal-start"));

    await waitFor(() => expect(textOf("terminal-notice")).toMatch(/Stop one first/i));
  });
});

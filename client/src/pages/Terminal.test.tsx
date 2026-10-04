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
    await waitFor(() => expect((screen.getByTestId("terminal-input") as HTMLTextAreaElement).disabled).toBe(false));

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
    await waitFor(() => expect((screen.getByTestId("terminal-input") as HTMLTextAreaElement).disabled).toBe(false));

    await userEvent.type(screen.getByTestId("terminal-input"), "pwd");
    await userEvent.click(screen.getByTestId("terminal-send"));

    await waitFor(() => {
      const inputCall = terminal.calls.find((call) => call.url.includes("/input"));
      expect(inputCall).toBeDefined();
      // The native side does not append a newline, so the client must.
      expect(JSON.parse(inputCall!.body!).data).toBe("pwd\n");
    });
    // The input field clears so the next command can be typed immediately.
    expect((screen.getByTestId("terminal-input") as HTMLTextAreaElement).value).toBe("");
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
    await waitFor(() => expect((screen.getByTestId("terminal-input") as HTMLTextAreaElement).disabled).toBe(false));

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

  /**
   * The input must keep the newlines of pasted text.
   *
   * <p>A single-line `<input>` is not merely inconvenient for these cases, it is wrong: its value
   * sanitization algorithm strips CR and LF, so a paste is silently <em>concatenated</em> into one
   * line. `echo 'echo "HELLO"' > hello.sh` and `sh hello.sh` arrive at the shell as one malformed
   * command that writes a file called `hello.shsh`, which is why sending each line separately worked
   * and pasting them together did not.
   */
  describe("multiline input", () => {
    /** The `data` field of the single /input request the terminal made. */
    async function sentData(terminal: { calls: { url: string; body: string | undefined }[] }) {
      await waitFor(() =>
        expect(terminal.calls.some((call) => call.url.includes("/input"))).toBe(true),
      );
      const inputCall = terminal.calls.find((call) => call.url.includes("/input"));
      return JSON.parse(inputCall!.body!).data as string;
    }

    async function startSession() {
      const terminal = stubTerminal([]);
      render(<Terminal />);
      await userEvent.click(screen.getByTestId("terminal-start"));
      await waitFor(() =>
        expect((screen.getByTestId("terminal-input") as HTMLTextAreaElement).disabled).toBe(false),
      );
      return terminal;
    }

    it("accepts a paste that spans two commands, keeping the newline between them", async () => {
      const terminal = await startSession();

      await userEvent.click(screen.getByTestId("terminal-input"));
      await userEvent.paste('echo \'echo "HELLO"\' > hello.sh\nsh hello.sh');
      await userEvent.click(screen.getByTestId("terminal-send"));

      // Both lines reach the shell verbatim, separated by exactly the newline that was pasted.
      expect(await sentData(terminal)).toBe('echo \'echo "HELLO"\' > hello.sh\nsh hello.sh\n');
    });

    it("sends a multi-line shell script as one write, so the shell runs it in order", async () => {
      const terminal = await startSession();

      const script = ["cat > greet.sh <<'EOF'", 'echo "HELLO"', "EOF", "sh greet.sh"].join("\n");
      await userEvent.click(screen.getByTestId("terminal-input"));
      await userEvent.paste(script);
      await userEvent.click(screen.getByTestId("terminal-send"));

      const data = await sentData(terminal);
      expect(data).toBe(`${script}\n`);
      // The heredoc body must not be broken by the client; every line survives in order.
      expect(data.split("\n").slice(0, 4)).toEqual([
        "cat > greet.sh <<'EOF'",
        'echo "HELLO"',
        "EOF",
        "sh greet.sh",
      ]);
    });

    it("preserves a blank line between commands instead of collapsing it", async () => {
      const terminal = await startSession();

      await userEvent.click(screen.getByTestId("terminal-input"));
      await userEvent.paste("cd /tmp\n\nls -la");
      await userEvent.click(screen.getByTestId("terminal-send"));

      expect(await sentData(terminal)).toBe("cd /tmp\n\nls -la\n");
    });

    it("leaves shell operators for the shell, with no client-side splitting", async () => {
      const terminal = await startSession();

      const line = "printf 'a\\nb\\n' | tr -d '\\n' && echo done > out.txt";
      await userEvent.click(screen.getByTestId("terminal-input"));
      await userEvent.paste(line);
      await userEvent.click(screen.getByTestId("terminal-send"));

      // Pipes, && and redirection are untouched: the client is not a command parser.
      expect(await sentData(terminal)).toBe(`${line}\n`);
    });

    it("still submits a single command with Enter, and does not send per line", async () => {
      const terminal = await startSession();

      await userEvent.type(screen.getByTestId("terminal-input"), "uname -m{Enter}");

      // Exactly one write for one Enter, so Enter submits rather than inserting a newline.
      const inputCalls = terminal.calls.filter((call) => call.url.includes("/input"));
      await waitFor(() => expect(inputCalls.length).toBe(1));
      expect(JSON.parse(inputCalls[0].body!).data).toBe("uname -m\n");
    });

    it("inserts a newline on Shift+Enter without sending, so a block can be typed", async () => {
      const terminal = await startSession();

      const field = screen.getByTestId("terminal-input") as HTMLTextAreaElement;
      await userEvent.type(field, "first");
      await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
      await userEvent.type(field, "second");

      expect(field.value).toBe("first\nsecond");
      // Nothing was submitted by typing.
      expect(terminal.calls.some((call) => call.url.includes("/input"))).toBe(false);

      await userEvent.click(screen.getByTestId("terminal-send"));
      expect(await sentData(terminal)).toBe("first\nsecond\n");
    });

    it("uses a multiline control, which is what makes paste keep its newlines", async () => {
      await startSession();
      const field = screen.getByTestId("terminal-input");
      expect(field.tagName).toBe("TEXTAREA");
      // The reproduction: the same paste into a single-line control loses every newline.
      expect(field.getAttribute("type")).toBeNull();
    });
  });
});

/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TerminalSurface from "./TerminalSurface";

/**
 * The Chat <-> Terminal switch that hosts the existing on-device terminal.
 *
 * These assertions pin the things that are easy to break while changing the surface:
 * the switch has both halves, the pressed half is Terminal, going back is a callback the page
 * handles as state rather than a navigation, and the panel below is the real `Terminal` speaking
 * to the real loopback base. The last one matters: a re-implemented terminal would still pass a
 * rendering test but would not be the shipped one.
 */

const SESSION_ID = "0123456789abcdef0123456789abcdef";

const LABELS = { chat: "Чат", terminal: "Терминал", surface: "Чат / Терминал" };

let calls: { url: string; method: string }[] = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/session") && method === "POST") {
      return new Response(JSON.stringify({ id: SESSION_ID, cwd: "/home/kairema" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/status")) {
      return new Response(JSON.stringify({ sessions: "0", max: "4", ready: "true" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/stream")) {
      // Held open: the test only needs the request, not the frames.
      return new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    if (url.endsWith("/kill")) {
      return new Response(JSON.stringify({ ok: "true" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe("TerminalSurface", () => {
  it("shows both halves of the switch with Terminal selected", () => {
    render(<TerminalSurface labels={LABELS} onBackToChat={() => undefined} />);

    const group = screen.getByRole("group", { name: LABELS.surface });
    expect(group).toBeTruthy();
    expect(screen.getByTestId("terminal-surface-chat").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("terminal-surface-terminal").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("terminal-surface-chat").textContent).toContain(LABELS.chat);
    expect(screen.getByTestId("terminal-surface-terminal").textContent).toContain(LABELS.terminal);
  });

  it("returns to the chat through a callback rather than a navigation", async () => {
    let back = 0;
    render(<TerminalSurface labels={LABELS} onBackToChat={() => { back += 1; }} />);

    await userEvent.click(screen.getByTestId("terminal-surface-chat"));

    expect(back).toBe(1);
  });

  it("mounts the existing Terminal screen rather than a second implementation", () => {
    render(<TerminalSurface labels={LABELS} onBackToChat={() => undefined} />);

    // The testid lives on the shipped Terminal component; a re-implementation would not have it.
    expect(screen.getByTestId("terminal-screen")).toBeTruthy();
    expect(screen.getByTestId("terminal-start")).toBeTruthy();
  });

  it("drives the existing loopback terminal API when a session is started", async () => {
    render(<TerminalSurface labels={LABELS} onBackToChat={() => undefined} />);

    // Nothing is dialled on mount: the shell only starts on request.
    expect(calls).toHaveLength(0);

    await userEvent.click(screen.getByTestId("terminal-start"));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/local/terminal/session")).toBe(true),
    );
  });
});

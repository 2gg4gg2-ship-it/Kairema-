/* @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TerminalSurface from "./TerminalSurface";

/**
 * The terminal surface hosts the existing on-device terminal.
 *
 * The point of these assertions is that the surface is a host, not a second terminal: the mode
 * carousel is passed in by the page, so there is only ever one switcher, and the panel below is the
 * shipped `Terminal` talking to the shipped loopback base. A re-implemented terminal would still
 * pass a rendering test but would not be the one that ships.
 */

const SESSION_ID = "0123456789abcdef0123456789abcdef";

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
  it("mounts the existing Terminal screen rather than a second implementation", () => {
    render(<TerminalSurface modeRow={<span data-testid="passed-mode-row" />} />);

    // The testid lives on the shipped Terminal component; a re-implementation would not have it.
    expect(screen.getByTestId("terminal-screen")).toBeTruthy();
    expect(screen.getByTestId("terminal-start")).toBeTruthy();
  });

  it("renders the page's mode carousel instead of owning a switcher of its own", () => {
    render(<TerminalSurface modeRow={<span data-testid="passed-mode-row" />} />);

    expect(screen.getByTestId("passed-mode-row")).toBeTruthy();
    // Exactly one control in this surface: the carousel the page handed over, with no second copy.
    expect(screen.getAllByTestId("passed-mode-row")).toHaveLength(1);
  });

  it("drives the existing loopback terminal API when a session is started", async () => {
    render(<TerminalSurface modeRow={<span data-testid="passed-mode-row" />} />);

    // Nothing is dialled on mount: the shell only starts on request.
    expect(calls).toHaveLength(0);

    await userEvent.click(screen.getByTestId("terminal-start"));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/local/terminal/session")).toBe(true),
    );
  });
});
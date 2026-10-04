import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nextDiagId,
  reportAuthMe,
  routeLabel,
  startDiagFetch,
} from "./diag";

describe("routeLabel", () => {
  it("classifies the routes that matter instead of echoing the path", () => {
    expect(routeLabel("/api/trpc/auth.me", "GET")).toBe("trpc");
    expect(routeLabel("/api/chat", "POST")).toBe("api");
    expect(routeLabel("/", "GET")).toBe("document");
    expect(routeLabel("/assets/index-abc.js", "GET")).toBe("asset");
  });
});

describe("nextDiagId", () => {
  it("increases and keeps the native d<hex> shape", () => {
    const first = nextDiagId();
    const second = nextDiagId();
    expect(first).toMatch(/^d[0-9a-f]+$/);
    expect(second).toMatch(/^d[0-9a-f]+$/);
    expect(Number.parseInt(second.slice(1), 16)).toBeGreaterThan(
      Number.parseInt(first.slice(1), 16),
    );
  });
});

describe("startDiagFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the start and the total elapsed time of one request", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_450);
    const finish = startDiagFetch("d1", "GET", "/api/trpc/auth.me");

    finish("ok", 200);

    const lines = info.mock.calls.map(call => String(call[0]));
    expect(lines[0]).toContain("phase=fetch_start");
    expect(lines[0]).toContain("route=trpc");
    expect(lines[1]).toContain("phase=fetch_end");
    expect(lines[1]).toContain("outcome=ok");
    expect(lines[1]).toContain("status=200");
    expect(lines[1]).toContain("totalMs=450");
    expect(now).toHaveBeenCalled();
  });

  it("reports a failure without a status", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    startDiagFetch("d2", "POST", "/api/trpc/auth.me")("error");

    const last = String(info.mock.calls.at(-1)?.[0]);
    expect(last).toContain("outcome=error");
    expect(last).not.toContain("status=");
  });

  it("reports an outcome only once, so a retried promise cannot double count", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const finish = startDiagFetch("d3", "GET", "/api/trpc/auth.me");
    finish("ok", 200);
    finish("error");

    const endLines = info.mock.calls.filter(call => String(call[0]).includes("phase=fetch_end"));
    expect(endLines).toHaveLength(1);
  });
});

describe("reportAuthMe", () => {
  it("names the welcome-screen gate explicitly with its duration", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    reportAuthMe("d4", "error", undefined, 30_000);

    const line = String(info.mock.calls.at(-1)?.[0]);
    expect(line).toContain("phase=auth_me");
    expect(line).toContain("outcome=error");
    expect(line).toContain("ms=30000");
  });
});
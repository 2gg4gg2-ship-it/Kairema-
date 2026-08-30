import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sendTransactionalEmail, assertTestEmailAllowed, resetTestEmailCooldown } from "../server/email";

describe("email service", () => {
  const originalEnv = process.env.RESEND_API_KEY;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key_stub";
    resetTestEmailCooldown();
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalEnv;
    resetTestEmailCooldown();
    vi.useRealTimers();
  });

  it("rejects empty recipient", async () => {
    const result = sendTransactionalEmail({ to: " ", subject: "subj", html: "<p>hi</p>" });
    await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects subject longer than 255 characters", async () => {
    const result = sendTransactionalEmail({ to: "test@example.com", subject: "a".repeat(256), html: "<p>hi</p>" });
    await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns false when Resend API key is missing", async () => {
    process.env.RESEND_API_KEY = "";
    const result = await sendTransactionalEmail({ to: "test@example.com", subject: "subj", html: "<p>hi</p>" });
    expect(result).toBe(false);
  });

  it("returns false when Resend rejects the request", async () => {
    const original = global.fetch;
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 422, statusText: "Unprocessable Entity", text: async () => "validation error" });

    const result = await sendTransactionalEmail({ to: "test@example.com", subject: "subj", html: "<p>hi</p>" });
    expect(result).toBe(false);
    (global as any).fetch = original;
  });

  it("returns true when Resend accepts the request", async () => {
    const original = global.fetch;
    (global as any).fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK", text: async () => "{}" });

    const result = await sendTransactionalEmail({ to: "test@example.com", subject: "subj", html: "<p>hi</p>" });
    expect(result).toBe(true);
    expect((global as any).fetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    (global as any).fetch = original;
  });

  it("never exposes the API key in thrown errors or logs", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = global.fetch;
    (global as any).fetch = vi.fn().mockRejectedValue(new Error("network"));

    const result = await sendTransactionalEmail({ to: "test@example.com", subject: "subj", html: "<p>hi</p>" });
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
    const logs = consoleSpy.mock.calls.map((args) => args.join(" ")).join(" ");
    expect(logs).not.toContain("re_test_key_stub");
    consoleSpy.mockRestore();
    (global as any).fetch = original;
  });
});

describe("test email idempotency", () => {
  const originalEnv = process.env.RESEND_API_KEY;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key_stub";
    resetTestEmailCooldown();
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalEnv;
    resetTestEmailCooldown();
    vi.useRealTimers();
  });

  it("allows the first test email send", () => {
    expect(() => assertTestEmailAllowed("test@example.com")).not.toThrow();
  });

  it("blocks duplicate test email within cooldown window", () => {
    assertTestEmailAllowed("test@example.com");
    expect(() => assertTestEmailAllowed("test@example.com")).toThrow(/too recently/i);
  });

  it("allows test email after cooldown expires", () => {
    assertTestEmailAllowed("test@example.com");
    vi.advanceTimersByTime(60_001);
    expect(() => assertTestEmailAllowed("test@example.com")).not.toThrow();
  });
});

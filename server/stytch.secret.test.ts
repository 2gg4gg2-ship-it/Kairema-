import { describe, expect, it } from "vitest";

function getStytchProjectEndpoint(environment: string) {
  if (environment === "test" || environment.startsWith("test-")) return "https://test.stytch.com/v1/passwords/strength_check";
  if (environment === "live" || environment.startsWith("live-")) return "https://api.stytch.com/v1/passwords/strength_check";
  throw new Error("STYTCH_ENVIRONMENT должен обозначать test или live environment");
}

describe("Stytch SDK environment normalization", () => {
  it("maps project-scoped labels to official SDK API base URLs", async () => {
    const { stytchSdkEnvironment } = await import("./stytch");

    expect(stytchSdkEnvironment("test")).toBe("https://test.stytch.com/");
    expect(stytchSdkEnvironment("test-project")).toBe("https://test.stytch.com/");
    expect(stytchSdkEnvironment("live-project")).toBe("https://api.stytch.com/");
  });
});

describe("Stytch Consumer configuration", () => {
  it("accepts a lightweight server-side project health check without exposing credentials", async () => {
    const projectId = process.env.STYTCH_PROJECT_ID?.trim();
    const secret = process.env.STYTCH_SECRET?.trim();
    const environment = process.env.STYTCH_ENVIRONMENT?.trim();

    expect(projectId, "STYTCH_PROJECT_ID должен быть задан через защищённое поле").toBeTruthy();
    expect(secret, "STYTCH_SECRET должен быть задан через защищённое поле").toBeTruthy();
    expect(
      environment === "test" || environment?.startsWith("test-") || environment === "live" || environment?.startsWith("live-"),
      "STYTCH_ENVIRONMENT должен обозначать test или live environment",
    ).toBe(true);

    const response = await fetch(getStytchProjectEndpoint(environment!), {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${projectId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "KairemaProviderHealthOnly_7!" }),
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.ok, `Stytch password-strength health check вернул HTTP ${response.status}`).toBe(true);
  }, 20_000);

  it("accepts a trusted HTTPS callback origin without exposing its value", () => {
    const callbackBaseUrl = process.env.STYTCH_CALLBACK_BASE_URL?.trim();
    expect(callbackBaseUrl, "STYTCH_CALLBACK_BASE_URL должен быть задан через защищённое поле").toBeTruthy();

    const callbackOrigin = new URL(callbackBaseUrl!);
    expect(callbackOrigin.protocol, "Stytch callback должен использовать HTTPS").toBe("https:");
    expect(callbackOrigin.pathname, "Stytch callback base не должен содержать path").toBe("/");
    expect(callbackOrigin.search, "Stytch callback base не должен содержать query").toBe("");
    expect(callbackOrigin.hash, "Stytch callback base не должен содержать fragment").toBe("");
    expect(new URL("/api/stytch/callback", callbackOrigin).pathname).toBe("/api/stytch/callback");
  });
});
